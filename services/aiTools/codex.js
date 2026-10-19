// Codex connector: Codex Analytics API for ChatGPT Enterprise workspaces.
// Needs a workspace-scoped OpenAI Admin key with codex.enterprise.analytics.read
// (some workspaces need OpenAI Support to apply the scope).
//
// UNVERIFIED CONTRACT: OpenAI's reference (chatgpt.com/public/admin/api-reference)
// is not publicly fetchable, so the route and field names below follow what
// integrators document (per user per day: threads, turns, credits, tokens by
// uncached/cached input and output, breakdowns by model and client). The URL is
// configurable (CODEX_ANALYTICS_URL) and parsing accepts common name variants;
// check both against the reference when the first live call is made.
import { activityStatus, getJson, isoDay, lastDays, monthStart } from './http.js';

const VENDOR = 'Codex';
export const DEFAULT_CODEX_USAGE_URL = 'https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/usage';

export async function fetchCodexRaw({ apiKey, workspaceId, url = DEFAULT_CODEX_USAGE_URL, fetch: fetchImpl = fetch, now = new Date(), days = 30 }) {
  const range = lastDays(now, days);
  const base = url.replace('{workspace_id}', encodeURIComponent(workspaceId));
  const records = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ start_date: range[0], end_date: range[range.length - 1], ...(cursor ? { after: cursor } : {}) });
    const page = await getJson(fetchImpl, VENDOR, `${base}?${query}`, { Authorization: `Bearer ${apiKey}` });
    records.push(...(page.data || page.results || []));
    cursor = page.has_more ? (page.next_page || page.last_id || null) : null;
  } while (cursor);
  return { records };
}

const number = (...values) => values.map(Number).find((value) => Number.isFinite(value)) ?? 0;

export function normalizeCodex(raw, now = new Date(), { idleDays = 14 } = {}) {
  const users = new Map();
  const credits = new Map();
  for (const record of raw.records || []) {
    const email = String(record.user_email || record.email || record.user?.email || '').toLowerCase();
    const day = isoDay(record.date || record.day || record.usage_date || now);
    const tokens = record.tokens || {};
    const entry = users.get(email) || { threads: 0, turns: 0, credits: 0, mtdCredits: 0, tokens: 0, clients: new Set(), lastActiveAt: null, name: record.user_name || record.name || '' };
    const turns = number(record.turns, record.turn_count);
    entry.threads += number(record.threads, record.thread_count);
    entry.turns += turns;
    entry.credits += number(record.credits, record.credits_used);
    if (day >= monthStart(now)) entry.mtdCredits += number(record.credits, record.credits_used);
    entry.tokens += number(tokens.total, number(tokens.uncached_input) + number(tokens.cached_input) + number(tokens.output));
    for (const client of record.by_client || record.clients || []) if (client.client || client.name) entry.clients.add(client.client || client.name);
    if (turns > 0 && (!entry.lastActiveAt || day > entry.lastActiveAt)) entry.lastActiveAt = day;
    users.set(email, entry);
    credits.set(day, (credits.get(day) || 0) + number(record.credits, record.credits_used));
  }

  const members = [...users.entries()].filter(([email]) => email).map(([email, entry]) => ({
    id: email,
    name: entry.name || email,
    email,
    lastActiveAt: entry.lastActiveAt,
    status: activityStatus(entry.lastActiveAt, now, idleDays),
    threads: entry.threads,
    turns: entry.turns,
    credits: entry.credits,
    tokens: entry.tokens,
    clients: [...entry.clients].sort().join(', '),
    // Month-to-date Codex credits.
    mtdSpend: Math.round(entry.mtdCredits * 10) / 10,
  }));
  const idle = members.filter((member) => member.status !== 'active');
  const sum = (key) => members.reduce((total, member) => total + member[key], 0);

  return {
    kpis: [
      { label: 'Users with Codex activity', value: members.length, format: 'number' },
      { label: `Active (${idleDays} days)`, value: members.length - idle.length, format: 'number' },
      { label: 'Credits, 30 days', value: sum('credits'), format: 'number' },
      { label: 'Threads / turns', value: `${sum('threads')} / ${sum('turns')}`, format: 'text' },
      { label: 'Tokens', value: sum('tokens'), format: 'compact' },
    ],
    daily: {
      label: 'Daily credits',
      format: 'number',
      points: [...credits.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    },
    members,
    memberColumns: [
      { key: 'threads', label: 'Threads', format: 'number' },
      { key: 'turns', label: 'Turns', format: 'number' },
      { key: 'credits', label: 'Credits', format: 'number' },
      { key: 'clients', label: 'Clients', format: 'text' },
    ],
    spendUnit: 'credits',
    idle: { count: idle.length, idleDays, note: `Workspace users with no Codex turns in ${idleDays} days.` },
  };
}
