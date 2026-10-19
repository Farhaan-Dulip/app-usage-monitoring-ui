import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLicenseGrant, queueLicenseGrant } from '../services/licenseGrants.js';
import { publishPendingGrants } from '../messaging/configPublisher.js';

const postman = {
  appName: 'Postman',
  processName: 'Postman.exe',
  monthlyCost: 10,
  owner: 'Farhan',
  ownerEmail: 'farhan@example.com',
  policy: { evaluationWindowValue: 3, evaluationWindowUnit: 'Minutes', workedThresholdHours: 1 },
};
const approved = {
  _id: 'req-1',
  requestedApp: 'Postman',
  requesterName: 'Nadia',
  requesterEmail: 'nadia@example.com',
  status: 'approved',
  targetDevice: { deviceId: 'dev-1', pcName: 'at-nb-01' },
};

function memory() {
  const docs = [];
  return {
    docs,
    async findOne(filter) { return docs.find((doc) => Object.entries(filter).every(([k, v]) => doc[k] === v)) || null; },
    async insertOne(doc) { docs.push({ ...doc, _id: doc._id || `o${docs.length + 1}` }); return {}; },
    async updateOne(filter, update, { upsert } = {}) {
      let doc = docs.find((entry) => entry._id === filter._id);
      if (!doc && upsert) { doc = { _id: filter._id, ...update.$setOnInsert }; docs.push(doc); }
      if (doc) Object.assign(doc, update.$set);
    },
    find(filter) { return { limit: () => ({ toArray: async () => docs.filter((doc) => doc.status === filter.status) }) }; },
  };
}

test('grant message carries the app, its tracker policy and the device', () => {
  const grant = buildLicenseGrant(approved, postman, new Date(0));
  assert.equal(grant.type, 'license_granted');
  assert.equal(grant.device_id, 'dev-1');
  assert.equal(grant.grant_id, 'req-1');
  assert.deepEqual(grant.app, {
    name: 'Postman.exe',
    type: 'application',
    subscriptionType: 'Postman',
    license_cost: 10,
    reclaim_policy: { idle_threshold_seconds: 4 },
  });
});

test('approval records the deployment and queues one push', async () => {
  const outbox = memory();
  const deploymentRecords = memory();
  const result = await queueLicenseGrant({ outbox, deploymentRecords, request: approved, licenses: [postman] });
  assert.deepEqual(result, { queued: true, pcName: 'at-nb-01' });
  assert.equal(outbox.docs.length, 1);
  assert.equal(outbox.docs[0].status, 'pending');
  const [record] = deploymentRecords.docs;
  assert.equal(record._id, encodeURIComponent('at-nb-01::application::::postman.exe'));
  assert.equal(record.target_pc, 'AT-NB-01');
  assert.equal(record.source_client_id, 'license-approval');
  assert.deepEqual(record.reclaim_policy, { evaluation_window_seconds: 180, worked_threshold_seconds: 60, idle_threshold_seconds: 4 });

  await queueLicenseGrant({ outbox, deploymentRecords, request: approved, licenses: [postman] });
  assert.equal(outbox.docs.length, 1);
  assert.equal(deploymentRecords.docs.length, 1);
});

test('nothing is pushed without a device on record', async () => {
  const outbox = memory();
  const result = await queueLicenseGrant({
    outbox, deploymentRecords: memory(), request: { ...approved, targetDevice: null }, licenses: [postman],
  });
  assert.deepEqual(result, { queued: false, reason: 'no_device' });
  assert.equal(outbox.docs.length, 0);
});

test('publisher declares the device queue, publishes with confirms and marks it sent', async () => {
  const outbox = memory();
  await outbox.insertOne({ _id: 'g1', grantId: 'req-1', deviceId: 'dev-1', pcName: 'AT-NB-01', status: 'pending', message: { app: { name: 'Postman.exe' } } });
  const calls = [];
  const channel = {
    assertQueue: async (...args) => calls.push(['assertQueue', ...args]),
    bindQueue: async (...args) => calls.push(['bindQueue', ...args]),
    publish: (...args) => calls.push(['publish', args[0], args[1], JSON.parse(args[2].toString()), args[3].persistent]),
    waitForConfirms: async () => calls.push(['confirm']),
  };
  const sent = await publishPendingGrants({ channel, outbox, logger: { log() {} } });
  assert.equal(sent, 1);
  assert.deepEqual(calls, [
    ['assertQueue', 'tracker.config.dev-1', { durable: true }],
    ['bindQueue', 'tracker.config.dev-1', 'tracker.config', 'dev-1'],
    ['publish', 'tracker.config', 'dev-1', { app: { name: 'Postman.exe' } }, true],
    ['confirm'],
  ]);
  assert.equal(outbox.docs[0].status, 'sent');
});
