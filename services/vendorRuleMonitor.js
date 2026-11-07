// Backend check of the vendor activity rules in each deployed user's policies.
//
// For every PC deployed from Deploy Tracker with a user email, and every app
// in that deployment whose policy has vendor fields (e.g. "Postman: signed in
// within 14 days"), this reads the vendor's per-user data (live when the
// vendor is connected, sample data otherwise) and records whether each field
// is met. A met field keeps the seat in use even when tracker active time is
// below the policy's threshold.
//
// Results are stored per PC and app in `vendor_rule_results`, refreshed at
// most every REFRESH_MS (vendor data is daily, and the connectors cache).
import { DAY_MS } from './aiTools/http.js';
import { lastSignIns, signInActionCodes } from './reports/postmanSignIns.js';
import { loadLicenseData } from './reports/licenseConnectors.js';
import { sampleFigma, samplePostman, sampleZoom } from './reports/vendorSamples.js';
import { latestDeployments } from './trackerDeployments.js';
import { productOfMeasure, vendorField } from './vendorRuleFields.js';

export const REFRESH_MS = 15 * 60 * 1000;
// Where each product's vendor data comes from, as the portal labels it.
const SOURCES = {
  postman: 'Postman audit log',
  claude: 'Claude Code usage report',
  codex: 'Codex usage',
  copilot: 'GitHub Copilot metrics',
  figma: 'Figma activity log',
  zoom: 'Zoom users',
};
const key = (value) => String(value || '').trim().toLowerCase();

// ---------------------------------------------------------------- per-user facts
// Each returns { mode, byEmail: Map(email -> { [measure]: value }) }, where a
// 'within' value is the ISO time the vendor last saw the user and an
// 'atLeast' value is a count.

async function licenseRaw(appId, sample, { env, now, identities }) {
  const data = await loadLicenseData(appId, { env, now });
  if (data.mode === 'live') return { mode: 'live', raw: data.raw };
  if (data.mode === 'error') return { mode: 'error', error: data.error };
  return { mode: 'sample', raw: sample(now, identities) };
}

const inWindow = (time, now, windowSeconds) => now.getTime() - Date.parse(time) <= windowSeconds * 1000;

const FACTS = {
  async postman(context) {
    const data = await licenseRaw('postman', samplePostman, context);
    if (!data.raw) return data;
    const latest = lastSignIns(data.raw.auditLogs?.trails, signInActionCodes(data.raw.auditActions));
    return { mode: data.mode, byEmail: new Map([...latest].map(([email, at]) => [email, { postmanSignedIn: at }])) };
  },

  async figma(context) {
    const data = await licenseRaw('figma', sampleFigma, context);
    if (!data.raw) return data;
    const byEmail = new Map();
    for (const log of data.raw.activityLogs?.meta?.activity_logs || []) {
      const email = key(log.actor?.email);
      if (!email) continue;
      const at = new Date(Number(log.timestamp) * 1000).toISOString();
      const entry = byEmail.get(email) || { events: [] };
      entry.events.push({ type: log.action?.type, at });
      byEmail.set(email, entry);
    }
    return {
      mode: data.mode,
      byEmail,
      // Counted per policy window, since the activity log has each event's time.
      count: (entry, measure, now, windowSeconds) => {
        const type = measure === 'figmaFilesEdited' ? 'fig_file_edit' : 'fig_file_view';
        return entry.events.filter((event) => event.type === type && inWindow(event.at, now, windowSeconds)).length;
      },
    };
  },

  async zoom(context) {
    const data = await licenseRaw('zoom', sampleZoom, context);
    if (!data.raw) return data;
    const byEmail = new Map(
      (data.raw.users?.users || []).filter((user) => user.email).map((user) => [key(user.email), { zoomSignedIn: user.last_login_time || null }])
    );
    return { mode: data.mode, byEmail };
  },

  async claude({ overview }) {
    return aiToolFacts(overview, 'claude', (member) => ({
      claudeUsedWithin: member.lastActiveAt,
      claudeActiveDays: member.activeDays,
      claudeAcceptedEdits: member.acceptedEdits,
    }));
  },

  async codex({ overview }) {
    return aiToolFacts(overview, 'codex', (member) => ({
      codexUsedWithin: member.lastActiveAt,
      codexActiveDays: member.activeDays,
      codexTurns: member.turns,
    }));
  },

  async copilot({ overview }) {
    return aiToolFacts(overview, 'copilot', (member) => ({
      copilotAccepted: member.acceptances,
      copilotActive: member.lastActiveAt,
    }));
  },
};

function aiToolFacts(overview, vendorId, pick) {
  const vendor = overview?.vendors?.find((item) => item.id === vendorId);
  if (!vendor) return { mode: 'error', error: `${vendorId} data is unavailable` };
  if (vendor.mode === 'error') return { mode: 'error', error: vendor.error };
  return {
    mode: vendor.mode,
    byEmail: new Map((vendor.members || []).filter((member) => member.email).map((member) => [key(member.email), pick(member)])),
  };
}

// ---------------------------------------------------------------- evaluation

// One vendor field for one user: { measure, label, threshold, value, met }.
// A 'within' value is days since last seen (null when never seen).
export function evaluateVendorRule(rule, facts, email, { now, windowSeconds }) {
  const field = vendorField(rule.measure);
  const entry = facts?.byEmail?.get(key(email)) || null;
  const threshold = Number(rule.value);
  if (field?.kind === 'within') {
    const last = entry?.[rule.measure];
    const days = last ? Math.floor((now.getTime() - Date.parse(last)) / DAY_MS) : null;
    return { measure: rule.measure, label: field.label, kind: 'within', threshold, value: days, met: days !== null && days <= threshold };
  }
  const raw = entry && facts.count ? facts.count(entry, rule.measure, now, windowSeconds) : entry?.[rule.measure];
  const value = Number(raw) || 0;
  return { measure: rule.measure, label: field?.label || rule.measure, kind: 'atLeast', threshold, value, met: value >= threshold };
}

// The apps in a deployment, matched to onboarded licenses with vendor fields.
function deployedLicenses(deployment, licenses) {
  const names = new Set(deployment.apps.map(key));
  return licenses.filter(
    (license) =>
      (license.policy?.vendorRules || []).length > 0 &&
      (names.has(key(license.processName)) || names.has(key(license.appName)))
  );
}

/**
 * Checks every deployed user's vendor rules and stores the results.
 * Returns the result documents.
 */
export async function runVendorRuleCheck({ outbox, licenses, results, overview, env = process.env, identities = [], now = new Date() }) {
  const deployments = (await latestDeployments(outbox)).filter((deployment) => deployment.userEmail && deployment.status !== 'superseded');
  const factsCache = new Map();
  const factsFor = async (product) => {
    if (!factsCache.has(product)) {
      const loader = FACTS[product];
      factsCache.set(product, loader ? await loader({ env, now, identities, overview }).catch((error) => ({ mode: 'error', error: error.message })) : null);
    }
    return factsCache.get(product);
  };

  const documents = [];
  for (const deployment of deployments) {
    for (const license of deployedLicenses(deployment, licenses)) {
      const windowSeconds = Number(license.policy.evaluationWindowDays) * 24 * 60 * 60 || 30 * DAY_MS / 1000;
      const checks = [];
      const modes = new Set();
      const errors = [];
      for (const rule of license.policy.vendorRules) {
        const facts = await factsFor(productOfMeasure(rule.measure));
        if (!facts || facts.mode === 'error') {
          if (facts?.error) errors.push(facts.error);
          continue;
        }
        modes.add(facts.mode);
        checks.push(evaluateVendorRule(rule, facts, deployment.userEmail, { now, windowSeconds }));
      }
      const document = {
        _id: encodeURIComponent(`${key(deployment.pcName)}::${key(license.processName || license.appName)}`),
        pcName: deployment.pcName,
        userEmail: deployment.userEmail,
        appName: license.appName,
        processName: license.processName || license.appName,
        policyName: license.policy.name || '',
        source: SOURCES[productOfMeasure(license.policy.vendorRules[0]?.measure)] || 'Vendor API',
        checks,
        // The seat counts as in use if any vendor field is met.
        inUse: checks.some((check) => check.met),
        mode: modes.has('live') ? (modes.has('sample') ? 'mixed' : 'live') : modes.has('sample') ? 'sample' : 'unavailable',
        errors,
        evaluatedAt: now,
      };
      await results.updateOne({ _id: document._id }, { $set: document }, { upsert: true });
      documents.push(document);
    }
  }
  return documents;
}

let lastRunAt = 0;
let running = null;

// Results, refreshed when older than REFRESH_MS (or when asked to).
export async function vendorRuleResults({ refresh = false, load, now = new Date(), ...options }) {
  if (refresh || now.getTime() - lastRunAt > REFRESH_MS) {
    running = running || runVendorRuleCheck({ ...options, now }).finally(() => {
      lastRunAt = Date.now();
      running = null;
    });
    await running;
  }
  return load();
}

export function resetVendorRuleSchedule() {
  lastRunAt = 0;
}
