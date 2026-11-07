// Deploy Tracker -> the PC's Tracker gets its monitoring config.
//
// The portal's Deploy Tracker button posts the config it built (onboarded
// apps, each with its policy's evaluation window, active-time threshold and
// idle threshold). This queues a `config_deployed` message in the same outbox
// approved license requests use; the telemetry worker publishes it to the
// `tracker.config` exchange with the device ID as routing key, and the
// device's durable queue holds it while the PC is off.
//
// A PC that has not connected yet has no device ID, so its deployment waits
// (`waiting_device`) until the PC first reports in under that name. A newer
// deployment to the same PC supersedes one still waiting to be sent.

export const DEPLOY_MESSAGE_TYPE = 'config_deployed';
export const DEPLOYMENT_KIND = 'deployment';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const pcKey = (value) => String(value || '').trim().toUpperCase();

// The config keys the portal owns in monitoring-config.json.
export function trackerConfigFrom(config) {
  return {
    target_pc: pcKey(config.target_pc),
    assigned_user: String(config.assigned_user || '').trim(),
    generated_at: config.generated_at || new Date().toISOString(),
    licensed_apps: Array.isArray(config.licensed_apps) ? config.licensed_apps : [],
    extensions: Array.isArray(config.extensions) ? config.extensions : [],
    tracked_urls: Array.isArray(config.tracked_urls) ? config.tracked_urls : [],
  };
}

// First problem with a deployment request, or ''.
export function deploymentError({ pcName, userEmail, config }) {
  if (!pcKey(pcName)) return 'Enter a PC name.';
  if (userEmail && !EMAIL.test(String(userEmail).trim())) return 'Enter a valid user email.';
  if (!config || typeof config !== 'object') return 'The deployment has no tracker config.';
  if (!Array.isArray(config.licensed_apps) || config.licensed_apps.length + (config.extensions || []).length === 0) {
    return 'Onboard at least one app before deployment.';
  }
  return '';
}

// The device a PC name belongs to: the one seen most recently under that name.
export async function findDeviceByPcName(devices, pcName) {
  const name = pcKey(pcName);
  const all = await devices.find({}).limit(5000).toArray();
  return all
    .filter((device) => pcKey(device.pcName) === name)
    .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))[0] || null;
}

export function buildDeploymentMessage({ deploymentId, deviceId, pcName, userEmail, config, now }) {
  return {
    type: DEPLOY_MESSAGE_TYPE,
    deployment_id: deploymentId,
    device_id: deviceId || null,
    pc_name: pcKey(pcName),
    assigned_user: String(userEmail || '').trim(),
    deployed_at: now.toISOString(),
    config: trackerConfigFrom({ ...config, target_pc: pcName, assigned_user: userEmail }),
  };
}

/**
 * Queues a deployment for a PC. Returns `{ queued: true, pcName, deviceFound }`;
 * `deviceFound: false` means it waits until the PC connects.
 */
export async function queueTrackerDeployment({ outbox, devices, pcName, userEmail, config, now = new Date() }) {
  const name = pcKey(pcName);
  const device = await findDeviceByPcName(devices, name);
  const earlier = await outbox.find({ kind: DEPLOYMENT_KIND, pcName: name }).limit(500).toArray();
  for (const entry of earlier) {
    if (entry.status === 'pending' || entry.status === 'waiting_device') {
      await outbox.updateOne({ _id: entry._id }, { $set: { status: 'superseded', supersededAt: now } });
    }
  }
  const deploymentId = `deploy-${name.toLowerCase()}-${now.getTime()}`;
  await outbox.insertOne({
    grantId: deploymentId,
    kind: DEPLOYMENT_KIND,
    deviceId: device?.deviceId || null,
    pcName: name,
    userEmail: String(userEmail || '').trim(),
    message: buildDeploymentMessage({ deploymentId, deviceId: device?.deviceId, pcName: name, userEmail, config, now }),
    status: device ? 'pending' : 'waiting_device',
    attempts: 0,
    createdAt: now,
  });
  return { queued: true, pcName: name, deviceFound: Boolean(device), deploymentId };
}

// Deployments waiting for their PC: those whose PC has now reported in get
// its device ID and are released to the publisher.
export async function releaseWaitingDeployments({ outbox, devices, now = new Date() }) {
  const waiting = await outbox.find({ status: 'waiting_device' }).limit(100).toArray();
  let released = 0;
  for (const entry of waiting) {
    const device = await findDeviceByPcName(devices, entry.pcName);
    if (!device?.deviceId) continue;
    await outbox.updateOne(
      { _id: entry._id },
      {
        $set: {
          deviceId: device.deviceId,
          message: { ...entry.message, device_id: device.deviceId },
          status: 'pending',
          releasedAt: now,
        },
      }
    );
    released += 1;
  }
  return released;
}

// What the Deploy screen shows for each PC's latest deployment.
export async function latestDeployments(outbox) {
  const entries = await outbox.find({ kind: DEPLOYMENT_KIND }).limit(2000).toArray();
  const latest = new Map();
  for (const entry of entries) {
    const current = latest.get(entry.pcName);
    if (!current || new Date(entry.createdAt) > new Date(current.createdAt)) latest.set(entry.pcName, entry);
  }
  return [...latest.values()].map((entry) => ({
    pcName: entry.pcName,
    userEmail: entry.userEmail || '',
    status: entry.status,
    createdAt: entry.createdAt,
    sentAt: entry.sentAt || null,
    apps: [
      ...(entry.message?.config?.licensed_apps || []).flatMap((app) => [app.name, ...(app.extensions || []).map((extension) => extension.name)]),
      ...(entry.message?.config?.extensions || []).map((extension) => extension.name),
    ].filter(Boolean),
  }));
}
