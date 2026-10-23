// Reports & Insights > End User Apps: one dashboard per app.
//
// Each dashboard = { app, mode, api, kpis, charts, table, tracker, notes }:
//   mode 'live'    vendor admin API data (licenseConnectors.js), when connected
//        'sample'  sample data in the same response format, when not
//        'error'   connected, but the vendor call failed (never sample data)
//        'tracker' no admin API; the Tracker's measurements are the data
// `tracker` is always real: active time measured on PCs (telemetry) for the
// app's processes. `api.endpoints[].verified` says how sure the field names are.
import { daysSince, isoDay, lastDays } from '../aiTools/http.js';
import { sampleChatGpt, sampleCursor, sampleDocker, sampleFigma, sampleJetBrains, samplePostman, sampleSlack, sampleZoom } from './vendorSamples.js';
import { LICENSE_CONNECTORS, loadLicenseData } from './licenseConnectors.js';

const DAY = 24 * 60 * 60 * 1000;

// Apps on the End User Apps page (one per vendor product).
export const LICENSE_APPS = [
  { id: 'slack', name: 'Slack', vendor: 'Salesforce', source: 'sample', processes: ['slack.exe'] },
  { id: 'zoom', name: 'Zoom', vendor: 'Zoom', source: 'sample', processes: ['zoom.exe'] },
  { id: 'figma', name: 'Figma', vendor: 'Figma', source: 'sample', processes: ['figma.exe'] },
  { id: 'postman', name: 'Postman', vendor: 'Postman', source: 'sample', processes: ['postman.exe'] },
  { id: 'docker', name: 'Docker Desktop', vendor: 'Docker', source: 'sample', processes: ['docker desktop.exe'] },
  { id: 'jetbrains', name: 'IntelliJ IDEA', vendor: 'JetBrains', source: 'sample', processes: ['idea64.exe'] },
  { id: 'vscode', name: 'Visual Studio Code', vendor: 'Microsoft', source: 'tracker', processes: ['code.exe'] },
  { id: 'visual-studio', name: 'Visual Studio', vendor: 'Microsoft', source: 'tracker', processes: ['devenv.exe'] },
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
  cursor(raw, now) {
    const members = raw.members.teamMembers.filter((member) => !member.isRemoved);
    const rows = raw.dailyUsage.data;
    const lastActive = {};
    for (const row of rows) if (row.isActive && (!lastActive[row.email] || row.day > lastActive[row.email])) lastActive[row.email] = row.day;
    const spend = new Map(raw.spend.teamMemberSpend.map((entry) => [entry.email, entry]));
    const requests = (row) => row.composerRequests + row.chatRequests + row.agentRequests;
    const models = {};
    for (const row of rows) models[row.mostUsedModel] = (models[row.mostUsedModel] || 0) + requests(row);
    const daily = lastDays(now, 30).map((date) => {
      const day = rows.filter((row) => row.day === date);
      return { date, agent: sum(day, (row) => row.agentRequests), chat: sum(day, (row) => row.chatRequests), composer: sum(day, (row) => row.composerRequests), activeUsers: day.filter((row) => row.isActive).length };
    });
    return {
      kpis: [
        { label: 'Seats', value: members.length, format: 'number' },
        { label: 'Active (14 days)', value: members.filter((member) => statusOf(lastActive[member.email], now, 14) === 'active').length, format: 'number' },
        { label: 'Spend this cycle', value: sum(raw.spend.teamMemberSpend, (entry) => entry.spendCents) / 100, format: 'usd' },
        { label: 'Tab acceptance', value: ratio(sum(rows, (row) => row.totalTabsAccepted), sum(rows, (row) => row.totalTabsShown)), format: 'percent' },
        { label: 'AI lines accepted', value: ratio(sum(rows, (row) => row.acceptedLinesAdded), sum(rows, (row) => row.totalLinesAdded)), format: 'percent' },
        { label: 'Requests, 30 days', value: sum(rows, requests), format: 'number' },
      ],
      charts: [
        { id: 'requests', title: 'Daily requests by mode', type: 'area', stacked: true, xKey: 'date', series: [{ key: 'agent', label: 'Agent' }, { key: 'chat', label: 'Chat' }, { key: 'composer', label: 'Composer' }], data: daily },
        { id: 'active', title: 'Daily active users', type: 'bar', xKey: 'date', series: [{ key: 'activeUsers', label: 'Active users' }], data: daily },
        { id: 'models', title: 'Requests by most-used model', type: 'pie', data: Object.entries(models).map(([name, value]) => ({ name, value })) },
      ],
      table: {
        title: 'Team members',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last active', format: 'date' },
          { key: 'spend', label: 'Spend (cycle)', format: 'usd' },
          { key: 'limit', label: 'Monthly limit', format: 'usd' },
          { key: 'requests', label: 'Requests (30d)', format: 'number' },
        ],
        rows: members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          status: statusOf(lastActive[member.email], now, 14),
          lastActiveAt: lastActive[member.email] || null,
          spend: (spend.get(member.email)?.spendCents || 0) / 100,
          limit: spend.get(member.email)?.monthlyLimitDollars ?? null,
          requests: sum(rows.filter((row) => row.email === member.email), requests),
        })),
      },
      notes: [],
    };
  },

  slack(raw, now) {
    const analytics = raw.memberAnalytics;
    const billable = Object.values(raw.billableInfo.billable_info).filter((entry) => entry.billing_active).length;
    const recent = analytics.filter((row) => daysSince(`${row.date}T00:00:00Z`, now) <= 14);
    const activeRecently = new Set(recent.filter((row) => row.is_active).map((row) => row.user_id));
    const lastActive = {};
    for (const row of analytics) if (row.is_active && (!lastActive[row.user_id] || row.date > lastActive[row.user_id])) lastActive[row.user_id] = row.date;
    const daily = lastDays(now, 30).map((date) => {
      const day = analytics.filter((row) => row.date === date);
      return { date, active: day.filter((row) => row.is_active).length, messages: sum(day, (row) => row.messages_posted_count) };
    });
    const billableIdle = raw.users.filter((user) => raw.billableInfo.billable_info[user.id]?.billing_active && !activeRecently.has(user.id));
    return {
      kpis: [
        { label: 'Members', value: raw.users.length, format: 'number' },
        { label: 'Billable seats', value: billable, format: 'number' },
        { label: 'Active (14 days)', value: activeRecently.size, format: 'number' },
        { label: 'Billable but inactive', value: billableIdle.length, format: 'number' },
        { label: 'Messages, 30 days', value: sum(analytics, (row) => row.messages_posted_count), format: 'number' },
      ],
      charts: [
        { id: 'active', title: 'Daily active members', type: 'bar', xKey: 'date', series: [{ key: 'active', label: 'Active members' }], data: daily },
        { id: 'messages', title: 'Messages posted per day', type: 'area', xKey: 'date', series: [{ key: 'messages', label: 'Messages' }], data: daily },
        { id: 'seats', title: 'Seats', type: 'pie', data: [{ name: 'Billable, active', value: billable - billableIdle.length }, { name: 'Billable, inactive', value: billableIdle.length }, { name: 'Not billable', value: raw.users.length - billable }] },
      ],
      table: {
        title: 'Members',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last active', format: 'date' },
          { key: 'billable', label: 'Billable seat', format: 'text' },
          { key: 'messages', label: 'Messages (30d)', format: 'number' },
        ],
        rows: raw.users.map((user) => ({
          id: user.id,
          name: user.real_name,
          email: user.profile.email,
          status: statusOf(lastActive[user.id] ? `${lastActive[user.id]}T00:00:00Z` : null, now, 14),
          lastActiveAt: lastActive[user.id] || null,
          billable: raw.billableInfo.billable_info[user.id]?.billing_active ? 'Yes' : 'No',
          messages: sum(analytics.filter((row) => row.user_id === user.id), (row) => row.messages_posted_count),
        })),
      },
      notes: billableIdle.length ? [`${billableIdle.length} billable seat(s) with no activity in 14 days: candidates to deactivate.`] : [],
    };
  },

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
    const trails = raw.auditLogs.trails.filter((trail) => trail.actor?.email);
    const lastActive = {};
    for (const trail of trails) if (!lastActive[trail.actor.email] || trail.timestamp > lastActive[trail.actor.email]) lastActive[trail.actor.email] = trail.timestamp;
    const actions = {};
    for (const trail of trails) actions[trail.action] = (actions[trail.action] || 0) + 1;
    const daily = Object.entries(byDay(now, trails, (trail) => isoDay(trail.timestamp), () => 1)).map(([date, value]) => ({ date, events: value }));
    const users = raw.users.data.map((user) => ({ ...user, roles: user.roles || [] }));
    return {
      kpis: [
        { label: 'Team members', value: users.length, format: 'number' },
        { label: 'Admins', value: users.filter((user) => user.roles.includes('admin')).length, format: 'number' },
        { label: 'Active (30 days)', value: Object.keys(lastActive).length, format: 'number' },
        { label: 'No activity in 30 days', value: users.filter((user) => !lastActive[user.email]).length, format: 'number' },
        { label: 'Audit events, 30 days', value: trails.length, format: 'number' },
      ],
      charts: [
        { id: 'events', title: 'Changes per day (audit log)', type: 'area', xKey: 'date', series: [{ key: 'events', label: 'Events' }], data: daily },
        { id: 'actions', title: 'Changes by type', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Events' }], data: Object.entries(actions).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) },
      ],
      table: {
        title: 'Team members',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last change', format: 'date' },
          { key: 'roles', label: 'Roles', format: 'text' },
          { key: 'joinedAt', label: 'Joined', format: 'date' },
        ],
        rows: users.map((user) => ({ id: user.id, name: user.name, email: user.email, status: statusOf(lastActive[user.email], now), lastActiveAt: lastActive[user.email] || null, roles: user.roles.join(', '), joinedAt: user.joinedAt })),
      },
      notes: [],
    };
  },

  docker(raw, now) {
    const members = raw.members.results;
    const versions = {};
    for (const member of members) versions[member.last_desktop_version] = (versions[member.last_desktop_version] || 0) + 1;
    const latest = Object.keys(versions).filter((version) => /^\d/.test(version)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    const roleOf = (member) => String(member.role || '').toLowerCase();
    const stale = members.filter((member) => daysSince(member.last_seen_at, now) > 30);
    return {
      kpis: [
        { label: 'Members (seats)', value: raw.members.count, format: 'number' },
        { label: 'Seen in 30 days', value: members.length - stale.length, format: 'number' },
        { label: 'Not seen in 30 days', value: stale.length, format: 'number' },
        ...(latest ? [{ label: `On latest Desktop (${latest})`, value: versions[latest] || 0, format: 'number' }] : []),
        { label: 'Owners', value: members.filter((member) => roleOf(member) === 'owner').length, format: 'number' },
      ],
      charts: [
        { id: 'versions', title: 'Docker Desktop versions in use', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Members' }], data: Object.entries(versions).map(([name, value]) => ({ name, value })).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })) },
        { id: 'roles', title: 'Members by role', type: 'pie', data: ['Owner', 'Editor', 'Member'].map((role) => ({ name: role, value: members.filter((member) => roleOf(member) === role.toLowerCase()).length })) },
      ],
      table: {
        title: 'Organization members',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last seen', format: 'date' },
          { key: 'role', label: 'Role', format: 'text' },
          { key: 'version', label: 'Desktop version', format: 'text' },
          { key: 'groups', label: 'Teams', format: 'text' },
        ],
        rows: members.map((member) => ({ id: member.id, name: member.full_name, email: member.email, status: statusOf(member.last_seen_at, now), lastActiveAt: member.last_seen_at, role: member.role, version: member.last_desktop_version, groups: member.groups.join(', ') })),
      },
      notes: stale.length ? [`${stale.length} member(s) not seen for 30+ days: candidates to remove from the paid organization.`] : [],
    };
  },

  jetbrains(raw, now) {
    const licenses = raw.licenses;
    const assigned = licenses.filter((license) => license.assignee);
    const stale = assigned.filter((license) => daysSince(license.lastSeen?.lastSeenDate, now) > 30);
    const products = {};
    for (const license of licenses) products[license.product.name] = (products[license.product.name] || 0) + 1;
    return {
      kpis: [
        { label: 'Licences', value: licenses.length, format: 'number' },
        { label: 'Assigned', value: assigned.length, format: 'number' },
        { label: 'Available to assign', value: licenses.length - assigned.length, format: 'number' },
        { label: 'Assigned, not used in 30 days', value: stale.length, format: 'number' },
      ],
      charts: [
        { id: 'products', title: 'Licences by product', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Licences' }], data: Object.entries(products).map(([name, value]) => ({ name, value })) },
        { id: 'assignment', title: 'Assignment', type: 'pie', data: [{ name: 'Assigned, in use', value: assigned.length - stale.length }, { name: 'Assigned, unused', value: stale.length }, { name: 'Unassigned', value: licenses.length - assigned.length }] },
      ],
      table: {
        title: 'Licences',
        columns: [
          { key: 'name', label: 'Assignee', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last seen', format: 'date' },
          { key: 'product', label: 'Product', format: 'text' },
          { key: 'licenseId', label: 'Licence ID', format: 'text' },
        ],
        rows: licenses.map((license) => ({ id: license.licenseId, name: license.assignee?.name || 'Unassigned', email: license.assignee?.email || '', status: license.assignee ? statusOf(license.lastSeen?.lastSeenDate, now) : 'never', lastActiveAt: license.lastSeen?.lastSeenDate || null, product: license.product.name, licenseId: license.licenseId })),
      },
      notes: stale.length ? [`${stale.length} assigned licence(s) unused for 30+ days could be reassigned.`] : [],
    };
  },

  chatgpt(raw, now) {
    const rows = raw.usage.data;
    const lastActive = {};
    for (const row of rows) if (!lastActive[row.user_email] || row.date > lastActive[row.user_email]) lastActive[row.user_email] = row.date;
    const models = {};
    for (const row of rows) for (const [model, count] of Object.entries(row.models)) models[model] = (models[model] || 0) + count;
    const daily = lastDays(now, 30).map((date) => {
      const day = rows.filter((row) => row.date === date);
      return { date, messages: sum(day, (row) => row.messages), users: day.length };
    });
    return {
      kpis: [
        { label: 'Seats', value: raw.seats.length, format: 'number' },
        { label: 'Active (14 days)', value: raw.seats.filter((seat) => statusOf(lastActive[seat.email] ? `${lastActive[seat.email]}T00:00:00Z` : null, now, 14) === 'active').length, format: 'number' },
        { label: 'Messages, 30 days', value: sum(rows, (row) => row.messages), format: 'number' },
        { label: 'GPT messages', value: sum(rows, (row) => row.gpt_messages), format: 'number' },
      ],
      charts: [
        { id: 'messages', title: 'Messages per day', type: 'area', xKey: 'date', series: [{ key: 'messages', label: 'Messages' }], data: daily },
        { id: 'users', title: 'Daily active users', type: 'bar', xKey: 'date', series: [{ key: 'users', label: 'Users' }], data: daily },
        { id: 'models', title: 'Messages by model', type: 'pie', data: Object.entries(models).map(([name, value]) => ({ name, value })) },
      ],
      table: {
        title: 'Seats',
        columns: [
          { key: 'name', label: 'User', format: 'text' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'lastActiveAt', label: 'Last active', format: 'date' },
          { key: 'messages', label: 'Messages (30d)', format: 'number' },
        ],
        rows: raw.seats.map((seat) => ({ id: seat.email, name: seat.name, email: seat.email, status: statusOf(lastActive[seat.email] ? `${lastActive[seat.email]}T00:00:00Z` : null, now, 14), lastActiveAt: lastActive[seat.email] || null, messages: sum(rows.filter((row) => row.user_email === seat.email), (row) => row.messages) })),
      },
      notes: [],
    };
  },
};

const SAMPLES = { cursor: sampleCursor, slack: sampleSlack, zoom: sampleZoom, figma: sampleFigma, postman: samplePostman, docker: sampleDocker, jetbrains: sampleJetBrains, chatgpt: sampleChatGpt };

// Which API each dashboard's data comes from, and how sure the field names are.
export const API_INFO = {
  claude: { name: 'Anthropic Admin API', endpoints: [['GET /v1/organizations/users', 'docs'], ['GET /v1/organizations/cost_report', 'docs'], ['GET /v1/organizations/usage_report/claude_code', 'docs']] },
  codex: { name: 'Codex Analytics API', endpoints: [['GET /v1/analytics/codex/workspaces/{id}/usage', 'integrator docs']] },
  copilot: { name: 'GitHub REST API (Copilot)', endpoints: [['GET /orgs/{org}/copilot/billing', 'docs'], ['GET /orgs/{org}/copilot/billing/seats', 'docs'], ['GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest', 'docs']] },
  cursor: { name: 'Cursor Admin API', endpoints: [['GET /teams/members', 'docs'], ['POST /teams/daily-usage-data', 'docs'], ['POST /teams/spend', 'docs']] },
  slack: { name: 'Slack Web API (admin)', endpoints: [['users.list', 'docs'], ['team.billableInfo', 'docs'], ['admin.analytics.getFile (type=member)', 'docs; fields unverified']] },
  zoom: { name: 'Zoom REST API v2', endpoints: [['POST /oauth/token (account_credentials)', 'docs'], ['GET /users', 'docs'], ['GET /report/daily', 'docs; fields unverified']] },
  figma: { name: 'Figma REST API', endpoints: [['GET /v1/activity_logs', 'docs; fields unverified'], ['SCIM GET /scim/v2/{tenant}/Users (seat type)', 'unverified fields']] },
  postman: { name: 'Postman API', endpoints: [['GET /users', 'integrator docs'], ['GET /audit/logs', 'docs; fields unverified']] },
  docker: { name: 'Docker Hub API', endpoints: [['POST /v2/auth/token', 'docs'], ['GET /v2/orgs/{org}/members', 'docs; activity fields unverified']] },
  jetbrains: { name: 'JetBrains Account API', endpoints: [['GET /api/v1/customer/licenses', 'unverified route and fields']] },
  chatgpt: { name: 'ChatGPT Enterprise analytics API', endpoints: [['Daily usage analytics', 'unverified fields']] },
  vscode: { name: 'None (free)', endpoints: [] },
  'visual-studio': { name: 'None public (Visual Studio Subscriptions admin portal)', endpoints: [] },
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
