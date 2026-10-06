// With ORIGIN_VERIFY_SECRET set (single-server deployment), only requests carrying
// CloudFront's secret header, or the agent's service token, reach the portal.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = 3921;
const base = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      PORT: String(PORT),
      // DynamoDB mode starts without connecting anywhere; no data calls are made here.
      DATA_STORE: 'dynamodb',
      PORTAL_TABLE: 'unused-portal',
      TELEMETRY_TABLE: 'unused-telemetry',
      ORIGIN_VERIFY_SECRET: 'cloudfront-secret',
      MCP_SERVICE_TOKEN: 'agent-token',
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await fetch(`${base}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server.js did not start');
});

after(() => child?.kill());

const status = async (headers = {}) => (await fetch(`${base}/health`, { headers })).status;

test('direct requests without the CloudFront header are refused', async () => {
  assert.equal(await status(), 403);
  assert.equal(await status({ 'X-Origin-Verify': 'wrong' }), 403);
});

test('CloudFront requests with the secret header are served', async () => {
  assert.equal(await status({ 'X-Origin-Verify': 'cloudfront-secret' }), 200);
});

test('in-network agent calls with the service token are served', async () => {
  assert.equal(await status({ 'X-MCP-Service-Token': 'agent-token' }), 200);
  assert.equal(await status({ 'X-MCP-Service-Token': 'wrong' }), 403);
});
