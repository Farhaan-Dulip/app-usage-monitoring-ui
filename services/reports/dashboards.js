// Reports & Insights > End User Apps: one dashboard per app.
//
// Each dashboard = { app, mode, api, kpis, charts, table, tracker, notes }:
//   mode 'live'    vendor admin API data (licenseConnectors.js), when connected
//        'sample'  sample data in the same response format, when not
//        'error'   connected, but the vendor call failed (never sample data)
//        'tracker' no admin API; the Tracker's measurements are the data
// `tracker` is always real: active time measured on PCs (telemetry) for the
// app's processes. `api.endpoints[].verified` says how sure the field names are.
import { DAY_MS, daysSince, isoDay, lastDays } from '../aiTools/http.js';
import { sampleFigma, samplePostman, sampleZoom } from './vendorSamples.js';
import { lastSignIns, signInActionCodes, signedInWithin, trailActor } from './postmanSignIns.js';
import { LICENSE_CONNECTORS, loadLicenseData } from './licenseConnectors.js';

const DAY = 24 * 60 * 60 * 1000;

// Apps on the End User Apps page (one per vendor product).
export const LICENSE_APPS = [
  { id: 'zoom', name: 'Zoom', vendor: 'Zoom', source: 'sample', processes: ['zoom.exe'] },
  { id: 'figma', name: 'Figma', vendor: 'Figma', source: 'sample', processes: ['figma.exe'] },
  { id: 'postman', name: 'Postman', vendor: 'Postman', source: 'sample', processes: ['postman.exe'] },
  { id: 'vscode', name: 'Visual Studio Code', vendor: 'Microsoft', source: 'tracker', processes: ['code.exe'] },
];

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const ratio = (a, b) => (b ? a / b : null);
const byDay = (now, rows, dayOf, valueOf) => {
  const totals = Object.fromEntries(lastDays(now, 30).map((day) => [day, 0]));
  for (const row of rows) {
    const day = dayOf(row);
    if (day in totals) totals[day] += valueOf(row);
  }
  return totals;
};
const statusOf = (lastActiveAt, now, idleDays = 30) => {
  const age = daysSince(lastActiveAt, now);
  if (age === null) return 'never';
  return age <= idleDays ? 'active' : 'idle';
};

// ---------------------------------------------------------------- tracker (real)
export function trackerUsage(events, processes, now) {
  const wanted = new Set(processes.map((name) => name.toLowerCase()));
  const perDay = Object.fromEntries(lastDays(now, 30).map((day) => [day, 0]));
  const perDevice = new Map();
  for (const event of events) {
    const day = event.recorded_date || isoDay(event.received_at || event.timestamp);
    for (const row of event.usage?.usage || []) {
      if (!wanted.has(String(row.app_name || '').toLowerCase())) continue;
      const seconds = Number(row.worked_runtime_seconds ?? row.foreground_runtime_seconds) || 0;
      if (day in perDay) perDay[day] += seconds;
      const key = event.device_key || event.device_id;
      const device = perDevice.get(key) || { device: event.device_name || key, user: event.user_upn || event.usage?.user_upn || '', seconds: 0, lastSeen: null };
      device.seconds += seconds;
      if (seconds > 0 && (!device.lastSeen || String(event.timestamp) > device.lastSeen)) device.lastSeen = event.timestamp;
      perDevice.set(key, device);
    }
  }
  const devices = [...perDevice.values()].sort((a, b) => b.seconds - a.seconds);
  const totalHours = sum(devices, (device) => device.seconds) / 3600;
  return {
    kpis: [
      { label: 'PCs using it (30 days)', value: devices.filter((device) => device.seconds > 0).length, format: 'number' },
      { label: 'Active time, 30 days', value: totalHours, format: 'hours' },
    ],
    daily: Object.entries(perDay).map(([date, seconds]) => ({ date, hours: Math.round((seconds / 3600) * 100) / 100 })),
    devices: devices.map((device) => ({ ...device, hours: Math.round((device.seconds / 3600) * 100) / 100 })),
  };
}

// ---------------------------------------------------------------- AI Tools vendors
function fromAiTools(vendor, now) {
  const members = vendor.members || [];
  const statusCounts = ['active', 'idle', 'never'].map((status) => ({ name: status === 'never' ? 'No activity' : status[0].toUpperCase() + status.slice(1), value: members.filter((member) => member.status === status).length }));
  const topKey = vendor.id === 'claude' ? 'costUsd' : vendor.id === 'codex' ? 'credits' : 'interactions';
  const topLabel = vendor.id === 'claude' ? 'Est. cost (USD)' : vendor.id === 'codex' ? 'Credits' : 'Prompts (28 days)';
  const top = [...members].sort((a, b) => (b[topKey] || 0) - (a[topKey] || 0)).slice(0, 8)
    .map((member) => ({ name: member.name, value: Math.round((member[topKey] || 0) * 100) / 100 }));
  return {
    kpis: vendor.kpis || [],
    charts: [
      { id: 'daily', title: vendor.daily?.label || 'Daily', type: 'area', xKey: 'date', series: [{ key: 'value', label: vendor.daily?.label || 'Value', format: vendor.daily?.format }], data: vendor.daily?.points || [] },
      { id: 'top', title: `Top users by ${topLabel.toLowerCase()}`, type: 'bar', xKey: 'name', series: [{ key: 'value', label: topLabel, format: vendor.id === 'claude' ? 'usd' : 'number' }], data: top },
      { id: 'status', title: 'Seats by activity', type: 'pie', data: statusCounts },
    ],
    table: {
      title: 'Members',
      columns: [
        { key: 'name', label: 'User', format: 'text' },
        { key: 'status', label: 'Status', format: 'status' },
        { key: 'lastActiveAt', label: 'Last active', format: 'date' },
        ...(vendor.memberColumns || []),
      ],
      rows: members,
    },
    notes: vendor.idle?.note ? [`${vendor.idle.count} reclaim candidate(s). ${vendor.idle.note}`] : [],
  };
}

// ---------------------------------------------------------------- sample vendors
const BUILDERS = {

  zoom(raw, now) {
    const users = raw.users.users;
    const licensed = users.filter((user) => user.type === 2);
    const staleLicensed = licensed.filter((user) => daysSince(user.last_login_time, now) > 30);
    const dates = raw.dailyReport.dates;
    return {
      kpis: [
        { label: 'Users', value: raw.users.total_records, format: 'number' },
        { label: 'Licensed', value: licensed.length, format: 'number' },
        { label: 'Licensed, no login in 30 days', value: staleLicensed.length, format: 'number' },
        { label: 'Meetings, 30 days', value: sum(dates, (day) => day.meetings), format: 'number' },
        { label: 'Meeting hours, 30 days', value: sum(dates, (day) => day.meeting_minutes) / 60, format: 'hours' },
      ],
      charts: [
        { id: 'meetings', title: 'Meetings per day', type: 'bar', xKey: 'date', series: [{ key: 'meetings', label: 'Meetings' }], data: dates },
        { id: 'minutes', title: 'Meeting minutes per day', type: 'area', xKey: 'date', series: [{ key: 'meeting_minutes', label: 'Minutes' }], data: dates },
        { id: 'types', title: 'Users by licence type', type: 'pie', data: [{ name: 'Licensed', value: licensed.length }, { name: 'Basic', value: users.length - licensed.length }] },
      ],
      table: {
        title: 'Users',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last login', format: 'date' },
          { key: 'licence', label: 'Licence', format: 'text' },
          { key: 'dept', label: 'Department', format: 'text' },
          { key: 'client', label: 'Client version', format: 'text' },
        ],
        rows: users.map((user) => ({
          id: user.id,
          name: user.display_name,
          email: user.email,
          status: statusOf(user.last_login_time, now),
          lastActiveAt: user.last_login_time,
          licence: user.type === 2 ? 'Licensed' : 'Basic',
          dept: user.dept,
          client: user.last_client_version,
        })),
      },
      notes: staleLicensed.length ? [`${staleLicensed.length} licensed user(s) haven't signed in for 30+ days: candidates to move to Basic.`] : [],
    };
  },

  figma(raw, now) {
    const logs = raw.activityLogs.meta.activity_logs.filter((log) => log.actor?.email);
    const lastActive = {};
    const events = {};
    for (const log of logs) {
      const email = log.actor.email;
      events[email] = (events[email] || 0) + 1;
      const when = new Date(log.timestamp * 1000).toISOString();
      if (!lastActive[email] || when > lastActive[email]) lastActive[email] = when;
    }
    const daily = Object.entries(byDay(now, logs, (log) => isoDay(log.timestamp * 1000), () => 1)).map(([date, value]) => ({ date, events: value }));
    const seatTypes = {};
    for (const seat of raw.seats) seatTypes[seat.seat_type] = (seatTypes[seat.seat_type] || 0) + 1;
    const paidIdle = raw.seats.filter((seat) => seat.seat_type !== 'View' && statusOf(lastActive[seat.email], now) !== 'active');
    return {
      kpis: [
        { label: 'Seats', value: raw.seats.length, format: 'number' },
        { label: 'Full seats', value: seatTypes.Full || 0, format: 'number' },
        { label: 'Active (30 days)', value: Object.keys(lastActive).length, format: 'number' },
        { label: 'Paid seats with no activity', value: paidIdle.length, format: 'number' },
        { label: 'File events, 30 days', value: logs.length, format: 'number' },
      ],
      charts: [
        { id: 'events', title: 'File activity per day', type: 'area', xKey: 'date', series: [{ key: 'events', label: 'Events' }], data: daily },
        { id: 'seats', title: 'Seats by type', type: 'pie', data: Object.entries(seatTypes).map(([name, value]) => ({ name, value })) },
      ],
      table: {
        title: 'Seats',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last activity', format: 'date' },
          { key: 'seat', label: 'Seat type', format: 'text' },
          { key: 'events', label: 'Events (30d)', format: 'number' },
        ],
        rows: raw.seats.map((seat) => ({ id: seat.id, name: seat.name, email: seat.email, status: statusOf(lastActive[seat.email], now), lastActiveAt: lastActive[seat.email] || null, seat: seat.seat_type, events: events[seat.email] || 0 })),
      },
      notes: seatTypes.Unknown ? ['Seat types need Figma SCIM (tenant ID and SCIM token in the Connect dialog); without it, seats are the people seen in the activity log.'] : [],
    };
  },

  postman(raw, now) {
    // The audit log is account events; sign-ins are the per-person signal.
    const codes = signInActionCodes(raw.auditActions);
    const latest = lastSignIns(raw.auditLogs.trails, codes);
    const signIns = raw.auditLogs.trails.filter((trail) => codes.has(trail.action) && trailActor(trail)?.email);
    const recent = signIns.filter((trail) => now.getTime() - Date.parse(trail.timestamp) <= 30 * DAY_MS);
    const daily = Object.entries(byDay(now, recent, (trail) => isoDay(trail.timestamp), () => 1)).map(([date, value]) => ({ date, signIns: value }));
    const names = new Map((raw.auditActions?.data || []).map((action) => [action.code, action.name]));
    const actions = {};
    for (const trail of raw.auditLogs.trails) {
      if (now.getTime() - Date.parse(trail.timestamp) > 30 * DAY_MS) continue;
      const name = names.get(trail.action) || trail.action;
      actions[name] = (actions[name] || 0) + 1;
    }
    const users = raw.users.data.map((user) => ({ ...user, roles: user.roles || [] }));
    const lastSignIn = (user) => latest.get(String(user.email || '').toLowerCase()) || null;
    return {
      kpis: [
        { label: 'Team members', value: users.length, format: 'number' },
        { label: 'Admins', value: users.filter((user) => user.roles.includes('admin')).length, format: 'number' },
        { label: 'Signed in (30 days)', value: users.filter((user) => signedInWithin(latest, user.email, 30, now)).length, format: 'number' },
        { label: 'No sign-in in 30 days', value: users.filter((user) => !signedInWithin(latest, user.email, 30, now)).length, format: 'number' },
        { label: 'Sign-ins, 30 days', value: recent.length, format: 'number' },
      ],
      charts: [
        { id: 'signins', title: 'Sign-ins per day (audit log)', type: 'area', xKey: 'date', series: [{ key: 'signIns', label: 'Sign-ins' }], data: daily },
        { id: 'actions', title: 'Audit events by type, 30 days', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Events' }], data: Object.entries(actions).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) },
      ],
      table: {
        title: 'Team members',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last sign-in', format: 'date' },
          { key: 'roles', label: 'Roles', format: 'text' },
          { key: 'joinedAt', label: 'Joined', format: 'date' },
        ],
        rows: users.map((user) => ({ id: user.id, name: user.name, email: user.email, status: statusOf(lastSignIn(user), now), lastActiveAt: lastSignIn(user), roles: user.roles.join(', '), joinedAt: user.joinedAt })),
      },
      notes: [
        'Postman’s audit log records sign-ins, not work in Postman, and the desktop app stays signed in, so a missing sign-in alone doesn’t mean an unused seat. Combine it with active time from the tracker.',
      ],
    };
  },

};

const SAMPLES = { zoom: sampleZoom, figma: sampleFigma, postman: samplePostman };

// Which API each dashboard's data comes from, and how sure the field names are.
export const API_INFO = {
  claude: { name: 'Anthropic Admin API', endpoints: [['GET /v1/organizations/users', 'docs'], ['GET /v1/organizations/cost_report', 'docs'], ['GET /v1/organizations/usage_report/claude_code', 'docs']] },
  codex: { name: 'Codex Analytics API', endpoints: [['GET /v1/analytics/codex/workspaces/{id}/usage', 'integrator docs']] },
  copilot: { name: 'GitHub REST API (Copilot)', endpoints: [['GET /orgs/{org}/copilot/billing', 'docs'], ['GET /orgs/{org}/copilot/billing/seats', 'docs'], ['GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest', 'docs']] },
  zoom: { name: 'Zoom REST API v2', endpoints: [['POST /oauth/token (account_credentials)', 'docs'], ['GET /users', 'docs'], ['GET /report/daily', 'docs; fields unverified']] },
  figma: { name: 'Figma REST API', endpoints: [['GET /v1/activity_logs', 'docs; fields unverified'], ['SCIM GET /scim/v2/{tenant}/Users (seat type)', 'unverified fields']] },
  postman: { name: 'Postman API', endpoints: [['GET /users', 'docs'], ['GET /audit-actions', 'docs'], ['GET /audit/logs (Enterprise, 180 days)', 'docs; sign-in codes unverified']] },
  vscode: { name: 'None (free)', endpoints: [] },
};

// env: credentials (environment overlaid with Connect dialog values).
export function licenseAppList(overview, env = {}) {
  return LICENSE_APPS.map((app) => {
    const vendor = overview?.vendors.find((item) => item.id === app.id);
    const mode = app.source === 'ai-tools'
      ? vendor?.mode || 'sample'
      : LICENSE_CONNECTORS[app.id]?.configured(env) ? 'live' : app.source;
    return { id: app.id, name: app.name, vendor: app.vendor, mode };
  });
}

// overview: AI Tools overview (live or sample); events: recent telemetry;
// env/fetch: for the live license connectors.
export async function buildDashboard(appId, { overview, events = [], identities = [], now = new Date(), env = {}, fetch: fetchImpl = fetch, refresh = false }) {
  const app = LICENSE_APPS.find((item) => item.id === appId);
  if (!app) return null;
  const tracker = trackerUsage(events, app.processes, now);
  const api = { name: API_INFO[app.id].name, endpoints: API_INFO[app.id].endpoints.map(([path, verified]) => ({ path, verified })) };
  const base = { app: { id: app.id, name: app.name, vendor: app.vendor }, api, tracker };

  if (app.source === 'ai-tools') {
    const vendor = overview.vendors.find((item) => item.id === app.id);
    if (vendor.mode === 'error') return { ...base, mode: 'error', error: vendor.error, kpis: [], charts: [], table: null, notes: [] };
    return { ...base, mode: vendor.mode, ...fromAiTools(vendor, now) };
  }
  if (app.source === 'tracker') {
    return {
      ...base,
      mode: 'tracker',
      kpis: tracker.kpis,
      charts: [
        { id: 'hours', title: 'Active hours per day (measured on PCs)', type: 'area', xKey: 'date', series: [{ key: 'hours', label: 'Hours', format: 'hours' }], data: tracker.daily },
        { id: 'devices', title: 'Active hours by PC', type: 'bar', xKey: 'device', series: [{ key: 'hours', label: 'Hours', format: 'hours' }], data: tracker.devices.slice(0, 10) },
      ],
      table: null,
      notes: [`${app.name} has no admin API: these numbers are the Tracker's measurements on each PC.`],
    };
  }
  const data = await loadLicenseData(app.id, { env, fetch: fetchImpl, now, refresh });
  if (data.mode === 'error') return { ...base, mode: 'error', error: data.error, kpis: [], charts: [], table: null, notes: [] };
  const raw = data.mode === 'live' ? data.raw : SAMPLES[app.id](now, identities);
  return { ...base, mode: data.mode, ...BUILDERS[app.id](raw, now) };
}

export { DAY };
