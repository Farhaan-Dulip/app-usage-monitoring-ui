// Approved license request -> the target PC starts monitoring the app.
//
// On approval the portal (1) records the app as deployed to that PC (the
// deployment record the dashboard reads) and (2) queues a `license_granted`
// message in an outbox. The telemetry worker, which holds the RabbitMQ
// connection, publishes the outbox to the `tracker.config` exchange with the
// device ID as routing key; the Tracker merges it into monitoring-config.json.
import { findOnboardedLicense } from './licenseRequests.js';
import { buildPortalReclaimPolicy, buildReclaimPolicy } from './reclaimPolicy.js';

export const GRANT_SOURCE = 'license-approval';

// Same _id scheme as the Deploy screen's records (server.js recordId), so an
// approval and a manual deployment of the same app never duplicate.
function deploymentRecordId(record) {
  return encodeURIComponent(
    [record.target_pc, record.type, record.parent_app, record.app_name]
      .map((part) => String(part || '').trim().toLowerCase())
      .join('::')
  );
}

export function buildLicenseGrant(request, license, now = new Date()) {
  const policy = license.policy || {};
  const appName = license.processName || license.appName;
  return {
    type: 'license_granted',
    grant_id: String(request._id),
    request_id: String(request._id),
    device_id: request.targetDevice.deviceId,
    pc_name: request.targetDevice.pcName,
    requester_email: request.requesterEmail,
    approved_at: now.toISOString(),
    app: {
      name: appName,
      type: 'application',
      subscriptionType: license.subscriptionType || license.appName || appName,
      license_cost: Number(license.monthlyCost) || 0,
      reclaim_policy: buildReclaimPolicy(policy),
    },
  };
}

export function buildDeploymentRecord(request, license, now = new Date()) {
  const policy = license.policy || {};
  return {
    target_pc: String(request.targetDevice.pcName).trim().toUpperCase(),
    assigned_user: request.requesterName,
    generated_at: now.toISOString(),
    app_name: license.processName || license.appName,
    type: 'application',
    parent_app: null,
    subscriptionType: license.subscriptionType || license.appName || '',
    license_cost: Number(license.monthlyCost) || 0,
    reclaim_policy: buildPortalReclaimPolicy(policy),
  };
}

/**
 * Called after a request is approved. Returns `{ queued: true, pcName }`, or
 * `{ queued: false, reason }` when there is no device on record or the app is
 * no longer onboarded (the owner then deploys it from the Deploy screen).
 */
export async function queueLicenseGrant({ outbox, deploymentRecords, request, licenses, now = new Date() }) {
  if (!request?.targetDevice?.deviceId) return { queued: false, reason: 'no_device' };
  const license = findOnboardedLicense(request.requestedApp, licenses);
  if (!license) return { queued: false, reason: 'app_not_onboarded' };

  const record = buildDeploymentRecord(request, license, now);
  await deploymentRecords.updateOne(
    { _id: deploymentRecordId(record) },
    {
      $set: { ...record, source_client_id: GRANT_SOURCE, license_request_id: String(request._id), updated_at: now },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  const grantId = String(request._id);
  if (!(await outbox.findOne({ grantId }))) {
    await outbox.insertOne({
      grantId,
      deviceId: request.targetDevice.deviceId,
      pcName: request.targetDevice.pcName,
      message: buildLicenseGrant(request, license, now),
      status: 'pending',
      attempts: 0,
      createdAt: now,
    });
  }
  return { queued: true, pcName: request.targetDevice.pcName };
}
