// DynamoDB-backed stand-in for the MongoDB `Db` / `Collection` objects used by
// server.js and the telemetry worker, for the pay-per-use (serverless) deployment.
//
// Table layout
//   PORTAL_TABLE    pk = collection name, sk = document _id, doc = document map,
//                   ver = optimistic-concurrency counter. Collections are small
//                   (inventory, policies, decisions, requests), so queries read a
//                   collection partition and filter in memory (documentQuery.js).
//   TELEMETRY_TABLE pk = device key, sk = sample timestamp (idempotent insert),
//                   GSI "byReceived" (gpk = "all", gsk = received_at) for
//                   incremental reads, TTL attribute expires_at.
import { randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  applyUpdate,
  equalityFields,
  matchesFilter,
  projectDocument,
  sortDocuments,
  toStorable,
} from './documentQuery.js';
import { telemetryRetentionSeconds } from './telemetryPersistence.js';

class Cursor {
  constructor(load, projection) {
    this.load = load;
    this.projection = projection;
    this.sortSpec = null;
    this.limitCount = 0;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  async toArray() {
    let documents = await this.load();
    if (this.sortSpec) documents = sortDocuments(documents, this.sortSpec);
    if (this.limitCount) documents = documents.slice(0, this.limitCount);
    return documents.map((document) => projectDocument(document, this.projection));
  }
}

function isConditionalFailure(error) {
  return error?.name === 'ConditionalCheckFailedException';
}

// Mongo-style 24-hex-character id, so existing ObjectId validation keeps working.
function newObjectIdHex() {
  const seconds = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  return seconds + randomBytes(8).toString('hex');
}

export class DynamoCollection {
  constructor(client, tableName, name) {
    this.client = client;
    this.tableName = tableName;
    this.collectionName = name;
  }

  async queryAll() {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': this.collectionName },
        ExclusiveStartKey,
      }));
      items.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async loadMatching(filter) {
    const items = await this.queryAll();
    return items.map((item) => item.doc).filter((document) => matchesFilter(document, filter));
  }

  find(filter = {}, { projection } = {}) {
    return new Cursor(() => this.loadMatching(filter), projection);
  }

  async getItem(id) {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: this.collectionName, sk: String(id) },
    }));
    return Item;
  }

  async findOne(filter = {}) {
    if (Object.keys(filter).length === 1 && filter._id !== undefined && !(filter._id instanceof RegExp)
      && (typeof filter._id !== 'object' || typeof filter._id.toHexString === 'function')) {
      return (await this.getItem(toStorable(filter._id)))?.doc || null;
    }
    return (await this.loadMatching(filter))[0] || null;
  }

  // Writes `doc` only if the stored version is still `previousVersion`.
  async putVersioned(doc, previousVersion) {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: this.collectionName, sk: String(doc._id), doc, ver: (previousVersion || 0) + 1 },
      ...(previousVersion
        ? { ConditionExpression: 'ver = :ver', ExpressionAttributeValues: { ':ver': previousVersion } }
        : { ConditionExpression: 'attribute_not_exists(pk)' }),
    }));
  }

  async updateOne(filter, update, { upsert = false } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = filter._id !== undefined && Object.keys(filter).length === 1
        ? await this.getItem(toStorable(filter._id))
        : await this.findItem(filter);
      if (!existing && !upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const base = existing ? existing.doc : { ...toStorable(equalityFields(filter)) };
      if (base._id === undefined) base._id = newObjectIdHex();
      const doc = toStorable(applyUpdate(base, update, { inserting: !existing }));
      try {
        await this.putVersioned(doc, existing?.ver);
        return existing
          ? { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
          : { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
      }
    }
    throw new Error(`Concurrent updates kept conflicting on ${this.collectionName}`);
  }

  async findItem(filter) {
    const items = await this.queryAll();
    return items.find((item) => matchesFilter(item.doc, filter)) || null;
  }

  async findOneAndUpdate(filter, update, { returnDocument = 'before' } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = filter._id !== undefined
        ? await this.getItem(toStorable(filter._id))
        : await this.findItem(filter);
      if (!existing || !matchesFilter(existing.doc, filter)) return null;
      const doc = toStorable(applyUpdate(existing.doc, update));
      try {
        await this.putVersioned(doc, existing.ver);
        return returnDocument === 'after' ? doc : existing.doc;
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
      }
    }
    throw new Error(`Concurrent updates kept conflicting on ${this.collectionName}`);
  }

  async insertOne(document) {
    const doc = toStorable({ ...document, _id: document._id ?? newObjectIdHex() });
    await this.putVersioned(doc, 0);
    return { acknowledged: true, insertedId: doc._id };
  }

  async bulkWrite(operations) {
    for (const operation of operations) {
      if (!operation.updateOne) throw new Error('Only updateOne bulk operations are supported');
      const { filter, update, upsert } = operation.updateOne;
      await this.updateOne(filter, update, { upsert });
    }
    return { ok: 1 };
  }

  async deleteMany(filter = {}) {
    const items = (await this.queryAll()).filter((item) => matchesFilter(item.doc, filter));
    for (let index = 0; index < items.length; index += 25) {
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: items.slice(index, index + 25).map((item) => ({
            DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
          })),
        },
      }));
    }
    return { deletedCount: items.length };
  }

  async createIndex() {
    return 'dynamodb-noop';
  }

  async dropIndex() {
    return undefined;
  }
}

export class DynamoTelemetryCollection {
  constructor(client, tableName, env = process.env) {
    this.client = client;
    this.tableName = tableName;
    this.collectionName = 'telemetry_events';
    this.retentionSeconds = telemetryRetentionSeconds(env);
  }

  // Supports the single write persistTelemetry performs: insert-if-absent keyed by
  // (device_key, timestamp) via $setOnInsert. Duplicates are ignored.
  async updateOne(filter, update, { upsert = false } = {}) {
    const doc = toStorable({ ...update.$setOnInsert, ...equalityFields(filter) });
    if (!upsert || !doc.device_key || !doc.timestamp) {
      throw new Error('Telemetry writes must upsert by device_key and timestamp');
    }
    const receivedAt = doc.received_at || new Date().toISOString();
    const receivedSeconds = Math.floor(Date.parse(receivedAt) / 1000);
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: doc.device_key,
          sk: doc.timestamp,
          gpk: 'all',
          gsk: `${receivedAt}#${doc.device_key}`,
          doc,
          ...(this.retentionSeconds ? { expires_at: receivedSeconds + this.retentionSeconds } : {}),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return { upsertedCount: 1 };
    } catch (error) {
      if (isConditionalFailure(error)) return { upsertedCount: 0, matchedCount: 1 };
      throw error;
    }
  }

  async loadSince(filter) {
    const since = filter?.received_at?.$gt;
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byReceived',
        KeyConditionExpression: since ? 'gpk = :all AND gsk > :since' : 'gpk = :all',
        ExpressionAttributeValues: {
          ':all': 'all',
          // '~' sorts after the '#device' suffix, so samples at exactly `since` are excluded.
          ...(since ? { ':since': `${toStorable(since)}~` } : {}),
        },
        ExclusiveStartKey,
      }));
      items.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const rest = { ...filter };
    delete rest.received_at;
    return items.map((item) => item.doc).filter((document) => matchesFilter(document, rest));
  }

  find(filter = {}, { projection } = {}) {
    return new Cursor(() => this.loadSince(filter), projection);
  }

  async createIndex() {
    return 'dynamodb-noop';
  }

  async dropIndex() {
    return undefined;
  }
}

export class DynamoDatabase {
  constructor({ portalTable, telemetryTable, region, env = process.env, client } = {}) {
    if (!portalTable || !telemetryTable) throw new Error('PORTAL_TABLE and TELEMETRY_TABLE are required');
    // DYNAMODB_ENDPOINT targets DynamoDB Local for development and tests.
    const endpoint = env.DYNAMODB_ENDPOINT || undefined;
    this.client = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region: region || 'us-east-1', endpoint }), {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
    });
    this.portalTable = portalTable;
    this.telemetryTable = telemetryTable;
    this.env = env;
    this.databaseName = `dynamodb:${portalTable}`;
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, name === 'telemetry_events'
        ? new DynamoTelemetryCollection(this.client, this.telemetryTable, this.env)
        : new DynamoCollection(this.client, this.portalTable, name));
    }
    return this.collections.get(name);
  }

  listCollections() {
    return { toArray: async () => [...this.collections.keys()].map((name) => ({ name })) };
  }

  async createCollection(name) {
    return this.collection(name);
  }
}
