import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceTokenMatches } from '../services/serviceAuth.js';
import { ensureTelemetryIndexes, telemetryRetentionSeconds } from '../services/telemetryPersistence.js';

test('service token must match exactly and be configured', () => {
  assert.ok(serviceTokenMatches('secret-token', 'secret-token'));
  assert.ok(!serviceTokenMatches('secret-tokeN', 'secret-token'));
  assert.ok(!serviceTokenMatches('short', 'secret-token'));
  assert.ok(!serviceTokenMatches(undefined, 'secret-token'));
  assert.ok(!serviceTokenMatches('', ''));
  assert.ok(!serviceTokenMatches('anything', undefined));
});

test('telemetry retention defaults to 30 days and 0 disables it', () => {
  assert.equal(telemetryRetentionSeconds({}), 30 * 24 * 60 * 60);
  assert.equal(telemetryRetentionSeconds({ TELEMETRY_RETENTION_DAYS: '7' }), 7 * 24 * 60 * 60);
  assert.equal(telemetryRetentionSeconds({ TELEMETRY_RETENTION_DAYS: '0' }), 0);
  assert.equal(telemetryRetentionSeconds({ TELEMETRY_RETENTION_DAYS: 'abc' }), 0);
});

function fakeCollection({ conflictOnce = false } = {}) {
  const calls = [];
  let conflict = conflictOnce;
  return {
    calls,
    async createIndex(keys, options) {
      calls.push(['createIndex', keys, options]);
      if (keys.received_at && conflict) {
        conflict = false;
        const error = new Error('Index already exists with different options');
        error.code = 85;
        throw error;
      }
    },
    async dropIndex(name) {
      calls.push(['dropIndex', name]);
    },
  };
}

test('creates a TTL index on received_at', async () => {
  const collection = fakeCollection();
  await ensureTelemetryIndexes(collection, {});
  assert.deepEqual(collection.calls[1], [
    'createIndex',
    { received_at: 1 },
    { name: 'received_at_1', expireAfterSeconds: 30 * 24 * 60 * 60 },
  ]);
});

test('replaces an existing non-TTL received_at index', async () => {
  const collection = fakeCollection({ conflictOnce: true });
  await ensureTelemetryIndexes(collection, {});
  assert.deepEqual(collection.calls.map(([name]) => name), ['createIndex', 'createIndex', 'dropIndex', 'createIndex']);
});

test('broker URL is assembled from parts with encoded credentials', async () => {
  const { connectionUrl } = await import('../messaging/telemetryConsumer.js');
  assert.equal(connectionUrl({ RABBITMQ_URL: 'amqp://a:b@h/v' }), 'amqp://a:b@h/v');
  assert.equal(
    connectionUrl({ RABBITMQ_HOST: 'rabbitmq', RABBITMQ_USERNAME: 'worker', RABBITMQ_PASSWORD: 'p@ss/word', RABBITMQ_VHOST: 'app_usage' }),
    'amqp://worker:p%40ss%2Fword@rabbitmq:5672/app_usage'
  );
});
