import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
const source = client.db(process.env.MONGO_SOURCE_DATABASE || 'app-license-monitoring');
const target = client.db(process.env.MONGO_DATABASE || 'app-usage-monitoring');

const mappings = {
  policies: ['license_policies', 'array', (value, index) => value.name || index],
  inventory: ['licensed_apps', 'array', (value, index) => value.id || `${value.appName || 'app'}-${index}`],
  onboarded_licenses: ['onboarded_licenses', 'array', (value, index) => value.id || value.appId || `${value.appName || 'license'}-${index}`],
  deployment_records: ['deployment_records', 'array', (value) =>
    [value.target_pc, value.type, value.parent_app, value.app_name].map((part) => String(part || '').trim().toLowerCase()).join('::')],
  costs: ['cost_overrides', 'map'],
  evaluation_decisions: ['evaluation_decisions', 'map'],
};

const id = (value) => encodeURIComponent(String(value || '').trim().toLowerCase());

async function migrateRecords(sourceName, [targetName, type, getId], portalData = {}) {
  const legacy = await source.collection(sourceName).findOne({ _id: 'default' });
  const portalKey = {
    policies: 'licensePolicies',
    inventory: 'licensedApps',
    onboarded_licenses: 'onboardedAppLicenses',
    deployment_records: 'deploymentPolicyRecords',
    costs: 'costOverrides',
    evaluation_decisions: 'completedEvaluationDecisions',
  }[sourceName];
  const data = portalData[portalKey] ?? legacy?.data ?? (type === 'array' ? [] : {});
  const entries = type === 'array' ? data : Object.entries(data);
  if (!entries.length) return;
  const now = new Date();
  const operations = entries.map((entry, index) => {
    const key = type === 'array' ? getId(entry, index) : entry[0];
    const value = type === 'array' ? entry : entry[1];
    return {
      updateOne: {
        filter: { _id: id(key) },
        update: {
          $set: type === 'array' ? { ...value, order: index, updated_at: now } : { value, updated_at: now },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
      },
    };
  });
  await target.collection(targetName).bulkWrite(operations);
}

async function migrateSingleton(sourceName, targetName, fields = null) {
  const legacy = await source.collection(sourceName).findOne({ _id: 'default' });
  if (!legacy?.data) return;
  const data = fields
    ? Object.fromEntries(fields.map((field) => [field, legacy.data[field] ?? null]))
    : legacy.data;
  await target.collection(targetName).updateOne(
    { _id: 'default' },
    { $set: { ...data, updated_at: new Date() } },
    { upsert: true }
  );
}

try {
  await client.connect();
  const portalData = (await source.collection('portal_state').findOne({ _id: 'default' }))?.data || {};
  const targetCollectionNames = [
    ...Object.values(mappings).map(([name]) => name),
    'report_settings',
    'agent_configurations',
    'app_settings',
    'telemetry_events',
  ];
  const existingNames = new Set(
    (await target.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name)
  );
  for (const name of targetCollectionNames) {
    if (!existingNames.has(name)) await target.createCollection(name);
  }
  for (const mapping of Object.entries(mappings)) await migrateRecords(...mapping, portalData);
  if (Object.keys(portalData).length) {
    await target.collection('report_settings').updateOne(
      { _id: 'default' },
      { $set: {
        selectedReportTemplateId: portalData.selectedReportTemplateId,
        selectedReportDimensions: portalData.selectedReportDimensions || [],
        selectedReportMetrics: portalData.selectedReportMetrics || [],
        reportFrequency: portalData.reportFrequency,
        deliveryChannel: portalData.deliveryChannel,
        historicalRange: portalData.historicalRange,
        updated_at: new Date(),
      } },
      { upsert: true }
    );
    await target.collection('agent_configurations').updateOne(
      { _id: 'default' },
      { $set: {
        config: portalData.config || null,
        lastDeploymentConfig: portalData.lastDeploymentConfig || null,
        updated_at: new Date(),
      } },
      { upsert: true }
    );
  } else {
    await migrateSingleton('report_settings', 'report_settings');
    await migrateSingleton('agent_configurations', 'agent_configurations');
  }
  await migrateSingleton('portal_state', 'app_settings', ['emailSummaryWindowKey']);

  const telemetry = await source.collection('telemetry_events').find({}).toArray();
  if (telemetry.length) {
    await target.collection('telemetry_events').bulkWrite(
      telemetry.map(({ _id, ...event }) => ({
        updateOne: {
          filter: { device_key: event.device_key, timestamp: event.timestamp },
          update: { $setOnInsert: event },
          upsert: true,
        },
      }))
    );
  }
  console.log(`Migrated MongoDB data from ${source.databaseName} to ${target.databaseName}.`);
} finally {
  await client.close();
}
