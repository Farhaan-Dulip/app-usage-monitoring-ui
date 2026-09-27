import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const configPath = resolve(process.cwd(), 'src', 'app_config.json');
let appConfig = {};

try {
  appConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.error('Unable to read src/app_config.json:', error.message);
  process.exit(1);
}

const recipientEmail = appConfig?.email;
const senderEmail = process.env.SES_SOURCE_EMAIL || appConfig?.ses_source_email;
const awsRegion = process.env.AWS_REGION || appConfig?.aws_region;

if (!recipientEmail) {
  console.error('Recipient email is missing in src/app_config.json');
  process.exit(1);
}

if (!senderEmail) {
  console.error(
    'Sender email is not configured. Set SES_SOURCE_EMAIL or app_config.json ses_source_email.'
  );
  process.exit(1);
}

if (!awsRegion) {
  console.error('AWS region is not configured. Set AWS_REGION or app_config.json aws_region.');
  process.exit(1);
}

const sesClient = new SESClient({ region: awsRegion });
const mongoClient = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
const database = mongoClient.db(process.env.MONGO_DATABASE || 'app-usage-monitoring');
const telemetryEvents = database.collection('telemetry_events');
const recordCollections = {
  licensePolicies: database.collection('license_policies'),
  licensedApps: database.collection('licensed_apps'),
  onboardedAppLicenses: database.collection('onboarded_licenses'),
  deploymentPolicyRecords: database.collection('deployment_records'),
  costOverrides: database.collection('cost_overrides'),
  completedEvaluationDecisions: database.collection('evaluation_decisions'),
};
const recordDefaults = {
  licensePolicies: [],
  licensedApps: [],
  onboardedAppLicenses: [],
  deploymentPolicyRecords: [],
  costOverrides: {},
  completedEvaluationDecisions: {},
};
const reportSettings = database.collection('report_settings');
const agentConfigurations = database.collection('agent_configurations');
const appSettings = database.collection('app_settings');
const applicationTimeZone = process.env.APP_TIME_ZONE || 'Asia/Colombo';

function assistantAppName(record) {
  return record?.appName || record?.app_name || record?.name || record?.application || '';
}

function assistantDecisionText(record) {
  return [record?.status, record?.decision, record?.recommendation, record?.result, record?.reason]
    .filter(Boolean)
    .join(' ');
}

function isReclaimableDecision(record) {
  return /reclaim|available|unused|inactive|underutilized|release/i.test(assistantDecisionText(record));
}

function findRequestedApp(question, records) {
  const normalizedQuestion = question.toLowerCase();
  const names = [...new Set(records.map(assistantAppName).filter(Boolean))].sort(
    (first, second) => String(second).length - String(first).length
  );
  return names.find((name) => normalizedQuestion.includes(String(name).toLowerCase())) || '';
}

function formatAssistantCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

async function answerAssistantQuestion(question) {
  const [licenses, decisions] = await Promise.all([
    recordCollections.onboardedAppLicenses.find({}).limit(500).toArray(),
    recordCollections.completedEvaluationDecisions
      .find({})
      .sort({ completed_date: -1, completed_time: -1 })
      .limit(500)
      .toArray(),
  ]);
  const allRecords = [...licenses, ...decisions];
  const requestedApp = findRequestedApp(question, allRecords);
  const questionText = question.toLowerCase();
  const recordsReviewed = allRecords.length;

  if (requestedApp) {
    const matchesApp = (record) =>
      String(assistantAppName(record)).toLowerCase() === String(requestedApp).toLowerCase();
    const appLicenses = licenses.filter(matchesApp);
    const appDecisions = decisions.filter(matchesApp);
    const reclaimable = appDecisions.filter(isReclaimableDecision);
    const totalSeats = appLicenses.reduce(
      (total, record) =>
        total + Number(record.totalSeats || record.total_seats || record.seats || record.quantity || 0),
      0
    );
    const assignedSeats = appLicenses.reduce(
      (total, record) => total + Number(record.assignedSeats || record.assigned_seats || record.usedSeats || 0),
      0
    );
    const explicitlyAvailable = appLicenses.reduce(
      (total, record) => total + Number(record.availableSeats || record.available_seats || 0),
      0
    );
    const inventoryAvailable = explicitlyAvailable || Math.max(0, totalSeats - assignedSeats);
    const availability = Math.max(inventoryAvailable, reclaimable.length);

    if (/available|availability|free|open|request|access/.test(questionText)) {
      if (availability > 0) {
        return {
          answer: `Yes. I found ${availability} potentially available ${requestedApp} license${availability === 1 ? '' : 's'}. ${inventoryAvailable} are indicated by inventory capacity and ${reclaimable.length} by completed reclaim decisions. Confirm the latest assignment state before allocating a seat.`,
          recordsReviewed,
        };
      }
      return {
        answer: `I could not confirm an available ${requestedApp} license. I found ${appLicenses.length} inventory record${appLicenses.length === 1 ? '' : 's'} and ${appDecisions.length} completed decision${appDecisions.length === 1 ? '' : 's'}, with no free capacity or reclaim recommendation recorded.`,
        recordsReviewed,
      };
    }

    return {
      answer: `${requestedApp} has ${appLicenses.length} inventory record${appLicenses.length === 1 ? '' : 's'}, ${appDecisions.length} completed decision${appDecisions.length === 1 ? '' : 's'}, and ${reclaimable.length} reclaimable or potentially available license${reclaimable.length === 1 ? '' : 's'}.${totalSeats ? ` Recorded capacity is ${totalSeats} seats.` : ''}`,
      recordsReviewed,
    };
  }

  const reclaimable = decisions.filter(isReclaimableDecision);
  const estimatedSavings = reclaimable.reduce(
    (total, record) => total + Number(record.monthlyCost || record.monthly_cost || record.savings || 0),
    0
  );
  const rankedApps = Object.entries(
    reclaimable.reduce((counts, record) => {
      const name = assistantAppName(record) || 'Unknown application';
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {})
  ).sort((first, second) => second[1] - first[1]);

  if (/saving|cost|spend|waste/.test(questionText)) {
    return {
      answer: `I found ${reclaimable.length} reclaimable decision${reclaimable.length === 1 ? '' : 's'}${estimatedSavings ? ` representing ${formatAssistantCurrency(estimatedSavings)} in recorded monthly savings` : ', but those records do not contain enough cost data to calculate a reliable savings total'}.`,
      recordsReviewed,
    };
  }

  if (/reclaim|unused|inactive|underutilized/.test(questionText)) {
    const leaders = rankedApps.slice(0, 5).map(([name, count]) => `${name} (${count})`).join(', ');
    return {
      answer: `There are ${reclaimable.length} completed decisions indicating reclaimable or underused licenses.${leaders ? ` The leading applications are ${leaders}.` : ''}`,
      recordsReviewed,
    };
  }

  if (/decision|summary|latest|overview/.test(questionText)) {
    return {
      answer: `The database currently contains ${decisions.length} completed license decisions across ${new Set(decisions.map(assistantAppName).filter(Boolean)).size} applications. ${reclaimable.length} are marked as reclaimable, available, inactive, or underutilized.`,
      recordsReviewed,
    };
  }

  return {
    answer: 'I can help with license availability, reclaimable or inactive licenses, completed decisions, and recorded savings. Try asking “Is there any license available for Postman?”',
    recordsReviewed,
  };
}

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

function localDateTimeToMilliseconds(date, time) {
  if (!date || !time) return null;
  if (applicationTimeZone === 'Asia/Colombo') return Date.parse(`${date}T${time}+05:30`);
  return Date.parse(`${date}T${time}Z`);
}

function documentId(value) {
  return encodeURIComponent(String(value || '').trim().toLowerCase());
}

function recordId(key, value, index) {
  if (key === 'licensePolicies') return documentId(value?.name || index);
  if (key === 'licensedApps' || key === 'onboardedAppLicenses') {
    return documentId(value?.id || value?.appId || `${value?.appName || 'app'}-${index}`);
  }
  if (key === 'deploymentPolicyRecords') {
    return documentId(
      [value?.target_pc, value?.type, value?.parent_app, value?.app_name]
        .map((part) => String(part || '').trim().toLowerCase())
        .join('::')
    );
  }
  return documentId(index);
}

function getClientId(req) {
  const value = String(req.get('x-client-id') || 'default').trim();
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 120) || 'default';
}

async function readRecords(key, collection) {
  const documents = await collection.find({}).sort({ order: 1, _id: 1 }).toArray();
  if (key === 'costOverrides') {
    return Object.fromEntries(documents.map(({ _id, override_key, value }) => [override_key || decodeURIComponent(_id), value]));
  }
  if (key === 'completedEvaluationDecisions') {
    return Object.fromEntries(documents.map(({ _id, decision_key, device_id, app_type, app_name, evaluation_started_date, evaluation_started_time, completed_date, completed_time, time_zone, source_client_id, created_at, updated_at, order, ...decision }) => [decision_key || decodeURIComponent(_id), {
      ...(decision.value ?? decision),
      completedAt: localDateTimeToMilliseconds(completed_date, completed_time),
    }]));
  }
  return documents.map(({ _id, order, source_client_id, created_at, updated_at, ...record }) => record);
}

async function replaceRecords(key, collection, data, updatedAt, clientId) {
  const entries = Array.isArray(data) ? data : Object.entries(data || {});
  const ids = [];
  const operations = entries.map((entry, index) => {
    const isMap = !Array.isArray(data);
    const mapKey = isMap ? entry[0] : null;
    const value = isMap ? entry[1] : entry;
    const _id = isMap ? documentId(mapKey) : recordId(key, value, index);
    ids.push(_id);
    let storedValue;
    if (key === 'completedEvaluationDecisions') {
      const [deviceId, appType, appName, evaluationStartedAt] = String(mapKey).split('::');
      const { completedAt, ...decision } = value || {};
      storedValue = {
        ...decision,
        decision_key: mapKey,
        device_id: deviceId || 'unknown',
        app_type: appType || 'unknown',
        app_name: appName || 'unknown',
        ...dateTimeFields(Number(evaluationStartedAt), 'evaluation_started'),
        ...dateTimeFields(completedAt, 'completed'),
        source_client_id: clientId,
        updated_at: updatedAt,
      };
    } else if (key === 'costOverrides') {
      storedValue = { override_key: mapKey, value, source_client_id: clientId, updated_at: updatedAt };
    } else {
      storedValue = { ...value, order: index, source_client_id: clientId, updated_at: updatedAt };
    }
    return {
      updateOne: {
        filter: { _id },
        update: {
          $set: storedValue,
          $setOnInsert: { created_at: updatedAt },
          ...(key === 'completedEvaluationDecisions' ? { $unset: { value: '' } } : {}),
        },
        upsert: true,
      },
    };
  });
  if (operations.length) await collection.bulkWrite(operations);
  await collection.deleteMany({ source_client_id: clientId, ...(ids.length ? { _id: { $nin: ids } } : {}) });
}

async function readSingleton(collection, clientId) {
  const document = (await collection.findOne({ _id: clientId })) || (clientId !== 'default' ? await collection.findOne({ _id: 'default' }) : null) || {};
  const { _id, client_id, updated_at, ...data } = document;
  return data;
}

async function saveSingleton(collection, data, updatedAt, clientId) {
  await collection.updateOne(
    { _id: clientId },
    { $set: { ...data, client_id: clientId, updated_at: updatedAt } },
    { upsert: true }
  );
}

app.get('/api/state', async (req, res) => {
  try {
    const clientId = getClientId(req);
    const [recordValues, reports, agentConfig, settings] = await Promise.all([
      Promise.all(
        Object.entries(recordCollections).map(async ([key, collection]) => [
          key,
          await readRecords(key, collection),
        ])
      ),
      readSingleton(reportSettings, clientId),
      readSingleton(agentConfigurations, clientId),
      readSingleton(appSettings, clientId),
    ]);
    const state = {};
    recordValues.forEach(([key, value]) => {
      if (value !== undefined) state[key] = value;
    });
    if (reports) Object.assign(state, reports);
    if (agentConfig) Object.assign(state, agentConfig);
    if (settings) Object.assign(state, settings);
    return res.json(state);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load portal state' });
  }
});

app.put('/api/state', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'State must be a JSON object' });
  }
  try {
    const clientId = getClientId(req);
    const updatedAt = new Date();
    const writes = Object.entries(recordCollections).map(([key, collection]) =>
      replaceRecords(key, collection, req.body[key] ?? recordDefaults[key], updatedAt, clientId)
    );
    writes.push(
      saveSingleton(
        reportSettings,
        {
          selectedReportTemplateId: req.body.selectedReportTemplateId,
          selectedReportDimensions: req.body.selectedReportDimensions || [],
          selectedReportMetrics: req.body.selectedReportMetrics || [],
          reportFrequency: req.body.reportFrequency,
          deliveryChannel: req.body.deliveryChannel,
          historicalRange: req.body.historicalRange,
        },
        updatedAt,
        clientId
      ),
      saveSingleton(
        agentConfigurations,
        {
          config: req.body.config || null,
          lastDeploymentConfig: req.body.lastDeploymentConfig || null,
        },
        updatedAt,
        clientId
      ),
      saveSingleton(
        appSettings,
        {
          emailSummaryWindowKey: req.body.emailSummaryWindowKey || null,
          sendEvaluationEmailEnabled: req.body.sendEvaluationEmailEnabled !== false,
        },
        updatedAt,
        clientId
      )
    );
    await Promise.all(writes);
    return res.json({ message: 'State saved' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to save portal state' });
  }
});

app.get('/api/agent-configurations', async (req, res) => {
  try {
    return res.json((await readSingleton(agentConfigurations, getClientId(req))) || {});
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load agent configurations' });
  }
});

app.get('/api/telemetry', async (_req, res) => {
  try {
    const rows = await telemetryEvents
      .find({}, { projection: { _id: 0, received_at: 0, device_key: 0 } })
      .sort({ received_at: 1 })
      .toArray();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to load telemetry' });
  }
});

app.post('/api/assistant/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const latestQuestion = [...messages]
    .reverse()
    .find((message) => message?.role === 'user' && typeof message?.content === 'string')
    ?.content.trim()
    .slice(0, 2000);
  if (!latestQuestion) {
    return res.status(400).json({ error: 'A user message is required' });
  }

  try {
    const result = await answerAssistantQuestion(latestQuestion);
    return res.json({ ...result, source: 'database' });
  } catch (error) {
    console.error('Assistant request failed:', error.message);
    return res.status(500).json({ error: 'Unable to analyze license data right now' });
  }
});

app.post('/api/telemetry', async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || !payload.timestamp) {
    return res.status(400).json({ error: 'Telemetry must include a timestamp' });
  }
  const deviceId = String(payload.device_id || payload.device_name || 'unknown');
  try {
    await telemetryEvents.updateOne(
      { device_key: deviceId, timestamp: payload.timestamp },
      {
        $setOnInsert: {
          ...payload,
          ...dateTimeFields(payload.timestamp, 'recorded'),
          device_key: deviceId,
          received_at: new Date(),
        },
      },
      { upsert: true }
    );
    return res.status(201).json({ message: 'Telemetry saved' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to save telemetry' });
  }
});

app.post('/send-email-summary', async (req, res) => {
  const { recipient = recipientEmail, subject, body, html } = req.body || {};

  if (!subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: subject and body' });
  }

  try {
    const messageBody = {
      Text: {
        Data: body,
        Charset: 'UTF-8',
      },
    };

    if (html) {
      messageBody.Html = {
        Data: html,
        Charset: 'UTF-8',
      };
    }

    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: [recipient],
      },
      Message: {
        Body: messageBody,
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
      },
      Source: senderEmail,
    });

    await sesClient.send(command);
    return res.json({ message: 'Email sent', recipient });
  } catch (error) {
    console.error('SES send error:', error);
    return res.status(500).json({ error: error.message || 'SES send failed' });
  }
});

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  await mongoClient.connect();
  const collectionNames = [
    ...Object.values(recordCollections).map((collection) => collection.collectionName),
    reportSettings.collectionName,
    agentConfigurations.collectionName,
    appSettings.collectionName,
    telemetryEvents.collectionName,
  ];
  const existingNames = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name)
  );
  await Promise.all(
    collectionNames
      .filter((name) => !existingNames.has(name))
      .map((name) => database.createCollection(name))
  );
  await Promise.all([
    recordCollections.licensePolicies.createIndex({ name: 1 }, { unique: true }),
    recordCollections.licensedApps.createIndex({ id: 1 }, { unique: true, sparse: true }),
    recordCollections.onboardedAppLicenses.createIndex({ id: 1 }, { unique: true, sparse: true }),
    recordCollections.deploymentPolicyRecords.createIndex(
      { target_pc: 1, type: 1, parent_app: 1, app_name: 1 },
      { unique: true }
    ),
    recordCollections.completedEvaluationDecisions.createIndex(
      { device_id: 1, evaluation_started_date: -1, evaluation_started_time: -1, app_name: 1 }
    ),
    agentConfigurations.createIndex({ client_id: 1 }, { sparse: true }),
    reportSettings.createIndex({ client_id: 1 }, { sparse: true }),
    appSettings.createIndex({ client_id: 1 }, { sparse: true }),
  ]);
  await telemetryEvents.createIndex({ device_key: 1, timestamp: 1 }, { unique: true });
  await telemetryEvents.createIndex({ received_at: 1 });
  app.listen(PORT, () => {
    console.log(`Backend server is running at http://localhost:${PORT}`);
    console.log(`MongoDB database: ${database.databaseName}`);
    console.log(`Sending email summaries to ${recipientEmail} from ${senderEmail}`);
  });
}

startServer().catch((error) => {
  console.error('Unable to start backend:', error);
  process.exit(1);
});
