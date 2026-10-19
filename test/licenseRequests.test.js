import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LicenseRequestError,
  chooseRequestDevice,
  deviceNamedIn,
  findAwaitingDeviceRequest,
  findOnboardedLicense,
  onboardedAppNames,
  submitLicenseRequest,
} from '../services/licenseRequests.js';

const licenses = [
  { appName: 'Postman', processName: 'postman.exe', owner: 'Nadia Perera', ownerEmail: 'Nadia@Example.com' },
  { appName: 'Figma', owner: '', ownerEmail: '' },
];

function fakeRequests() {
  const documents = [];
  return {
    documents,
    async findOne(filter) {
      return documents.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null;
    },
    async insertOne(document) {
      const insertedId = `id-${documents.length + 1}`;
      documents.push({ ...document, _id: insertedId });
      return { insertedId };
    },
  };
}

const emailInput = {
  requestedApp: 'postman',
  requesterName: 'Farhan',
  requesterEmail: 'Farhan@Example.com',
  requestText: 'I need Postman for API testing.',
  sourceMessageId: '<abc@mail.example.com>',
  source: 'email',
};

test('matches onboarded apps by display or process name', () => {
  assert.equal(findOnboardedLicense('POSTMAN', licenses).appName, 'Postman');
  assert.equal(findOnboardedLicense('postman.exe', licenses).appName, 'Postman');
  assert.equal(findOnboardedLicense('Slack', licenses), null);
  assert.deepEqual(onboardedAppNames(licenses), ['Figma', 'Postman']);
});

test('email request is routed to the app owner and marked as from email', async () => {
  const collection = fakeRequests();
  const { request, duplicate } = await submitLicenseRequest(collection, licenses, emailInput, new Date(0));
  assert.equal(duplicate, false);
  assert.equal(request.requestedApp, 'Postman');
  assert.equal(request.approvingManagerName, 'Nadia Perera');
  assert.equal(request.approvingManagerEmail, 'nadia@example.com');
  assert.equal(request.requesterEmail, 'farhan@example.com');
  assert.equal(request.status, 'pending_approval');
  assert.equal(request.source, 'email');
  assert.equal(request.clientId, 'email');
});

test('the same email message creates only one request', async () => {
  const collection = fakeRequests();
  await submitLicenseRequest(collection, licenses, emailInput);
  const second = await submitLicenseRequest(collection, licenses, emailInput);
  assert.equal(second.duplicate, true);
  assert.equal(collection.documents.length, 1);
});

test('rejects unknown apps, apps without an owner and missing requester details', async () => {
  const collection = fakeRequests();
  const rejects = (input, statusCode) =>
    assert.rejects(submitLicenseRequest(collection, licenses, { ...emailInput, ...input }), (error) =>
      error instanceof LicenseRequestError && error.statusCode === statusCode);
  await rejects({ requestedApp: 'Slack' }, 404);
  await rejects({ requestedApp: 'Figma' }, 409);
  await rejects({ requesterEmail: 'not-an-email' }, 400);
  assert.equal(collection.documents.length, 0);
});

test('asking again while a request is pending returns the pending one', async () => {
  const collection = fakeRequests();
  await submitLicenseRequest(collection, licenses, { ...emailInput, source: 'chat', sourceMessageId: undefined });
  const again = await submitLicenseRequest(collection, licenses, { ...emailInput, sourceMessageId: '<other@mail>' });
  assert.equal(again.duplicate, true);
  assert.equal(collection.documents.length, 1);
  collection.documents[0].status = 'declined';
  const afterDecision = await submitLicenseRequest(collection, licenses, { ...emailInput, sourceMessageId: '<third@mail>' });
  assert.equal(afterDecision.duplicate, false);
  assert.equal(collection.documents.length, 2);
});

const laptop = { deviceId: 'd1', pcName: 'AT-NB-01' };
const desktop = { deviceId: 'd2', pcName: 'AT-DT-02' };

test('a single device is attached automatically; none means "to be confirmed"', async () => {
  const one = await submitLicenseRequest(fakeRequests(), licenses, { ...emailInput, requesterDevices: [laptop] });
  assert.deepEqual(one.request.targetDevice, laptop);
  const none = await submitLicenseRequest(fakeRequests(), licenses, { ...emailInput, requesterDevices: [] });
  assert.equal(none.request.targetDevice, null);
  assert.equal(none.request.status, 'pending_approval');
});

test('several devices: chat must choose, email waits for the reply', async () => {
  const collection = fakeRequests();
  await assert.rejects(
    submitLicenseRequest(collection, licenses, { ...emailInput, source: 'chat', requesterDevices: [laptop, desktop] }),
    (error) => error.details?.code === 'device_choice_required' && error.details.devices.length === 2
  );
  assert.equal(collection.documents.length, 0);

  const named = await submitLicenseRequest(fakeRequests(), licenses, {
    ...emailInput, requesterDevices: [laptop, desktop], targetDevice: 'at-dt-02',
  });
  assert.deepEqual(named.request.targetDevice, desktop);

  await assert.rejects(
    submitLicenseRequest(fakeRequests(), licenses, { ...emailInput, requesterDevices: [laptop], targetDevice: 'OTHER-PC' }),
    (error) => error.details?.code === 'device_not_found'
  );
});

test('email request waits for a device, then goes to the owner', async () => {
  const collection = fakeRequests();
  collection.updateOne = async (filter, update) => {
    const doc = collection.documents.find((entry) => entry._id === filter._id && entry.status === filter.status);
    Object.assign(doc, update.$set);
    Object.keys(update.$unset || {}).forEach((key) => delete doc[key]);
  };
  const { request } = await submitLicenseRequest(collection, licenses, {
    ...emailInput,
    requesterDevices: [laptop, desktop],
    awaitDeviceChoice: true,
    sourceConversationId: 'conv-1',
  });
  assert.equal(request.status, 'awaiting_device');
  assert.deepEqual(request.candidateDevices, [laptop, desktop]);

  const found = await findAwaitingDeviceRequest(collection, 'conv-1', 'FARHAN@example.com');
  assert.equal(found._id, request._id);
  await assert.rejects(chooseRequestDevice(collection, found, 'OTHER-PC'), (error) => error.details?.code === 'device_not_found');
  const chosen = await chooseRequestDevice(collection, found, 'AT-NB-01');
  assert.equal(chosen.status, 'pending_approval');
  assert.deepEqual(collection.documents[0].targetDevice, laptop);
  assert.equal(collection.documents[0].candidateDevices, undefined);
});

test('finds the device named in a chat message', () => {
  assert.equal(deviceNamedIn('I need access to Postman on at-dt-02 please', [laptop, desktop]), desktop);
  assert.equal(deviceNamedIn('I need access to Postman', [laptop, desktop]), null);
});
