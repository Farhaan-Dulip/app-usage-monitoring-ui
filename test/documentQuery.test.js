import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import {
  applyUpdate,
  equalityFields,
  matchesFilter,
  projectDocument,
  sortDocuments,
  toStorable,
} from '../services/documentQuery.js';
import { appAliasFilter } from '../services/assistantMatching.js';

const docs = [
  { _id: 'a', appName: 'Postman', order: 2, source_client_id: 'c1', status: 'pending_approval' },
  { _id: 'b', app_name: 'postman.exe', order: 1, source_client_id: 'c1' },
  { _id: 'c', appName: 'VS Code', order: 3, source_client_id: 'c2' },
];

test('equality, $nin and combined filters (replaceRecords cleanup)', () => {
  const stale = docs.filter((doc) => matchesFilter(doc, { source_client_id: 'c1', _id: { $nin: ['a'] } }));
  assert.deepEqual(stale.map((doc) => doc._id), ['b']);
  assert.equal(docs.filter((doc) => matchesFilter(doc, {})).length, 3);
});

test('app alias $or/$in RegExp filter matches display and process names', () => {
  const filter = appAliasFilter(['postman']);
  assert.deepEqual(docs.filter((doc) => matchesFilter(doc, filter)).map((doc) => doc._id), ['a', 'b']);
});

test('ObjectId and Date values compare with their stored string forms', () => {
  const id = new ObjectId();
  assert.ok(matchesFilter({ _id: id.toHexString(), status: 'pending_approval' }, { _id: id, status: 'pending_approval' }));
  const when = new Date('2026-10-05T10:00:00Z');
  assert.ok(matchesFilter({ received_at: '2026-10-05T10:00:01.000Z' }, { received_at: { $gt: when } }));
  assert.ok(!matchesFilter({ received_at: '2026-10-05T10:00:00.000Z' }, { received_at: { $gt: when } }));
});

test('sorts by multiple fields and directions', () => {
  assert.deepEqual(sortDocuments(docs, { order: 1 }).map((doc) => doc._id), ['b', 'a', 'c']);
  assert.deepEqual(sortDocuments(docs, { source_client_id: -1, order: 1 }).map((doc) => doc._id), ['c', 'b', 'a']);
});

test('inclusion and exclusion projections', () => {
  assert.deepEqual(projectDocument(docs[0], { appName: 1 }), { _id: 'a', appName: 'Postman' });
  assert.deepEqual(projectDocument(docs[0], { _id: 0, order: 0, source_client_id: 0, status: 0 }), { appName: 'Postman' });
});

test('update operators and upsert seed fields', () => {
  const inserted = applyUpdate({ _id: 'x' }, { $set: { a: 1 }, $setOnInsert: { created: 't' }, $unset: { gone: '' } }, { inserting: true });
  assert.deepEqual(inserted, { _id: 'x', a: 1, created: 't' });
  const updated = applyUpdate({ _id: 'x', created: 't', gone: 1 }, { $set: { a: 2 }, $setOnInsert: { created: 'new' }, $unset: { gone: '' } });
  assert.deepEqual(updated, { _id: 'x', created: 't', a: 2 });
  assert.deepEqual(equalityFields({ _id: 'x', device_key: 'd', status: { $in: ['a'] } }), { _id: 'x', device_key: 'd' });
});

test('toStorable converts Dates and ObjectIds and drops undefined', () => {
  const id = new ObjectId();
  assert.deepEqual(toStorable({ at: new Date('2026-01-01T00:00:00Z'), id, gone: undefined, list: [new Date(0)] }), {
    at: '2026-01-01T00:00:00.000Z', id: id.toHexString(), list: ['1970-01-01T00:00:00.000Z'],
  });
});
