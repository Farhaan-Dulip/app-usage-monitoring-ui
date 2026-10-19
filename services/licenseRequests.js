// License requests raised from the chat assistant or from email to the AI agent.
// Each is routed to the onboarded app's owner and appears on the License
// Approvals page. The request names the PC the license is for: the
// requester's only device, the one they chose, or "not on record".
import { normalizeAppName } from './assistantMatching.js';
import { resolveTargetDevice } from './deviceRegistry.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class LicenseRequestError extends Error {
  constructor(message, statusCode, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function licenseAppName(license) {
  return license?.appName || license?.app_name || license?.name || license?.application || '';
}

// Onboarded license whose display or process name matches (`Postman`, `postman.exe`).
export function findOnboardedLicense(appName, licenses) {
  const wanted = normalizeAppName(appName);
  if (!wanted) return null;
  return (
    licenses.find((license) =>
      [licenseAppName(license), license?.processName].some((name) => normalizeAppName(name) === wanted)
    ) || null
  );
}

export function onboardedAppNames(licenses) {
  return [...new Set(licenses.map(licenseAppName).map((name) => String(name).trim()).filter(Boolean))].sort();
}

const deviceSummary = (device) => ({ deviceId: device.deviceId, pcName: device.pcName });

// The requester's device whose PC name appears in free text ("... on AT-NB-01").
export function deviceNamedIn(text, requesterDevices) {
  const lower = String(text || '').toLowerCase();
  return (
    [...requesterDevices]
      .sort((a, b) => b.pcName.length - a.pcName.length)
      .find((device) => device.pcName && lower.includes(device.pcName.toLowerCase())) || null
  );
}

function deviceChoiceError(requestedApp, devices, requested) {
  const names = devices.map((device) => device.pcName).join(', ');
  return requested
    ? new LicenseRequestError(`${requested} is not one of your devices. Your devices: ${names}.`, 400, {
        code: 'device_not_found',
        devices: devices.map(deviceSummary),
      })
    : new LicenseRequestError(`You have ${devices.length} devices (${names}). Which PC should the ${requestedApp} license go on?`, 409, {
        code: 'device_choice_required',
        devices: devices.map(deviceSummary),
      });
}

/**
 * Creates a request for `requestedApp`, approved by the app's owner.
 *
 * `requesterDevices` are the requester's devices from the device register and
 * `targetDevice` the PC name or device ID they asked for, if any. With several
 * devices and no choice, it throws `device_choice_required` (chat asks), or,
 * with `awaitDeviceChoice` (email), stores the request as `awaiting_device`
 * until `chooseRequestDevice` is called from the requester's reply.
 *
 * Returns the existing request with `duplicate: true` when the same email
 * (`sourceMessageId`, its Message-ID) is processed again, or when the requester
 * already has an open request for the app.
 */
export async function submitLicenseRequest(collection, licenses, input, now = new Date()) {
  const requesterName = String(input.requesterName || '').trim().slice(0, 200);
  const requesterEmail = String(input.requesterEmail || '').trim().toLowerCase();
  if (!requesterName || !EMAIL_PATTERN.test(requesterEmail)) {
    throw new LicenseRequestError('Add your name and work email before submitting a license request.', 400);
  }

  const license = findOnboardedLicense(input.requestedApp, licenses);
  if (!license) {
    throw new LicenseRequestError(`${input.requestedApp || 'That application'} is not an onboarded application.`, 404);
  }
  const requestedApp = licenseAppName(license);
  const approvingManagerName = String(license.owner || '').trim();
  const approvingManagerEmail = String(license.ownerEmail || '').trim().toLowerCase();
  if (!approvingManagerName || !approvingManagerEmail) {
    throw new LicenseRequestError(`No app owner is configured for ${requestedApp}. Update the onboarded license first.`, 409);
  }

  const sourceMessageId = String(input.sourceMessageId || '').trim().slice(0, 998) || undefined;
  if (sourceMessageId) {
    const existing = await collection.findOne({ sourceMessageId });
    if (existing) return { request: existing, duplicate: true };
  }

  // One open request per person and app: asking again returns the open one.
  for (const status of ['pending_approval', 'awaiting_device']) {
    const open = await collection.findOne({ requesterEmail, requestedApp, status });
    if (open) return { request: open, duplicate: true };
  }

  const requesterDevices = Array.isArray(input.requesterDevices) ? input.requesterDevices : [];
  const requested = String(input.targetDevice || '').trim();
  const resolution = resolveTargetDevice(requesterDevices, requested);
  if (resolution.invalid) throw deviceChoiceError(requestedApp, requesterDevices, requested);
  const awaitingDevice = Boolean(resolution.choiceRequired);
  if (awaitingDevice && !input.awaitDeviceChoice) throw deviceChoiceError(requestedApp, requesterDevices, '');

  const sourceConversationId = String(input.sourceConversationId || '').trim().slice(0, 500) || undefined;
  const request = {
    clientId: input.clientId || (input.source === 'email' ? 'email' : 'unknown-session'),
    requesterName,
    requesterEmail,
    requestedApp,
    approvingManagerName,
    approvingManagerEmail,
    requestText: String(input.requestText || '').trim().slice(0, 4000),
    status: awaitingDevice ? 'awaiting_device' : 'pending_approval',
    requestedFor: 'self',
    source: input.source === 'email' ? 'email' : 'chat',
    targetDevice: resolution.device ? deviceSummary(resolution.device) : null,
    ...(awaitingDevice ? { candidateDevices: requesterDevices.map(deviceSummary) } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(sourceConversationId ? { sourceConversationId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await collection.insertOne(request);
    return { request: { ...request, _id: result.insertedId }, duplicate: false };
  } catch (error) {
    // Two deliveries of the same message racing past the findOne above.
    if (error?.code === 11000 && sourceMessageId) {
      const existing = await collection.findOne({ sourceMessageId });
      if (existing) return { request: existing, duplicate: true };
    }
    throw error;
  }
}

// The requester's awaiting request in an email thread.
export async function findAwaitingDeviceRequest(collection, conversationId, requesterEmail) {
  const id = String(conversationId || '').trim();
  const email = String(requesterEmail || '').trim().toLowerCase();
  if (!id || !email) return null;
  return collection.findOne({ sourceConversationId: id, requesterEmail: email, status: 'awaiting_device' });
}

// Completes an `awaiting_device` request with the PC the requester chose; it
// then goes to the app owner like any other request.
export async function chooseRequestDevice(collection, request, requested, now = new Date()) {
  if (request?.status !== 'awaiting_device') {
    throw new LicenseRequestError('This request is not waiting for a device choice.', 409);
  }
  const candidates = Array.isArray(request.candidateDevices) ? request.candidateDevices : [];
  const resolution = resolveTargetDevice(candidates, requested);
  if (!resolution.device) throw deviceChoiceError(request.requestedApp, candidates, String(requested || '').trim() || 'That device');
  const targetDevice = deviceSummary(resolution.device);
  await collection.updateOne(
    { _id: request._id, status: 'awaiting_device' },
    { $set: { status: 'pending_approval', targetDevice, updatedAt: now }, $unset: { candidateDevices: '' } }
  );
  return { ...request, status: 'pending_approval', targetDevice, candidateDevices: undefined, updatedAt: now };
}
