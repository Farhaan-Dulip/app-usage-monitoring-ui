// AI tools overview: one card per vendor. A vendor is "live" when its admin
// credential is configured, "sample" (documented response shapes, fictional
// data) when it is not, and "error" when a live call fails. Failed live
// calls never fall back to sample data, so sample numbers are never shown
// as real ones.
import { fetchClaudeRaw, normalizeClaude } from './claude.js';
import { DEFAULT_CODEX_USAGE_URL, fetchCodexRaw, normalizeCodex } from './codex.js';
import { fetchCopilotRaw, normalizeCopilot } from './copilot.js';
import { daysIntoMonth } from './http.js';
import { sampleClaudeRaw, sampleCodexRaw, sampleCopilotRaw } from './sampleData.js';

const CACHE_MS = 10 * 60 * 1000;

export function vendorDefinitions(env = process.env) {
  return [
    {
      id: 'claude',
      name: 'Claude',
      product: 'Anthropic Admin API: members, cost report, Claude Code analytics',
      configured: Boolean(env.ANTHROPIC_ADMIN_KEY),
      contractVerified: true,
      connect: 'Anthropic Console > Settings > Admin keys (organization admin), stored as anthropicAdminKey.',
      loadLive: (options) => fetchClaudeRaw({ ...options, apiKey: env.ANTHROPIC_ADMIN_KEY }),
      loadSample: (now, identities) => sampleClaudeRaw(now, Math.max(14, daysIntoMonth(now)), identities),
      normalize: normalizeClaude,
    },
    {
      id: 'codex',
      name: 'Codex',
      product: 'Codex Analytics API (ChatGPT Enterprise workspace)',
      configured: Boolean(env.OPENAI_CODEX_ADMIN_KEY && env.OPENAI_CODEX_WORKSPACE_ID),
      // Route and field names not yet checked against OpenAI's reference.
      contractVerified: false,
      connect: 'OpenAI Admin console > Credentials > Admin keys, restricted to the workspace with codex.enterprise.analytics.read; stored as codexAdminKey + codexWorkspaceId.',
      loadLive: (options) => fetchCodexRaw({
        ...options,
        apiKey: env.OPENAI_CODEX_ADMIN_KEY,
        workspaceId: env.OPENAI_CODEX_WORKSPACE_ID,
        url: env.CODEX_ANALYTICS_URL || DEFAULT_CODEX_USAGE_URL,
      }),
      loadSample: (now, identities) => sampleCodexRaw(now, 30, identities),
      normalize: normalizeCodex,
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      product: 'GitHub REST API: Copilot seats and usage metrics reports',
      configured: Boolean(env.GITHUB_COPILOT_TOKEN && env.GITHUB_ORG),
      contractVerified: true,
      connect: 'GitHub token from an org owner/billing manager with manage_billing:copilot or read:org; stored as githubToken + githubOrg.',
      loadLive: (options) => fetchCopilotRaw({ ...options, token: env.GITHUB_COPILOT_TOKEN, org: env.GITHUB_ORG }),
      loadSample: (now, identities) => sampleCopilotRaw(now, identities),
      normalize: (raw, now) => normalizeCopilot(raw, now, { loginEmails: parseLoginEmails(env.GITHUB_LOGIN_EMAILS) }),
    },
  ];
}

// "octocat=ava@corp.com,kasun-p=kasun@corp.com" -> { octocat: 'ava@corp.com', ... }
export function parseLoginEmails(value) {
  return Object.fromEntries(
    String(value || '')
      .split(',')
      .map((pair) => pair.split('=').map((part) => part.trim()))
      .filter(([login, address]) => login && address)
  );
}

const liveCache = new Map();

export function clearAiToolsCache() {
  liveCache.clear();
}

async function loadVendor(vendor, { fetch: fetchImpl, now, refresh, sampleIdentities }) {
  const base = {
    id: vendor.id,
    name: vendor.name,
    product: vendor.product,
    contractVerified: vendor.contractVerified,
    connect: vendor.connect,
  };
  if (!vendor.configured) {
    return { ...base, mode: 'sample', fetchedAt: now.toISOString(), ...vendor.normalize(vendor.loadSample(now, sampleIdentities), now) };
  }
  const cached = liveCache.get(vendor.id);
  if (!refresh && cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
  let value;
  try {
    const raw = await vendor.loadLive({ fetch: fetchImpl, now });
    value = { ...base, mode: 'live', fetchedAt: now.toISOString(), ...vendor.normalize(raw, now) };
  } catch (error) {
    value = { ...base, mode: 'error', fetchedAt: now.toISOString(), error: error.message };
  }
  liveCache.set(vendor.id, { at: now.getTime(), value });
  return value;
}

// sampleIdentities: real people ({ name, email }, e.g. device owners) to
// include in sample data; ignored for live vendors.
export async function getAiToolsOverview({ env = process.env, fetch: fetchImpl = fetch, now = new Date(), refresh = false, sampleIdentities = [] } = {}) {
  const vendors = await Promise.all(
    vendorDefinitions(env).map((vendor) => loadVendor(vendor, { fetch: fetchImpl, now, refresh, sampleIdentities }))
  );
  return { generatedAt: now.toISOString(), vendors };
}

// One person's row in each vendor's data (by work email), for a tracker's
// detail page. Copilot matches through the login-to-email mapping.
export function aiToolsForUser(overview, email) {
  const wanted = String(email || '').trim().toLowerCase();
  return overview.vendors.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    mode: vendor.mode,
    contractVerified: vendor.contractVerified,
    error: vendor.error || null,
    idleDays: vendor.idle?.idleDays ?? null,
    memberColumns: vendor.memberColumns || [],
    member: wanted ? (vendor.members || []).find((member) => member.email === wanted) || null : null,
  }));
}
