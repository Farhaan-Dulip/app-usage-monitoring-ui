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
import {
  LicenseRequestError,
  chooseRequestDevice,
  deviceNamedIn,
  findAwaitingDeviceRequest,
  onboardedAppNames,
  submitLicenseRequest,
} from './services/licenseRequests.js';
import { DeviceRegistryError, devicesForEmail, listDevices, setDeviceOwner } from './services/deviceRegistry.js';
import { queueLicenseGrant } from './services/licenseGrants.js';
import { aiToolsForUser, clearAiToolsCache, getAiToolsOverview } from './services/aiTools/index.js';
import { credentialEnv } from './services/aiTools/credentials.js';
import { createIntegrationsRouter } from './services/aiTools/integrations.js';
import { buildDashboard, licenseAppList } from './services/reports/dashboards.js';
import { clearLicenseCache } from './services/reports/licenseConnectors.js';
import { buildPlatformDashboard, ContractError, deleteContract, platformOverview, saveContract, savedContracts } from './services/platforms/index.js';
import { buildTrackerReport } from './services/reports/trackerReport.js';
import { authConfig, createAuthRouter, requireSession } from './services/portalAuth.js';
import {
  PeopleError,
  buildPeopleReport,
  getBudgets,
  importDirectory,
  parseDirectoryCsv,
  setBudget,
} from './services/aiTools/people.js';

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
const devices = database.collection('devices');
// AI Tools people view: imported directory (employee ID, manager) and budgets.
const peopleDirectory = database.collection('ai_people_directory');
// Vendor admin credentials connected from the portal (encrypted).
const integrationCredentials = database.collection('integration_credentials');
const aiToolBudgets = database.collection('ai_tool_budgets');
// Enterprise Infrastructure Platform contracts edited in the portal.
const platformContracts = database.collection('platform_contracts');
// Approved licenses waiting to be pushed to Trackers (published by the worker).
const deviceConfigOutbox = database.collection('device_config_outbox');
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
// Single-server deployment: the portal is published directly (CloudFront origin),
// so require CloudFront's secret origin header. In-network callers (the AI agent)
// authenticate with the service token instead. Disabled when unset.
const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET?.trim();
if (originVerifySecret) {
  app.use((req, res, next) => {
    if (serviceTokenMatches(req.get('X-Origin-Verify'), originVerifySecret)) return next();
    if (mcpServiceToken && serviceTokenMatches(req.get(SERVICE_TOKEN_HEADER), mcpServiceToken)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  });
}

// Portal sign-in (Microsoft Entra ID and/or a POC access code). Trackers posting
// telemetry over HTTP have no session, so that route stays open.
const portalAuth = authConfig(process.env);
const sessionGuard = requireSession({
  config: portalAuth,
  serviceToken: mcpServiceToken,
  serviceHeader: SERVICE_TOKEN_HEADER,
  isPublic: (req) => req.method === 'POST' && req.path === '/telemetry',
});
app.use('/api/auth', createAuthRouter({ express, config: portalAuth }));
app.use('/api', sessionGuard);
app.use('/send-email-summary', sessionGuard);

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

// The requester profile and chat session go with the conversation so the agent
// can raise a request for this person; the model never chooses who it is for.
async function answerWithMonitoringAgent(messages, requester, clientId) {
  if (!mcpServiceToken) throw new Error('MCP_SERVICE_TOKEN is not configured');
  const response = await fetch(assistantAgentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [SERVICE_TOKEN_HEADER]: mcpServiceToken },
    body: JSON.stringify({
      messages,
      requester: { name: String(requester?.name || '').trim(), email: String(requester?.email || '').trim() },
      clientId: clientId || '',
    }),
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

  const requesterDevices = await devicesForEmail(devices, requester?.email);
  let result;
  try {
    result = await submitLicenseRequest(assistantRequests, licenses, {
      requestedApp,
      requesterName: requester?.name,
      requesterEmail: requester?.email,
      requestText: question,
      clientId: clientId || 'unknown-session',
      source: 'chat',
      requesterDevices,
      // "I need access to Postman on AT-NB-01"
      targetDevice: deviceNamedIn(question, requesterDevices)?.pcName,
    });
  } catch (error) {
    if (error instanceof LicenseRequestError && error.details?.code === 'device_choice_required') {
      return { deviceChoice: true, requestedApp, devices: error.details.devices, message: error.message };
    }
    throw error;
  }
  const { request, duplicate } = result;
  return {
    id: request._id.toString(),
    requestedApp: request.requestedApp,
    approvingManagerName: request.approvingManagerName,
    status: request.status,
    targetDevice: request.targetDevice || null,
    duplicate,
  };
}

function workflowAnswer(workflow) {
  if (workflow.duplicate) {
    return `You already have a ${workflow.requestedApp} license request waiting for ${workflow.approvingManagerName} to approve. No new request was raised.`;
  }
  const device = workflow.targetDevice
    ? ` for ${workflow.targetDevice.pcName}`
    : ' (no device is registered to your email yet, so the device is to be confirmed)';
  return `Your ${workflow.requestedApp} license request${device} has been sent to ${workflow.approvingManagerName} (app owner) for approval. No license has been assigned yet.`;
}

function deviceChoiceAnswer(choice) {
  const names = choice.devices.map((device) => device.pcName);
  return `You have ${names.length} devices: ${names.join(', ')}. Which PC should the ${choice.requestedApp} license go on? ` +
    `Reply with, for example, "I need access to ${choice.requestedApp} on ${names[0]}".`;
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
    source: request.source || 'chat',
    targetDevice: request.targetDevice || null,
    candidateDevices: request.candidateDevices || [],
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
    if (workflow?.deviceChoice) {
      return res.json({ answer: deviceChoiceAnswer(workflow), recordsReviewed: 0, source: 'workflow', deviceChoice: workflow });
    }
    if (workflow) {
      return res.status(workflow.duplicate ? 200 : 201).json({
        answer: workflowAnswer(workflow),
        recordsReviewed: 0,
        source: 'workflow',
        workflow,
      });
    }
    try {
      return res.json(await answerWithMonitoringAgent(messages, req.body?.requester, req.get('X-Client-Id')));
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
    let configPush = null;
    if (action === 'approve') {
      // The decision stands even if the push cannot be queued; the owner can deploy manually.
      try {
        const licenses = await recordCollections.onboardedAppLicenses.find({}).limit(500).toArray();
        configPush = await queueLicenseGrant({
          outbox: deviceConfigOutbox,
          deploymentRecords: recordCollections.deploymentPolicyRecords,
          request: updatedRequest,
          licenses,
          now,
        });
      } catch (error) {
        console.error('Queueing the license config push failed:', error.message);
        configPush = { queued: false, reason: 'error' };
      }
    }
    return res.json({ request: serializeLicenseRequest(updatedRequest), configPush });
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

// AI agent (email intake and chat): the onboarded apps a request may name, and
// raising the request itself, routed to the app owner.
app.get('/api/mcp/onboarded-apps', requireMcpService, async (_req, res) => {
  try {
    const licenses = await recordCollections.onboardedAppLicenses.find({}).limit(500).toArray();
    return res.json({ apps: onboardedAppNames(licenses) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load onboarded apps' });
  }
});

app.post('/api/mcp/license-requests', requireMcpService, async (req, res) => {
  try {
    const licenses = await recordCollections.onboardedAppLicenses.find({}).limit(500).toArray();
    const { request, duplicate } = await submitLicenseRequest(assistantRequests, licenses, {
      requestedApp: req.body?.requestedApp,
      requesterName: req.body?.requesterName,
      requesterEmail: req.body?.requesterEmail,
      requestText: req.body?.reason,
      sourceMessageId: req.body?.sourceMessageId,
      sourceConversationId: req.body?.sourceConversationId,
      source: req.body?.source === 'chat' ? 'chat' : 'email',
      clientId: typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 200) : undefined,
      requesterDevices: await devicesForEmail(devices, req.body?.requesterEmail),
      targetDevice: req.body?.targetDevice,
      awaitDeviceChoice: req.body?.awaitDeviceChoice === true,
    });
    return res.status(duplicate ? 200 : 201).json({ request: serializeLicenseRequest(request), duplicate });
  } catch (error) {
    if (error instanceof LicenseRequestError) {
      return res.status(error.statusCode).json({ error: error.message, ...error.details });
    }
    console.error('Agent license request failed:', error.message);
    return res.status(500).json({ error: 'Unable to create license request' });
  }
});

// Email thread waiting for the requester to name a PC (several devices on record).
app.get('/api/mcp/license-requests/awaiting-device', requireMcpService, async (req, res) => {
  try {
    const request = await findAwaitingDeviceRequest(assistantRequests, req.query.conversationId, req.query.requesterEmail);
    return res.json({ request: request ? serializeLicenseRequest(request) : null });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load the awaiting request' });
  }
});

app.post('/api/mcp/license-requests/:requestId/device', requireMcpService, async (req, res) => {
  if (!ObjectId.isValid(req.params.requestId)) return res.status(400).json({ error: 'Invalid request ID' });
  try {
    const request = await assistantRequests.findOne({ _id: new ObjectId(req.params.requestId) });
    const requesterEmail = String(req.body?.requesterEmail || '').trim().toLowerCase();
    if (!request || request.requesterEmail !== requesterEmail) return res.status(404).json({ error: 'Request not found' });
    const updated = await chooseRequestDevice(assistantRequests, request, req.body?.targetDevice);
    return res.json({ request: serializeLicenseRequest(updated) });
  } catch (error) {
    if (error instanceof LicenseRequestError) {
      return res.status(error.statusCode).json({ error: error.message, ...error.details });
    }
    console.error('Device choice failed:', error.message);
    return res.status(500).json({ error: 'Unable to update the request' });
  }
});

// AI tools (Claude, Codex, Copilot): live from each vendor's admin API when its
// credential is configured, otherwise sample data in the documented formats.
// Connectors read deployment values (env) overlaid with portal-connected ones.
async function aiToolsEnv() {
  return (await credentialEnv(integrationCredentials, process.env.CREDENTIALS_KEY, process.env)).env;
}

app.use('/api/integrations', createIntegrationsRouter({
  express,
  collection: integrationCredentials,
  onChange: () => {
    clearAiToolsCache();
    clearLicenseCache();
  },
}));

// Sample data also covers the real device owners, so tracker pages show how
// each person's data will look before live credentials are connected.
async function deviceOwnerIdentities() {
  const owners = new Map();
  for (const device of await listDevices(devices)) {
    if (device.ownerEmail) owners.set(device.ownerEmail, { name: device.ownerEmail, email: device.ownerEmail });
  }
  return [...owners.values()];
}

app.get('/api/ai-tools/overview', async (req, res) => {
  try {
    return res.json(await getAiToolsOverview({
      env: await aiToolsEnv(),
      refresh: req.query.refresh === '1',
      sampleIdentities: await deviceOwnerIdentities(),
    }));
  } catch (error) {
    console.error('AI tools overview failed:', error.message);
    return res.status(500).json({ error: 'Unable to load AI tool data' });
  }
});

// Per-person budgets vs month-to-date spend, with directory data and a
// manager roll-up.
async function peopleReport(refresh = false) {
  const overview = await getAiToolsOverview({ env: await aiToolsEnv(), refresh, sampleIdentities: await deviceOwnerIdentities() });
  const [directoryRows, budgets] = await Promise.all([
    peopleDirectory.find({}).limit(20000).toArray(),
    getBudgets(aiToolBudgets),
  ]);
  return buildPeopleReport(overview, directoryRows, budgets);
}

app.get('/api/ai-tools/people', async (req, res) => {
  try {
    return res.json(await peopleReport(req.query.refresh === '1'));
  } catch (error) {
    console.error('AI tools people report failed:', error.message);
    return res.status(500).json({ error: 'Unable to load the people report' });
  }
});

// { vendor, email ('*' = default), monthlyBudget (null removes an override) }
app.put('/api/ai-tools/budgets', async (req, res) => {
  try {
    await setBudget(aiToolBudgets, req.body || {});
    return res.json({ budgets: await getBudgets(aiToolBudgets) });
  } catch (error) {
    if (error instanceof PeopleError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to save the budget' });
  }
});

// CSV export from HR or Entra ID: Email plus any of Name, Employee ID,
// Manager's Name, Manager Email, Department. Rows are upserted by email.
app.post('/api/ai-tools/directory', express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), async (req, res) => {
  try {
    const { people, rejectedRows } = parseDirectoryCsv(typeof req.body === 'string' ? req.body : '');
    const imported = await importDirectory(peopleDirectory, people);
    return res.json({ imported, rejectedRows });
  } catch (error) {
    if (error instanceof PeopleError) return res.status(error.statusCode).json({ error: error.message });
    console.error('Directory import failed:', error.message);
    return res.status(500).json({ error: 'Unable to import the directory' });
  }
});

// Reports & Insights. Telemetry for the last 30 days is read at most once a
// minute (the dashboards share it).
let recentTelemetryCache = { at: 0, events: [] };
async function recentTelemetry() {
  if (Date.now() - recentTelemetryCache.at < 60 * 1000) return recentTelemetryCache.events;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const events = await telemetryEvents
    .find({ received_at: { $gte: since } }, { projection: { device_key: 1, device_id: 1, device_name: 1, user_upn: 1, timestamp: 1, received_at: 1, recorded_date: 1, usage: 1 } })
    .limit(100000)
    .toArray();
  recentTelemetryCache = { at: Date.now(), events };
  return events;
}

app.get('/api/reports/apps', async (_req, res) => {
  try {
    const overview = await getAiToolsOverview({ env: await aiToolsEnv(), sampleIdentities: await deviceOwnerIdentities() });
    return res.json({ apps: licenseAppList(overview, await aiToolsEnv()) });
  } catch (error) {
    console.error('Report app list failed:', error.message);
    return res.status(500).json({ error: 'Unable to load apps' });
  }
});

app.get('/api/reports/apps/:appId', async (req, res) => {
  try {
    const identities = await deviceOwnerIdentities();
    const env = await aiToolsEnv();
    const [overview, events] = await Promise.all([
      getAiToolsOverview({ env, sampleIdentities: identities }),
      recentTelemetry(),
    ]);
    const dashboard = await buildDashboard(req.params.appId, { overview, events, identities, env, refresh: req.query.refresh === '1' });
    if (!dashboard) return res.status(404).json({ error: 'Unknown app' });
    return res.json(dashboard);
  } catch (error) {
    console.error('App dashboard failed:', error.message);
    return res.status(500).json({ error: 'Unable to build the dashboard' });
  }
});

// Reports & Insights > Enterprise Infrastructure Platform (phase 1, read-only).
app.get('/api/platforms', async (_req, res) => {
  try {
    return res.json(platformOverview({ saved: await savedContracts(platformContracts) }));
  } catch (error) {
    console.error('Platform overview failed:', error.message);
    return res.status(500).json({ error: 'Unable to load platforms' });
  }
});

app.get('/api/platforms/:platformId', async (req, res) => {
  try {
    const dashboard = buildPlatformDashboard(req.params.platformId, { saved: await savedContracts(platformContracts) });
    if (!dashboard) return res.status(404).json({ error: 'Unknown platform' });
    return res.json(dashboard);
  } catch (error) {
    console.error('Platform dashboard failed:', error.message);
    return res.status(500).json({ error: 'Unable to build the platform dashboard' });
  }
});

app.put('/api/platforms/:platformId/contract', async (req, res) => {
  try {
    const contract = await saveContract(platformContracts, req.params.platformId, req.body || {});
    return res.json({ contract });
  } catch (error) {
    if (error instanceof ContractError) return res.status(400).json({ error: error.message });
    console.error('Saving a platform contract failed:', error.message);
    return res.status(500).json({ error: 'Unable to save the contract' });
  }
});

app.delete('/api/platforms/:platformId/contract', async (req, res) => {
  try {
    await deleteContract(platformContracts, req.params.platformId);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Removing a platform contract failed:', error.message);
    return res.status(500).json({ error: 'Unable to remove the contract' });
  }
});

app.get('/api/reports/tracker-usage', async (_req, res) => {
  try {
    const [events, deviceList] = await Promise.all([recentTelemetry(), listDevices(devices)]);
    return res.json(buildTrackerReport(events, deviceList));
  } catch (error) {
    console.error('Tracker usage report failed:', error.message);
    return res.status(500).json({ error: 'Unable to build the tracker report' });
  }
});

// One person's AI tool activity (tracker detail page).
app.get('/api/ai-tools/user', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const report = await peopleReport();
    const person = report.people.find((row) => row.email === email) || null;
    const overview = await getAiToolsOverview({ env: await aiToolsEnv(), sampleIdentities: await deviceOwnerIdentities() });
    return res.json({ email, person, vendors: aiToolsForUser(overview, email) });
  } catch (error) {
    console.error('AI tools user lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load AI tool data' });
  }
});

// Device register (portal): each device's owner, linked from the Tracker's
// signed-in work account; an admin can override it.
app.get('/api/devices', async (_req, res) => {
  try {
    return res.json({ devices: await listDevices(devices) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load devices' });
  }
});

app.patch('/api/devices/:deviceId', async (req, res) => {
  try {
    return res.json({ device: await setDeviceOwner(devices, req.params.deviceId, req.body?.ownerEmail) });
  } catch (error) {
    if (error instanceof DeviceRegistryError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to update the device owner' });
  }
});

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
    await persistTelemetry(telemetryEvents, payload, 'http', { devices });
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
    devices.collectionName,
    deviceConfigOutbox.collectionName,
    peopleDirectory.collectionName,
    aiToolBudgets.collectionName,
    integrationCredentials.collectionName,
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
    assistantRequests.createIndex({ sourceMessageId: 1 }, { unique: true, sparse: true }),
    devices.createIndex({ deviceId: 1 }, { unique: true }),
    deviceConfigOutbox.createIndex({ grantId: 1 }, { unique: true }),
    deviceConfigOutbox.createIndex({ status: 1, createdAt: 1 }),
    peopleDirectory.createIndex({ email: 1 }, { unique: true }),
    aiToolBudgets.createIndex({ vendor: 1, email: 1 }, { unique: true }),
    integrationCredentials.createIndex({ vendor: 1 }, { unique: true }),
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
