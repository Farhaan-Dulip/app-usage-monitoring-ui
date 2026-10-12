import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LicenseRequestError,
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
