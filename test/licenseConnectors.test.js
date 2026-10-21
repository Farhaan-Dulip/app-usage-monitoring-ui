import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
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
  const dashboard = await buildDashboard('slack', { env: {}, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'sample');
  assert.ok(dashboard.kpis.length > 0);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(licenseAppList(null, {}).find((app) => app.id === 'slack').mode, 'sample');
  assert.equal(licenseAppList(null, { SLACK_ADMIN_TOKEN: 'x' }).find((app) => app.id === 'slack').mode, 'live');
});

test('Slack: members, billable seats and gzipped daily analytics files', async () => {
  const analyticsDay = NOW.toISOString().slice(0, 10).replace(/\d\d$/, (day) => String(Number(day) - 3).padStart(2, '0'));
  const fetchImpl = fakeFetch({
    'https://slack.com/api/users.list': {
      ok: true,
      members: [
        { id: 'U1', real_name: 'Ava Perera', profile: { email: 'ava@corp.com' } },
        { id: 'U2', real_name: 'Ben Silva', profile: { email: 'ben@corp.com' } },
        { id: 'USLACKBOT', name: 'slackbot', profile: {} },
        { id: 'UBOT', is_bot: true, profile: {} },
      ],
      response_metadata: { next_cursor: '' },
    },
    'https://slack.com/api/team.billableInfo': { ok: true, billable_info: { U1: { billing_active: true }, U2: { billing_active: true } } },
    'https://slack.com/api/admin.analytics.getFile': (url) => {
      const date = new URL(url).searchParams.get('date');
      if (date !== analyticsDay) return json({ ok: false, error: 'file_not_yet_available' });
      const rows = [
        { date, user_id: 'U1', email_address: 'ava@corp.com', is_active: true, messages_posted_count: 12 },
        { date, user_id: 'U2', email_address: 'ben@corp.com', is_active: false, messages_posted_count: 0 },
      ];
      return new Response(gzipSync(rows.map((row) => JSON.stringify(row)).join('\n')), { headers: { 'Content-Type': 'application/gzip' } });
    },
  });
  const dashboard = await buildDashboard('slack', { env: { SLACK_ADMIN_TOKEN: 'xoxp-test' }, fetch: fetchImpl, now: NOW });
  assert.equal(dashboard.mode, 'live');
  const kpi = Object.fromEntries(dashboard.kpis.map((item) => [item.label, item.value]));
  assert.equal(kpi.Members, 2);
  assert.equal(kpi['Billable seats'], 2);
  assert.equal(kpi['Active (14 days)'], 1);
  assert.equal(kpi['Billable but inactive'], 1);
  assert.equal(kpi['Messages, 30 days'], 12);
  assert.ok(fetchImpl.calls.every((call) => call.init.headers.Authorization === 'Bearer xoxp-test'));
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

test('Postman, Docker and JetBrains map their responses into the dashboards', async () => {
  const fetchImpl = fakeFetch({
    'https://api.getpostman.com/users': { data: [{ id: 1, name: 'Ava Perera', email: 'ava@corp.com', roles: ['admin'], joinedAt: daysAgo(200) }, { id: 2, name: 'Ben Silva', email: 'ben@corp.com', joinedAt: daysAgo(100) }] },
    'https://api.getpostman.com/audit/logs': { trails: [{ id: 1, action: 'collection.update', timestamp: daysAgo(1), actor: { email: 'ava@corp.com' } }] },
    'https://hub.docker.com/v2/auth/token': { access_token: 'docker-jwt' },
    'https://hub.docker.com/v2/orgs/acme/members': { count: 2, next: null, results: [{ id: 'd1', username: 'ava', email: 'ava@corp.com', role: 'owner', last_logged_in_at: daysAgo(3) }, { id: 'd2', username: 'ben', email: 'ben@corp.com', role: 'member', last_logged_in_at: daysAgo(60) }] },
    'https://account.jetbrains.com/api/v1/customer/licenses': [
      { licenseId: 'L1', product: { code: 'II', name: 'IntelliJ IDEA Ultimate' }, assignee: { email: 'ava@corp.com', name: 'Ava Perera' }, lastSeen: { lastSeenDate: daysAgo(45) } },
      { licenseId: 'L2', product: { code: 'II', name: 'IntelliJ IDEA Ultimate' }, assignee: null, lastSeen: null },
    ],
  });
  const env = { POSTMAN_API_KEY: 'PMAK-test', DOCKER_USERNAME: 'admin', DOCKER_TOKEN: 'dckr_pat', DOCKER_ORG: 'acme', JETBRAINS_CUSTOMER_CODE: 'C1', JETBRAINS_API_KEY: 'jb' };
  const kpis = async (appId) => {
    const dashboard = await buildDashboard(appId, { env, fetch: fetchImpl, now: NOW });
    assert.equal(dashboard.mode, 'live', appId);
    return Object.fromEntries(dashboard.kpis.map((item) => [item.label, item.value]));
  };
  assert.deepEqual([(await kpis('postman'))['Team members'], (await kpis('postman'))['No activity in 30 days']], [2, 1]);
  const docker = await kpis('docker');
  assert.deepEqual([docker['Members (seats)'], docker['Not seen in 30 days'], docker.Owners], [2, 1, 1]);
  assert.ok(!Object.keys(docker).some((label) => label.startsWith('On latest Desktop')), 'no version KPI when versions are unknown');
  const jetbrains = await kpis('jetbrains');
  assert.deepEqual([jetbrains.Licences, jetbrains['Available to assign'], jetbrains['Assigned, not used in 30 days']], [2, 1, 1]);
  const docs = fetchImpl.calls.find((call) => call.url.includes('/orgs/acme/members'));
  assert.equal(docs.init.headers.Authorization, 'Bearer docker-jwt');
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
