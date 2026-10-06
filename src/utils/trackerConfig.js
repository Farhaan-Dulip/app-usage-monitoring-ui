// Builds the tracker runtime config the dashboard expects (licensed app names as
// the Tracker reports them, per-app policies and types, extensions, URLs) from the
// deployment records saved by the Deploy screen. Uses the current PC's records
// when it has any, otherwise all records. Returns null when nothing is deployed.
export function deriveTrackerConfig(deploymentPolicyRecords = [], lastDeploymentConfig = null, pcName = '') {
  const pcKey = String(pcName || '').trim().toLowerCase();
  const forPc = deploymentPolicyRecords.filter(
    (record) => String(record?.target_pc || '').trim().toLowerCase() === pcKey
  );
  const records = forPc.length > 0 ? forPc : deploymentPolicyRecords;
  if (records.length === 0) return null;

  // The Tracker reports application rows by lower-cased process name.
  const appKey = (value) => String(value || '').trim().toLowerCase();
  const applications = records.filter((record) => !record.parent_app && record.app_name);
  const extensions = records.filter((record) => record.parent_app && record.app_name);
  const licensedApps = [...new Set(applications.map((record) => appKey(record.app_name)))];

  return {
    licensed_apps: licensedApps,
    licensed_app_policies: Object.fromEntries(
      applications.map((record) => [appKey(record.app_name), record.reclaim_policy || {}])
    ),
    licensed_app_types: Object.fromEntries(
      applications.map((record) => [appKey(record.app_name), record.type || 'application'])
    ),
    licensed_app_metadata: {},
    extensions: extensions.map((record) => ({
      name: record.app_name,
      type: record.type || 'agent',
      parent_app: appKey(record.parent_app),
      subscriptionType: record.subscriptionType || '',
      license_cost: Number(record.license_cost) || 0,
      reclaim_policy: record.reclaim_policy || {},
    })),
    tracked_urls: Array.isArray(lastDeploymentConfig?.tracked_urls) ? lastDeploymentConfig.tracked_urls : [],
    derived_from_deployment_records: true,
  };
}
