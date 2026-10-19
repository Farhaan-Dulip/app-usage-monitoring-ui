import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceRegistryError,
  devicesForEmail,
  recordDeviceSighting,
  resetSightingCache,
  resolveTargetDevice,
  setDeviceOwner,
} from '../services/deviceRegistry.js';
import { applyUpdate, matchesFilter } from '../services/documentQuery.js';

// In-memory collection using the portal's own query/update semantics.
function memoryCollection() {
  const docs = [];
  let writes = 0;
  return {
    docs,
    get writes() { return writes; },
    async findOne(filter) { return docs.find((doc) => matchesFilter(doc, filter)) || null; },
    find(filter) { return { limit: () => ({ toArray: async () => docs.filter((doc) => matchesFilter(doc, filter)) }) }; },
    async updateOne(filter, update, { upsert = false } = {}) {
      writes += 1;
      const index = docs.findIndex((doc) => matchesFilter(doc, filter));
      if (index >= 0) docs[index] = applyUpdate(docs[index], update);
      else if (upsert) docs.push(applyUpdate({ ...filter }, update, { inserting: true }));
    },
  };
}

const sample = (overrides = {}) => ({
  device_id: 'dev-1',
  device_name: 'AT-NB-FARHAN',
  user_upn: 'Farhan@Example.com',
  timestamp: '2026-10-13T08:00:00Z',
  ...overrides,
});

beforeEach(resetSightingCache);

test('telemetry links the device to the signed-in work account', async () => {
  const devices = memoryCollection();
  await recordDeviceSighting(devices, sample(), new Date(0));
  const [device] = await devicesForEmail(devices, 'farhan@example.com');
  assert.equal(device.pcName, 'AT-NB-FARHAN');
  assert.equal(device.ownerSource, 'tracker');
});

test('the user inside the RabbitMQ envelope is used too', async () => {
  const devices = memoryCollection();
  await recordDeviceSighting(devices, { device_id: 'dev-2', device_name: 'PC2', usage: { user_upn: 'a@example.com' } });
  assert.equal((await devicesForEmail(devices, 'a@example.com')).length, 1);
});

test('unchanged sightings are written at most every 5 minutes', async () => {
  const devices = memoryCollection();
  await recordDeviceSighting(devices, sample(), new Date(0));
  await recordDeviceSighting(devices, sample(), new Date(60_000));
  assert.equal(devices.writes, 1);
  await recordDeviceSighting(devices, sample({ device_name: 'RENAMED' }), new Date(70_000));
  await recordDeviceSighting(devices, sample(), new Date(6 * 60_000));
  assert.equal(devices.writes, 3);
});

test('a sample without a user keeps the last reported owner', async () => {
  const devices = memoryCollection();
  await recordDeviceSighting(devices, sample(), new Date(0));
  await recordDeviceSighting(devices, sample({ user_upn: undefined }), new Date(10 * 60_000));
  assert.equal((await devicesForEmail(devices, 'farhan@example.com')).length, 1);
});

test('admin override wins until cleared', async () => {
  const devices = memoryCollection();
  await recordDeviceSighting(devices, sample());
  const overridden = await setDeviceOwner(devices, 'dev-1', 'Nadia@Example.com');
  assert.equal(overridden.ownerEmail, 'nadia@example.com');
  assert.equal(overridden.ownerSource, 'admin');
  assert.equal((await devicesForEmail(devices, 'farhan@example.com')).length, 0);
  const cleared = await setDeviceOwner(devices, 'dev-1', '');
  assert.equal(cleared.ownerEmail, 'farhan@example.com');
  await assert.rejects(setDeviceOwner(devices, 'dev-1', 'not-an-email'), DeviceRegistryError);
  await assert.rejects(setDeviceOwner(devices, 'missing', 'a@example.com'), (error) => error.statusCode === 404);
});

test('target device: none, one, several, or a named one', () => {
  const one = { deviceId: 'd1', pcName: 'AT-NB-01' };
  const two = { deviceId: 'd2', pcName: 'AT-DT-02' };
  assert.deepEqual(resolveTargetDevice([], ''), { device: null });
  assert.deepEqual(resolveTargetDevice([one], ''), { device: one });
  assert.equal(resolveTargetDevice([one, two], '').choiceRequired, true);
  assert.deepEqual(resolveTargetDevice([one, two], 'at-dt-02'), { device: two });
  assert.equal(resolveTargetDevice([one, two], 'SOMEONE-ELSES-PC').invalid, true);
});
