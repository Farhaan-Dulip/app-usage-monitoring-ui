// Creates the portal and telemetry tables in DynamoDB Local (same schema as the
// UsagePocServerless CDK stack).
//   DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/create-local-dynamo-tables.js
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

// endpoint 'aws' uses real DynamoDB with the default credential chain.
function clientFor(endpoint) {
  return endpoint === 'aws'
    ? new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
    : new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
}

export async function deleteTables({ endpoint, tables }) {
  const client = clientFor(endpoint);
  for (const TableName of tables) await client.send(new DeleteTableCommand({ TableName })).catch(() => {});
}

export async function createLocalTables({
  endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  portalTable = process.env.PORTAL_TABLE || 'usage-portal',
  telemetryTable = process.env.TELEMETRY_TABLE || 'usage-telemetry',
} = {}) {
  const client = clientFor(endpoint);
  const keySchema = {
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  };
  const tables = [
    { TableName: portalTable, ...keySchema },
    {
      TableName: telemetryTable,
      ...keySchema,
      AttributeDefinitions: [
        ...keySchema.AttributeDefinitions,
        { AttributeName: 'gpk', AttributeType: 'S' },
        { AttributeName: 'gsk', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [{
        IndexName: 'byReceived',
        KeySchema: [
          { AttributeName: 'gpk', KeyType: 'HASH' },
          { AttributeName: 'gsk', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      }],
    },
  ];
  for (const table of tables) {
    try {
      await client.send(new CreateTableCommand(table));
    } catch (error) {
      if (!(error instanceof ResourceInUseException)) throw error;
    }
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: table.TableName });
  }
  return { portalTable, telemetryTable };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('create-local-dynamo-tables.js')) {
  createLocalTables().then((tables) => console.log('Tables ready:', tables));
}
