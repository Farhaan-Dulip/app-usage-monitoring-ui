import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deploymentError,
  latestDeployments,
  queueTrackerDeployment,
  releaseWaitingDeployments,
} from '../services/trackerDeployments.js';
import { publishPendingGrants } from '../messaging/configPublisher.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const config = {
  target_pc: 'at-nb-01',
  assigned_user: 'ava@corp.com',
  licensed_apps: [{
    name: 'claude.exe',
    type: 'application',
    reclaim_policy: { evaluation_window_seconds: 2592000, worked_threshold_seconds: 28800, idle_threshold_seconds: 4 },
    extensions: [],
  }],
  extensions: [],
  tracked_urls: [],
};

// In-memory collection with the subset of the Mongo API the code uses.
function memory(docs = []) {
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
  return {
    docs,
    find(filter = {}) {
      return { limit: () => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }) };
    },
    async insertOne(doc) { docs.push({ _id: `o${docs.length + 1}`, ...doc }); },
    async updateOne(filter, update) {
      const doc = docs.find((entry) => matches(entry, filter));
      if (doc) Object.assign(doc, update.$set);
    },
  };
}

test('a deployment needs a PC, a valid email if given, and apps', () => {
  assert.equal(deploymentError({ pcName: '', config }), 'Enter a PC name.');
  assert.equal(deploymentError({ pcName: 'PC', userEmail: 'ava', config }), 'Enter a valid user email.');
  assert.equal(deploymentError({ pcName: 'PC', config: { licensed_apps: [], extensions: [] } }), 'Onboard at least one app before deployment.');
  assert.equal(deploymentError({ pcName: 'PC', userEmail: 'ava@corp.com', config }), '');
  assert.equal(deploymentError({ pcName: 'PC', config }), '');
});

test('a PC that has reported in gets its config queued for its device', async () => {
  const outbox = memory();
  const devices = memory([
    { deviceId: 'old', pcName: 'AT-NB-01', lastSeenAt: new Date('2026-10-01') },
    { deviceId: 'dev-1', pcName: 'at-nb-01', lastSeenAt: new Date('2026-11-06') },
  ]);
  const result = await queueTrackerDeployment({ outbox, devices, pcName: 'at-nb-01', userEmail: 'ava@corp.com', config, now: NOW });
  assert.deepEqual(result, { queued: true, pcName: 'AT-NB-01', deviceFound: true, deploymentId: `deploy-at-nb-01-${NOW.getTime()}` });
  const [entry] = outbox.docs;
  assert.equal(entry.status, 'pending');
  assert.equal(entry.deviceId, 'dev-1', 'the most recently seen device with that name');
  assert.equal(entry.message.type, 'config_deployed');
  assert.equal(entry.message.device_id, 'dev-1');
  assert.equal(entry.message.config.target_pc, 'AT-NB-01');
  assert.equal(entry.message.config.assigned_user, 'ava@corp.com');
  assert.equal(entry.message.config.licensed_apps[0].reclaim_policy.worked_threshold_seconds, 28800);
});

test('a PC that hasn’t connected waits, then is released when it reports in', async () => {
  const outbox = memory();
  const devices = memory();
  const result = await queueTrackerDeployment({ outbox, devices, pcName: 'NEW-PC', userEmail: '', config, now: NOW });
  assert.equal(result.deviceFound, false);
  assert.equal(outbox.docs[0].status, 'waiting_device');
  assert.equal(await releaseWaitingDeployments({ outbox, devices }), 0);

  devices.docs.push({ deviceId: 'dev-9', pcName: 'new-pc', lastSeenAt: NOW });
  assert.equal(await releaseWaitingDeployments({ outbox, devices }), 1);
  assert.equal(outbox.docs[0].status, 'pending');
  assert.equal(outbox.docs[0].message.device_id, 'dev-9');
});

test('a newer deployment supersedes one not sent yet, and the publisher sends it', async () => {
  const outbox = memory();
  const devices = memory([{ deviceId: 'dev-1', pcName: 'AT-NB-01', lastSeenAt: NOW }]);
  await queueTrackerDeployment({ outbox, devices, pcName: 'AT-NB-01', config, now: NOW });
  await queueTrackerDeployment({ outbox, devices, pcName: 'AT-NB-01', config, now: new Date(NOW.getTime() + 1000) });
  assert.deepEqual(outbox.docs.map((doc) => doc.status), ['superseded', 'pending']);

  const published = [];
  const channel = {
    assertQueue: async () => {},
    bindQueue: async () => {},
    publish: (exchange, key, body) => published.push({ exchange, key, body: JSON.parse(body) }),
    waitForConfirms: async () => {},
  };
  const logs = [];
  assert.equal(await publishPendingGrants({ channel, outbox, logger: { log: (line) => logs.push(line) } }), 1);
  assert.equal(published[0].key, 'dev-1');
  assert.equal(published[0].body.type, 'config_deployed');
  assert.match(logs[0], /Tracker config \(1 apps\) sent to AT-NB-01/);

  const [latest] = await latestDeployments(outbox);
  assert.equal(latest.status, 'sent');
  assert.deepEqual(latest.apps, ['claude.exe']);
});
