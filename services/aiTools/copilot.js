// GitHub Copilot connector: REST API version 2026-03-10, token with
// manage_billing:copilot or read:org (org owner / billing manager).
// Docs: https://docs.github.com/en/rest/copilot
//   GET /orgs/{org}/copilot/billing                                   seat breakdown, plan
//   GET /orgs/{org}/copilot/billing/seats                             seats with last_activity_at (page/per_page)
//   GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest       signed download_links to the per-user report
// Report files are fetched without the GitHub token: they are pre-signed URLs on another host.
import { activityStatus, getJson, isoDay, monthStart } from './http.js';

const BASE_URL = 'https://api.github.com';
const VENDOR = 'GitHub Copilot';
const API_VERSION = '2026-03-10';
// List prices per seat per month; spend is an estimate from seat counts.
const SEAT_PRICE_USD = { business: 19, enterprise: 39 };

function headers(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION };
}

// Report files are JSON (an array or one object) or NDJSON (one object per line).
export function parseReport(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
}

export async function fetchCopilotRaw({ token, org, fetch: fetchImpl = fetch, baseUrl = BASE_URL }) {
  const orgPath = `${baseUrl}/orgs/${encodeURIComponent(org)}`;
  const billing = await getJson(fetchImpl, VENDOR, `${orgPath}/copilot/billing`, headers(token));

  const seats = [];
  for (let page = 1; ; page += 1) {
    const result = await getJson(fetchImpl, VENDOR, `${orgPath}/copilot/billing/seats?per_page=100&page=${page}`, headers(token));
    seats.push(...(result.seats || []));
    if (!result.seats?.length || seats.length >= (result.total_seats || 0)) break;
  }

  // Usage metrics need the "Copilot usage metrics" policy enabled; without it
  // seats still load and the report is reported as unavailable.
  let report = { records: [], available: false, reason: null };
  try {
    const links = await getJson(fetchImpl, VENDOR, `${orgPath}/copilot/metrics/reports/users-28-day/latest`, headers(token));
    const records = [];
    for (const link of links.download_links || []) {
      const response = await fetchImpl(link, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`report download returned HTTP ${response.status}`);
      records.push(...parseReport(await response.text()));
    }
    report = { records, available: true, startDay: links.report_start_day, endDay: links.report_end_day };
  } catch (error) {
    report = { records: [], available: false, reason: error.message };
  }
  return { billing, seats, report };
}

// Copilot features grouped the way people talk about them. Feature names in
// totals_by_feature are matched loosely (e.g. code_completion, chat_inline,
// chat_panel_ask_mode, chat_panel_agent_mode, agent_edit).
export function featureGroup(feature) {
  const name = String(feature || '').toLowerCase();
  if (name.includes('agent')) return 'Agent';
  if (name.includes('completion')) return 'Inline';
  if (name.includes('inline')) return 'Inline';
  return 'Chat';
}

const activityOf = (entry) =>
  (Number(entry.code_generation_activity_count) || 0) + (Number(entry.user_initiated_interaction_count) || 0);

function sumReport(record, now) {
  // 28-day files carry one record per user with per-day entries in day_totals.
  const days = Array.isArray(record.day_totals) && record.day_totals.length ? record.day_totals : [record];
  const firstOfMonth = monthStart(now);
  const groups = { Inline: 0, Chat: 0, Agent: 0 };
  const totals = days.reduce((sum, day) => {
    for (const feature of day.totals_by_feature || []) groups[featureGroup(feature.feature)] += activityOf(feature);
    return {
      interactions: sum.interactions + (Number(day.user_initiated_interaction_count) || 0),
      generations: sum.generations + (Number(day.code_generation_activity_count) || 0),
      acceptances: sum.acceptances + (Number(day.code_acceptance_activity_count) || 0),
      linesAdded: sum.linesAdded + (Number(day.loc_added_sum) || 0),
      credits: sum.credits + (Number(day.ai_credits_used) || 0),
      // The 28-day report covers month-to-date until the 28th of the month.
      mtdCredits: sum.mtdCredits + (String(day.day || record.day || '') >= firstOfMonth ? Number(day.ai_credits_used) || 0 : 0),
      activeDays: sum.activeDays + (activityOf(day) > 0 ? 1 : 0),
      agentDays: sum.agentDays + (day.used_agent || day.used_copilot_coding_agent ? 1 : 0),
    };
  }, { interactions: 0, generations: 0, acceptances: 0, linesAdded: 0, credits: 0, mtdCredits: 0, activeDays: 0, agentDays: 0 });
  for (const feature of days === record.day_totals ? record.totals_by_feature || [] : []) {
    groups[featureGroup(feature.feature)] += activityOf(feature);
  }
  const groupTotal = groups.Inline + groups.Chat + groups.Agent;
  const [topGroup, topValue] = Object.entries(groups).sort(([, a], [, b]) => b - a)[0];
  return {
    ...totals,
    // e.g. "Inline (45%)": the way this person mostly uses Copilot.
    pattern: groupTotal ? `${topGroup} (${Math.round((topValue / groupTotal) * 100)}%)` : null,
    // Agentic index (our definition, 0-100): share of Copilot activity in agent
    // features, blended equally with the share of active days that used an agent.
    agenticIndex: groupTotal || totals.activeDays
      ? Math.round(50 * (groupTotal ? groups.Agent / groupTotal : 0) + 50 * (totals.activeDays ? totals.agentDays / totals.activeDays : 0))
      : null,
  };
}

// loginEmails: { githubLogin: workEmail }, so seats can be matched to people.
export function normalizeCopilot(raw, now = new Date(), { idleDays = 30, loginEmails = {} } = {}) {
  const emailFor = Object.fromEntries(
    Object.entries({ ...(raw.loginEmails || {}), ...loginEmails }).map(([login, address]) => [login.toLowerCase(), String(address).toLowerCase()])
  );
  const usageByLogin = new Map(
    (raw.report?.records || []).map((record) => [String(record.user_login || '').toLowerCase(), sumReport(record, now)])
  );
  const members = (raw.seats || []).map((seat) => {
    const login = seat.assignee?.login || '(unassigned)';
    const usage = usageByLogin.get(login.toLowerCase());
    return {
      id: String(seat.assignee?.id || login),
      name: login,
      login,
      email: emailFor[login.toLowerCase()] || null,
      plan: seat.plan_type,
      ...(raw.sampleBudgets?.[login] ? { sampleBudget: raw.sampleBudgets[login] } : {}),
      lastActiveAt: seat.last_activity_at || null,
      lastEditor: seat.last_activity_editor || null,
      pendingCancellation: seat.pending_cancellation_date || null,
      status: activityStatus(seat.last_activity_at, now, idleDays),
      interactions: usage?.interactions ?? null,
      acceptances: usage?.acceptances ?? null,
      acceptanceRate: usage && usage.generations > 0 ? usage.acceptances / usage.generations : null,
      linesAdded: usage?.linesAdded ?? null,
      pattern: usage?.pattern ?? null,
      agenticIndex: usage?.agenticIndex ?? null,
      // Month-to-date spend in AI credits (ai_credits_used: consumption, not invoicing).
      mtdSpend: usage ? Math.round(usage.mtdCredits * 100) / 100 : 0,
    };
  });

  const breakdown = raw.billing?.seat_breakdown || {};
  const plan = raw.billing?.plan_type || 'business';
  const seatPrice = SEAT_PRICE_USD[plan] || SEAT_PRICE_USD.business;
  const idle = members.filter((member) => member.status !== 'active' && !member.pendingCancellation);
  const totals = [...usageByLogin.values()].reduce((sum, usage) => ({
    generations: sum.generations + usage.generations,
    acceptances: sum.acceptances + usage.acceptances,
  }), { generations: 0, acceptances: 0 });

  // Seats by the day Copilot was last used, for the activity chart.
  const lastActiveByDay = new Map();
  for (const member of members) {
    if (member.lastActiveAt) {
      const day = isoDay(member.lastActiveAt);
      lastActiveByDay.set(day, (lastActiveByDay.get(day) || 0) + 1);
    }
  }

  return {
    kpis: [
      { label: 'Seats', value: breakdown.total ?? members.length, format: 'number' },
      { label: 'Active this cycle', value: breakdown.active_this_cycle ?? members.length - idle.length, format: 'number' },
      { label: 'Inactive this cycle', value: breakdown.inactive_this_cycle ?? idle.length, format: 'number' },
      { label: 'Est. monthly cost', value: (breakdown.total ?? members.length) * seatPrice, format: 'usd', hint: `${plan} list price $${seatPrice}/seat` },
      { label: 'Suggestion acceptance', value: totals.generations ? totals.acceptances / totals.generations : null, format: 'percent' },
      { label: 'Pending invitations', value: breakdown.pending_invitation ?? 0, format: 'number' },
    ],
    daily: {
      label: 'Seats by last-active day',
      format: 'number',
      points: [...lastActiveByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    },
    members,
    memberColumns: [
      { key: 'plan', label: 'Plan', format: 'text' },
      { key: 'lastEditor', label: 'Last editor', format: 'text' },
      { key: 'interactions', label: 'Prompts (28d)', format: 'number' },
      { key: 'acceptanceRate', label: 'Accept rate', format: 'percent' },
      { key: 'pattern', label: 'Pattern', format: 'text' },
      { key: 'agenticIndex', label: 'Agentic index', format: 'number' },
    ],
    spendUnit: 'AI credits',
    idle: {
      count: idle.length,
      idleDays,
      estimatedMonthlySavings: idle.length * seatPrice,
      note: raw.report?.available
        ? `Seats with no Copilot activity for ${idleDays} days.`
        : `Seats with no Copilot activity for ${idleDays} days. Usage report unavailable: ${raw.report?.reason || 'not enabled'}.`,
    },
  };
}
