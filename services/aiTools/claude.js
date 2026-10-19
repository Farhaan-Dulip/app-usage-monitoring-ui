// Claude (Anthropic) connector: Admin API, admin key (sk-ant-admin...).
// Docs: https://platform.claude.com/docs/en/api/admin-api
//   GET /v1/organizations/users                        members (cursor: after_id)
//   GET /v1/organizations/cost_report                  daily cost; amounts are cents as decimal strings
//   GET /v1/organizations/usage_report/claude_code     per-user daily Claude Code metrics (one day per call)
// Claude chat (claude.ai) activity is not in the Admin API; activity here is Claude Code.
import { activityStatus, daysIntoMonth, getJson, isoDay, lastDays, monthStart } from './http.js';

const BASE_URL = 'https://api.anthropic.com';
const VENDOR = 'Claude';

function headers(apiKey) {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}

// Claude Code days: the last 14, or the whole month so far if longer (month-to-date spend).
export async function fetchClaudeRaw({ apiKey, fetch: fetchImpl = fetch, now = new Date(), days = Math.max(14, daysIntoMonth(now)), baseUrl = BASE_URL }) {
  const users = [];
  let afterId = null;
  do {
    const query = new URLSearchParams({ limit: '1000', ...(afterId ? { after_id: afterId } : {}) });
    const page = await getJson(fetchImpl, VENDOR, `${baseUrl}/v1/organizations/users?${query}`, headers(apiKey));
    users.push(...(page.data || []));
    afterId = page.has_more ? page.last_id : null;
  } while (afterId);

  const costBuckets = [];
  let costPage = null;
  const startingAt = new Date(Date.parse(`${lastDays(now, 30)[0]}T00:00:00Z`)).toISOString();
  do {
    const query = new URLSearchParams({ starting_at: startingAt, bucket_width: '1d', limit: '31', ...(costPage ? { page: costPage } : {}) });
    const page = await getJson(fetchImpl, VENDOR, `${baseUrl}/v1/organizations/cost_report?${query}`, headers(apiKey));
    costBuckets.push(...(page.data || []));
    costPage = page.has_more ? page.next_page : null;
  } while (costPage);

  const claudeCode = [];
  for (const day of lastDays(now, days)) {
    let page = null;
    do {
      const query = new URLSearchParams({ starting_at: day, limit: '1000', ...(page ? { page } : {}) });
      const result = await getJson(fetchImpl, VENDOR, `${baseUrl}/v1/organizations/usage_report/claude_code?${query}`, headers(apiKey));
      claudeCode.push(...(result.data || []));
      page = result.has_more ? result.next_page : null;
    } while (page);
  }
  return { users, costBuckets, claudeCode };
}

export function normalizeClaude(raw, now = new Date(), { idleDays = 14 } = {}) {
  const activity = new Map();
  for (const record of raw.claudeCode || []) {
    if (record.actor?.type !== 'user_actor') continue;
    const email = String(record.actor.email_address || '').toLowerCase();
    if (!email) continue;
    const entry = activity.get(email) || { sessions: 0, linesAdded: 0, linesRemoved: 0, commits: 0, pullRequests: 0, costCents: 0, mtdCostCents: 0, accepted: 0, rejected: 0, lastActiveAt: null };
    const inMonth = isoDay(record.date) >= monthStart(now);
    const metrics = record.core_metrics || {};
    entry.sessions += Number(metrics.num_sessions) || 0;
    entry.linesAdded += Number(metrics.lines_of_code?.added) || 0;
    entry.linesRemoved += Number(metrics.lines_of_code?.removed) || 0;
    entry.commits += Number(metrics.commits_by_claude_code) || 0;
    entry.pullRequests += Number(metrics.pull_requests_by_claude_code) || 0;
    for (const model of record.model_breakdown || []) {
      entry.costCents += Number(model.estimated_cost?.amount) || 0;
      if (inMonth) entry.mtdCostCents += Number(model.estimated_cost?.amount) || 0;
    }
    for (const action of Object.values(record.tool_actions || {})) {
      entry.accepted += Number(action.accepted) || 0;
      entry.rejected += Number(action.rejected) || 0;
    }
    if ((Number(metrics.num_sessions) || 0) > 0 && (!entry.lastActiveAt || record.date > entry.lastActiveAt)) entry.lastActiveAt = record.date;
    activity.set(email, entry);
  }

  const members = (raw.users || []).map((user) => {
    const email = String(user.email || '').toLowerCase();
    const usage = activity.get(email);
    return {
      id: user.id,
      name: user.name || email,
      email,
      role: user.role,
      lastActiveAt: usage?.lastActiveAt || null,
      status: activityStatus(usage?.lastActiveAt, now, idleDays),
      sessions: usage?.sessions || 0,
      linesAdded: usage?.linesAdded || 0,
      commits: usage?.commits || 0,
      pullRequests: usage?.pullRequests || 0,
      acceptanceRate: usage && usage.accepted + usage.rejected > 0 ? usage.accepted / (usage.accepted + usage.rejected) : null,
      costUsd: usage ? usage.costCents / 100 : 0,
      // Month-to-date Claude Code estimated cost (USD).
      mtdSpend: usage ? usage.mtdCostCents / 100 : 0,
    };
  });

  const daily = (raw.costBuckets || []).map((bucket) => ({
    date: isoDay(bucket.starting_at),
    // Cost report amounts are cents as decimal strings ("123.45" = $1.23).
    value: (bucket.results || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0) / 100,
  }));
  const totals = members.reduce((sum, member) => ({
    linesAdded: sum.linesAdded + member.linesAdded,
    commits: sum.commits + member.commits,
    pullRequests: sum.pullRequests + member.pullRequests,
  }), { linesAdded: 0, commits: 0, pullRequests: 0 });
  const accepted = [...activity.values()].reduce((sum, entry) => sum + entry.accepted, 0);
  const proposed = [...activity.values()].reduce((sum, entry) => sum + entry.accepted + entry.rejected, 0);
  const idle = members.filter((member) => member.status !== 'active');

  return {
    kpis: [
      { label: 'Members', value: members.length, format: 'number' },
      { label: `Active (${idleDays} days)`, value: members.length - idle.length, format: 'number' },
      { label: 'Spend, 30 days', value: daily.reduce((sum, point) => sum + point.value, 0), format: 'usd' },
      { label: 'Lines added by Claude Code', value: totals.linesAdded, format: 'number' },
      { label: 'Commits / PRs', value: `${totals.commits} / ${totals.pullRequests}`, format: 'text' },
      { label: 'Tool actions accepted', value: proposed ? accepted / proposed : null, format: 'percent' },
    ],
    daily: { label: 'Daily spend (USD)', format: 'usd', points: daily },
    members,
    memberColumns: [
      { key: 'sessions', label: 'Sessions', format: 'number' },
      { key: 'linesAdded', label: 'Lines added', format: 'number' },
      { key: 'commits', label: 'Commits', format: 'number' },
      { key: 'acceptanceRate', label: 'Accept rate', format: 'percent' },
      { key: 'costUsd', label: 'Est. cost', format: 'usd' },
    ],
    spendUnit: 'USD',
    idle: { count: idle.length, idleDays, note: 'No Claude Code sessions in the window (claude.ai chat use is not reported by the Admin API).' },
  };
}
