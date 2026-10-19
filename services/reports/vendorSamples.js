// Sample responses for the Reports dashboards of apps whose data connector is
// not built yet, in each vendor API's response format (see docs/vendor-apis.md
// and the `api` blocks in dashboards.js for which fields are verified). The same
// fictional people (plus real device owners) appear as on the AI Tools page;
// numbers are invented and stable within a day.
import { DAY_MS, isoDay, lastDays } from '../aiTools/http.js';
import { SAMPLE_LEVEL, samplePeople, sampleRandom, sampleSeed } from '../aiTools/sampleData.js';

const pick = (rand, items) => items[Math.floor(rand() * items.length) % items.length];
const ago = (now, days, rand) => new Date(now.getTime() - days * DAY_MS - Math.floor(rand() * 10) * 3600000).toISOString();

// Cursor Admin API: GET /teams/members, POST /teams/daily-usage-data, POST /teams/spend.
export function sampleCursor(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 11));
  const everyone = samplePeople(identities).filter((_, index) => index % 4 !== 3);
  const teamMembers = everyone.map(([name, , , email], index) => ({
    id: `user_sample${String(index + 1).padStart(4, '0')}`,
    name,
    email,
    role: index === 0 ? 'owner' : 'member',
    isRemoved: false,
  }));
  const data = [];
  for (const day of lastDays(now, 30)) {
    everyone.forEach(([, , level, email], index) => {
      const activity = SAMPLE_LEVEL[level];
      if (rand() > activity) return;
      const tabsShown = Math.floor(80 + rand() * 300 * activity);
      const linesAdded = Math.floor(200 + rand() * 1400 * activity);
      const applies = Math.floor(10 + rand() * 80 * activity);
      data.push({
        userId: 10000 + index,
        day,
        date: Date.parse(`${day}T00:00:00Z`),
        email,
        isActive: true,
        totalLinesAdded: linesAdded,
        totalLinesDeleted: Math.floor(linesAdded * (0.3 + rand() * 0.3)),
        acceptedLinesAdded: Math.floor(linesAdded * (0.55 + rand() * 0.25)),
        acceptedLinesDeleted: Math.floor(linesAdded * 0.2),
        totalApplies: applies,
        totalAccepts: Math.floor(applies * (0.7 + rand() * 0.2)),
        totalRejects: Math.floor(applies * 0.12),
        totalTabsShown: tabsShown,
        totalTabsAccepted: Math.floor(tabsShown * (0.6 + rand() * 0.25)),
        composerRequests: Math.floor(rand() * 40 * activity),
        chatRequests: Math.floor(20 + rand() * 90 * activity),
        agentRequests: Math.floor(rand() * (index % 3 === 0 ? 40 : 10) * activity),
        cmdkUsages: Math.floor(rand() * 50 * activity),
        subscriptionIncludedReqs: Math.floor(40 + rand() * 120 * activity),
        apiKeyReqs: 0,
        usageBasedReqs: Math.floor(rand() * 8 * activity),
        bugbotUsages: Math.floor(rand() * 3),
        mostUsedModel: pick(rand, ['claude-sonnet-5-5', 'gpt-5', 'claude-opus-5-5', 'auto']),
        applyMostUsedExtension: pick(rand, ['.tsx', '.ts', '.py', '.cs']),
        tabMostUsedExtension: pick(rand, ['.ts', '.tsx', '.py']),
        clientVersion: pick(rand, ['1.7.12', '1.7.9', '1.6.45']),
      });
    });
  }
  const teamMemberSpend = everyone.map(([name, , level, email], index) => {
    const spendCents = Math.round((900 + rand() * 4200 * SAMPLE_LEVEL[level]) * 1000) / 1000;
    return {
      userId: teamMembers[index].id,
      spendCents,
      overallSpendCents: spendCents,
      fastPremiumRequests: Math.floor(spendCents / 4),
      name,
      email,
      role: teamMembers[index].role,
      hardLimitOverrideDollars: 0,
      monthlyLimitDollars: 100,
      effectivePerUserLimitDollars: 100,
    };
  });
  return {
    members: { teamMembers },
    dailyUsage: { data, period: { startDate: Date.parse(`${lastDays(now, 30)[0]}T00:00:00Z`), endDate: now.getTime() } },
    spend: { teamMemberSpend, subscriptionCycleStart: Date.parse(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`), totalMembers: teamMembers.length, totalPages: 1 },
  };
}

// Slack: team.billableInfo (billing_active per user) and member analytics rows.
export function sampleSlack(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 12));
  const everyone = samplePeople(identities);
  const ids = everyone.map((_, index) => `U0${(7000 + index * 37).toString(36).toUpperCase()}SAMPLE`);
  const billable_info = Object.fromEntries(everyone.map(([, , level], index) => [ids[index], { billing_active: level !== 'idle' }]));
  const memberAnalytics = [];
  for (const day of lastDays(now, 30)) {
    everyone.forEach(([, , level, email], index) => {
      const active = level !== 'idle' && rand() < 0.35 + SAMPLE_LEVEL[level] * 0.6;
      memberAnalytics.push({
        date: day,
        user_id: ids[index],
        email_address: email,
        is_guest: false,
        is_billable_seat: level !== 'idle',
        is_active: active,
        is_active_desktop: active && rand() < 0.9,
        is_active_ios: active && rand() < 0.3,
        messages_posted_count: active ? Math.floor(4 + rand() * 60 * Math.max(SAMPLE_LEVEL[level], 0.3)) : 0,
        reactions_added_count: active ? Math.floor(rand() * 20) : 0,
        files_added_count: active ? Math.floor(rand() * 4) : 0,
      });
    });
  }
  return { billableInfo: { ok: true, billable_info }, memberAnalytics, users: everyone.map(([name, , , email], index) => ({ id: ids[index], real_name: name, profile: { email } })) };
}

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

// Postman: GET /users (team) and audit logs.
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
  const trails = [];
  for (const day of lastDays(now, 30)) {
    everyone.forEach(([name, login, level, email], index) => {
      const events = Math.floor(rand() * 4 * SAMPLE_LEVEL[level]);
      for (let event = 0; event < events; event += 1) {
        trails.push({
          id: trails.length + 1,
          ip: '203.0.113.10',
          userAgent: 'PostmanRuntime/7.43',
          action: pick(rand, ['collection.update', 'request.create', 'environment.update', 'collection.fork', 'workspace.update']),
          timestamp: new Date(Date.parse(`${day}T08:00:00Z`) + event * 3600000).toISOString(),
          message: `${name} made a change`,
          actor: { id: data[index].id, name, username: login, email, active: true },
        });
      }
    });
  }
  return { users: { data }, auditLogs: { trails } };
}

// Docker Hub: GET /v2/orgs/{org}/members (insights fields when enabled).
export function sampleDocker(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 16));
  const everyone = samplePeople(identities);
  const results = everyone.map(([name, login, level, email], index) => ({
    id: `docker-user-${index + 1}`,
    username: login,
    full_name: name,
    email,
    type: 'User',
    role: index === 0 ? 'Owner' : index % 5 === 0 ? 'Editor' : 'Member',
    groups: [index % 2 === 0 ? 'developers' : 'platform'],
    is_guest: false,
    date_joined: ago(now, 500 - index * 40, rand),
    last_logged_in_at: level === 'idle' ? ago(now, 60 + index * 5, rand) : ago(now, Math.floor(rand() * 10), rand),
    last_seen_at: level === 'idle' ? ago(now, 55 + index * 5, rand) : ago(now, Math.floor(rand() * 6), rand),
    last_desktop_version: pick(rand, ['4.45.0', '4.44.3', '4.41.2', '4.37.1']),
  }));
  return { members: { count: results.length, next: null, previous: null, results } };
}

// JetBrains Account API: organization licences (field names not verified).
export function sampleJetBrains(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 17));
  const everyone = samplePeople(identities);
  const products = [
    { code: 'II', name: 'IntelliJ IDEA Ultimate' },
    { code: 'WS', name: 'WebStorm' },
    { code: 'AI', name: 'JetBrains AI Pro' },
  ];
  const licenses = [];
  everyone.forEach(([name, , level, email], index) => {
    licenses.push({
      licenseId: `LIC${(10000 + index).toString(36).toUpperCase()}`,
      product: products[index % 3 === 2 ? 1 : 0],
      team: { id: 1, name: 'Engineering' },
      assignee: { type: 'USER', email, name },
      lastSeen: { lastSeenDate: level === 'idle' ? ago(now, 70, rand) : ago(now, Math.floor(rand() * 5), rand) },
      isTrial: false,
    });
  });
  for (let spare = 0; spare < 3; spare += 1) {
    licenses.push({ licenseId: `LICSPARE${spare}`, product: products[spare === 2 ? 2 : 0], team: { id: 1, name: 'Engineering' }, assignee: null, lastSeen: null, isTrial: false });
  }
  return { licenses };
}

// ChatGPT Enterprise usage analytics (daily per user; field names not verified).
export function sampleChatGpt(now, identities) {
  const rand = sampleRandom(sampleSeed(now, 18));
  const everyone = samplePeople(identities);
  const data = [];
  for (const day of lastDays(now, 30)) {
    everyone.forEach(([name, , level, email]) => {
      if (rand() > 0.2 + SAMPLE_LEVEL[level] * 0.7) return;
      const messages = Math.floor(5 + rand() * 70 * Math.max(SAMPLE_LEVEL[level], 0.25));
      data.push({
        date: day,
        user_email: email,
        user_name: name,
        messages,
        gpt_messages: Math.floor(messages * rand() * 0.3),
        tool_messages: Math.floor(messages * rand() * 0.25),
        models: { 'gpt-5': Math.floor(messages * 0.7), 'gpt-5-thinking': Math.ceil(messages * 0.3) },
      });
    });
  }
  return { usage: { data }, seats: everyone.map(([name, , , email]) => ({ email, name, role: 'standard-user', status: 'active' })) };
}

export { isoDay };
