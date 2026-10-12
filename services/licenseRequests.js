// License requests raised from the chat assistant or from email to the AI agent.
// Both end up in assistant_requests with status pending_approval, routed to the
// onboarded app's owner, and appear on the License Approvals page.
import { normalizeAppName } from './assistantMatching.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class LicenseRequestError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
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

/**
 * Creates a pending request for `requestedApp`, approved by the app's owner.
 * Returns the existing request with `duplicate: true` when the same email
 * (`sourceMessageId`, its Message-ID) is processed again, or when the requester
 * already has a pending request for the app.
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

  // One open request per person and app: asking again returns the pending one.
  const pending = await collection.findOne({ requesterEmail, requestedApp, status: 'pending_approval' });
  if (pending) return { request: pending, duplicate: true };

  const request = {
    clientId: input.clientId || (input.source === 'email' ? 'email' : 'unknown-session'),
    requesterName,
    requesterEmail,
    requestedApp,
    approvingManagerName,
    approvingManagerEmail,
    requestText: String(input.requestText || '').trim().slice(0, 4000),
    status: 'pending_approval',
    requestedFor: 'self',
    source: input.source === 'email' ? 'email' : 'chat',
    ...(sourceMessageId ? { sourceMessageId } : {}),
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
