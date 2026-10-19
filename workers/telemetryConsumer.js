import dotenv from 'dotenv';
import { startTelemetryConsumer } from '../messaging/telemetryConsumer.js';
import { startConfigPublisher } from '../messaging/configPublisher.js';
import { createDatabase } from '../services/database.js';
import { ensureTelemetryIndexes } from '../services/telemetryPersistence.js';

dotenv.config();

async function main() {
  const { database, connect } = await createDatabase(process.env);
  const telemetryEvents = database.collection('telemetry_events');
  const devices = database.collection('devices');
  await connect();
  await ensureTelemetryIndexes(telemetryEvents);
  const { connection } = await startTelemetryConsumer({
    telemetryEvents,
    devices,
    onClose: () => {
      console.error('Exiting so the supervisor restarts the consumer.');
      process.exit(1);
    },
  });
  // Approved license requests -> Trackers (see services/licenseGrants.js).
  await startConfigPublisher({ connection, outbox: database.collection('device_config_outbox') });
}

main().catch((error) => {
  console.error('Unable to start RabbitMQ telemetry consumer:', error);
  process.exit(1);
});
