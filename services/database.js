// Chooses the document store: MongoDB (container deployment, local dev) or
// DynamoDB (pay-per-use deployment) behind the same Db/Collection interface.
import { MongoClient } from 'mongodb';

export async function createDatabase(env = process.env) {
  if ((env.DATA_STORE || 'mongodb').toLowerCase() === 'dynamodb') {
    const { DynamoDatabase } = await import('./dynamoDatabase.js');
    const database = new DynamoDatabase({
      portalTable: env.PORTAL_TABLE,
      telemetryTable: env.TELEMETRY_TABLE,
      region: env.AWS_REGION,
      env,
    });
    return { database, connect: async () => {}, close: async () => {} };
  }
  const client = new MongoClient(env.MONGO_URI || 'mongodb://localhost:27017');
  return {
    database: client.db(env.MONGO_DATABASE || 'app-usage-monitoring'),
    connect: () => client.connect(),
    close: () => client.close(),
  };
}
