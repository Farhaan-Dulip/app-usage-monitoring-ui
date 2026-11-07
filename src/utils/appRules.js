// Usage rules: a license is in use when any of its policy's conditions is met
// within the policy's period. Each onboarded app is evaluated with one of its
// own policies; surfaces bundled with an app (its extension, its web version)
// share its policy.
import { getPolicyWindowSeconds } from '../../services/reclaimPolicy.js';
// The vendor rule fields are shared with the backend, which checks them.
import { VENDOR_RULE_FIELDS, vendorField } from '../../services/vendorRuleFields.js';

export const WINDOW_UNITS = ['Days', 'Hours', 'Minutes'];
export const TIME_UNITS = ['Hours', 'Minutes'];
// Starting values for a new policy.
export const NEW_POLICY_RULE = {
  windowValue: 30,
  windowUnit: 'Days',
  conditions: [{ measure: 'activeTime', min: 1, unit: 'Hours' }],
};

// Measures the tracker reports for every app.
export const TRACKER_MEASURES = [{ id: 'activeTime', label: 'Active time' }];

export { VENDOR_RULE_FIELDS };

export function vendorRuleFields(product) {
  return (product && VENDOR_RULE_FIELDS[product]) || [];
}

const unitSeconds = (unit) => (unit === 'Minutes' ? 60 : 60 * 60);

export function conditionSeconds(condition) {
  return Number(condition.min) * unitSeconds(condition.unit);
}

export function ruleWindowSeconds(rule) {
  return getPolicyWindowSeconds(Number(rule.windowValue), { evaluationWindowUnit: rule.windowUnit });
}

// First problem in a rule, or '' when it can be saved.
export function ruleError(rule) {
  if (!(Number(rule.windowValue) > 0)) return 'Enter a period longer than 0.';
  const conditions = rule.conditions || [];
  if (conditions.length === 0) return 'Add at least one condition.';
  if (conditions.some((condition) => !(Number(condition.min) > 0))) return 'Enter an amount above 0 for each condition.';
  const wholeNumber = (value) => Number.isInteger(Number(value));
  if (conditions.some((condition) => vendorField(condition.measure) && !wholeNumber(condition.min))) {
    return 'Enter whole numbers for vendor activity.';
  }
  const tooLong = conditions
    .map((condition) => ({ condition, field: vendorField(condition.measure) }))
    .find(({ condition, field }) => field?.max && Number(condition.min) > field.max);
  if (tooLong) return `${tooLong.field.label} can be at most ${tooLong.field.max} days.`;
  const window = ruleWindowSeconds(rule);
  if (conditions.some((condition) => condition.measure === 'activeTime' && conditionSeconds(condition) > window)) {
    return 'Active time can’t be longer than the period.';
  }
  return '';
}

export function normalizeRule(rule) {
  return {
    windowValue: Number(rule.windowValue),
    windowUnit: rule.windowUnit,
    conditions: rule.conditions.map((condition) => ({ ...condition, min: Number(condition.min) })),
  };
}

const plural = (value, unit) => `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`.toLowerCase();

// "30 days", "1 hour".
export function formatAmount(value, unit) {
  return plural(Number(value), unit);
}

// The App Rules form: evaluation window and active threshold, as text.
export function ruleToDraft(rule) {
  const activeTime = rule.conditions.find((condition) => condition.measure === 'activeTime') || NEW_POLICY_RULE.conditions[0];
  return {
    windowValue: String(rule.windowValue),
    windowUnit: rule.windowUnit,
    threshold: String(activeTime.min),
    thresholdUnit: activeTime.unit,
    vendor: Object.fromEntries(
      rule.conditions.filter((condition) => vendorField(condition.measure)).map((condition) => [condition.measure, String(condition.min)])
    ),
  };
}

// The form's values as a rule: active time, plus each vendor field filled in
// for this app (a blank field isn't part of the rule).
export function draftToRule(draft, fields = []) {
  const vendor = fields
    .filter((field) => String(draft.vendor?.[field.id] ?? '').trim() !== '')
    .map((field) => ({ measure: field.id, min: draft.vendor[field.id] }));
  return {
    windowValue: draft.windowValue,
    windowUnit: draft.windowUnit,
    conditions: [{ measure: 'activeTime', min: draft.threshold, unit: draft.thresholdUnit }, ...vendor],
  };
}

export function describeCondition(condition) {
  if (condition.measure === 'activeTime') return `Active time ≥ ${plural(condition.min, condition.unit)}`;
  const field = vendorField(condition.measure);
  if (field?.kind === 'within') return `${field.label} ${plural(Number(condition.min), 'Days')}`;
  return `${field?.label || condition.measure} ≥ ${condition.min}`;
}

// The vendor activity part of a rule, or '' when it has none.
export function describeVendorConditions(rule) {
  return rule.conditions.filter((condition) => condition.measure !== 'activeTime').map(describeCondition).join(' or ');
}

export function describeRule(rule) {
  return `${rule.conditions.map(describeCondition).join(' or ')} in ${plural(rule.windowValue, rule.windowUnit)}`;
}

// The policy shape deployment records, evaluation and license grants read.
// Only active time is evaluated so far.
export function ruleToPolicy(rule, name) {
  const activeTime = rule.conditions.find((condition) => condition.measure === 'activeTime');
  const workedThresholdSeconds = activeTime ? conditionSeconds(activeTime) : 0;
  return {
    name,
    evaluationWindowValue: rule.windowValue,
    evaluationWindowUnit: rule.windowUnit,
    evaluationWindowDays: ruleWindowSeconds(rule) / (24 * 60 * 60),
    workedThresholdHours: workedThresholdSeconds / 3600,
    workedThresholdSeconds,
    // The vendor fields set in the policy, for the backend to check against
    // each vendor's data (e.g. postmanSignedIn: 14 means signed in within 14 days).
    vendorRules: rule.conditions
      .filter((condition) => vendorField(condition.measure))
      .map((condition) => ({ measure: condition.measure, value: Number(condition.min) })),
  };
}

// A rule from a policy saved before rules. Its threshold was in the policy's
// window unit.
export function policyToRule(policy = {}) {
  const windowUnit = policy.evaluationWindowUnit || 'Days';
  const windowValue = Number(policy.evaluationWindowValue ?? policy.evaluationWindowDays ?? 30);
  const seconds = Number(policy.workedThresholdSeconds) > 0
    ? Number(policy.workedThresholdSeconds)
    : getPolicyWindowSeconds(Number(policy.workedThresholdHours ?? 1), { evaluationWindowUnit: windowUnit });
  const inHours = seconds >= 3600 && seconds % 360 === 0;
  return {
    windowValue,
    windowUnit,
    conditions: [{ measure: 'activeTime', min: inHours ? seconds / 3600 : seconds / 60, unit: inHours ? 'Hours' : 'Minutes' }],
  };
}

// Inventory apps and extensions that can be onboarded: not the surfaces
// bundled with them or plain web addresses.
const isMainApp = (app) => !app.bundledWith && app.appType !== 'Web URL';

// Onboarded apps: the ones the tracker watches, each with a rule.
export function ruleApps(licensedApps) {
  return licensedApps.filter((app) => isMainApp(app) && app.onboarded);
}

// Every inventory app that can have a rule, onboarded or not.
export function inventoryRuleApps(licensedApps) {
  return licensedApps.filter(isMainApp);
}

// Named policies per app (one for each department, say): each holds a rule.
// An onboarded app is evaluated with the policy picked for it.
export function appPolicies(app) {
  return app?.policies || [];
}

export function selectedPolicy(app) {
  return appPolicies(app).find((policy) => policy.id === app?.policyId) || null;
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function policyId(name) {
  return `policy-${slug(name) || 'unnamed'}`;
}

// First problem with a policy name for an app, or ''.
export function policyNameError(app, name, editingId = '') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Enter a policy name.';
  const clash = appPolicies(app).find((policy) => policy.id !== editingId && policyId(policy.name) === policyId(trimmed));
  return clash ? `${app.appName} already has a policy called ${clash.name}.` : '';
}

// The app with a policy added or replaced.
export function savePolicy(app, { id, name, rule }) {
  const policies = appPolicies(app);
  const next = { id: id || policyId(name), name: String(name).trim(), rule };
  return {
    ...app,
    policies: policies.some((policy) => policy.id === next.id)
      ? policies.map((policy) => (policy.id === next.id ? next : policy))
      : [...policies, next],
  };
}

// Everything the tracker evaluates: each onboarded app with a policy, and the
// surfaces bundled with it. An onboarded app without a policy isn't tracked.
export function buildRuleLicenses(licensedApps) {
  const byId = new Map(licensedApps.map((app) => [app.id, app]));
  return licensedApps
    .filter((app) => app.appType !== 'Web URL')
    .map((app) => ({ app, owner: (app.bundledWith && byId.get(app.bundledWith)) || app }))
    .map(({ app, owner }) => ({ app, owner, chosen: owner.onboarded ? selectedPolicy(owner) : null }))
    .filter(({ chosen }) => chosen)
    .map(({ app, chosen }) => ({ ...app, policy: { ...ruleToPolicy(chosen.rule, chosen.name), policyId: chosen.id } }));
}

// Inventory apps saved before onboarding and policies lived on them: an app
// with an onboarded license is onboarded with that license's policy (an app
// that was on the old default rule gets it as a policy of that name), and an
// app's single rule becomes a policy. Apps that already picked a policy keep it.
export function migrateLicensePolicies(licensedApps, onboardedLicenses) {
  const licenses = new Map((onboardedLicenses || []).map((license) => [license.id, license]));
  return licensedApps.map((app) => {
    if (app.bundledWith) return app;
    let next = app;
    if (next.rule && !next.policies) {
      const { rule, ...rest } = next;
      const name = `${next.appName} policy`;
      next = { ...rest, policies: [{ id: policyId(name), name, rule }], policyId: policyId(name) };
    }
    const license = licenses.get(app.id);
    if (!license) return next;
    if (next.onboarded === undefined) next = { ...next, onboarded: true };
    const saved = license.policy;
    if (!next.policyId && saved) {
      const name = String(saved.name || '').trim() || `${next.appName} policy`;
      next = { ...savePolicy(next, { name, rule: policyToRule(saved) }), policyId: policyId(name) };
    }
    return next;
  });
}
