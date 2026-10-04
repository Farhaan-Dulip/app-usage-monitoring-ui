import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { startTelemetryConsumer } from '../messaging/telemetryConsumer.js';

dotenv.config();

const mongoClient = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
const database = mongoClient.db(process.env.MONGO_DATABASE || 'app-usage-monitoring');
const telemetryEvents = database.collection('telemetry_events');

async function main() {
  await mongoClient.connect();
  await telemetryEvents.createIndex({ device_key: 1, timestamp: 1 }, { unique: true });
  await telemetryEvents.createIndex({ received_at: 1 });
  await startTelemetryConsumer({ telemetryEvents });
}

main().catch((error) => {
  console.error('Unable to start RabbitMQ telemetry consumer:', error);
  process.exit(1);
});
