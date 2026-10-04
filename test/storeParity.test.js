// Runs the same HTTP scenario against server.js on MongoDB and on DynamoDB.
// Opt-in, because it needs running databases:
//   PARITY_MONGO_URI=mongodb://localhost:27017 PARITY_DYNAMODB_ENDPOINT=http://localhost:8000 npm test
// PARITY_DYNAMODB_ENDPOINT=aws uses real DynamoDB (temporary tables, deleted afterwards).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { createLocalTables, deleteTables } from '../scripts/create-local-dynamo-tables.js';

const TOKEN = 'parity-service-token';
const CLIENT = { 'X-Client-Id': 'parity-client' };

async function startServer(env, port) {
  // Run from a neutral directory so a developer's .env (loaded by dotenv) cannot
  // inject credentials or settings into the test server.
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      MCP_SERVICE_TOKEN: TOKEN,
      ASSISTANT_AGENT_URL: 'http://127.0.0.1:9/unreachable',
      ASSISTANT_AGENT_TIMEOUT_MS: '1000',
      SES_SOURCE_EMAIL: '',
      SES_RECIPIENT_EMAIL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return { child, base };
    } catch { /* not listening yet */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`server.js did not start:\n${output}`);
}

async function call(base, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...CLIENT, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const owner = { owner: 'App Owner', ownerEmail: 'owner@example.com' };
const state = {
  licensePolicies: [{ name: 'Engineering tools', evaluationWindowValue: 30, evaluationWindowUnit: 'Days', workedThresholdHours: 8 }],
  licensedApps: [
    { id: 'application-postman', appName: 'Postman', processName: 'Postman.exe', monthlyCost: 20, appType: 'Application', ...owner },
    { id: 'application-vs-code', appName: 'VS Code', processName: 'code.exe', monthlyCost: 10, appType: 'Application', ...owner },
  ],
  onboardedAppLicenses: [
    { id: 'application-postman', appName: 'Postman', processName: 'Postman.exe', monthlyCost: 20, appType: 'Application', policy: { name: 'Engineering tools' }, ...owner },
  ],
  completedEvaluationDecisions: {
    'pc-1::application::postman.exe::1790000000000': {
      status: 'Reclaimable', savingsEligible: true, reason: 'Below policy thresholds', completedAt: 1790000600000,
    },
  },
  costOverrides: { 'pc-1::postman.exe': 25 },
  reportFrequency: 'Weekly',
  config: { licensed_apps: ['postman.exe'] },
};

function scenario(name, setup) {
  describe(name, () => {
    let server;
    let cleanup = async () => {};
    before(async () => {
      ({ server, cleanup } = await setup());
    });
    after(async () => {
      server?.child.kill();
      await cleanup();
    });

    test('state round-trips and removed records are deleted', async () => {
      assert.equal((await call(server.base, '/api/state', { method: 'PUT', body: state })).status, 200);
      const saved = (await call(server.base, '/api/state')).body;
      assert.deepEqual(saved.licensedApps.map((app) => app.appName), ['Postman', 'VS Code']);
      assert.deepEqual(saved.onboardedAppLicenses[0].policy, { name: 'Engineering tools' });
      assert.equal(saved.costOverrides['pc-1::postman.exe'], 25);
      const decision = saved.completedEvaluationDecisions['pc-1::application::postman.exe::1790000000000'];
      assert.equal(decision.status, 'Reclaimable');
      assert.equal(decision.completedAt, 1790000600000);
      assert.equal(saved.reportFrequency, 'Weekly');
      assert.deepEqual(saved.config, { licensed_apps: ['postman.exe'] });

      const trimmed = { ...state, licensedApps: state.licensedApps.slice(0, 1) };
      await call(server.base, '/api/state', { method: 'PUT', body: trimmed });
      assert.deepEqual((await call(server.base, '/api/state')).body.licensedApps.map((app) => app.appName), ['Postman']);
    });

    test('license request workflow with conditional approval', async () => {
      const created = await call(server.base, '/api/assistant/chat', {
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: 'Submit a request for a Postman license.' }],
          requester: { name: 'Requester', email: 'requester@example.com' },
        },
      });
      assert.equal(created.status, 201);
      const id = created.body.workflow.id;
      assert.match(id, /^[0-9a-f]{24}$/);
      assert.equal((await call(server.base, '/api/assistant/requests')).body.requests.length, 1);
      const approve = { method: 'PATCH', body: { action: 'approve' } };
      const approved = await call(server.base, `/api/license-requests/${id}`, approve);
      assert.equal(approved.status, 200);
      assert.equal(approved.body.request.status, 'approved');
      assert.equal((await call(server.base, `/api/license-requests/${id}`, approve)).status, 409);
    });

    test('questions fall back to database answers when the agent is down', async () => {
      const answer = await call(server.base, '/api/assistant/chat', {
        method: 'POST', body: { messages: [{ role: 'user', content: 'Which licenses can be reclaimed now?' }] },
      });
      assert.equal(answer.status, 200);
      assert.equal(answer.body.source, 'monitoring-agent-fallback');
      assert.match(answer.body.answer, /1 completed decision/);
    });

    test('MCP endpoints resolve Postman to postman.exe decisions', async () => {
      const headers = { 'X-MCP-Service-Token': TOKEN };
      assert.equal((await call(server.base, '/api/mcp/license-availability?appName=Postman')).status, 401);
      const availability = await call(server.base, '/api/mcp/license-availability?appName=Postman', { headers });
      assert.equal(availability.body.inventoryRecords, 1);
      assert.equal(availability.body.reclaimableDecisions, 1);
      const details = await call(server.base, '/api/mcp/reclaimable-details?appName=postman', { headers });
      assert.equal(details.body.details[0].pcName, 'pc-1');
    });

    test('telemetry is idempotent and readable incrementally', async () => {
      const sample = (timestamp) => ({ device_id: 'dev-1', device_name: 'PC-1', timestamp, usage: [{ app_name: 'code.exe' }] });
      await call(server.base, '/api/telemetry', { method: 'POST', body: sample('2026-10-05T10:00:00Z') });
      await call(server.base, '/api/telemetry', { method: 'POST', body: sample('2026-10-05T10:00:00Z') });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await call(server.base, '/api/telemetry', { method: 'POST', body: sample('2026-10-05T10:01:00Z') });
      const all = (await call(server.base, '/api/telemetry')).body;
      assert.deepEqual(all.map((row) => row.timestamp), ['2026-10-05T10:00:00Z', '2026-10-05T10:01:00Z']);
      assert.ok(all.every((row) => typeof row.received_at === 'string' && row.device_key === undefined));
      const newer = (await call(server.base, `/api/telemetry?since=${encodeURIComponent(all[0].received_at)}`)).body;
      assert.deepEqual(newer.map((row) => row.timestamp), ['2026-10-05T10:01:00Z']);
      assert.equal((await call(server.base, '/api/telemetry?since=not-a-date')).status, 400);
    });
  });
}

const mongoUri = process.env.PARITY_MONGO_URI;
const dynamoEndpoint = process.env.PARITY_DYNAMODB_ENDPOINT;

if (!mongoUri && !dynamoEndpoint) {
  test('store parity (skipped: set PARITY_MONGO_URI and/or PARITY_DYNAMODB_ENDPOINT)', { skip: true }, () => {});
}

if (mongoUri) {
  scenario('MongoDB store', async () => {
    const databaseName = `parity_${randomUUID().slice(0, 8)}`;
    const server = await startServer({ DATA_STORE: 'mongodb', MONGO_URI: mongoUri, MONGO_DATABASE: databaseName }, 3910);
    return {
      server,
      cleanup: async () => {
        const client = await MongoClient.connect(mongoUri);
        await client.db(databaseName).dropDatabase();
        await client.close();
      },
    };
  });
}

if (dynamoEndpoint) {
  scenario('DynamoDB store', async () => {
    const suffix = randomUUID().slice(0, 8);
    const tables = await createLocalTables({
      endpoint: dynamoEndpoint,
      portalTable: `parity-portal-${suffix}`,
      telemetryTable: `parity-telemetry-${suffix}`,
    });
    const real = dynamoEndpoint === 'aws';
    const server = await startServer({
      DATA_STORE: 'dynamodb',
      PORTAL_TABLE: tables.portalTable,
      TELEMETRY_TABLE: tables.telemetryTable,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      ...(real ? {} : { DYNAMODB_ENDPOINT: dynamoEndpoint, AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local' }),
    }, 3911);
    return {
      server,
      cleanup: () => deleteTables({ endpoint: dynamoEndpoint, tables: [tables.portalTable, tables.telemetryTable] }),
    };
  });
}
