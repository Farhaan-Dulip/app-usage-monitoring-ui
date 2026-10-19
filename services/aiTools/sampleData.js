// Sample responses in each vendor's documented raw format, used until that
// vendor's admin credential is configured. They go through the same
// normalizers as live responses, so switching to live changes only the data.
// People are fictional (example.com) plus, when given, the portal's real
// device owners (so a tracker's detail page can show how its user's data will
// look); all numbers are invented and deterministic per day.
import { DAY_MS, isoDay, lastDays } from './http.js';

const PEOPLE = [
  ['Ava Fernando', 'ava.fernando', 'heavy'],
  ['Kasun Perera', 'kasun-p', 'heavy'],
  ['Nimali Silva', 'nimali-s', 'regular'],
  ['Ravi Kumar', 'ravik', 'regular'],
  ['Sara Jayasinghe', 'sara-j', 'light'],
  ['Dinesh Wickrama', 'dineshw', 'light'],
  ['Maya de Silva', 'maya-ds', 'idle'],
  ['Tharindu Bandara', 'tharindu-b', 'idle'],
];
const LEVEL = { heavy: 1, regular: 0.6, light: 0.25, idle: 0 };
// Indexes into PEOPLE of the fictional people who also use Claude / Codex
// (real device owners always get all three). Heavy Copilot users get the
// larger 200-credit budget; everyone else uses the default.
const CLAUDE_USERS = new Set([0, 2, 5]);
const CODEX_USERS = new Set([0, 1, 3]);
const COPILOT_LARGE_BUDGET = 200;
// Share of each person's Copilot activity in agent mode (wide spread, like real teams).
const AGENT_SHARE = [0.55, 0.06, 0.35, 0.12, 0.7, 0.03, 0.2, 0.4, 0.25];

// Small deterministic generator so sample numbers are stable within a day.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const fictionalEmail = (login) => `${login.replace(/-/g, '.')}@example.com`;

// Display names of the fictional people, for the sample directory.
export const SAMPLE_NAMES = Object.fromEntries(PEOPLE.map(([name, login]) => [fictionalEmail(login), name]));

// [name, login, activity level, email] for the fictional people plus real
// device owners ({ name, email }), who get regular sample activity.
function people(identities = []) {
  const known = new Set(PEOPLE.map(([, login]) => fictionalEmail(login)));
  const extra = identities
    .filter((identity) => identity?.email && !known.has(identity.email))
    .map((identity) => [identity.name || identity.email, sampleLogin(identity.email), 'regular', identity.email]);
  return [...PEOPLE.map(([name, login, level]) => [name, login, level, fictionalEmail(login)]), ...extra];
}

// Shared with the Reports dashboards' sample data, so the same fictional people
// (and real device owners) appear across every app.
export { people as samplePeople, random as sampleRandom, seedFor as sampleSeed, LEVEL as SAMPLE_LEVEL };

// GitHub-style login for a sample seat: the email's local part.
export function sampleLogin(emailAddress) {
  return String(emailAddress).split('@')[0].replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}
const seedFor = (now, salt) => Number(isoDay(now).replace(/-/g, '')) + salt;

export function sampleClaudeRaw(now = new Date(), days = 14, identities = []) {
  const rand = random(seedFor(now, 1));
  const everyone = people(identities).filter((_, index) => CLAUDE_USERS.has(index) || index >= PEOPLE.length);
  const users = everyone.map(([name, , , address], index) => ({
    type: 'user',
    id: `user_sample${index + 1}`,
    added_at: new Date(now.getTime() - (120 + index * 9) * DAY_MS).toISOString(),
    email: address,
    name,
    role: index === 0 ? 'admin' : 'developer',
  }));
  const claudeCode = [];
  for (const day of lastDays(now, days)) {
    for (const [, , level, address] of everyone) {
      if (rand() > LEVEL[level]) continue;
      const sessions = 1 + Math.floor(rand() * 6 * LEVEL[level]);
      claudeCode.push({
        actor: { type: 'user_actor', email_address: address },
        core_metrics: {
          num_sessions: sessions,
          lines_of_code: { added: Math.floor(sessions * (40 + rand() * 120)), removed: Math.floor(sessions * (10 + rand() * 40)) },
          commits_by_claude_code: Math.floor(rand() * 3 * LEVEL[level]),
          pull_requests_by_claude_code: rand() > 0.8 ? 1 : 0,
        },
        customer_type: 'subscription',
        subscription_type: 'team',
        date: `${day}T00:00:00Z`,
        is_remote: false,
        model_breakdown: [{
          model: 'claude-sonnet-5-5',
          estimated_cost: { amount: Math.floor(sessions * (20 + rand() * 60)), currency: 'USD' },
          tokens: { input: sessions * 21000, output: sessions * 5200, cache_read: sessions * 3400, cache_creation: sessions * 900 },
        }],
        organization_id: '00000000-0000-0000-0000-000000000000',
        terminal_type: 'vscode',
        tool_actions: {
          edit_tool: { accepted: Math.floor(sessions * (2 + rand() * 4)), rejected: Math.floor(rand() * 2) },
          write_tool: { accepted: Math.floor(sessions * rand() * 2), rejected: 0 },
        },
      });
    }
  }
  const costBuckets = lastDays(now, 30).map((day) => ({
    starting_at: `${day}T00:00:00Z`,
    ending_at: new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString(),
    // Cents as decimal strings, as the cost report returns them.
    results: [{ amount: (1800 + rand() * 2600).toFixed(2), currency: 'USD', cost_type: null, description: null, model: null, workspace_id: null }],
  }));
  return { users, costBuckets, claudeCode };
}

export function sampleCopilotRaw(now = new Date(), identities = []) {
  const rand = random(seedFor(now, 2));
  const everyone = people(identities);
  const seats = everyone.map(([, login, level], index) => {
    const idleFor = level === 'idle' ? 40 + index * 3 : Math.floor(rand() * 4 / Math.max(LEVEL[level], 0.2));
    return {
      assignee: { login, id: 9000 + index, type: 'User' },
      assigning_team: null,
      created_at: new Date(now.getTime() - (200 - index * 11) * DAY_MS).toISOString(),
      last_activity_at: new Date(now.getTime() - idleFor * DAY_MS - Math.floor(rand() * 8) * 3600000).toISOString(),
      last_activity_editor: ['vscode/1.105.0/copilot-chat/0.32.0', 'JetBrains-IU/2026.2/copilot/1.6.0'][index % 2],
      last_authenticated_at: new Date(now.getTime() - idleFor * DAY_MS).toISOString(),
      pending_cancellation_date: null,
      plan_type: 'enterprise',
    };
  });
  const records = everyone.filter(([, , level]) => level !== 'idle').map(([, login, level], index) => ({
    user_id: 9000 + index,
    user_login: login,
    report_start_day: lastDays(now, 28)[0],
    report_end_day: isoDay(now.getTime() - DAY_MS),
    day_totals: lastDays(now, 28).filter(() => rand() < LEVEL[level]).map((day) => {
      const generations = Math.floor(20 + rand() * 120 * LEVEL[level]);
      const interactions = Math.floor(5 + rand() * 40 * LEVEL[level]);
      // Each person leans towards one way of working (inline, chat or agent).
      const lean = [0.65, 0.2, 0.15, 0.3, 0.55][index % 5];
      const agentShare = AGENT_SHARE[index % AGENT_SHARE.length];
      const usedAgent = rand() < Math.min(0.95, agentShare * 1.6);
      return {
        day,
        user_initiated_interaction_count: interactions,
        code_generation_activity_count: generations,
        code_acceptance_activity_count: Math.floor(generations * (0.22 + rand() * 0.25)),
        loc_added_sum: Math.floor(generations * (1.5 + rand() * 3)),
        loc_deleted_sum: Math.floor(generations * rand()),
        ai_credits_used: Math.round((1.2 + interactions * 0.08 + (usedAgent ? 1.5 + rand() * 2.5 : 0)) * 100) / 100,
        used_chat: rand() < 0.8,
        used_agent: usedAgent,
        totals_by_feature: [
          { feature: 'code_completion', code_generation_activity_count: Math.floor(generations * lean), user_initiated_interaction_count: 0 },
          { feature: 'chat_panel_ask_mode', code_generation_activity_count: Math.floor(generations * (1 - lean - agentShare)), user_initiated_interaction_count: Math.floor(interactions * 0.6) },
          { feature: 'chat_panel_agent_mode', code_generation_activity_count: Math.floor(generations * agentShare), user_initiated_interaction_count: Math.floor(interactions * 0.4) },
        ],
      };
    }),
  }));
  const active = seats.filter((seat) => now.getTime() - Date.parse(seat.last_activity_at) < 30 * DAY_MS).length;
  return {
    billing: {
      seat_breakdown: { total: seats.length, added_this_cycle: 1, pending_invitation: 1, pending_cancellation: 0, active_this_cycle: active, inactive_this_cycle: seats.length - active },
      seat_management_setting: 'assign_selected',
      ide_chat: 'enabled',
      platform_chat: 'enabled',
      cli: 'enabled',
      public_code_suggestions: 'block',
      plan_type: 'enterprise',
    },
    seats,
    report: { records, available: true, startDay: lastDays(now, 28)[0], endDay: isoDay(now.getTime() - DAY_MS) },
    // Sample only: lets the per-user view match seats to emails. Live data uses
    // the githubLoginEmails mapping instead (logins are not emails).
    loginEmails: Object.fromEntries(everyone.map(([, login, , address]) => [login, address])),
    // Sample only: per-person budgets (live budgets are set in the portal).
    sampleBudgets: Object.fromEntries(everyone.filter(([, , level]) => level === 'heavy').map(([, login]) => [login, COPILOT_LARGE_BUDGET])),
  };
}

export function sampleCodexRaw(now = new Date(), days = 30, identities = []) {
  const rand = random(seedFor(now, 3));
  const records = [];
  const everyone = people(identities).filter((_, index) => CODEX_USERS.has(index) || index >= PEOPLE.length);
  for (const day of lastDays(now, days)) {
    for (const [name, , level, address] of everyone) {
      if (rand() > LEVEL[level] * 0.9) continue;
      const turns = Math.floor(3 + rand() * 30 * LEVEL[level]);
      records.push({
        date: day,
        user_email: address,
        user_name: name,
        threads: Math.max(1, Math.floor(turns / 6)),
        turns,
        // About 0.3-0.7 credits per turn: heavy users reach most of a 200-credit budget.
        credits: Math.round(turns * (0.3 + rand() * 0.4) * 10) / 10,
        tokens: { uncached_input: turns * 8200, cached_input: turns * 21000, output: turns * 1900 },
        by_model: [{ model: 'gpt-5-codex', tokens: { output: turns * 1900 } }],
        by_client: [{ client: rand() > 0.5 ? 'cli' : 'ide', turns }],
      });
    }
  }
  return { records };
}
