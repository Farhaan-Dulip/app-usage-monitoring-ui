import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ObjectId } from 'mongodb';
import { createDatabase } from './services/database.js';
import {
  ensureTelemetryIndexes,
  persistTelemetry,
  validateTelemetryPayload,
} from './services/telemetryPersistence.js';
import {
  appAliasFilter,
  buildAppAliases,
  isExplicitLicenseRequest,
} from './services/assistantMatching.js';
import { SERVICE_TOKEN_HEADER, serviceTokenMatches } from './services/serviceAuth.js';

dotenv.config();

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header include server-to-server calls and local health checks.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  })
);
app.use(express.json());
// API responses are per-user state; never let a CDN (CloudFront, Amplify) cache them.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Optional local-development fallback; deployed environments use env vars only.
const configPath = resolve(process.cwd(), 'src', 'app_config.json');
let appConfig = {};

if (existsSync(configPath)) {
  try {
    appConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.error('Unable to read src/app_config.json:', error.message);
    process.exit(1);
  }
}

// SES_RECIPIENT_EMAIL may list several comma-separated addresses; the first is
// the default and only listed addresses can receive summaries.
const allowedRecipientEmails = String(process.env.SES_RECIPIENT_EMAIL || appConfig?.email || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const recipientEmail = allowedRecipientEmails[0];
const senderEmail = process.env.SES_SOURCE_EMAIL || appConfig?.ses_source_email;
const awsRegion = process.env.AWS_REGION || appConfig?.aws_region;
const sesClient = senderEmail && awsRegion ? new SESClient({ region: awsRegion }) : null;
// MongoDB (containers, local dev) or DynamoDB (DATA_STORE=dynamodb, serverless).
const { database, connect: connectDatabase } = await createDatabase(process.env);
const telemetryEvents = database.collection('telemetry_events');
const recordCollections = {
  licensePolicies: database.collection('license_policies'),
  licensedApps: database.collection('licensed_apps'),
  onboardedAppLicenses: database.collection('onboarded_licenses'),
  managerAssignments: database.collection('manager_assignments'),
  deploymentPolicyRecords: database.collection('deployment_records'),
  costOverrides: database.collection('cost_overrides'),
  completedEvaluationDecisions: database.collection('evaluation_decisions'),
};
const recordDefaults = {
  licensePolicies: [],
  licensedApps: [],
  onboardedAppLicenses: [],
  managerAssignments: [],
  deploymentPolicyRecords: [],
  costOverrides: {},
  completedEvaluationDecisions: {},
};
const reportSettings = database.collection('report_settings');
const agentConfigurations = database.collection('agent_configurations');
const appSettings = database.collection('app_settings');
const assistantRequests = database.collection('assistant_requests');
const applicationTimeZone = process.env.APP_TIME_ZONE || 'Asia/Colombo';
const assistantAgentUrl =
  process.env.ASSISTANT_AGENT_URL || 'http://localhost:3002/api/assistant/chat';
// Kept above the agent's own deadline so the agent can finish or fail cleanly.
const assistantAgentTimeoutMs = Number(process.env.ASSISTANT_AGENT_TIMEOUT_MS) || 25000;
// Shared secret for both directions: portal -> agent chat, agent -> portal MCP tools.
const mcpServiceToken = process.env.MCP_SERVICE_TOKEN?.trim();

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

function assistantNumber(record, keys) {
  const key = keys.find((candidate) => record?.[candidate] !== undefined);
  return key ? Number(record[key] || 0) : 0;
}

function requireMcpService(req, res, next) {
  if (!mcpServiceToken) {
    return res.status(503).json({ error: 'MCP service authentication is not configured' });
  }
  if (!serviceTokenMatches(req.get(SERVICE_TOKEN_HEADER), mcpServiceToken)) {
    return res.status(401).json({ error: 'Unauthorized MCP service request' });
  }
  return next();
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

async function answerWithMonitoringAgent(messages) {
  if (!mcpServiceToken) throw new Error('MCP_SERVICE_TOKEN is not configured');
  const response = await fetch(assistantAgentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [SERVICE_TOKEN_HEADER]: mcpServiceToken },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(assistantAgentTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Monitoring agent returned ${response.status}`);
  }
  if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new Error('Monitoring agent returned an invalid response');
  }
  return { ...payload, source: payload.source || 'openai-mcp' };
}

async function createAssistantRequest(question, clientId, requester) {
  const licenses = await recordCollections.onboardedAppLicenses.find({}).limit(500).toArray();
  const requestedApp = findRequestedApp(question, licenses);
  if (!isExplicitLicenseRequest(question) || !requestedApp) return null;

  const requesterName = String(requester?.name || '').trim();
  const requesterEmail = String(requester?.email || '').trim().toLowerCase();
  if (!requesterName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
    const error = new Error('Add your name and work email before submitting a license request.');
    error.statusCode = 400;
    throw error;
  }

  const requestedLicense = licenses.find(
    (license) => String(assistantAppName(license)).toLowerCase() === requestedApp.toLowerCase()
  );
  const approvingManagerName = String(requestedLicense?.owner || '').trim();
  const approvingManagerEmail = String(requestedLicense?.ownerEmail || '').trim().toLowerCase();
  if (!approvingManagerName || !approvingManagerEmail) {
    const error = new Error(`No app owner is configured for ${requestedApp}. Update the onboarded license first.`);
    error.statusCode = 409;
    throw error;
  }

  const now = new Date();
  const request = {
    clientId: clientId || 'unknown-session',
    requesterName,
    requesterEmail,
    requestedApp,
    approvingManagerName,
    approvingManagerEmail,
    requestText: question,
    status: 'pending_approval',
    requestedFor: 'self',
    createdAt: now,
    updatedAt: now,
  };
  const result = await assistantRequests.insertOne(request);
  return {
    id: result.insertedId.toString(),
    requestedApp,
    approvingManagerName,
    status: request.status,
  };
}

function serializeLicenseRequest(request) {
  return {
    id: request._id.toString(),
    requesterName: request.requesterName || 'Unknown requester',
    requesterEmail: request.requesterEmail || '',
    approvingManagerName: request.approvingManagerName || 'Unassigned',
    approvingManagerEmail: request.approvingManagerEmail || '',
    requestedApp: request.requestedApp,
    reason: request.requestText,
    status: request.status,
    declineReason: request.declineReason || '',
    createdAt: request.createdAt,
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
  if (key === 'managerAssignments') {
    return documentId(value?.requesterEmail || value?.requesterId || value?.requesterName || index);
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

// ?since=<ISO received_at> returns only samples received after that instant, so
// pollers fetch increments instead of the full history every time.
app.get('/api/telemetry', async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  if (since && Number.isNaN(since.getTime())) {
    return res.status(400).json({ error: 'since must be an ISO date/time' });
  }
  try {
    const rows = await telemetryEvents
      .find(since ? { received_at: { $gt: since } } : {}, { projection: { _id: 0, device_key: 0 } })
      .sort({ received_at: 1 })
      .toArray();
    return res.json(rows.map(({ received_at: receivedAt, ...row }) => ({
      ...row,
      received_at: receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt,
    })));
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
    const workflow = await createAssistantRequest(
      latestQuestion,
      req.get('X-Client-Id'),
      req.body?.requester
    );
    if (workflow) {
      return res.status(201).json({
        answer: `Your ${workflow.requestedApp} license request has been submitted for approval. No license has been assigned yet.`,
        recordsReviewed: 0,
        source: 'workflow',
        workflow,
      });
    }
    try {
      return res.json(await answerWithMonitoringAgent(messages));
    } catch (agentError) {
      console.error('Monitoring agent unavailable; using database fallback:', agentError.message);
      const result = await answerAssistantQuestion(latestQuestion);
      return res.json({ ...result, source: 'monitoring-agent-fallback' });
    }
  } catch (error) {
    console.error('Assistant request failed:', error.message);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Unable to analyze license data right now',
    });
  }
});

app.get('/api/assistant/requests', async (req, res) => {
  const clientId = req.get('X-Client-Id');
  if (!clientId) return res.status(400).json({ error: 'X-Client-Id is required' });

  try {
    const requests = await assistantRequests
      .find({ clientId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    return res.json({ requests: requests.map(serializeLicenseRequest) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load assistant requests' });
  }
});

app.get('/api/license-requests', async (_req, res) => {
  try {
    const requests = await assistantRequests.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    return res.json({ requests: requests.map(serializeLicenseRequest) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load license requests' });
  }
});

app.patch('/api/license-requests/:requestId', async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();
  const declineReason = String(req.body?.declineReason || '').trim();
  if (!['approve', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve or decline' });
  }
  if (action === 'decline' && !declineReason) {
    return res.status(400).json({ error: 'A decline reason is required' });
  }
  if (!ObjectId.isValid(req.params.requestId)) {
    return res.status(400).json({ error: 'Invalid request ID' });
  }

  try {
    const now = new Date();
    const result = await assistantRequests.findOneAndUpdate(
      { _id: new ObjectId(req.params.requestId), status: 'pending_approval' },
      {
        $set: {
          status: action === 'approve' ? 'approved' : 'declined',
          declineReason: action === 'decline' ? declineReason : null,
          decidedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );
    const updatedRequest = result?.value || result;
    if (!updatedRequest) return res.status(409).json({ error: 'This request is no longer awaiting approval' });
    return res.json({ request: serializeLicenseRequest(updatedRequest) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update license request' });
  }
});

// Read-only endpoints backing the AI agent's MCP tools (service-token only;
// blocked at the load balancer). App names resolve through inventory aliases
// so `Postman`, `postman` and `postman.exe` all match, and filtering happens
// in MongoDB rather than over a capped in-memory sample.
const MCP_RECORD_LIMIT = 5000;

async function resolveAppAliases(appName) {
  const [inventory, licenses] = await Promise.all([
    recordCollections.licensedApps.find({}, { projection: { appName: 1, processName: 1 } }).toArray(),
    recordCollections.onboardedAppLicenses.find({}, { projection: { appName: 1, processName: 1 } }).toArray(),
  ]);
  return buildAppAliases(appName, [...inventory, ...licenses]);
}

function requiredAppName(req, res) {
  const appName = String(req.query.appName || '').trim().slice(0, 120);
  if (!appName) res.status(400).json({ error: 'appName is required' });
  return appName;
}

app.get('/api/mcp/license-availability', requireMcpService, async (req, res) => {
  const appName = requiredAppName(req, res);
  if (!appName) return undefined;
  try {
    const filter = appAliasFilter(await resolveAppAliases(appName));
    const [appLicenses, appDecisions] = await Promise.all([
      recordCollections.onboardedAppLicenses.find(filter).limit(MCP_RECORD_LIMIT).toArray(),
      recordCollections.completedEvaluationDecisions.find(filter).limit(MCP_RECORD_LIMIT).toArray(),
    ]);
    const totalSeats = appLicenses.reduce((sum, row) => sum + assistantNumber(row, ['totalSeats', 'total_seats', 'seats', 'quantity']), 0);
    const assignedSeats = appLicenses.reduce((sum, row) => sum + assistantNumber(row, ['assignedSeats', 'assigned_seats', 'usedSeats']), 0);
    const explicitAvailable = appLicenses.reduce((sum, row) => sum + assistantNumber(row, ['availableSeats', 'available_seats']), 0);
    const inventoryAvailable = explicitAvailable || Math.max(0, totalSeats - assignedSeats);
    const reclaimableDecisions = appDecisions.filter(isReclaimableDecision).length;
    return res.json({ application: appName, inventoryRecords: appLicenses.length, completedDecisions: appDecisions.length, totalSeats, assignedSeats, inventoryAvailable, reclaimableDecisions, potentiallyAvailable: Math.max(inventoryAvailable, reclaimableDecisions) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load license availability' });
  }
});

app.get('/api/mcp/reclaimable-summary', requireMcpService, async (_req, res) => {
  try {
    const decisions = await recordCollections.completedEvaluationDecisions.find({}).limit(MCP_RECORD_LIMIT).toArray();
    const reclaimable = decisions.filter(isReclaimableDecision);
    const byApplication = reclaimable.reduce((counts, row) => {
      const name = assistantAppName(row) || 'Unknown application';
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {});
    return res.json({ completedDecisionsReviewed: decisions.length, reclaimableDecisionCount: reclaimable.length, byApplication });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load reclaimable summary' });
  }
});

app.get('/api/mcp/decision-summary', requireMcpService, async (req, res) => {
  const appName = requiredAppName(req, res);
  if (!appName) return undefined;
  try {
    const filter = appAliasFilter(await resolveAppAliases(appName));
    const appDecisions = await recordCollections.completedEvaluationDecisions.find(filter).limit(MCP_RECORD_LIMIT).toArray();
    const categories = appDecisions.reduce((counts, row) => {
      const category = assistantDecisionText(row) || 'Unspecified';
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {});
    return res.json({ application: appName, completedDecisionCount: appDecisions.length, reclaimableDecisionCount: appDecisions.filter(isReclaimableDecision).length, categories });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load decision summary' });
  }
});

app.get('/api/mcp/reclaimable-details', requireMcpService, async (req, res) => {
  const appName = requiredAppName(req, res);
  if (!appName) return undefined;
  try {
    const filter = appAliasFilter(await resolveAppAliases(appName));
    const decisions = await recordCollections.completedEvaluationDecisions.find(filter).sort({ completed_date: -1, completed_time: -1 }).limit(MCP_RECORD_LIMIT).toArray();
    const details = decisions
      .filter(isReclaimableDecision)
      .slice(0, 50)
      .map((row) => ({ application: assistantAppName(row) || appName, pcName: row.pcName || row.pc_name || row.device_name || row.device_id || 'Not recorded', decision: assistantDecisionText(row) || 'Reclaimable', completedDate: row.completed_date || null, completedTime: row.completed_time || null, timeZone: row.time_zone || null }));
    return res.json({ application: appName, reclaimableDecisionCount: details.length, details, excludedFields: ['user identity', 'raw telemetry'] });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load reclaimable details' });
  }
});

app.post('/api/telemetry', async (req, res) => {
  const payload = req.body;
  try {
    validateTelemetryPayload(payload);
    await persistTelemetry(telemetryEvents, payload, 'http');
    return res.status(201).json({ message: 'Telemetry saved' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to save telemetry' });
  }
});

app.post('/send-email-summary', async (req, res) => {
  const { subject, body, html } = req.body || {};
  // Never trust a client-supplied address: only configured recipients are allowed.
  const requestedRecipient = String(req.body?.recipient || '').trim().toLowerCase();
  if (requestedRecipient && !allowedRecipientEmails.includes(requestedRecipient)) {
    return res.status(400).json({ error: 'Recipient is not an allowed summary address' });
  }
  const recipient = requestedRecipient || recipientEmail;

  if (!subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: subject and body' });
  }
  if (!sesClient || !senderEmail || !recipient) {
    return res.status(503).json({ error: 'Email summaries are not configured' });
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

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = Number(process.env.PORT) || 3000;
const distPath = resolve(process.cwd(), 'dist');

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(resolve(distPath, 'index.html')));
}

// Connects and prepares collections/indexes once (no-ops on DynamoDB).
export async function initialize() {
  await connectDatabase();
  const collectionNames = [
    ...Object.values(recordCollections).map((collection) => collection.collectionName),
    reportSettings.collectionName,
    agentConfigurations.collectionName,
    appSettings.collectionName,
    assistantRequests.collectionName,
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
    recordCollections.managerAssignments.createIndex({ requesterEmail: 1 }, { unique: true, sparse: true }),
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
    assistantRequests.createIndex({ clientId: 1, createdAt: -1 }),
  ]);
  await ensureTelemetryIndexes(telemetryEvents);
}

async function startServer() {
  await initialize();
  app.listen(PORT, () => {
    console.log(`Backend server is running at http://localhost:${PORT}`);
    console.log(`MongoDB database: ${database.databaseName}`);
    console.log(
      sesClient
        ? `Sending email summaries to ${recipientEmail} from ${senderEmail}`
        : 'Email summaries are disabled; configure SES_SOURCE_EMAIL and AWS_REGION to enable them.'
    );
  });
}

export { app };

// Listen only when run directly (`node server.js`); the Lambda handler imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error('Unable to start backend:', error);
    process.exit(1);
  });
}
