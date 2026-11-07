import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, licenseAppList } from '../services/reports/dashboards.js';
import { clearLicenseCache, loadLicenseData } from '../services/reports/licenseConnectors.js';

const NOW = new Date('2026-10-21T10:00:00Z');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

// Routes requests by URL prefix (longest match first) and records them.
function fakeFetch(routes) {
  const calls = [];
  const sorted = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const match = sorted.find(([prefix]) => String(url).startsWith(prefix));
    if (!match) return json({ message: `no route for ${url}` }, 404);
    return typeof match[1] === 'function' ? match[1](String(url), init) : json(match[1]);
  };
  impl.calls = calls;
  return impl;
}

beforeEach(() => clearLicenseCache());

test('apps without credentials stay on sample data and make no calls', async () => {
  const fetchImpl = fakeFetch({});
  const dashboard = await buildDashboard('postman', { env: {}, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'sample');
  assert.ok(dashboard.kpis.length > 0);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(licenseAppList(null, {}).find((app) => app.id === 'postman').mode, 'sample');
  assert.equal(licenseAppList(null, { POSTMAN_API_KEY: 'x' }).find((app) => app.id === 'postman').mode, 'live');
});

test('Zoom: token, all user pages, and daily reports trimmed to 30 days', async () => {
  const fetchImpl = fakeFetch({
    'https://zoom.us/oauth/token': { access_token: 'zoom-access', expires_in: 3600 },
    'https://api.zoom.us/v2/users': (url) => {
      const token = new URL(url).searchParams.get('next_page_token');
      return json(token
        ? { total_records: 2, next_page_token: '', users: [{ id: 'z2', display_name: 'Ben Silva', email: 'ben@corp.com', type: 1, last_login_time: daysAgo(2) }] }
        : { total_records: 2, next_page_token: 'page2', users: [{ id: 'z1', display_name: 'Ava Perera', email: 'ava@corp.com', type: 2, last_login_time: daysAgo(40) }] });
    },
    'https://api.zoom.us/v2/report/daily': (url) => {
      const month = Number(new URL(url).searchParams.get('month'));
      return json({ dates: month === 10 ? [{ date: '2026-10-20', meetings: 4, meeting_minutes: 120 }] : [{ date: '2026-09-01', meetings: 99, meeting_minutes: 999 }, { date: '2026-09-25', meetings: 2, meeting_minutes: 60 }] });
    },
  });
  const dashboard = await buildDashboard('zoom', { env: { ZOOM_ACCOUNT_ID: 'acc', ZOOM_CLIENT_ID: 'id', ZOOM_CLIENT_SECRET: 'secret' }, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'live');
  const kpi = Object.fromEntries(dashboard.kpis.map((item) => [item.label, item.value]));
  assert.equal(kpi.Users, 2);
  assert.equal(kpi.Licensed, 1);
  assert.equal(kpi['Licensed, no login in 30 days'], 1);
  assert.equal(kpi['Meetings, 30 days'], 6, 'September 1 is outside the last 30 days');
  const token = fetchImpl.calls.find((call) => call.url.startsWith('https://zoom.us/oauth/token'));
  assert.match(token.init.headers.Authorization, /^Basic /);
  assert.match(String(token.init.body), /grant_type=account_credentials/);
});

test('Figma without SCIM: seats are the people in the activity log', async () => {
  const fetchImpl = fakeFetch({
    'https://api.figma.com/v1/activity_logs': {
      error: false,
      status: 200,
      meta: {
        activity_logs: [
          { id: '1', timestamp: Math.floor(Date.parse(daysAgo(1)) / 1000), actor: { id: 'f1', email: 'ava@corp.com', handle: 'Ava' }, action: { type: 'fig_file_view' } },
          { id: '2', timestamp: Math.floor(Date.parse(daysAgo(2)) / 1000), actor: null, action: { type: 'org_setting_change' } },
        ],
        cursor: '',
        next_page: false,
      },
    },
  });
  const dashboard = await buildDashboard('figma', { env: { FIGMA_TOKEN: 'figd_test' }, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'live');
  assert.equal(dashboard.table.rows.length, 1);
  assert.equal(dashboard.table.rows[0].seat, 'Unknown');
  assert.match(dashboard.notes[0], /SCIM/);
  assert.equal(fetchImpl.calls[0].init.headers['X-Figma-Token'], 'figd_test');
});

test('Postman maps its responses into the dashboards', async () => {
  const fetchImpl = fakeFetch({
    'https://api.getpostman.com/users': { data: [{ id: 1, name: 'Ava Perera', email: 'ava@corp.com', roles: ['admin'], joinedAt: daysAgo(200) }, { id: 2, name: 'Ben Silva', email: 'ben@corp.com', joinedAt: daysAgo(100) }] },
    'https://api.getpostman.com/audit-actions': { data: [{ code: 'user.login_sso', name: 'User Logged-In Using SSO' }, { code: 'api_key.create', name: 'Created Postman API Key' }] },
    'https://api.getpostman.com/audit/logs': {
      trails: [
        { id: 1, action: 'user.login_sso', timestamp: daysAgo(3), message: 'Ava Perera logged in', data: { actor: { id: 1, email: 'ava@corp.com', active: true } } },
        // Not a sign-in: an API key event doesn't count as being seen.
        { id: 2, action: 'api_key.create', timestamp: daysAgo(1), message: 'Ben Silva created an API key', data: { actor: { id: 2, email: 'ben@corp.com', active: true } } },
      ],
    },
  });
  const env = { POSTMAN_API_KEY: 'PMAK-test' };
  const kpis = async (appId) => {
    const dashboard = await buildDashboard(appId, { env, fetch: fetchImpl, now: NOW });
    assert.equal(dashboard.mode, 'live', appId);
    return Object.fromEntries(dashboard.kpis.map((item) => [item.label, item.value]));
  };
  const postman = await kpis('postman');
  assert.deepEqual([postman['Team members'], postman['Signed in (30 days)'], postman['No sign-in in 30 days']], [2, 1, 1]);
  const logsCall = fetchImpl.calls.find((call) => call.url.startsWith('https://api.getpostman.com/audit/logs'));
  assert.equal(new URL(logsCall.url).searchParams.get('since'), '2026-04-24', 'reads the 180 days Postman keeps');
});

test('a failed live call shows an error, never sample data, and is cached', async () => {
  const fetchImpl = fakeFetch({ 'https://api.getpostman.com/users': () => json({ error: { message: 'Invalid API Key' } }, 401) });
  const dashboard = await buildDashboard('postman', { env: { POSTMAN_API_KEY: 'bad' }, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'error');
  assert.match(dashboard.error, /Postman: HTTP 401.*Invalid API Key/);
  assert.equal(dashboard.table, null);
  const calls = fetchImpl.calls.length;
  await loadLicenseData('postman', { env: { POSTMAN_API_KEY: 'bad' }, fetch: fetchImpl, now: NOW });
  assert.equal(fetchImpl.calls.length, calls, 'second load within 10 minutes uses the cache');
  await loadLicenseData('postman', { env: { POSTMAN_API_KEY: 'bad' }, fetch: fetchImpl, now: NOW, refresh: true });
  assert.ok(fetchImpl.calls.length > calls, 'refresh calls the vendor again');
});
