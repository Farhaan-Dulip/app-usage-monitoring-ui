import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchClaudeRaw, normalizeClaude } from '../services/aiTools/claude.js';
import { fetchCopilotRaw, normalizeCopilot, parseReport } from '../services/aiTools/copilot.js';
import { fetchCodexRaw, normalizeCodex } from '../services/aiTools/codex.js';
import { clearAiToolsCache, getAiToolsOverview } from '../services/aiTools/index.js';

const now = new Date('2026-10-19T12:00:00Z');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Fake fetch that records calls and answers from a route table: [predicate(url), handler(url, init)].
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: init.headers || {} });
    const route = routes.find(([match]) => match(href));
    if (!route) throw new Error(`unexpected request ${href}`);
    return route[1](href, init);
  };
  fn.calls = calls;
  return fn;
}

beforeEach(clearAiToolsCache);

test('Claude: admin headers, cursor pagination, one Claude Code call per day', async () => {
  const fetch = fakeFetch([
    [(u) => u.includes('/v1/organizations/users') && !u.includes('after_id'), () => json({ data: [{ id: 'u1', email: 'A@x.com', name: 'A', role: 'developer' }], has_more: true, last_id: 'u1' })],
    [(u) => u.includes('/v1/organizations/users') && u.includes('after_id=u1'), () => json({ data: [{ id: 'u2', email: 'b@x.com', name: 'B', role: 'user' }], has_more: false })],
    [(u) => u.includes('/cost_report'), () => json({ data: [{ starting_at: '2026-10-18T00:00:00Z', results: [{ amount: '12345.6', currency: 'USD' }] }], has_more: false })],
    [(u) => u.includes('/usage_report/claude_code') && u.includes('starting_at=2026-10-19'), () => json({
      data: [{
        actor: { type: 'user_actor', email_address: 'a@x.com' },
        date: '2026-10-19T00:00:00Z',
        core_metrics: { num_sessions: 3, lines_of_code: { added: 100, removed: 5 }, commits_by_claude_code: 2, pull_requests_by_claude_code: 1 },
        model_breakdown: [{ estimated_cost: { amount: 250, currency: 'USD' } }],
        tool_actions: { edit_tool: { accepted: 9, rejected: 1 } },
      }],
      has_more: false,
    })],
    [(u) => u.includes('/usage_report/claude_code'), () => json({ data: [], has_more: false })],
  ]);
  const raw = await fetchClaudeRaw({ apiKey: 'sk-ant-admin-test', fetch, now, days: 2 });
  assert.equal(raw.users.length, 2);
  assert.ok(fetch.calls.every((call) => call.headers['x-api-key'] === 'sk-ant-admin-test' && call.headers['anthropic-version'] === '2023-06-01'));
  assert.equal(fetch.calls.filter((call) => call.url.includes('claude_code')).length, 2);

  const card = normalizeClaude(raw, now);
  const a = card.members.find((member) => member.email === 'a@x.com');
  assert.equal(a.status, 'active');
  assert.equal(a.linesAdded, 100);
  assert.equal(a.acceptanceRate, 0.9);
  assert.equal(a.costUsd, 2.5);
  assert.equal(card.members.find((member) => member.email === 'b@x.com').status, 'never');
  // Cost report amounts are cents as decimal strings.
  assert.equal(card.daily.points[0].value, 123.456);
});

test('Copilot: API version header, seat paging, report downloaded without the token', async () => {
  const fetch = fakeFetch([
    [(u) => u.endsWith('/orgs/acme/copilot/billing'), () => json({ plan_type: 'enterprise', seat_breakdown: { total: 2, active_this_cycle: 1, inactive_this_cycle: 1, pending_invitation: 0 } })],
    [(u) => u.includes('/copilot/billing/seats') && u.endsWith('&page=1'), () => json({ total_seats: 2, seats: [{ assignee: { login: 'ava', id: 1 }, last_activity_at: '2026-10-18T09:00:00Z', plan_type: 'enterprise' }] })],
    [(u) => u.includes('/copilot/billing/seats') && u.endsWith('&page=2'), () => json({ total_seats: 2, seats: [{ assignee: { login: 'ben', id: 2 }, last_activity_at: '2026-08-01T09:00:00Z', plan_type: 'enterprise' }] })],
    [(u) => u.includes('/users-28-day/latest'), () => json({ download_links: ['https://reports.example.net/signed?sig=1'], report_start_day: '2026-09-21', report_end_day: '2026-10-18' })],
    [(u) => u.startsWith('https://reports.example.net/'), () => new Response('{"user_login":"ava","day_totals":[{"day":"2026-10-18","code_generation_activity_count":10,"code_acceptance_activity_count":4,"user_initiated_interaction_count":3,"loc_added_sum":20}]}\n')],
  ]);
  const raw = await fetchCopilotRaw({ token: 'ghp_test', org: 'acme', fetch });
  const apiCalls = fetch.calls.filter((call) => call.url.startsWith('https://api.github.com/'));
  assert.ok(apiCalls.every((call) => call.headers['X-GitHub-Api-Version'] === '2026-03-10' && call.headers.Authorization === 'Bearer ghp_test'));
  const download = fetch.calls.find((call) => call.url.startsWith('https://reports.example.net/'));
  assert.equal(download.headers.Authorization, undefined);
  assert.equal(raw.seats.length, 2);

  const card = normalizeCopilot(raw, now);
  assert.equal(card.members.find((member) => member.login === 'ava').acceptanceRate, 0.4);
  assert.equal(card.members.find((member) => member.login === 'ben').status, 'idle');
  assert.equal(card.idle.estimatedMonthlySavings, 39);
  assert.equal(card.kpis.find((kpi) => kpi.label === 'Est. monthly cost').value, 78);
});

test('Copilot: seats still load when usage metrics are not enabled', async () => {
  const fetch = fakeFetch([
    [(u) => u.endsWith('/copilot/billing'), () => json({ plan_type: 'business', seat_breakdown: { total: 1 } })],
    [(u) => u.includes('/billing/seats'), () => json({ total_seats: 1, seats: [{ assignee: { login: 'ava' }, last_activity_at: '2026-10-18T09:00:00Z' }] })],
    [(u) => u.includes('/users-28-day/latest'), () => json({ message: 'Copilot Usage Metrics API access is disabled' }, 403)],
  ]);
  const raw = await fetchCopilotRaw({ token: 't', org: 'acme', fetch });
  assert.equal(raw.report.available, false);
  assert.match(normalizeCopilot(raw, now).idle.note, /Usage report unavailable/);
});

test('report files may be a JSON array, one object or NDJSON', () => {
  assert.equal(parseReport('[{"a":1},{"a":2}]').length, 2);
  assert.equal(parseReport('{"a":1}').length, 1);
  assert.equal(parseReport('{"a":1}\n{"a":2}\n').length, 2);
  assert.deepEqual(parseReport(''), []);
});

test('Codex: workspace URL, bearer key, per-user totals', async () => {
  const fetch = fakeFetch([
    [(u) => u.startsWith('https://api.chatgpt.com/v1/analytics/codex/workspaces/ws_1/usage'), () => json({
      data: [
        { date: '2026-10-18', user_email: 'A@x.com', threads: 2, turns: 9, credits: 4.5, tokens: { uncached_input: 10, cached_input: 20, output: 5 }, by_client: [{ client: 'cli' }] },
        { date: '2026-09-01', user_email: 'b@x.com', threads: 1, turns: 2, credits: 1, tokens: { total: 7 } },
      ],
      has_more: false,
    })],
  ]);
  const raw = await fetchCodexRaw({ apiKey: 'sk-admin', workspaceId: 'ws_1', fetch, now });
  assert.equal(fetch.calls[0].headers.Authorization, 'Bearer sk-admin');
  assert.match(fetch.calls[0].url, /start_date=\d{4}-\d{2}-\d{2}&end_date=2026-10-19/);
  const card = normalizeCodex(raw, now);
  const a = card.members.find((member) => member.email === 'a@x.com');
  assert.deepEqual([a.turns, a.credits, a.tokens, a.clients, a.status], [9, 4.5, 35, 'cli', 'active']);
  assert.equal(card.members.find((member) => member.email === 'b@x.com').status, 'idle');
});

test('overview: sample without credentials, live with them, error (not sample) when live fails', async () => {
  const sample = await getAiToolsOverview({ env: {}, now });
  assert.deepEqual(sample.vendors.map((vendor) => [vendor.id, vendor.mode]), [['claude', 'sample'], ['codex', 'sample'], ['copilot', 'sample']]);
  assert.ok(sample.vendors.every((vendor) => vendor.members.length > 0 && vendor.kpis.length > 0));
  assert.equal(sample.vendors.find((vendor) => vendor.id === 'codex').contractVerified, false);

  const failing = fakeFetch([[() => true, () => json({ error: { message: 'invalid x-api-key' } }, 401)]]);
  const live = await getAiToolsOverview({ env: { ANTHROPIC_ADMIN_KEY: 'bad' }, fetch: failing, now });
  const claude = live.vendors.find((vendor) => vendor.id === 'claude');
  assert.equal(claude.mode, 'error');
  assert.match(claude.error, /HTTP 401.*invalid x-api-key/);
  assert.equal(claude.members, undefined);
  assert.equal(live.vendors.find((vendor) => vendor.id === 'copilot').mode, 'sample');
});

test('overview: live results are cached for 10 minutes unless refreshed', async () => {
  const fetch = fakeFetch([
    [(u) => u.includes('/v1/organizations/users'), () => json({ data: [], has_more: false })],
    [(u) => u.includes('/cost_report'), () => json({ data: [], has_more: false })],
    [(u) => u.includes('/claude_code'), () => json({ data: [], has_more: false })],
  ]);
  const env = { ANTHROPIC_ADMIN_KEY: 'k' };
  await getAiToolsOverview({ env, fetch, now });
  const first = fetch.calls.length;
  await getAiToolsOverview({ env, fetch, now: new Date(now.getTime() + 5 * 60000) });
  assert.equal(fetch.calls.length, first);
  await getAiToolsOverview({ env, fetch, now, refresh: true });
  assert.ok(fetch.calls.length > first);
});

test('per-user view: sample data includes real device owners, matched by email in every tool', async () => {
  const { aiToolsForUser } = await import('../services/aiTools/index.js');
  const overview = await getAiToolsOverview({ env: {}, now, sampleIdentities: [{ name: 'Farhan', email: 'farhan@corp.test' }] });
  const rows = aiToolsForUser(overview, 'FARHAN@corp.test');
  assert.deepEqual(rows.map((row) => [row.id, row.mode, Boolean(row.member)]), [['claude', 'sample', true], ['codex', 'sample', true], ['copilot', 'sample', true]]);
  assert.equal(rows.find((row) => row.id === 'copilot').member.login, 'farhan');
  assert.ok(aiToolsForUser(overview, 'nobody@corp.test').every((row) => row.member === null));
});

test('live Copilot seats match people only through the login-to-email mapping', async () => {
  const { parseLoginEmails } = await import('../services/aiTools/index.js');
  assert.deepEqual(parseLoginEmails(' ava = Ava@Corp.com ,bad, ben=ben@corp.com'), { ava: 'Ava@Corp.com', ben: 'ben@corp.com' });
  const raw = { billing: {}, seats: [{ assignee: { login: 'Ava' }, last_activity_at: '2026-10-18T00:00:00Z' }, { assignee: { login: 'zed' } }], report: { records: [] } };
  const members = normalizeCopilot(raw, now, { loginEmails: { ava: 'Ava@Corp.com' } }).members;
  assert.equal(members.find((member) => member.login === 'Ava').email, 'ava@corp.com');
  assert.equal(members.find((member) => member.login === 'zed').email, null);
});
