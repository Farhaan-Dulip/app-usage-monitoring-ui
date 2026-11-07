// Sample responses for the Reports dashboards of apps whose data connector is
// not built yet, in each vendor API's response format (see docs/vendor-apis.md
// and the `api` blocks in dashboards.js for which fields are verified). The same
// fictional people (plus real device owners) appear as on the AI Tools page;
// numbers are invented and stable within a day.
import { DAY_MS, isoDay, lastDays } from '../aiTools/http.js';
import { SAMPLE_LEVEL, samplePeople, sampleRandom, sampleSeed } from '../aiTools/sampleData.js';

const pick = (rand, items) => items[Math.floor(rand() * items.length) % items.length];
const ago = (now, days, rand) => new Date(now.getTime() - days * DAY_MS - Math.floor(rand() * 10) * 3600000).toISOString();

// Zoom: GET /users (type 1 Basic, 2 Licensed) and GET /report/daily.
export function sampleZoom(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 13));
  const everyone = samplePeople(identities);
  const users = everyone.map(([name, , level, email], index) => {
    const [first, ...rest] = name.split(' ');
    const licensed = index % 3 !== 2;
    const loginAgo = level === 'idle' ? 45 + index * 4 : Math.floor(rand() * 6 / Math.max(SAMPLE_LEVEL[level], 0.25));
    return {
      id: `zoom${index + 1}SampleId`,
      first_name: first,
      last_name: rest.join(' '),
      display_name: name,
      email,
      type: licensed ? 2 : 1,
      pmi: 4000000000 + index,
      timezone: 'Asia/Colombo',
      dept: pick(rand, ['Engineering', 'Product', 'Sales', 'Support']),
      created_at: ago(now, 300 + index * 20, rand),
      last_login_time: ago(now, loginAgo, rand),
      last_client_version: pick(rand, ['6.4.6.53970(win)', '6.4.3.51500(win)', '6.3.11.60501(mac)']),
      status: 'active',
      role_id: index === 0 ? '0' : '2',
    };
  });
  const dates = lastDays(now, 30).map((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const busy = weekday === 0 || weekday === 6 ? 0.15 : 1;
    const meetings = Math.floor((6 + rand() * 14) * busy);
    return { date, new_users: rand() < 0.08 ? 1 : 0, meetings, participants: Math.floor(meetings * (3 + rand() * 4)), meeting_minutes: Math.floor(meetings * (25 + rand() * 30)) };
  });
  return {
    users: { page_count: 1, page_number: 1, page_size: 300, total_records: users.length, next_page_token: '', users },
    dailyReport: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, dates },
  };
}

// Figma: seats (SCIM) and activity logs (Enterprise, org:activity_log_read).
export function sampleFigma(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 14));
  const everyone = samplePeople(identities).filter((_, index) => index % 2 === 0 || index >= 8);
  const seats = everyone.map(([name, , level, email], index) => ({
    id: `figma-user-${index + 1}`,
    email,
    name,
    seat_type: level === 'idle' ? 'View' : pick(rand, ['Full', 'Full', 'Dev', 'Collab']),
  }));
  const activity_logs = [];
  for (const day of lastDays(now, 30)) {
    everyone.forEach(([name, , level, email], index) => {
      const events = Math.floor(rand() * 9 * SAMPLE_LEVEL[level]);
      for (let event = 0; event < events; event += 1) {
        activity_logs.push({
          id: `al_${day.replace(/-/g, '')}_${index}_${event}`,
          timestamp: Math.floor(Date.parse(`${day}T09:00:00Z`) / 1000) + event * 900,
          actor: { type: 'user', id: seats[index].id, email, name },
          action: { type: pick(rand, ['fig_file_view', 'fig_file_view', 'fig_file_edit', 'fig_file_export']), details: {} },
          entity: { type: 'file', id: `file${index}${event % 3}`, name: pick(rand, ['Design system', 'Portal UI', 'Onboarding flow']) },
          context: { client_name: 'Figma Desktop', team_id: 'team-sample', org_id: 'org-sample' },
        });
      }
    });
  }
  return { seats, activityLogs: { error: false, status: 200, meta: { activity_logs, cursor: '', next_page: false } } };
}

// Postman: GET /users (team), GET /audit-actions and GET /audit/logs, in the
// shapes Postman's API reference documents. The audit log holds account
// events: sign-ins (how often depends on how active someone is; the desktop
// app stays signed in) and the odd sign-out or API key event. Action codes
// here are sample values; live codes come from GET /audit-actions.
const POSTMAN_SAMPLE_ACTIONS = [
  { code: 'user.login_password', name: 'User Logged-In Using Password' },
  { code: 'user.login_sso', name: 'User Logged-In Using SSO' },
  { code: 'user.login_google', name: 'User Logged-In Using Google OAuth' },
  { code: 'user.logout', name: 'User Logged-out' },
  { code: 'api_key.create', name: 'Created Postman API Key' },
];
// Days between sign-ins for each activity level (idle people don't sign in).
const POSTMAN_SIGN_IN_GAP = { heavy: 4, regular: 9, light: 25 };

export function samplePostman(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 15));
  const everyone = samplePeople(identities);
  const data = everyone.map(([name, login, , email], index) => ({
    id: 12000000 + index,
    name,
    username: login,
    email,
    roles: index === 0 ? ['admin', 'user'] : index % 4 === 0 ? ['billing', 'user'] : ['user'],
    joinedAt: ago(now, 400 - index * 30, rand),
  }));
  const team = { name: 'Allion Engineering', id: 4410 };
  const trails = [];
  const event = (index, code, daysAgo) => {
    const [name, login, , email] = everyone[index];
    const action = POSTMAN_SAMPLE_ACTIONS.find((item) => item.code === code);
    trails.push({
      id: 95000000 + trails.length,
      ip: '203.0.113.10',
      userAgent: 'PostmanClient/11.30.4 (AppId=Desktop; Platform=win32)',
      action: code,
      timestamp: ago(now, daysAgo, rand),
      message: `${name} ${action.name.replace(/^User /, '').toLowerCase()}`,
      data: { actor: { name, username: login, email, id: data[index].id, active: true }, team },
    });
  };
  everyone.forEach(([, , level], index) => {
    const gap = POSTMAN_SIGN_IN_GAP[level];
    if (!gap) return;
    const via = pick(rand, ['user.login_password', 'user.login_sso', 'user.login_sso', 'user.login_google']);
    for (let daysAgo = Math.floor(rand() * gap); daysAgo < 180; daysAgo += gap + Math.floor(rand() * gap)) {
      event(index, via, daysAgo);
      if (rand() < 0.15) event(index, 'user.logout', Math.max(0, daysAgo - 1));
    }
    if (index % 5 === 1) event(index, 'api_key.create', 20 + index);
  });
  trails.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { users: { data }, auditActions: { data: POSTMAN_SAMPLE_ACTIONS }, auditLogs: { trails } };
}

export { isoDay };
