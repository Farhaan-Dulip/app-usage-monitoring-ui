import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { startTelemetryConsumer } from '../messaging/telemetryConsumer.js';
import { ensureTelemetryIndexes } from '../services/telemetryPersistence.js';

dotenv.config();

const mongoClient = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
const database = mongoClient.db(process.env.MONGO_DATABASE || 'app-usage-monitoring');
const telemetryEvents = database.collection('telemetry_events');

async function main() {
  await mongoClient.connect();
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
