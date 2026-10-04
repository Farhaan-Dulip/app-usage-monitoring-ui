const applicationTimeZone = process.env.APP_TIME_ZONE || 'Asia/Colombo';

function dateTimeFields(value, prefix) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return {};
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: applicationTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: partValue }) => [type, partValue])
  );
  return {
    [`${prefix}_date`]: `${parts.year}-${parts.month}-${parts.day}`,
    [`${prefix}_time`]: `${parts.hour}:${parts.minute}:${parts.second}`,
    time_zone: applicationTimeZone,
  };
}

export function validateTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.timestamp) {
    throw new Error('Telemetry must be a JSON object with a timestamp');
  }
  if (Number.isNaN(new Date(payload.timestamp).getTime())) {
    throw new Error('Telemetry timestamp must be a valid ISO date/time');
  }
  return payload;
}

export async function persistTelemetry(telemetryEvents, payload, source = 'http') {
  validateTelemetryPayload(payload);
  const deviceId = String(payload.device_id || payload.device_name || 'unknown');
  await telemetryEvents.updateOne(
    { device_key: deviceId, timestamp: payload.timestamp },
    {
      $setOnInsert: {
        ...payload,
        ...dateTimeFields(payload.timestamp, 'recorded'),
        device_key: deviceId,
        received_at: new Date(),
        received_via: source,
      },
    },
    { upsert: true }
  );
}

const INDEX_OPTIONS_CONFLICT = 85;

// Raw telemetry expires after TELEMETRY_RETENTION_DAYS (default 30, 0 keeps
// it forever). An existing non-TTL `received_at` index is replaced in place.
export function telemetryRetentionSeconds(env = process.env) {
  const days = Number(env.TELEMETRY_RETENTION_DAYS ?? 30);
  return Number.isFinite(days) && days > 0 ? Math.round(days * 24 * 60 * 60) : 0;
}

export async function ensureTelemetryIndexes(telemetryEvents, env = process.env) {
  await telemetryEvents.createIndex({ device_key: 1, timestamp: 1 }, { unique: true });
  const expireAfterSeconds = telemetryRetentionSeconds(env);
  const options = expireAfterSeconds ? { name: 'received_at_1', expireAfterSeconds } : { name: 'received_at_1' };
  try {
    await telemetryEvents.createIndex({ received_at: 1 }, options);
  } catch (error) {
    if (error?.code !== INDEX_OPTIONS_CONFLICT) throw error;
    await telemetryEvents.dropIndex('received_at_1');
    await telemetryEvents.createIndex({ received_at: 1 }, options);
  }
}
