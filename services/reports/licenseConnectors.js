// Live data connectors for the End User Apps dashboards. Each
// fetch*Raw() returns the same shape as its sample in vendorSamples.js (which
// copies the vendor's response format), so dashboards.js builds live and
// sample dashboards with the same code. Credentials come from the Connect
// dialog (encrypted in the portal) or the deployment's environment.
//
// How sure each call is: see API_INFO in dashboards.js and docs/vendor-apis.md.
import { gunzipSync } from 'node:zlib';
import { DAY_MS, getJson, isoDay, lastDays, VendorApiError } from '../aiTools/http.js';

const basic = (user, password = '') => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(fetchImpl, vendor, url, init = {}) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new VendorApiError(vendor, `request failed (${error.message})`);
  }
}

async function postJson(fetchImpl, vendor, url, { headers = {}, body, form } = {}) {
  const response = await request(fetchImpl, vendor, url, {
    method: 'POST',
    headers: { ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }), ...headers },
    body: form ? new URLSearchParams(form) : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VendorApiError(vendor, `HTTP ${response.status}: ${payload.reason || payload.message || payload.error || payload.detail || response.statusText}`, response.status);
  }
  return payload;
}

// --------------------------------------------------------------------- Slack
// users.list (members), team.billableInfo (billable seats) and
// admin.analytics.getFile type=member (one gzipped NDJSON file per day;
// Enterprise Grid, admin.analytics:read). Recent days may not be ready yet.
async function slackCall(fetchImpl, token, method, params = {}) {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await request(fetchImpl, 'Slack', url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 429 && attempt < 2) {
      await wait((Number(response.headers.get('retry-after')) || 5) * 1000);
      continue;
    }
    return response;
  }
}

async function slackJson(fetchImpl, token, method, params) {
  const response = await slackCall(fetchImpl, token, method, params);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new VendorApiError('Slack', `${method}: ${payload.error || `HTTP ${response.status}`}`, response.status);
  return payload;
}

export async function fetchSlackRaw({ env, fetch: fetchImpl = fetch, now = new Date() }) {
  const token = env.SLACK_ADMIN_TOKEN;
  const users = [];
  let cursor = '';
  do {
    const page = await slackJson(fetchImpl, token, 'users.list', { limit: '200', ...(cursor ? { cursor } : {}) });
    users.push(...(page.members || []).filter((member) => !member.deleted && !member.is_bot && member.id !== 'USLACKBOT'));
    cursor = page.response_metadata?.next_cursor || '';
  } while (cursor);

  const billableInfo = await slackJson(fetchImpl, token, 'team.billableInfo');

  const memberAnalytics = [];
  for (const day of lastDays(now, 30)) {
    const response = await slackCall(fetchImpl, token, 'admin.analytics.getFile', { type: 'member', date: day });
    const type = response.headers.get('content-type') || '';
    if (type.includes('json')) {
      const payload = await response.json().catch(() => ({}));
      if (['file_not_yet_available', 'file_not_found', 'data_not_available'].includes(payload.error)) continue;
      throw new VendorApiError('Slack', `admin.analytics.getFile: ${payload.error || `HTTP ${response.status}`}`, response.status);
    }
    if (!response.ok) throw new VendorApiError('Slack', `admin.analytics.getFile: HTTP ${response.status}`, response.status);
    const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
    for (const line of text.split('\n')) if (line.trim()) memberAnalytics.push(JSON.parse(line));
  }
  return {
    billableInfo,
    memberAnalytics,
    users: users.map((user) => ({ id: user.id, real_name: user.real_name || user.profile?.real_name || user.name, profile: { email: user.profile?.email || '' } })),
  };
}

// ---------------------------------------------------------------------- Zoom
// Server-to-Server OAuth token, GET /users (all pages) and GET /report/daily
// for this month and last (report:read:admin), trimmed to the last 30 days.
export async function fetchZoomRaw({ env, fetch: fetchImpl = fetch, now = new Date() }) {
  const token = await postJson(fetchImpl, 'Zoom', 'https://zoom.us/oauth/token', {
    headers: { Authorization: basic(env.ZOOM_CLIENT_ID, env.ZOOM_CLIENT_SECRET) },
    form: { grant_type: 'account_credentials', account_id: env.ZOOM_ACCOUNT_ID },
  });
  const auth = { Authorization: `Bearer ${token.access_token}` };
  const users = [];
  let nextPageToken = '';
  let total = 0;
  do {
    const query = new URLSearchParams({ page_size: '300', status: 'active', ...(nextPageToken ? { next_page_token: nextPageToken } : {}) });
    const page = await getJson(fetchImpl, 'Zoom', `https://api.zoom.us/v2/users?${query}`, auth);
    users.push(...(page.users || []));
    total = page.total_records ?? users.length;
    nextPageToken = page.next_page_token || '';
  } while (nextPageToken);

  const wanted = new Set(lastDays(now, 30));
  const months = new Map();
  for (const day of wanted) months.set(day.slice(0, 7), true);
  const dates = [];
  for (const month of months.keys()) {
    const [year, monthNumber] = month.split('-');
    const report = await getJson(fetchImpl, 'Zoom', `https://api.zoom.us/v2/report/daily?year=${year}&month=${Number(monthNumber)}`, auth);
    dates.push(...(report.dates || []).filter((entry) => wanted.has(entry.date)));
  }
  dates.sort((a, b) => a.date.localeCompare(b.date));
  return {
    users: { page_count: 1, page_number: 1, page_size: users.length, total_records: total, next_page_token: '', users },
    dailyReport: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, dates },
  };
}

// --------------------------------------------------------------------- Figma
// GET /v1/activity_logs (Enterprise, org admin token with org:activity_log_read),
// last 30 days. Seat types come from SCIM when its tenant ID and token are
// given; otherwise the seats are the people seen in the activity log.
export async function fetchFigmaRaw({ env, fetch: fetchImpl = fetch, now = new Date() }) {
  const headers = { 'X-Figma-Token': env.FIGMA_TOKEN };
  const activity_logs = [];
  let cursor = '';
  const startTime = Math.floor((now.getTime() - 30 * DAY_MS) / 1000);
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ start_time: String(startTime), limit: '1000', order: 'asc', ...(cursor ? { cursor } : {}) });
    const result = await getJson(fetchImpl, 'Figma', `https://api.figma.com/v1/activity_logs?${query}`, headers);
    activity_logs.push(...(result.meta?.activity_logs || []));
    cursor = result.meta?.cursor || '';
    if (!result.meta?.next_page || !cursor) break;
  }

  let seats;
  if (env.FIGMA_SCIM_TENANT_ID && env.FIGMA_SCIM_TOKEN) {
    seats = [];
    let startIndex = 1;
    for (;;) {
      const query = new URLSearchParams({ startIndex: String(startIndex), count: '100' });
      const page = await getJson(fetchImpl, 'Figma', `https://www.figma.com/scim/v2/${encodeURIComponent(env.FIGMA_SCIM_TENANT_ID)}/Users?${query}`, { Authorization: `Bearer ${env.FIGMA_SCIM_TOKEN}` });
      for (const user of page.Resources || []) {
        const figma = user['urn:ietf:params:scim:schemas:extension:figma:2.0:User'] || {};
        seats.push({
          id: user.id,
          email: String(user.userName || user.emails?.[0]?.value || '').toLowerCase(),
          name: user.displayName || [user.name?.givenName, user.name?.familyName].filter(Boolean).join(' ') || user.userName,
          seat_type: figma.seatType || 'Unknown',
        });
      }
      startIndex += page.Resources?.length || 0;
      if (!page.Resources?.length || startIndex > (page.totalResults || 0)) break;
    }
  } else {
    const people = new Map();
    for (const log of activity_logs) {
      const email = log.actor?.email;
      if (email && !people.has(email)) people.set(email, { id: log.actor.id, email, name: log.actor.name || log.actor.handle || email, seat_type: 'Unknown' });
    }
    seats = [...people.values()];
  }
  return { seats, activityLogs: { error: false, status: 200, meta: { activity_logs, cursor: '', next_page: false } } };
}

// ------------------------------------------------------------------- Postman
// GET /users (team members) and GET /audit/logs (Enterprise), last 30 days.
export async function fetchPostmanRaw({ env, fetch: fetchImpl = fetch, now = new Date() }) {
  const headers = { 'X-API-Key': env.POSTMAN_API_KEY };
  const users = await getJson(fetchImpl, 'Postman', 'https://api.getpostman.com/users', headers);
  const trails = [];
  let cursor = '';
  const since = isoDay(now.getTime() - 30 * DAY_MS);
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ since, until: isoDay(now), limit: '300', ...(cursor ? { cursor } : {}) });
    const result = await getJson(fetchImpl, 'Postman', `https://api.getpostman.com/audit/logs?${query}`, headers);
    trails.push(...(result.trails || []));
    cursor = result.meta?.nextCursor || result.nextCursor || '';
    if (!cursor) break;
  }
  return { users: { data: users.data || [] }, auditLogs: { trails } };
}

// -------------------------------------------------------------------- Docker
// Personal access token -> JWT, then GET /v2/orgs/{org}/members (all pages).
// Activity fields (last_seen_at, last_desktop_version) depend on the plan's
// insights; when absent, last sign-in stands in and the version is unknown.
export async function fetchDockerRaw({ env, fetch: fetchImpl = fetch }) {
  const token = await postJson(fetchImpl, 'Docker', 'https://hub.docker.com/v2/auth/token', {
    body: { identifier: env.DOCKER_USERNAME, secret: env.DOCKER_TOKEN },
  });
  const auth = { Authorization: `Bearer ${token.access_token}` };
  const results = [];
  let url = `https://hub.docker.com/v2/orgs/${encodeURIComponent(env.DOCKER_ORG)}/members?page_size=100&page=1`;
  let count = 0;
  for (let page = 0; url && page < 100; page += 1) {
    const result = await getJson(fetchImpl, 'Docker', url, auth);
    results.push(...(result.results || []));
    count = result.count ?? results.length;
    url = result.next || '';
  }
  return {
    members: {
      count,
      next: null,
      previous: null,
      results: results.map((member) => ({
        ...member,
        full_name: member.full_name || member.username,
        groups: member.groups || [],
        last_seen_at: member.last_seen_at || member.last_logged_in_at || null,
        last_desktop_version: member.last_desktop_version || 'Unknown',
      })),
    },
  };
}

// ----------------------------------------------------------------- JetBrains
// JetBrains Account API: GET /customer/licenses (X-Customer-Code + X-Api-Key).
export async function fetchJetBrainsRaw({ env, fetch: fetchImpl = fetch }) {
  const result = await getJson(fetchImpl, 'JetBrains', 'https://account.jetbrains.com/api/v1/customer/licenses', {
    'X-Customer-Code': env.JETBRAINS_CUSTOMER_CODE,
    'X-Api-Key': env.JETBRAINS_API_KEY,
  });
  const licenses = Array.isArray(result) ? result : result.licenses || result.data || [];
  return { licenses: licenses.map((license) => ({ ...license, product: license.product || { code: '', name: 'Unknown product' } })) };
}

// Which connector each app uses and when it is configured.
export const LICENSE_CONNECTORS = {
  slack: { configured: (env) => Boolean(env.SLACK_ADMIN_TOKEN), fetch: fetchSlackRaw },
  zoom: { configured: (env) => Boolean(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET), fetch: fetchZoomRaw },
  figma: { configured: (env) => Boolean(env.FIGMA_TOKEN), fetch: fetchFigmaRaw },
  postman: { configured: (env) => Boolean(env.POSTMAN_API_KEY), fetch: fetchPostmanRaw },
  docker: { configured: (env) => Boolean(env.DOCKER_USERNAME && env.DOCKER_TOKEN && env.DOCKER_ORG), fetch: fetchDockerRaw },
  jetbrains: { configured: (env) => Boolean(env.JETBRAINS_CUSTOMER_CODE && env.JETBRAINS_API_KEY), fetch: fetchJetBrainsRaw },
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export function clearLicenseCache() {
  cache.clear();
}

// { mode: 'live', raw } | { mode: 'error', error } | { mode: 'sample' } for one
// app. Live results (and failures) are cached for 10 minutes; a failed live
// call never falls back to sample data.
export async function loadLicenseData(appId, { env = process.env, fetch: fetchImpl = fetch, now = new Date(), refresh = false } = {}) {
  const connector = LICENSE_CONNECTORS[appId];
  if (!connector || !connector.configured(env)) return { mode: 'sample' };
  const cached = cache.get(appId);
  if (!refresh && cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
  let value;
  try {
    value = { mode: 'live', raw: await connector.fetch({ env, fetch: fetchImpl, now }) };
  } catch (error) {
    value = { mode: 'error', error: error.message };
  }
  cache.set(appId, { at: now.getTime(), value });
  return value;
}
