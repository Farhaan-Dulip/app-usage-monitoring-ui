import dotenv from 'dotenv';
import { startTelemetryConsumer } from '../messaging/telemetryConsumer.js';
import { createDatabase } from '../services/database.js';
import { ensureTelemetryIndexes } from '../services/telemetryPersistence.js';

dotenv.config();

async function main() {
  const { database, connect } = await createDatabase(process.env);
  const telemetryEvents = database.collection('telemetry_events');
  await connect();
  await ensureTelemetryIndexes(telemetryEvents);
  await startTelemetryConsumer({
    telemetryEvents,
    onClose: () => {
      console.error('Exiting so the supervisor restarts the consumer.');
      process.exit(1);
    },
  });
}

main().catch((error) => {
  console.error('Unable to start RabbitMQ telemetry consumer:', error);
  process.exit(1);
});
