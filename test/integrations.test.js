import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { cleanValues, credentialEnv, decrypt, encrypt, CredentialError } from '../services/aiTools/credentials.js';
import { createIntegrationsRouter, githubAuthorizeUrl } from '../services/aiTools/integrations.js';

function memoryCollection() {
  const docs = [];
  return {
    docs,
    find: () => ({ limit: () => ({ toArray: async () => docs }) }),
    async updateOne(filter, update) {
      const doc = docs.find((entry) => entry.vendor === filter.vendor);
      if (doc) Object.assign(doc, update.$set);
      else docs.push({ ...update.$set });
    },
    async deleteMany(filter) {
      const index = docs.findIndex((entry) => entry.vendor === filter.vendor);
      if (index >= 0) docs.splice(index, 1);
    },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('credentials are encrypted at rest and need the same key to read', () => {
  const record = encrypt({ anthropicAdminKey: 'sk-ant-admin-secret' }, 'key-1');
  assert.ok(!JSON.stringify(record).includes('sk-ant-admin-secret'));
  assert.deepEqual(decrypt(record, 'key-1'), { anthropicAdminKey: 'sk-ant-admin-secret' });
  assert.throws(() => decrypt(record, 'other-key'));
});

test('submitted values are validated per vendor', () => {
  assert.throws(() => cleanValues('claude', { anthropicAdminKey: 'sk-ant-api03-normal-key' }), CredentialError);
  assert.throws(() => cleanValues('codex', { codexAdminKey: 'k' }), /codexWorkspaceId is required/);
  assert.throws(() => cleanValues('notion', {}), (error) => error.statusCode === 404);
  assert.throws(() => cleanValues('zoom', { zoomAccountId: 'a', zoomClientId: 'b' }), /zoomClientSecret is required/);
  assert.deepEqual(cleanValues('copilot', { githubToken: ' t ', githubOrg: 'acme', ignored: 'x' }), { githubToken: 't', githubOrg: 'acme' });
});

test('portal-connected credentials override deployment values per vendor', async () => {
  const collection = memoryCollection();
  collection.docs.push({ vendor: 'claude', ...encrypt({ anthropicAdminKey: 'sk-ant-admin-portal' }, 'k') });
  const { env, sources } = await credentialEnv(collection, 'k', { ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-env', GITHUB_COPILOT_TOKEN: 'gh', GITHUB_ORG: 'acme' });
  assert.equal(env.ANTHROPIC_ADMIN_KEY, 'sk-ant-admin-portal');
  assert.equal(sources.claude, 'portal');
  assert.equal(sources.copilot, 'deployment');
  const broken = await credentialEnv(collection, 'wrong-key', {});
  assert.match(broken.problems.claude, /could not be decrypted/);
});

test('GitHub sign-in URL asks for the Copilot billing and org read scopes', () => {
  const url = new URL(githubAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://portal/cb', state: 'abc' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'manage_billing:copilot read:org');
  assert.equal(url.searchParams.get('state'), 'abc');
});

// Router over HTTP with a fake vendor/GitHub fetch.
let server;
let base;
let collection;
let vendorResponse;
const env = {
  PORTAL_ADMIN_TOKEN: 'admin-token',
  CREDENTIALS_KEY: 'credentials-key',
  GITHUB_OAUTH_CLIENT_ID: 'cid',
  GITHUB_OAUTH_CLIENT_SECRET: 'csecret',
  PUBLIC_PORTAL_URL: 'https://portal.example',
};
const vendorFetch = async (url) => {
  const href = String(url);
  if (href === 'https://github.com/login/oauth/access_token') return json({ access_token: 'gho_from_oauth' });
  return vendorResponse(href);
};

before(async () => {
  collection = memoryCollection();
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', createIntegrationsRouter({ express, collection, env, fetch: vendorFetch }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/integrations`;
});
after(() => server.close());
beforeEach(() => {
  collection.docs.length = 0;
  vendorResponse = () => json({ data: [], has_more: false, seats: [], total_seats: 0, seat_breakdown: {} });
});

const post = (path, body, token = 'admin-token') =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) }, body: JSON.stringify(body) });

test('connecting needs the admin token', async () => {
  const response = await post('/claude/connect', { values: { anthropicAdminKey: 'sk-ant-admin-x' } }, 'wrong');
  assert.equal(response.status, 401);
  assert.equal(collection.docs.length, 0);
});

test('a credential the vendor rejects is not saved unless forced', async () => {
  vendorResponse = () => json({ error: { message: 'invalid x-api-key' } }, 401);
  const rejected = await post('/claude/connect', { values: { anthropicAdminKey: 'sk-ant-admin-bad' } });
  assert.equal(rejected.status, 400);
  const body = await rejected.json();
  assert.equal(body.testFailed, true);
  assert.match(body.error, /invalid x-api-key/);
  assert.equal(collection.docs.length, 0);

  const forced = await post('/claude/connect', { values: { anthropicAdminKey: 'sk-ant-admin-bad' }, force: true });
  assert.equal(forced.status, 200);
  assert.equal(collection.docs.length, 1);
});

test('a working credential is saved encrypted and reported as connected, never returned', async () => {
  const response = await post('/claude/connect', { values: { anthropicAdminKey: 'sk-ant-admin-good' } });
  assert.equal(response.status, 200);
  const status = await (await fetch(base)).text();
  assert.ok(!status.includes('sk-ant-admin-good'));
  const claude = JSON.parse(status).vendors.find((vendor) => vendor.vendor === 'claude');
  assert.deepEqual([claude.connected, claude.source], [true, 'portal']);

  const removed = await fetch(`${base}/claude`, { method: 'DELETE', headers: { 'X-Admin-Token': 'admin-token' } });
  assert.equal(removed.status, 200);
  assert.equal(collection.docs.length, 0);
});

test('GitHub sign-in: start returns the authorize URL, the callback stores the token', async () => {
  const start = await post('/copilot/oauth/start', { org: 'acme' });
  const { url } = await start.json();
  const state = new URL(url).searchParams.get('state');
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://portal.example/api/integrations/copilot/oauth/callback');

  const callback = await fetch(`${base}/copilot/oauth/callback?code=c0de&state=${state}`, { redirect: 'manual' });
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location'), /integration=copilot&result=connected/);
  assert.deepEqual(decrypt(collection.docs[0], 'credentials-key'), { githubToken: 'gho_from_oauth', githubOrg: 'acme' });

  // A replayed or unknown state is refused.
  const replay = await fetch(`${base}/copilot/oauth/callback?code=c0de&state=${state}`, { redirect: 'manual' });
  assert.match(replay.headers.get('location'), /result=error/);
});

test('vendors without a data connector get a lightweight check with the right auth', async () => {
  const { testCredentials } = await import('../services/aiTools/integrations.js');
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body ? String(init.body) : '' });
    if (String(url).startsWith('https://zoom.us/oauth/token')) return json({ access_token: 'zoom-at' });
    if (String(url) === 'https://hub.docker.com/v2/auth/token') return json({ access_token: 'docker-jwt' });
    if (String(url) === 'https://slack.com/api/auth.test') return json({ ok: false, error: 'invalid_auth' });
    return json({});
  };
  assert.deepEqual(await testCredentials('zoom', { zoomAccountId: 'acc', zoomClientId: 'id', zoomClientSecret: 'sec' }, { fetch: fetchStub }), { checked: true });
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('id:sec').toString('base64')}`);
  assert.match(calls[0].body, /grant_type=account_credentials&account_id=acc/);
  assert.equal(calls[1].headers.Authorization, 'Bearer zoom-at');

  calls.length = 0;
  await testCredentials('cursor', { cursorApiKey: 'crsr_x' }, { fetch: fetchStub });
  assert.deepEqual([calls[0].url, calls[0].headers.Authorization], ['https://api.cursor.com/teams/members', `Basic ${Buffer.from('crsr_x:').toString('base64')}`]);

  calls.length = 0;
  await testCredentials('docker', { dockerUsername: 'farhan', dockerToken: 'dckr_pat', dockerOrg: 'acme' }, { fetch: fetchStub });
  assert.deepEqual(JSON.parse(calls[0].body), { identifier: 'farhan', secret: 'dckr_pat' });
  assert.equal(calls[1].headers.Authorization, 'Bearer docker-jwt');

  await assert.rejects(testCredentials('slack', { slackToken: 'xoxp-bad' }, { fetch: fetchStub }), /invalid_auth/);
  const unchecked = await testCredentials('jetbrains', { jetbrainsCustomerCode: 'c', jetbrainsApiKey: 'k' }, { fetch: fetchStub });
  assert.equal(unchecked.checked, false);
});
