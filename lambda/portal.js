// AWS Lambda entry point for the portal API (pay-per-use deployment). Runs the
// same Express app as the container, on DynamoDB, behind a Lambda function URL
// that Amplify Hosting proxies /api/* to.
import serverless from 'serverless-http';
import { loadSsmEnv } from './ssmEnv.js';

await loadSsmEnv();
const { app, initialize } = await import('../server.js');
await initialize();

export const handler = serverless(app);
