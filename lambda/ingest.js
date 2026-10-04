// AWS Lambda entry point for Tracker telemetry over HTTPS (pay-per-use
// deployment; replaces RabbitMQ + worker). Accepts the same event envelope the
// Tracker publishes to RabbitMQ, authenticated with a shared bearer token.
// Responds 2xx only after the sample is stored, so the Tracker's outbox keeps
// at-least-once delivery; duplicates are ignored by the store.
import { loadSsmEnv } from './ssmEnv.js';
import { createDatabase } from '../services/database.js';
import { persistTelemetry, validateTelemetryPayload } from '../services/telemetryPersistence.js';
import { serviceTokenMatches } from '../services/serviceAuth.js';

await loadSsmEnv();
const { database } = await createDatabase(process.env);
const telemetryEvents = database.collection('telemetry_events');
const MAX_BODY_BYTES = 256 * 1024;

function respond(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export async function handler(event) {
  if (event.requestContext?.http?.method !== 'POST') return respond(405, { error: 'POST only' });
  const authorization = event.headers?.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!serviceTokenMatches(token, process.env.INGEST_TOKEN)) return respond(401, { error: 'Unauthorized' });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return respond(413, { error: 'Payload too large' });
  let payload;
  try {
    payload = JSON.parse(raw);
    validateTelemetryPayload(payload);
  } catch (error) {
    return respond(400, { error: error instanceof SyntaxError ? 'Body must be JSON' : error.message });
  }
  await persistTelemetry(telemetryEvents, payload, 'https');
  return respond(202, { accepted: payload.event_id || payload.timestamp });
}
