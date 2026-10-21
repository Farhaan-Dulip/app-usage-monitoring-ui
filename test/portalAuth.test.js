import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authConfig, createAuthRouter, emailAllowed, requireSession, SESSION_COOKIE } from '../services/portalAuth.js';

const ENV = {
  PORTAL_ACCESS_CODE: 'right-code',
  PORTAL_SSO_TENANT_ID: 'tenant-1',
  PORTAL_SSO_CLIENT_ID: 'client-1',
  PORTAL_SSO_CLIENT_SECRET: 'sso-secret',
  PUBLIC_PORTAL_URL: 'https://portal.example',
  PORTAL_SESSION_SECRET: 'session-secret',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const cookiesFrom = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

let server;
let base;
let tokenClaims;
before(async () => {
  const config = authConfig(ENV);
  const fetchImpl = async () => json({ id_token: idToken(tokenClaims) });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({ express, config, fetchImpl }));
  app.use('/api', requireSession({ config, serviceToken: 'svc', serviceHeader: 'X-MCP-Service-Token', isPublic: (req) => req.path === '/telemetry' }));
  app.get('/api/state', (_req, res) => res.json({ ok: true }));
  app.post('/api/telemetry', (_req, res) => res.status(201).json({ ok: true }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const login = (body) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('sign-in is off when nothing is configured', () => {
  assert.equal(authConfig({}).required, false);
  assert.equal(authConfig({ PORTAL_ACCESS_CODE: 'x' }).required, true);
  assert.equal(authConfig({ ...ENV, PORTAL_ACCESS_CODE: '' }).microsoft.redirectUri, 'https://portal.example/api/auth/microsoft/callback');
});

test('only company email domains are accepted', () => {
  assert.ok(emailAllowed('Farhan@AllionTechnologies.com'.toLowerCase(), ['alliontechnologies.com']));
  assert.ok(!emailAllowed('someone@gmail.com', ['alliontechnologies.com']));
  assert.ok(!emailAllowed('not-an-email', ['alliontechnologies.com']));
});

test('APIs need a session; telemetry and service calls do not', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'X-MCP-Service-Token': 'svc' } })).status, 200);
  assert.equal((await fetch(`${base}/api/telemetry`, { method: 'POST' })).status, 201);
  const session = await (await fetch(`${base}/api/auth/session`)).json();
  assert.deepEqual([session.required, session.authenticated, session.methods], [true, false, { microsoft: true, accessCode: true }]);
});

test('access code sign-in sets a session cookie that opens the API', async () => {
  assert.equal((await login({ email: 'a@gmail.com', accessCode: 'right-code' })).status, 401);
  assert.equal((await login({ email: 'a.b@alliontechnologies.com', accessCode: 'wrong' })).status, 401);
  const response = await login({ email: 'Jane.Doe@alliontechnologies.com', accessCode: 'right-code' });
  assert.equal(response.status, 200);
  const setCookie = response.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  const cookie = cookiesFrom(response);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie } })).status, 200);
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json();
  assert.deepEqual(session.user, { email: 'jane.doe@alliontechnologies.com', name: 'Jane Doe', method: 'access-code' });
});

test('"keep me signed in" makes the session cookie persistent', async () => {
  const plain = (await login({ email: 'jane@alliontechnologies.com', accessCode: 'right-code' })).headers.getSetCookie()[0];
  const kept = (await login({ email: 'jane@alliontechnologies.com', accessCode: 'right-code', remember: true })).headers.getSetCookie()[0];
  assert.doesNotMatch(plain, /Max-Age/);
  assert.match(kept, /Max-Age=2592000/);
});

test('Microsoft sign-in passes the typed email as a login hint', async () => {
  const start = await fetch(`${base}/api/auth/microsoft/start?login_hint=${encodeURIComponent('jane@alliontechnologies.com')}`, { redirect: 'manual' });
  const location = new URL(start.headers.get('location'));
  assert.equal(location.searchParams.get('login_hint'), 'jane@alliontechnologies.com');
  assert.equal(location.searchParams.get('prompt'), null);
});

test('a tampered session cookie is rejected', async () => {
  const response = await login({ email: 'jane@alliontechnologies.com', accessCode: 'right-code' });
  const [name, value] = cookiesFrom(response).split('=');
  const [body, signature] = decodeURIComponent(value).split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), email: 'admin@alliontechnologies.com' })).toString('base64url');
  assert.equal(name, SESSION_COOKIE);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: `${name}=${forged}.${signature}` } })).status, 401);
});

test('Microsoft sign-in checks state, nonce, audience and tenant', async () => {
  const start = await fetch(`${base}/api/auth/microsoft/start`, { redirect: 'manual' });
  const location = new URL(start.headers.get('location'));
  assert.equal(location.host, 'login.microsoftonline.com');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://portal.example/api/auth/microsoft/callback');
  const state = location.searchParams.get('state');
  const nonce = location.searchParams.get('nonce');
  const cookie = cookiesFrom(start);
  const callback = (query, claims) => {
    tokenClaims = claims;
    return fetch(`${base}/api/auth/microsoft/callback?${new URLSearchParams(query)}`, { headers: { cookie }, redirect: 'manual' });
  };
  const good = { aud: 'client-1', tid: 'tenant-1', nonce, exp: Date.now() / 1000 + 600, preferred_username: 'Jane@alliontechnologies.com', name: 'Jane Doe' };

  assert.match((await callback({ code: 'c', state: 'other' }, good)).headers.get('location'), /sign_in_expired/);
  assert.match((await callback({ code: 'c', state }, { ...good, tid: 'other-tenant' })).headers.get('location'), /sign_in_failed/);
  assert.match((await callback({ code: 'c', state }, { ...good, nonce: 'replayed' })).headers.get('location'), /sign_in_failed/);
  assert.match((await callback({ code: 'c', state }, { ...good, preferred_username: 'x@gmail.com' })).headers.get('location'), /account_not_allowed/);

  const ok = await callback({ code: 'c', state }, good);
  assert.equal(ok.headers.get('location'), '/');
  const session = await (await fetch(`${base}/api/auth/session`, { headers: { cookie: cookiesFrom(ok) } })).json();
  assert.deepEqual(session.user, { email: 'jane@alliontechnologies.com', name: 'Jane Doe', method: 'microsoft' });
});
