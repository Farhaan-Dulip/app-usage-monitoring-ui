import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortalReclaimPolicy } from '../services/reclaimPolicy.js';
import {
  NEW_POLICY_RULE,
  buildRuleLicenses,
  describeRule,
  describeVendorConditions,
  normalizeRule,
  vendorRuleFields,
  draftToRule,
  formatAmount,
  migrateLicensePolicies,
  policyToRule,
  appPolicies,
  inventoryRuleApps,
  policyId,
  policyNameError,
  savePolicy,
  selectedPolicy,
  ruleApps,
  ruleError,
  ruleToDraft,
  ruleToPolicy,
} from '../src/utils/appRules.js';

const eightHours = { windowValue: 30, windowUnit: 'Days', conditions: [{ measure: 'activeTime', min: 8, unit: 'Hours' }] };

const inventory = [
  { id: 'claude', appName: 'Claude', appType: 'Application', processName: 'claude.exe', onboarded: true,
    policies: [{ id: 'policy-engineering', name: 'Engineering', rule: eightHours }], policyId: 'policy-engineering' },
  { id: 'claude-web', appName: 'claude.ai', appType: 'Web URL', url: 'claude.ai', bundledWith: 'claude' },
  { id: 'copilot', appName: 'GitHub Copilot', appType: 'Extension', bundledWith: 'claude' },
  { id: 'zoom', appName: 'Zoom', appType: 'Application', processName: 'zoom.exe', onboarded: true },
  { id: 'figma', appName: 'Figma', appType: 'Application', processName: 'Figma.exe' },
  { id: 'intranet', appName: 'intranet.example.com', appType: 'Web URL', url: 'intranet.example.com' },
];

test('a rule reads as its conditions and period', () => {
  assert.equal(describeRule(eightHours), 'Active time ≥ 8 hours in 30 days');
  assert.equal(describeRule(NEW_POLICY_RULE), 'Active time ≥ 1 hour in 30 days');
  assert.equal(
    describeRule({ windowValue: 1, windowUnit: 'Days', conditions: [{ measure: 'activeTime', min: 30, unit: 'Minutes' }] }),
    'Active time ≥ 30 minutes in 1 day'
  );
});

test('a rule needs a period, conditions and amounts that fit the period', () => {
  assert.equal(ruleError(eightHours), '');
  assert.equal(ruleError({ ...eightHours, windowValue: '0' }), 'Enter a period longer than 0.');
  assert.equal(ruleError({ ...eightHours, conditions: [] }), 'Add at least one condition.');
  assert.equal(
    ruleError({ ...eightHours, conditions: [{ measure: 'activeTime', min: '', unit: 'Hours' }] }),
    'Enter an amount above 0 for each condition.'
  );
  assert.equal(
    ruleError({ windowValue: 2, windowUnit: 'Hours', conditions: [{ measure: 'activeTime', min: 3, unit: 'Hours' }] }),
    'Active time can’t be longer than the period.'
  );
});

test('a rule becomes the policy the tracker records evaluate', () => {
  const policy = ruleToPolicy(eightHours, 'Claude rule');
  assert.equal(policy.name, 'Claude rule');
  assert.equal(policy.workedThresholdSeconds, 8 * 3600);
  assert.deepEqual(buildPortalReclaimPolicy(policy), {
    evaluation_window_seconds: 30 * 24 * 3600,
    worked_threshold_seconds: 8 * 3600,
    idle_threshold_seconds: 4,
  });
});

test('onboarded apps are tracked with their policy; bundled surfaces share it', () => {
  const licenses = buildRuleLicenses(inventory);
  // Zoom is onboarded without a policy, so it isn't tracked.
  assert.deepEqual(licenses.map((app) => app.id), ['claude', 'copilot']);
  assert.equal(licenses[0].policy.name, 'Engineering');
  assert.equal(licenses[0].policy.policyId, 'policy-engineering');
  assert.equal(licenses[1].policy.workedThresholdSeconds, 8 * 3600);
  assert.deepEqual(ruleApps(inventory).map((app) => app.id), ['claude', 'zoom']);
  assert.deepEqual(inventoryRuleApps(inventory).map((app) => app.id), ['claude', 'zoom', 'figma']);
});

test('onboarded policies become their apps’ policies, keeping what they evaluated', () => {
  const apps = [
    { id: 'figma', appName: 'Figma', appType: 'Application' },
    { id: 'zoom', appName: 'Zoom', appType: 'Application' },
  ];
  const migrated = migrateLicensePolicies(apps, [
    { id: 'figma', policy: { name: 'Design suite', evaluationWindowValue: 45, evaluationWindowUnit: 'Days', workedThresholdHours: 4 } },
  ]);
  // Old thresholds were in the window's unit: 4 days of active time.
  assert.equal(migrated[0].onboarded, true);
  assert.equal(migrated[1].onboarded, undefined);
  assert.equal(migrated[0].policyId, 'policy-design-suite');
  assert.deepEqual(appPolicies(migrated[0]), [{
    id: 'policy-design-suite',
    name: 'Design suite',
    rule: { windowValue: 45, windowUnit: 'Days', conditions: [{ measure: 'activeTime', min: 96, unit: 'Hours' }] },
  }]);
  assert.deepEqual(appPolicies(migrated[1]), []);
  assert.deepEqual(migrateLicensePolicies(migrated, [{ id: 'figma', policy: { workedThresholdHours: 1 } }]), migrated);
});

test('an app that was on the old default rule keeps it as a policy', () => {
  const apps = [{ id: 'zoom', appName: 'Zoom', appType: 'Application', onboarded: true }];
  const saved = [{ id: 'zoom', policy: ruleToPolicy(NEW_POLICY_RULE, 'Default rule') }];
  const [zoom] = migrateLicensePolicies(apps, saved);
  assert.equal(selectedPolicy(zoom).name, 'Default rule');
  assert.deepEqual(selectedPolicy(zoom).rule, NEW_POLICY_RULE);
  // Loading again changes nothing, and an app taken off stays off.
  assert.deepEqual(migrateLicensePolicies([zoom], buildRuleLicenses([zoom])), [zoom]);
  const removed = { ...zoom, onboarded: false };
  assert.deepEqual(migrateLicensePolicies([removed], saved), [removed]);
});

test('policies saved from rules convert back exactly', () => {
  const rule = { windowValue: 7, windowUnit: 'Days', conditions: [{ measure: 'activeTime', min: 45, unit: 'Minutes' }] };
  assert.deepEqual(policyToRule(ruleToPolicy(rule, 'x')), rule);
  assert.deepEqual(policyToRule(ruleToPolicy(eightHours, 'x')), eightHours);
});


test('the rule form edits active use and the vendor fields its app offers', () => {
  const draft = ruleToDraft(eightHours);
  assert.deepEqual(draft, { windowValue: '30', windowUnit: 'Days', threshold: '8', thresholdUnit: 'Hours', vendor: {} });
  const figma = vendorRuleFields('figma');
  assert.deepEqual(figma.map((field) => field.id), ['figmaFilesEdited', 'figmaFilesViewed']);
  const rule = draftToRule({ ...draft, threshold: '4', vendor: { figmaFilesEdited: '5', figmaFilesViewed: ' ' } }, figma);
  assert.deepEqual(rule.conditions, [
    { measure: 'activeTime', min: '4', unit: 'Hours' },
    { measure: 'figmaFilesEdited', min: '5' },
  ]);
  assert.equal(ruleError(rule), '');
  assert.equal(describeVendorConditions(normalizeRule(rule)), 'Files edited ≥ 5');
  assert.deepEqual(ruleToDraft(normalizeRule(rule)).vendor, { figmaFilesEdited: '5' });
  assert.equal(
    ruleError(draftToRule({ ...draft, vendor: { figmaFilesEdited: '2.5' } }, figma)),
    'Enter whole numbers for vendor activity.'
  );
  assert.equal(describeVendorConditions({ ...eightHours, conditions: [{ measure: 'zoomSignedIn', min: 14 }] }), 'Signed in within 14 days');
  assert.deepEqual(vendorRuleFields('vscode'), []);
  assert.equal(formatAmount(1, 'Hours'), '1 hour');
  assert.equal(formatAmount('45', 'Days'), '45 days');
});

test('an app’s single rule becomes its first policy', () => {
  const [app] = migrateLicensePolicies([{ id: 'figma', appName: 'Figma', appType: 'Application', onboarded: true, rule: eightHours }], []);
  assert.equal('rule' in app, false);
  assert.equal(selectedPolicy(app).name, 'Figma policy');
  assert.deepEqual(selectedPolicy(app).rule, eightHours);
});

test('policies per app have unique names and can be replaced', () => {
  const figma = { id: 'figma', appName: 'Figma', appType: 'Application' };
  const withDesign = savePolicy(figma, { name: ' Design team ', rule: eightHours });
  assert.deepEqual(appPolicies(withDesign).map((policy) => [policy.id, policy.name]), [['policy-design-team', 'Design team']]);
  assert.equal(policyNameError(withDesign, 'design TEAM'), 'Figma already has a policy called Design team.');
  assert.equal(policyNameError(withDesign, 'Design team', 'policy-design-team'), '');
  assert.equal(policyNameError(withDesign, ''), 'Enter a policy name.');
  const updated = savePolicy(withDesign, { id: 'policy-design-team', name: 'Design team', rule: NEW_POLICY_RULE });
  assert.equal(appPolicies(updated).length, 1);
  assert.deepEqual(appPolicies(updated)[0].rule, NEW_POLICY_RULE);
  assert.equal(policyId('Sales & Marketing'), 'policy-sales-marketing');
});

test('Postman’s rule is "signed in within", at most the 180 days Postman keeps, and reaches the backend', () => {
  const postman = vendorRuleFields('postman');
  assert.deepEqual(postman.map((field) => [field.id, field.kind, field.max]), [['postmanSignedIn', 'within', 180]]);
  const draft = ruleToDraft(NEW_POLICY_RULE);
  assert.equal(ruleError(draftToRule({ ...draft, vendor: { postmanSignedIn: '200' } }, postman)), 'Signed in within can be at most 180 days.');
  const rule = normalizeRule(draftToRule({ ...draft, vendor: { postmanSignedIn: '14' } }, postman));
  assert.equal(ruleError(rule), '');
  assert.equal(describeVendorConditions(rule), 'Signed in within 14 days');
  assert.deepEqual(ruleToPolicy(rule, 'Engineering').vendorRules, [{ measure: 'postmanSignedIn', value: 14 }]);
  assert.deepEqual(ruleToPolicy(NEW_POLICY_RULE, 'Default rule').vendorRules, []);
});

test('Claude’s rule fields: used Claude Code within, active days and accepted edits', () => {
  const claude = vendorRuleFields('claude');
  assert.deepEqual(claude.map((field) => [field.id, field.kind]), [
    ['claudeUsedWithin', 'within'],
    ['claudeActiveDays', 'atLeast'],
    ['claudeAcceptedEdits', 'atLeast'],
  ]);
  const rule = normalizeRule(draftToRule(
    { ...ruleToDraft(NEW_POLICY_RULE), vendor: { claudeUsedWithin: '7', claudeActiveDays: '4', claudeAcceptedEdits: '20' } },
    claude
  ));
  assert.equal(describeVendorConditions(rule), 'Used Claude Code within 7 days or Active days ≥ 4 or Accepted edits ≥ 20');
  assert.deepEqual(ruleToPolicy(rule, 'Engineering').vendorRules.map((item) => item.measure), ['claudeUsedWithin', 'claudeActiveDays', 'claudeAcceptedEdits']);
});

test('Codex’s rule fields: used Codex within, active days and turns', () => {
  const codex = vendorRuleFields('codex');
  assert.deepEqual(codex.map((field) => [field.id, field.kind]), [
    ['codexUsedWithin', 'within'],
    ['codexActiveDays', 'atLeast'],
    ['codexTurns', 'atLeast'],
  ]);
  const rule = normalizeRule(draftToRule({ ...ruleToDraft(NEW_POLICY_RULE), vendor: { codexUsedWithin: '10', codexTurns: '30' } }, codex));
  assert.equal(describeVendorConditions(rule), 'Used Codex within 10 days or Turns ≥ 30');
});
