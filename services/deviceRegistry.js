// Device register: which employee (work email) each tracked device belongs to.
//
// The Tracker reports the signed-in work account (`user_upn`) with every
// sample, which links the device automatically. An admin can override the
// owner in the portal (shared or wrongly linked PCs); the override wins until
// it is cleared. License requests use this to ask which PC a license is for.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_MS = 5 * 60 * 1000;

export class DeviceRegistryError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

export function deviceOwnerEmail(device) {
  return normalizeEmail(device?.ownerOverrideEmail) || normalizeEmail(device?.reportedUserEmail);
}

export function serializeDevice(device) {
  return {
    deviceId: device.deviceId,
    pcName: device.pcName || device.deviceId,
    ownerEmail: deviceOwnerEmail(device),
    ownerSource: normalizeEmail(device.ownerOverrideEmail) ? 'admin' : normalizeEmail(device.reportedUserEmail) ? 'tracker' : 'none',
    reportedUserEmail: normalizeEmail(device.reportedUserEmail),
    lastSeenAt: device.lastSeenAt || null,
  };
}

// Telemetry arrives every few seconds per device; write the register only
// when something changed or every REFRESH_MS (per process).
const recentSightings = new Map();

export function resetSightingCache() {
  recentSightings.clear();
}

export async function recordDeviceSighting(devices, payload, now = new Date()) {
  const deviceId = String(payload?.device_id || payload?.device_name || '').trim();
  if (!deviceId) return false;
  const pcName = String(payload?.device_name || payload?.usage?.device_name || deviceId).trim().slice(0, 200);
  const reportedUserEmail = normalizeEmail(payload?.user_upn || payload?.usage?.user_upn);

  const signature = `${pcName}|${reportedUserEmail}`;
  const previous = recentSightings.get(deviceId);
  if (previous && previous.signature === signature && now.getTime() - previous.at < REFRESH_MS) return false;

  await devices.updateOne(
    { deviceId },
    {
      $set: {
        pcName,
        lastSeenAt: now,
        // A sample without a user (local account, older Tracker) keeps the last one reported.
        ...(reportedUserEmail ? { reportedUserEmail } : {}),
      },
      $setOnInsert: { deviceId, firstSeenAt: now },
    },
    { upsert: true }
  );
  recentSightings.set(deviceId, { signature, at: now.getTime() });
  return true;
}

export async function listDevices(devices) {
  const records = await devices.find({}).limit(5000).toArray();
  return records
    .map(serializeDevice)
    .sort((a, b) => String(a.pcName).localeCompare(String(b.pcName)));
}

export async function devicesForEmail(devices, email) {
  const wanted = normalizeEmail(email);
  if (!wanted) return [];
  return (await listDevices(devices)).filter((device) => device.ownerEmail === wanted);
}

// Admin override; an empty email clears it so the Tracker-reported user applies again.
export async function setDeviceOwner(devices, deviceId, ownerEmail, now = new Date()) {
  const id = String(deviceId || '').trim();
  const existing = id ? await devices.findOne({ deviceId: id }) : null;
  if (!existing) throw new DeviceRegistryError('Device not found', 404);
  const email = String(ownerEmail || '').trim();
  if (email && !normalizeEmail(email)) throw new DeviceRegistryError('Owner must be a work email address', 400);
  await devices.updateOne(
    { deviceId: id },
    email
      ? { $set: { ownerOverrideEmail: normalizeEmail(email), ownerUpdatedAt: now } }
      : { $unset: { ownerOverrideEmail: '' }, $set: { ownerUpdatedAt: now } }
  );
  return serializeDevice(await devices.findOne({ deviceId: id }));
}

// Picks the requester's device for a license request.
//   requested device given  -> must be one of theirs (by PC name or device ID)
//   none on record          -> { device: null } (request raised, device to be confirmed)
//   exactly one             -> that one
//   several                 -> { choiceRequired: true, devices }
export function resolveTargetDevice(requesterDevices, requested) {
  const wanted = String(requested || '').trim().toLowerCase();
  if (wanted) {
    const match = requesterDevices.find(
      (device) => device.pcName.toLowerCase() === wanted || device.deviceId.toLowerCase() === wanted
    );
    if (!match) return { invalid: true, devices: requesterDevices };
    return { device: match };
  }
  if (requesterDevices.length === 0) return { device: null };
  if (requesterDevices.length === 1) return { device: requesterDevices[0] };
  return { choiceRequired: true, devices: requesterDevices };
}
