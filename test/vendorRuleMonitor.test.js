import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateVendorRule, runVendorRuleCheck } from '../services/vendorRuleMonitor.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

function memory(docs = []) {
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
  return {
    docs,
    find(filter = {}) {
      return { limit: () => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }) };
    },
    async updateOne(filter, update, { upsert } = {}) {
      let doc = docs.find((entry) => matches(entry, filter));
      if (!doc && upsert) { doc = { ...filter }; docs.push(doc); }
      if (doc) Object.assign(doc, update.$set);
    },
  };
}

const deployment = (pcName, userEmail, apps, status = 'sent') => ({
  kind: 'deployment',
  pcName,
  userEmail,
  status,
  createdAt: NOW,
  message: { config: { licensed_apps: apps.map((name) => ({ name, extensions: [] })), extensions: [] } },
});

test('"within" fields compare days since last seen; "at least" fields compare counts', () => {
  const facts = { byEmail: new Map([['ava@corp.com', { claudeUsedWithin: daysAgo(3), claudeActiveDays: 2 }]]) };
  const window = { now: NOW, windowSeconds: 30 * 86400 };
  assert.deepEqual(evaluateVendorRule({ measure: 'claudeUsedWithin', value: 7 }, facts, 'AVA@corp.com', window),
    { measure: 'claudeUsedWithin', label: 'Used Claude Code within', kind: 'within', threshold: 7, value: 3, met: true });
  assert.equal(evaluateVendorRule({ measure: 'claudeUsedWithin', value: 2 }, facts, 'ava@corp.com', window).met, false);
  assert.equal(evaluateVendorRule({ measure: 'claudeActiveDays', value: 3 }, facts, 'ava@corp.com', window).met, false);
  // Someone the vendor has never seen: within is unknown (not met), counts are 0.
  assert.deepEqual(
    [evaluateVendorRule({ measure: 'claudeUsedWithin', value: 7 }, facts, 'ben@corp.com', window).value,
      evaluateVendorRule({ measure: 'claudeActiveDays', value: 1 }, facts, 'ben@corp.com', window).value],
    [null, 0]
  );
});

test('each deployed user is checked against the vendor fields of the apps deployed to them', async () => {
  const outbox = memory([
    deployment('AT-NB-01', 'ava@corp.com', ['claude.exe', 'Postman.exe']),
    deployment('AT-NB-02', '', ['claude.exe']),
    deployment('AT-NB-03', 'ben@corp.com', ['claude.exe'], 'superseded'),
  ]);
  const licenses = [
    { appName: 'Claude', processName: 'claude.exe', policy: { name: 'Engineering', evaluationWindowDays: 30, vendorRules: [{ measure: 'claudeUsedWithin', value: 7 }, { measure: 'claudeActiveDays', value: 10 }] } },
    { appName: 'Postman', processName: 'Postman.exe', policy: { name: 'QA', evaluationWindowDays: 30, vendorRules: [] } },
  ];
  const overview = {
    vendors: [{ id: 'claude', mode: 'live', members: [{ email: 'ava@corp.com', lastActiveAt: daysAgo(1), activeDays: 4, acceptedEdits: 20 }] }],
  };
  const results = memory();
  const documents = await runVendorRuleCheck({ outbox, licenses, results, overview, env: {}, now: NOW });
  // Only Ava: the second PC has no user email, the third deployment was replaced,
  // and Postman's policy has no vendor fields.
  assert.equal(documents.length, 1);
  const [ava] = documents;
  assert.equal(ava.pcName, 'AT-NB-01');
  assert.equal(ava.policyName, 'Engineering');
  assert.equal(ava.mode, 'live');
  assert.deepEqual(ava.checks.map((check) => [check.measure, check.value, check.met]), [['claudeUsedWithin', 1, true], ['claudeActiveDays', 4, false]]);
  assert.equal(ava.inUse, true, 'any met field keeps the seat');
  assert.equal(results.docs.length, 1);
});

test('Postman sign-ins come from sample data for deployed users when Postman isn’t connected', async () => {
  const outbox = memory([deployment('AT-NB-01', 'farhan@alliontechnologies.com', ['Postman.exe'])]);
  const licenses = [{ appName: 'Postman', processName: 'Postman.exe', policy: { name: 'QA', evaluationWindowDays: 30, vendorRules: [{ measure: 'postmanSignedIn', value: 180 }] } }];
  const results = memory();
  const [doc] = await runVendorRuleCheck({
    outbox, licenses, results, overview: { vendors: [] }, env: {}, now: NOW,
    identities: [{ name: 'Farhan', email: 'farhan@alliontechnologies.com' }],
  });
  assert.equal(doc.mode, 'sample');
  assert.equal(doc.checks[0].measure, 'postmanSignedIn');
  assert.equal(typeof doc.checks[0].met, 'boolean');
});
