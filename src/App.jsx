import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatAssistant from './ChatAssistant';
import AppNavigation from './components/AppNavigation';
import AiToolsView, { UserAiTools } from './components/AiToolsView';
import AppCatalog from './components/AppCatalog';
import AppNamePicker from './components/AppNamePicker';
import ReportsInsights from './components/reports/ReportsInsights';
import { ChartGrid } from './components/reports/DashboardView';
import { LicenseCategoryTabs, PlatformLicenses } from './components/LicenseCategories';
import NetworkCanvas from './components/NetworkCanvas';
import CustomReportBuilder from './components/reports/CustomReportBuilder';
import AppInventoryIcon from './components/AppInventoryIcon';
import SettingsModal from './components/SettingsModal';
import RuntimeBreakdown from './components/RuntimeBreakdown';
import AppPlansModal from './components/AppPlansModal';
import { planSummary } from './utils/appPlans';
import {
  NEW_POLICY_RULE,
  TIME_UNITS,
  WINDOW_UNITS,
  buildRuleLicenses,
  draftToRule,
  inventoryRuleApps,
  migrateLicensePolicies,
  normalizeRule,
  appPolicies,
  policyId,
  policyNameError,
  ruleApps,
  savePolicy,
  selectedPolicy,
  ruleError,
  ruleToDraft,
  ruleToPolicy,
  vendorRuleFields,
} from './utils/appRules';
import InventoryAppPicker from './components/InventoryAppPicker';
import { sampleLicenseGroups } from './data/sampleLicenseGroups';
import LicenseOverview from './components/LicenseOverview';
import { buildProductRows, sampleProductRows } from './utils/licenseOverview';
import { appEngagementSeries } from './utils/appEngagement';
import {
  getPortalClientId,
} from './utils/clientPreferences';
import {
  DEFAULT_LICENSE_APP_FORM,
  DEFAULT_RECLAIM_POLICY,
  DEFAULT_USAGE_WINDOW_SECONDS,
  RECLAIMABLE_THRESHOLD_SECONDS,
  TOTAL_MONTHLY_SOFTWARE_SPEND,
} from './config/licenseDefaults';
import {
  reportDimensions,
  reportHistory,
  reportMetrics,
  reportTemplates,
} from './data/reportingData';
import appCostData from './app_costs.json';
import appConfig from './app_config.json';
import { deriveTrackerConfig } from './utils/trackerConfig';
import { PRODUCTS, findCatalogSurface, inventoryMatch, productSurfaces } from './data/appCatalog';
import {
  buildPortalReclaimPolicy,
  buildReclaimPolicy,
  getEvaluationWindowDays,
  getEvaluationWindowSeconds,
  getPolicyWindowSeconds,
} from '../services/reclaimPolicy.js';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const LICENSE_REQUEST_STATUS = {
  pending_approval: { label: 'Pending approval', className: 'status-observing' },
  awaiting_device: { label: 'Waiting for device choice', className: 'status-neutral' },
  approved: { label: 'Accepted', className: 'status-active' },
  declined: { label: 'Declined', className: 'status-reclaimable' },
  unknown: { label: 'Unknown', className: 'status-neutral' },
};
function getConfigKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function formatEvaluationWindow(policy) {
  const value = policy.evaluationWindowValue ?? policy.evaluationWindowDays ?? 30;
  const unit = policy.evaluationWindowUnit || 'Days';
  return `${value} ${unit.toLowerCase()}`;
}

function formatPolicyWindowValue(value, policy) {
  const unit = policy.evaluationWindowUnit || 'Days';
  return `${value} ${unit.toLowerCase()}`;
}

function getExtensionDetectionDefaults(extensionName) {
  const normalizedName = String(extensionName || '')
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (normalizedName === 'github-copilot') {
    return {
      dummy_model: 'Claud Opus-4.6',
      model_signatures: [],
      // VS Code runs copilot-runtime; other IDEs run the language server.
      identifiers: ['copilot-runtime', 'copilot-language-server', 'github.copilot'],
      match_all: [],
    };
  }
  if (normalizedName === 'claude-code') {
    // The VS Code extension runs the Claude Code binary from its own folder.
    return {
      canonical_name: 'claude-code',
      dummy_model: '',
      model_signatures: [],
      identifiers: [],
      match_all: ['anthropic.claude-code'],
    };
  }
  if (normalizedName === 'codex') {
    return {
      canonical_name: 'codex',
      dummy_model: 'GPT-5.2',
      model_signatures: [
        {
          name: 'gpt-5.2',
          identifiers: ['gpt-5.2'],
          match_all: [],
        },
        {
          name: 'gpt-5',
          identifiers: ['gpt-5'],
          match_all: [],
        },
      ],
      identifiers: ['codex.exe', 'codex'],
      match_all: [],
    };
  }

  return {
    dummy_model: '',
    model_signatures: [],
    identifiers: [],
    match_all: [],
  };
}

function buildAgentDeploymentConfig({ pcName, user, licensedApps, inventoryApps = [] }) {
  const applicationItems = licensedApps.filter((app) => app.appType === 'Application');
  const extensionItems = licensedApps.filter((app) => app.appType === 'Extension' && app.trackExtensions !== false);
  const webUrlItems = inventoryApps.filter((app) => app.appType === 'Web URL');
  const extensionConfig = (extension) => {
    const extensionName = extension.processName || extension.appName;
    const detectionDefaults = getExtensionDetectionDefaults(extensionName);
    const configuredModelSignatures = extension.model_signatures;
    const configuredIdentifiers = extension.identifiers;
    const configuredMatchAll = extension.match_all || extension.matchAll;
    const resolvedMatchAll =
      Array.isArray(configuredMatchAll) && configuredMatchAll.length > 0
        ? configuredMatchAll
        : detectionDefaults.match_all;
    const resolvedIdentifiers =
      Array.isArray(configuredIdentifiers) && configuredIdentifiers.length > 0
        ? configuredIdentifiers
        : detectionDefaults.identifiers;
    return {
      name: detectionDefaults.canonical_name || extensionName,
      type: 'agent',
      subscriptionType: extension.subscriptionType,
      license_cost: extension.monthlyCost,
      dummy_model: extension.dummy_model || extension.dummyModel || detectionDefaults.dummy_model,
      model_signatures:
        Array.isArray(configuredModelSignatures) && configuredModelSignatures.length > 0
          ? configuredModelSignatures
          : detectionDefaults.model_signatures,
      identifiers:
        resolvedIdentifiers.length > 0 || resolvedMatchAll.length > 0
          ? resolvedIdentifiers
          : [extensionName],
      match_all: resolvedMatchAll,
      reclaim_policy: buildReclaimPolicy(extension.policy, {
        includeTokenThreshold: true,
      }),
    };
  };

  return {
    target_pc: pcName,
    assigned_user: user,
    generated_at: new Date().toISOString(),
    licensed_apps: applicationItems.map((app) => ({
      name: app.processName || app.appName,
      type: 'application',
      subscriptionType: app.subscriptionType || app.appName,
      license_cost: app.monthlyCost,
      reclaim_policy: buildReclaimPolicy(app.policy),
      extensions: extensionItems
        .filter(
          (extension) =>
            extension.parentApp === app.appName ||
            extension.parentApp === app.processName
        )
        .map(extensionConfig),
    })),
    extensions: extensionItems.filter((extension) => !extension.parentApp).map(extensionConfig),
    tracked_urls: webUrlItems.map((app) => app.url),
  };
}

function normalizeDeploymentRecordKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getDeploymentRecordId(record) {
  return [
    normalizeDeploymentRecordKey(record.target_pc),
    normalizeDeploymentRecordKey(record.type),
    normalizeDeploymentRecordKey(record.parent_app),
    normalizeDeploymentRecordKey(record.app_name),
  ].join('::');
}

function buildDeploymentPolicyRecords(deploymentConfig, licensedApps = []) {
  const targetPc = String(deploymentConfig?.target_pc || '').trim().toUpperCase();
  const assignedUser = String(deploymentConfig?.assigned_user || '').trim();
  const generatedAt = deploymentConfig?.generated_at || new Date().toISOString();
  const findSourceLicense = (appName, isExtension = false) =>
    licensedApps.find((license) => {
      const licenseName = license.processName || license.appName;
      if (licenseName !== appName) return false;
      return license.appType === (isExtension ? 'Extension' : 'Application');
    });

  const extensionRecord = (extension, parentApp) => {
    const extensionName = String(extension?.name || '').trim();
    if (!targetPc || !extensionName) return null;
    const sourceExtension = findSourceLicense(extensionName, true);

    return {
      target_pc: targetPc,
      assigned_user: assignedUser,
      generated_at: generatedAt,
      app_name: extensionName,
      type: extension?.type || 'agent',
      parent_app: parentApp,
      subscriptionType: extension?.subscriptionType || '',
      license_cost: Number(extension?.license_cost) || 0,
      reclaim_policy: sourceExtension?.policy
        ? buildPortalReclaimPolicy(sourceExtension.policy, {
            includeTokenThreshold: true,
          })
        : extension?.reclaim_policy || {},
    };
  };

  const appRecords = (deploymentConfig?.licensed_apps || []).flatMap((app) => {
    const appName = String(app?.name || '').trim();
    if (!targetPc || !appName) return [];
    const sourceApp = findSourceLicense(appName);

    const appRecord = {
      target_pc: targetPc,
      assigned_user: assignedUser,
      generated_at: generatedAt,
      app_name: appName,
      type: app?.type || 'application',
      parent_app: null,
      subscriptionType: app?.subscriptionType || '',
      license_cost: Number(app?.license_cost) || 0,
      reclaim_policy: sourceApp?.policy
        ? buildPortalReclaimPolicy(sourceApp.policy)
        : app?.reclaim_policy || {},
    };

    const extensionRecords = (Array.isArray(app?.extensions) ? app.extensions : [])
      .map((extension) => extensionRecord(extension, appName))
      .filter(Boolean);

    return [appRecord, ...extensionRecords];
  });
  const hostlessRecords = (deploymentConfig?.extensions || [])
    .map((extension) => extensionRecord(extension, null))
    .filter(Boolean);
  return [...appRecords, ...hostlessRecords];
}

const sentEmailSummaryWindowKeys = new Set();
const pendingEmailSummaryWindowKeys = new Set();

const pricingMap = {
  Adobe: 150,
  'Adobe Creative Cloud': 150,
  Photoshop: 35,
  Illustrator: 35,
  WebStorm: 16,
  PyCharm: 24,
  'Microsoft 365': 22,
  Office: 22,
  Figma: 15,
  Notion: 10,
  Jira: 8.15,
  Zoom: 16,
  Chrome: 0,
  Firefox: 0,
  Postman: 19,
  Notepad: 0,
  'Notepad++': 0,
};

const fallbackCosts = [150, 95, 72, 49, 29, 18];
const fallbackExtensionCosts = [19, 12, 20, 10];
const fallbackDiscoveredAppCosts = [0];

const extensionPricingMap = {
  'github-copilot': 19,
  'github copilot': 19,
  copilot: 19,
  tabnine: 12,
  codex: 20,
  'claude code': 20,
  cline: 15,
  'gemini code assist': 19,
};

const aiModelSubscriptionMap = {
  'configured-in-tool': 'Configured in tool',
  'gpt-4o': 'OpenAI paid API',
  'gpt-4.1': 'OpenAI paid API',
  'gpt-5': 'OpenAI paid API',
  'claude-3.5-sonnet': 'Claude Pro / Team',
  'claude-3-5-sonnet': 'Claude Pro / Team',
  'claude-sonnet-4': 'Claude Pro / Team',
  'gemini-1.5-pro': 'Google AI paid tier',
  'gemini-2.5-pro': 'Google AI paid tier',
};

const engagementChartColors = [
  '#e74c3c',
  '#8e44ad',
  '#2980b9',
  '#16a085',
  '#f39c12',
  '#2c3e50',
  '#d35400',
];

const appDisplayNames = {
  'code.exe': 'Visual Studio Code',
  code: 'Visual Studio Code',
  'cursor.exe': 'Cursor',
  cursor: 'Cursor',
  'idea64.exe': 'IntelliJ IDEA',
  idea64: 'IntelliJ IDEA',
  'webstorm64.exe': 'WebStorm',
  webstorm64: 'WebStorm',
  'pycharm64.exe': 'PyCharm',
  pycharm64: 'PyCharm',
  'devenv.exe': 'Visual Studio',
  devenv: 'Visual Studio',
  'chrome.exe': 'Google Chrome',
  chrome: 'Google Chrome',
  'firefox.exe': 'Mozilla Firefox',
  firefox: 'Mozilla Firefox',
  'postman.exe': 'Postman',
  postman: 'Postman',
  'notepad.exe': 'Notepad',
  notepad: 'Notepad',
  'notepad++.exe': 'Notepad++',
};

const usageHistory = Array.from({ length: 30 }, (_, index) => {
  const date = new Date('2026-04-01T00:00:00.000Z');
  date.setDate(date.getDate() + index);

  return {
    date: date.toISOString(),
    totalWaste: Math.max(420, 2100 - index * 47 + Math.sin(index / 2) * 130),
    totalSavings: Math.min(2600, 260 + index * 68 + Math.cos(index / 3) * 90),
    activeUsers: Math.round(18 + index * 0.7 + Math.sin(index / 4) * 4),
  };
});

const engagementVelocity = Array.from({ length: 24 }, (_, hour) => ({
  time: `${String(hour).padStart(2, '0')}:00`,
  adobeCc: Math.max(4, Math.round(12 + Math.sin((hour - 8) / 3) * 18 + (hour >= 9 && hour <= 16 ? 34 : 0))),
  figma: Math.max(3, Math.round(10 + Math.sin((hour - 10) / 2.6) * 16 + (hour >= 10 && hour <= 18 ? 42 : 0))),
  vsCode: Math.max(6, Math.round(18 + Math.sin((hour - 7) / 2.8) * 20 + (hour >= 8 && hour <= 19 ? 48 : 0))),
}));

const cloudProviderColors = {
  AWS: '#ff9900',
  Azure: '#0078d4',
  GCP: '#34a853',
};

const cloudInventory = [
  {
    id: 'aws-prod-api-01',
    provider: 'AWS',
    name: 'prod-api-m5-xlarge',
    region: 'us-east-1',
    type: 'EC2',
    department: 'Engineering',
    monthlyBurn: 312,
    cpuUtilization: 4,
    memoryUtilization: 18,
  },
  {
    id: 'aws-prod-db-01',
    provider: 'AWS',
    name: 'prod-db-instance',
    region: 'us-east-1',
    type: 'RDS',
    department: 'Engineering',
    monthlyBurn: 640,
    cpuUtilization: 52,
    memoryUtilization: 68,
  },
  {
    id: 'aws-marketing-assets',
    provider: 'AWS',
    name: 'marketing-asset-bucket',
    region: 'us-west-2',
    type: 'S3',
    department: 'Marketing',
    monthlyBurn: 94,
    cpuUtilization: 0,
    memoryUtilization: 0,
  },
  {
    id: 'azure-qa-runner-02',
    provider: 'Azure',
    name: 'qa-runner-d4s-vm',
    region: 'eastus',
    type: 'Virtual Machine',
    department: 'QA',
    monthlyBurn: 228,
    cpuUtilization: 8,
    memoryUtilization: 21,
  },
  {
    id: 'azure-sql-finance',
    provider: 'Azure',
    name: 'finance-sql-managed',
    region: 'centralus',
    type: 'Azure SQL',
    department: 'Finance',
    monthlyBurn: 410,
    cpuUtilization: 35,
    memoryUtilization: 48,
  },
  {
    id: 'azure-cdn-market',
    provider: 'Azure',
    name: 'campaign-cdn-profile',
    region: 'westus2',
    type: 'CDN',
    department: 'Marketing',
    monthlyBurn: 126,
    cpuUtilization: 0,
    memoryUtilization: 0,
  },
  {
    id: 'gcp-ml-worker-01',
    provider: 'GCP',
    name: 'ml-worker-n2-standard',
    region: 'us-central1',
    type: 'Compute Engine',
    department: 'Engineering',
    monthlyBurn: 288,
    cpuUtilization: 6,
    memoryUtilization: 24,
  },
  {
    id: 'gcp-analytics-sql',
    provider: 'GCP',
    name: 'analytics-cloud-sql',
    region: 'us-east4',
    type: 'Cloud SQL',
    department: 'QA',
    monthlyBurn: 356,
    cpuUtilization: 41,
    memoryUtilization: 59,
  },
  {
    id: 'gcp-public-logs',
    provider: 'GCP',
    name: 'public-log-archive',
    region: 'europe-west1',
    type: 'Cloud Storage',
    department: 'Security',
    monthlyBurn: 78,
    cpuUtilization: 0,
    memoryUtilization: 0,
  },
];

const zombieCloudAssets = [
  {
    id: 'zombie-ebs-01',
    provider: 'AWS',
    resourceName: 'vol-0f92-prod-orphan',
    region: 'us-east-1',
    type: 'Unattached EBS Volume',
    monthlyBurn: 46,
    reason: 'Detached for 19 days with no snapshot dependency',
  },
  {
    id: 'zombie-alb-01',
    provider: 'AWS',
    resourceName: 'legacy-checkout-alb',
    region: 'us-west-2',
    type: 'Idle Load Balancer',
    monthlyBurn: 31,
    reason: 'Zero healthy targets and no requests in 14 days',
  },
  {
    id: 'zombie-eip-01',
    provider: 'AWS',
    resourceName: 'eipalloc-08c1-unused',
    region: 'us-east-1',
    type: 'Unused Elastic IP',
    monthlyBurn: 12,
    reason: 'Allocated but not associated to any network interface',
  },
  {
    id: 'zombie-azure-disk-01',
    provider: 'Azure',
    resourceName: 'qa-temp-osdisk-2024',
    region: 'eastus',
    type: 'Unattached Managed Disk',
    monthlyBurn: 39,
    reason: 'Disk owner VM deleted, disk still billing',
  },
  {
    id: 'zombie-gcp-ip-01',
    provider: 'GCP',
    resourceName: 'staging-static-ip',
    region: 'us-central1',
    type: 'Unused Static IP',
    monthlyBurn: 15,
    reason: 'Reserved address with no forwarding rule or VM',
  },
];

const rightSizingRecommendations = [
  {
    id: 'rightsize-api',
    provider: 'AWS',
    resourceName: 'prod-api-m5-xlarge',
    currentSize: 'EC2 m5.xlarge',
    recommendation: 'Switch to t3.medium',
    cpuUtilization: 4,
    monthlySavings: 84,
  },
  {
    id: 'rightsize-qa',
    provider: 'Azure',
    resourceName: 'qa-runner-d4s-vm',
    currentSize: 'D4s v5 VM',
    recommendation: 'Downgrade to B2ms',
    cpuUtilization: 8,
    monthlySavings: 62,
  },
  {
    id: 'rightsize-ml',
    provider: 'GCP',
    resourceName: 'ml-worker-n2-standard',
    currentSize: 'n2-standard-8',
    recommendation: 'Move to e2-standard-2',
    cpuUtilization: 6,
    monthlySavings: 74,
  },
];

const cloudConnectors = [
  {
    provider: 'AWS',
    account: 'prod-finops-9842',
    status: 'Connected',
    lastSync: '4 min ago',
  },
  {
    provider: 'Azure',
    account: 'corp-subscription-east',
    status: 'Syncing',
    lastSync: 'running now',
  },
  {
    provider: 'GCP',
    account: 'agentops-shared-vpc',
    status: 'Auth Error',
    lastSync: '2h ago',
  },
];

const unifiedSpendTrend = [
  {
    month: 'Jan',
    desktopSoftware: 3650,
    aiAgents: 780,
    cloudInfrastructure: 1840,
  },
  {
    month: 'Feb',
    desktopSoftware: 3780,
    aiAgents: 910,
    cloudInfrastructure: 1985,
  },
  {
    month: 'Mar',
    desktopSoftware: 3920,
    aiAgents: 1040,
    cloudInfrastructure: 2190,
  },
  {
    month: 'Apr',
    desktopSoftware: 4050,
    aiAgents: 1195,
    cloudInfrastructure: 2380,
  },
  {
    month: 'May',
    desktopSoftware: 4175,
    aiAgents: 1320,
    cloudInfrastructure: 2532,
  },
  {
    month: 'Jun',
    desktopSoftware: 4250,
    aiAgents: 1410,
    cloudInfrastructure: 2532,
  },
];

const utilizationHeatmapHours = ['00', '03', '06', '09', '12', '15', '18', '21'];

const utilizationHeatmapRows = [
  {
    domain: 'Desktop',
    signal: 'Adobe / Figma',
    values: [8, 4, 12, 72, 88, 81, 46, 18],
    decision: 'Floating licenses viable outside business hours',
  },
  {
    domain: 'AI Agents',
    signal: 'Copilot / Claude',
    values: [5, 3, 9, 63, 76, 71, 39, 22],
    decision: 'Seat harvesting strongest for low night and weekend use',
  },
  {
    domain: 'Cloud',
    signal: 'EC2 / RDS / S3',
    values: [18, 14, 21, 58, 69, 73, 44, 24],
    decision: 'Schedule dev and QA workloads after peak windows',
  },
];

const departmentCostAttribution = [
  {
    team: 'Engineering',
    desktopCost: 1480,
    cloudCost: 1240,
    aiToolingCost: 760,
    efficiency: 74,
  },
  {
    team: 'Marketing',
    desktopCost: 890,
    cloudCost: 220,
    aiToolingCost: 180,
    efficiency: 69,
  },
  {
    team: 'Product',
    desktopCost: 620,
    cloudCost: 310,
    aiToolingCost: 245,
    efficiency: 82,
  },
  {
    team: 'QA',
    desktopCost: 510,
    cloudCost: 584,
    aiToolingCost: 120,
    efficiency: 66,
  },
  {
    team: 'Finance',
    desktopCost: 420,
    cloudCost: 410,
    aiToolingCost: 105,
    efficiency: 79,
  },
];

function formatRuntime(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return remainingSeconds > 0
      ? `${hours}h ${mins}m ${remainingSeconds}s`
      : `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return remainingSeconds > 0 ? `${mins}m ${remainingSeconds}s` : `${mins}m`;
  }
  return `${remainingSeconds}s`;
}

function getTimestampMs(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  const parsedTime = new Date(value).getTime();
  return Number.isNaN(parsedTime) ? null : parsedTime;
}

function getTelemetryTimestampMs(payload) {
  return getTimestampMs(payload?.timestamp);
}

// Legacy HTTP samples store the app rows directly in `usage`. RabbitMQ events
// wrap the Tracker's original sample in `usage`, so its app rows are nested at
// `usage.usage`. Support both shapes while the portal has historical data.
function getUsageEntries(payload) {
  const usage = payload?.usage;
  if (Array.isArray(usage)) return usage;
  if (Array.isArray(usage?.usage)) return usage.usage;
  return [];
}

function getTelemetryEvaluationWindowMs(payload) {
  const firstUsageRow = getUsageEntries(payload)[0] || {};
  const startsAt = getTimestampMs(
    payload?.evaluation_window_start_time ||
      payload?.last_reset_time ||
      payload?.evaluation_window?.starts_at ||
      firstUsageRow.evaluation_window_start_time ||
      firstUsageRow.last_reset_time ||
      firstUsageRow.evaluation_window?.starts_at
  );
  const endsAt = getTimestampMs(
    payload?.evaluation_window_end_time ||
      payload?.evaluation_window?.ends_at ||
      firstUsageRow.evaluation_window_end_time ||
      firstUsageRow.evaluation_window?.ends_at
  );

  if (startsAt === null || endsAt === null || endsAt <= startsAt) {
    return null;
  }

  return { startsAt, endsAt };
}

function getTelemetryLastResetMs(payload) {
  const firstUsageRow = getUsageEntries(payload)[0] || {};
  return getTimestampMs(
    payload?.last_reset_time ||
      payload?.evaluation_window_start_time ||
      payload?.evaluation_window?.starts_at ||
      firstUsageRow.last_reset_time ||
      firstUsageRow.evaluation_window_start_time ||
      firstUsageRow.evaluation_window?.starts_at
  );
}

function getTelemetryLastResetForAppMs(payload, appName) {
  const usageEntry = getUsageEntries(payload).find(
    (entry) => entry.app_name === appName
  );

  if (!usageEntry) return null;
  return getTimestampMs(
    usageEntry.last_reset_time ||
      usageEntry.evaluation_window_start_time ||
      usageEntry.evaluation_window?.starts_at
  );
}

function getConfigEvaluationWindowSeconds(config) {
  const appPolicyWindows = Object.values(config?.licensed_app_policies || {})
    .map((policy) => policy?.evaluation_window_seconds)
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(Number);
  const extensionPolicyWindows = (config?.extensions || [])
    .map((extension) => extension?.reclaim_policy?.evaluation_window_seconds)
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(Number);
  const policyWindows = [...appPolicyWindows, ...extensionPolicyWindows];

  return policyWindows.length > 0
    ? Math.min(...policyWindows)
    : DEFAULT_RECLAIM_POLICY.evaluation_window_seconds;
}

function getDeploymentEvaluationWindowConfig(
  deploymentPolicyRecords,
  pcName,
  fallbackWindowSeconds
) {
  const pcKey = getDeploymentPolicyKey(pcName);
  const pcRecords = deploymentPolicyRecords.filter(
    (record) => getDeploymentPolicyKey(record.target_pc) === pcKey
  );
  const matchingRecords = pcRecords.length > 0 ? pcRecords : deploymentPolicyRecords;
  const policyWindows = matchingRecords
    .map((record) => record?.reclaim_policy?.evaluation_window_seconds)
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(Number);
  const generatedTimes = matchingRecords
    .map((record) => getTimestampMs(record?.generated_at))
    .filter((value) => value !== null);

  return {
    seconds:
      policyWindows.length > 0 ? Math.min(...policyWindows) : fallbackWindowSeconds,
    startsAt: generatedTimes.length > 0 ? Math.max(...generatedTimes) : null,
  };
}

function getOnboardedEvaluationWindowSeconds(onboardedAppLicenses, fallbackWindowSeconds) {
  const policyWindows = onboardedAppLicenses
    .map((app) => getEvaluationWindowSeconds(app.policy || {}))
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(Number);

  return policyWindows.length > 0 ? Math.min(...policyWindows) : fallbackWindowSeconds;
}

function getCurrentEvaluationWindow(windowStartsAt, windowEndsAt, nowMs = Date.now()) {
  if (!windowStartsAt || !windowEndsAt || nowMs < windowEndsAt) {
    return { startsAt: windowStartsAt, endsAt: windowEndsAt };
  }

  const windowDurationMs = Math.max(1, windowEndsAt - windowStartsAt);
  const elapsedWindows = Math.floor((nowMs - windowEndsAt) / windowDurationMs) + 1;
  const startsAt = windowEndsAt + (elapsedWindows - 1) * windowDurationMs;

  return {
    startsAt,
    endsAt: startsAt + windowDurationMs,
  };
}

function formatDateTime(value) {
  if (!value) return 'Not started';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatLastSeenDateTime(value) {
  if (!value) return '-';
  return formatDateTime(value);
}

function formatLastTrackedInline(value) {
  return value
    ? formatDateTime(value)
    : '- Not being used';
}

function createUsageCounters() {
  return {
    trackedRuntimeSeconds: 0,
    foregroundRuntimeSeconds: 0,
    workedRuntimeSeconds: 0,
    automationWorkedSeconds: 0,
    backgroundAutomationWorkedSeconds: 0,
    idleRuntimeSeconds: 0,
    consumedTokens: 0,
    selectedAiModel: null,
    tokenSource: null,
  };
}

function readUsageCounters(entry = {}) {
  const foregroundRuntimeSeconds =
    entry.foreground_runtime_seconds ?? entry.total_runtime_seconds ?? 0;
  const backgroundAutomationWorkedSeconds =
    entry.background_automation_worked_seconds ?? 0;
  const trackedRuntimeSeconds =
    entry.tracked_runtime_seconds ??
    entry.total_runtime_seconds ??
    foregroundRuntimeSeconds + backgroundAutomationWorkedSeconds;
  const idleRuntimeSeconds = entry.idle_runtime_seconds ?? 0;
  const automationWorkedSeconds = entry.automation_worked_seconds ?? 0;
  const workedRuntimeSeconds =
    entry.worked_runtime_seconds ??
    Math.max(0, foregroundRuntimeSeconds - idleRuntimeSeconds);
  const consumedTokens = Number(
    entry.consumed_tokens ?? entry.consumedTokens ?? 0
  );
  const selectedAiModel =
    entry.selected_ai_model || entry.selectedAiModel || entry.ai_model || null;
  const tokenSource = entry.token_source || entry.tokenSource || null;

  return {
    trackedRuntimeSeconds,
    foregroundRuntimeSeconds,
    workedRuntimeSeconds,
    automationWorkedSeconds,
    backgroundAutomationWorkedSeconds,
    idleRuntimeSeconds,
    consumedTokens: Number.isFinite(consumedTokens) ? consumedTokens : 0,
    selectedAiModel,
    tokenSource,
  };
}

function getUsageCounters(usageMap, appName) {
  return usageMap.get(appName) || createUsageCounters();
}

// An extension's usage: the Tracker reports one ext:<name>@<host> row per host.
function extensionUsageCounters(usageMap, name) {
  const total = { ...getUsageCounters(usageMap, name) };
  usageMap.forEach((counters, key) => {
    if (!key.startsWith(`ext:${name}@`)) return;
    Object.keys(total).forEach((field) => {
      if (typeof total[field] === 'number') total[field] += Number(counters[field]) || 0;
    });
  });
  return total;
}

// A license is used through its own program, inside other apps (ext:<app>@<host>)
// and in the browser (web:<app>); the Tracker reports each as its own row.
function licenseWorkedSeconds(usageMap, appName) {
  const name = String(appName || '').toLowerCase();
  let total = 0;
  usageMap.forEach((counters, key) => {
    if (key === name || key === `web:${name}` || key.startsWith(`ext:${name}@`)) {
      total += Number(counters.workedRuntimeSeconds) || 0;
    }
  });
  return total;
}

function getUsageCountersForWindow(history, appName, windowEndsAt, windowSeconds) {
  const counters = createUsageCounters();
  const windowStartsAt = windowEndsAt - windowSeconds * 1000;

  history.forEach((payload) => {
    const timestampMs = getTelemetryTimestampMs(payload);
    if (timestampMs === null || timestampMs < windowStartsAt) return;

    getUsageEntries(payload).forEach((entry) => {
      if (entry.app_name !== appName) return;

      const next = readUsageCounters(entry);
      counters.trackedRuntimeSeconds += next.trackedRuntimeSeconds;
      counters.foregroundRuntimeSeconds += next.foregroundRuntimeSeconds;
      counters.workedRuntimeSeconds += next.workedRuntimeSeconds;
      counters.automationWorkedSeconds += next.automationWorkedSeconds;
      counters.backgroundAutomationWorkedSeconds +=
        next.backgroundAutomationWorkedSeconds;
      counters.idleRuntimeSeconds += next.idleRuntimeSeconds;
    });
  });

  return counters;
}

function getUtilizationPercent(workedRuntimeSeconds, foregroundRuntimeSeconds) {
  if (foregroundRuntimeSeconds <= 0) return 0;
  return Math.round((workedRuntimeSeconds / foregroundRuntimeSeconds) * 100);
}

function getPolicyUtilizationPercent(workedRuntimeSeconds, policy) {
  const evaluationWindowSeconds = getPolicyValue(policy, 'evaluation_window_seconds');
  if (evaluationWindowSeconds <= 0) return 0;
  return Math.min(
    100,
    Math.round((workedRuntimeSeconds / evaluationWindowSeconds) * 100)
  );
}

function getManualWorkedSeconds(entry) {
  return Math.max(
    0,
    (entry.workedRuntimeSeconds || 0) - (entry.automationWorkedSeconds || 0)
  );
}

function getPolicyValue(policy, key) {
  return policy?.[key] ?? DEFAULT_RECLAIM_POLICY[key];
}

function getDeploymentPolicyKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getEvaluationDecisionKey(pcName, type, name, evaluationSeriesStart) {
  return [pcName, type, name, evaluationSeriesStart]
    .map(getDeploymentPolicyKey)
    .join('::');
}

function readCompletedEvaluationDecisions() {
  return {};
}

function findDeploymentPolicyRecord(
  deploymentPolicyRecords,
  pcName,
  appName,
  { type = null, parentApp = null } = {}
) {
  const pcKey = getDeploymentPolicyKey(pcName);
  const appKey = getDeploymentPolicyKey(appName);
  const typeKey = type ? getDeploymentPolicyKey(type) : null;
  const parentAppKeys = (Array.isArray(parentApp) ? parentApp : [parentApp])
    .filter(Boolean)
    .map(getDeploymentPolicyKey);

  if (!appKey) return null;

  const matchingRecords = deploymentPolicyRecords.filter((record) => {
      if (getDeploymentPolicyKey(record.app_name) !== appKey) return false;
      if (typeKey && getDeploymentPolicyKey(record.type) !== typeKey) return false;
      if (
        parentAppKeys.length > 0 &&
        !parentAppKeys.includes(getDeploymentPolicyKey(record.parent_app))
      ) {
        return false;
      }
      return true;
    });

  if (matchingRecords.length === 0) return null;

  return (
    matchingRecords.find(
      (record) => pcKey && getDeploymentPolicyKey(record.target_pc) === pcKey
    ) || matchingRecords[matchingRecords.length - 1]
  );
}

function getStoredReclaimPolicy(
  deploymentPolicyRecords,
  pcName,
  appName,
  fallbackPolicy,
  options = {}
) {
  return (
    findDeploymentPolicyRecord(
      deploymentPolicyRecords,
      pcName,
      appName,
      options
    )?.reclaim_policy ||
    fallbackPolicy ||
    DEFAULT_RECLAIM_POLICY
  );
}

function getFirstSeenTimestampMs(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  const parsedTime = new Date(value).getTime();
  return Number.isNaN(parsedTime) ? null : parsedTime;
}

function getAppPolicy(config, appName) {
  const normalizedName = String(appName || '').toLowerCase();
  return config?.licensed_app_policies?.[normalizedName] || DEFAULT_RECLAIM_POLICY;
}

function getAppFirstSeenAt(config, appName) {
  const normalizedName = String(appName || '').toLowerCase();
  return config?.licensed_app_metadata?.[normalizedName]?.first_seen_at || null;
}

function getAppLastSeenAt(config, appName) {
  const normalizedName = String(appName || '').toLowerCase();
  const metadata = config?.licensed_app_metadata?.[normalizedName];
  return metadata?.last_seen_at || metadata?.lastSeenAt || null;
}

function getLatestUsageTimestampForApp(history, appName) {
  return history.reduce((latestTimestampMs, payload) => {
    const usageEntry = getUsageEntries(payload).find(
      (entry) => entry.app_name === appName
    );
    if (!usageEntry) return latestTimestampMs;

    const timestampMs =
      getTimestampMs(
        usageEntry.last_reset_time ||
          usageEntry.evaluation_window_start_time ||
          usageEntry.evaluation_window?.starts_at
      ) ?? getTelemetryTimestampMs(payload);
    if (timestampMs === null) return latestTimestampMs;

    return Math.max(latestTimestampMs, timestampMs);
  }, 0);
}

function getLastSeenAt(config, history, appName, fallbackLastSeenAt = null) {
  const configuredLastSeenAt =
    fallbackLastSeenAt || getAppLastSeenAt(config, appName);
  const configuredLastSeenMs = getFirstSeenTimestampMs(configuredLastSeenAt);
  const telemetryLastSeenMs = getLatestUsageTimestampForApp(history, appName);
  const lastSeenMs = Math.max(configuredLastSeenMs || 0, telemetryLastSeenMs);

  if (lastSeenMs <= 0) return null;
  return new Date(lastSeenMs).toISOString();
}

function getAgentStartedAt(config) {
  return config?.agent_started_at || config?.agentStartedAt || null;
}

function getAgentStartedTimestampMs(payload) {
  return getFirstSeenTimestampMs(
    payload?.agent_started_at || payload?.agentStartedAt
  );
}

function getAppType(config, appName) {
  const normalizedName = String(appName || '').toLowerCase();
  return config?.licensed_app_types?.[normalizedName] || 'application';
}

function appHasAgentExtension(config, appName) {
  const normalizedName = String(appName || '').toLowerCase();
  return (config?.extensions || []).some(
    (extension) =>
      String(extension?.parent_app || '').toLowerCase() === normalizedName &&
      extension?.type === 'agent'
  );
}

function getReclaimDecision({
  policy,
  workedRuntimeSeconds,
  consumedTokens = 0,
  evaluationComplete = false,
  previousDecision = null,
}) {
  const workedThresholdSeconds = getPolicyValue(policy, 'worked_threshold_seconds');
  const tokenThreshold = getPolicyValue(policy, 'token_threshold');

  if (!evaluationComplete) {
    if (previousDecision) {
      return {
        ...previousDecision,
        reason: `Previous evaluation: ${previousDecision.reason}`,
      };
    }
    return {
      status: 'Evaluating',
      savingsEligible: false,
      reason: 'First evaluation in progress',
    };
  }

  const hasEnoughWorkedRuntime = workedRuntimeSeconds >= workedThresholdSeconds;
  const hasEnoughTokens = tokenThreshold <= 0 || consumedTokens >= tokenThreshold;

  if (hasEnoughWorkedRuntime && hasEnoughTokens) {
    return {
      status: 'Active',
      savingsEligible: false,
      reason: 'Policy thresholds met',
    };
  }

  return {
    status: 'Reclaimable',
    savingsEligible: true,
    reason: 'Below policy thresholds',
  };
}

function getStatusBadgeClass(status) {
  if (status === 'Active' || status === 'Detected') return 'status-active';
  if (status === 'Evaluating' || status === 'Observing') return 'status-observing';
  if (status === 'Reclaimable') return 'status-reclaimable';
  return 'status-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatDateTick(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
  }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createEmailSummarySubject(windowEndsAt) {
  return `License Utilizations summary - ${formatDateTime(windowEndsAt)}`;
}

function createEmailSummaryHtml({
  evaluationWindow,
  aggregates,
  usageByApp,
  extensionAttributionRows,
  currentPcName,
  config,
  latestTelemetry,
}) {
  const appRows = usageByApp || [];
  const extensionRows = extensionAttributionRows || [];
  const updatedAt = latestTelemetry?.timestamp
    ? new Date(latestTelemetry.timestamp).toLocaleTimeString()
    : null;
  const cellStyle =
    'padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;vertical-align:top;';
  const headerStyle =
    'padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-transform:uppercase;color:#475569;vertical-align:top;';
  const costImpactStyle = `${cellStyle}color:#c52535;font-weight:800;`;
  const getSavingsStyle = (value) =>
    `${cellStyle}color:${value > 0 ? '#178f52' : '#74849a'};font-weight:800;`;
  const statusBadgeHtml = (status) => {
    const statusStyles = {
      Active: 'background:#e8f8f0;color:#11633c;',
      Observing: 'background:#fff7df;color:#8a5a00;',
      Evaluating: 'background:#fff7df;color:#8a5a00;',
      Reclaimable: 'background:#fff0f1;color:#be2634;',
    };

    return `<span style="display:inline-block;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;line-height:1;background:#edf2f7;color:#53667e;${
      statusStyles[status] || ''
    }">${escapeEmailHtml(status)}</span>`;
  };

  const runtimeBreakdownHtml = (entry) => {
    const isAgentEntry = entry.appType === 'agent' || entry.type === 'agent';
    const showAutomationWork = isAgentEntry || entry.hasAgentExtension;

    return [
      `<strong>${formatRuntime(entry.totalRuntimeSeconds)}</strong>`,
      !isAgentEntry ? `Manual Work ${formatRuntime(getManualWorkedSeconds(entry))}` : null,
      showAutomationWork
        ? `Automation Work ${formatRuntime(entry.automationWorkedSeconds || 0)}`
        : null,
      `Idle ${formatRuntime(entry.idleRuntimeSeconds || 0)}`,
    ]
      .filter(Boolean)
      .map((line, index) =>
        index === 0
          ? `<div>${line}</div>`
          : `<div style="color:#64748b;margin-top:4px;">${line}</div>`
      )
      .join('');
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>License Utilizations Summary</title>
</head>
<body style="margin:0;padding:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f3f7fb;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table width="820" cellpadding="0" cellspacing="0" role="presentation" style="width:820px;max-width:100%;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #dbe5f0;box-shadow:0 24px 70px rgba(15,23,42,0.12);">
          <tr>
            <td style="padding:34px 34px 30px;background:#101828;color:#ffffff;">
              <p style="margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.14em;color:#8fd3ff;">License intelligence</p>
              <h1 style="margin:0;font-size:28px;line-height:1.25;letter-spacing:0;">Evaluation window: ${formatDateTime(evaluationWindow.startsAt)} to ${formatDateTime(evaluationWindow.endsAt)}</h1>
              <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#d7e3f0;">License Utilizations - live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 34px 0;background:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="width:33.33%;padding:0 8px 16px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:16px;padding:20px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Total Monthly Software Spend</p>
                      <h2 style="margin:0;font-size:20px;color:#c52535;">${formatCurrency(aggregates.totalMonthlySoftwareSpend)}</h2>
                      <p style="margin:10px 0 0;font-size:13px;color:#475569;">App license cost + AI license cost</p>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 8px 16px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:16px;padding:20px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Identified monthly savings</p>
                      <h2 style="margin:0;font-size:20px;color:#178f52;">${formatCurrency(aggregates.totalMonthlySavings)}</h2>
                      <p style="margin:10px 0 0;font-size:13px;color:#475569;">Reclaimable app cost + AI license cost</p>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 8px 16px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:16px;padding:20px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Reclaimable Licenses</p>
                      <h2 style="margin:0;font-size:20px;color:#0f172a;">${aggregates.totalReclaimableLicenses} <span style="font-size:13px;color:#64748b;font-weight:600;">from ${aggregates.totalLicenses} total licenses</span></h2>
                      <p style="margin:10px 0 0;font-size:13px;color:#475569;">${aggregates.reclaimableSeats} App Licenses + ${aggregates.reclaimableAgentExtensions} AI Licenses</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:2px 34px 24px;background:#ffffff;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#0f172a;">App Licenses</h2>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">License decisions are finalized at the end of each evaluation window. Idle grace periods are configured inside each reclaim policy.</p>
              <p style="margin:0 0 16px;font-size:13px;color:#475569;">${evaluationWindow.sampleCount} telemetry samples${updatedAt ? ` &middot; Updated ${updatedAt}` : ''}</p>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin-bottom:18px;">
                <tr>
                  <td style="width:33.33%;padding:0 8px 0 0;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Overall monthly cost</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${formatCurrency(aggregates.trackedMonthlyCost)}</h3>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 8px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Identified monthly savings</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${formatCurrency(aggregates.totalSavings)}</h3>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 0 0 8px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">App Licenses</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${aggregates.totalSeats}</h3>
                      <p style="margin:8px 0 0;font-size:13px;color:#475569;">${aggregates.activeSeats} Actively Working</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 34px 26px;background:#ffffff;">
              <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a;">App Licenses</h3>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border:1px solid #dbe5f0;border-radius:14px;overflow:hidden;">
                  <tr style="background:#eef2ff;">
                    <th align="left" style="${headerStyle}">PC Name</th>
                    <th align="left" style="${headerStyle}">App Identity</th>
                    <th align="left" style="${headerStyle}">Status</th>
                    <th align="right" style="${headerStyle}">Tracked Runtime</th>
                    <th align="right" style="${headerStyle}">Utilization</th>
                    <th align="right" style="${headerStyle}">Cost Impact</th>
                    <th align="right" style="${headerStyle}">Savings Opportunity</th>
                  </tr>
                  ${appRows
                    .map(
                      (entry) =>
                        `<tr>
                          <td style="${cellStyle}">${escapeEmailHtml(entry.pcName)}</td>
                          <td style="${cellStyle}"><strong>${escapeEmailHtml(entry.displayName)}</strong>${entry.shouldShowRawName ? `<br /><span style="color:#64748b;">${escapeEmailHtml(entry.rawName)}</span>` : ''}</td>
                          <td style="${cellStyle}">${statusBadgeHtml(entry.status)}</td>
                          <td align="right" style="${cellStyle}">${runtimeBreakdownHtml(entry)}</td>
                          <td align="right" style="${cellStyle}">${entry.utilizationPercent}%</td>
                          <td align="right" style="${costImpactStyle}">-${formatCurrency(entry.monthlyCost)}</td>
                          <td align="right" style="${getSavingsStyle(entry.savingsOpportunity)}">${entry.savingsOpportunity > 0 ? `+${formatCurrency(entry.savingsOpportunity)}` : formatCurrency(0)}</td>
                        </tr>`
                    )
                    .join('')}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 34px 34px;background:#ffffff;">
              <h2 style="margin:8px 0 8px;font-size:20px;color:#0f172a;">AI Licenses</h2>
              <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#475569;">Nested extension usage is counted only while the host application is focused.</p>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin-bottom:18px;">
                <tr>
                  <td style="width:33.33%;padding:0 8px 0 0;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Overall monthly cost</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${formatCurrency(aggregates.totalExtensionMonthlyCost)}</h3>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 8px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">Identified monthly savings</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${formatCurrency(aggregates.totalExtensionSavings)}</h3>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:0 0 0 8px;vertical-align:top;">
                    <div style="background:#f8fafc;border:1px solid #dbe5f0;border-radius:14px;padding:16px;">
                      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">AI Agent Licenses</p>
                      <h3 style="margin:0;font-size:18px;color:#0f172a;">${aggregates.totalAgentExtensions}</h3>
                      <p style="margin:8px 0 0;font-size:13px;color:#475569;">${aggregates.activeExtensions} Actively Working</p>
                    </div>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border:1px solid #dbe5f0;border-radius:14px;overflow:hidden;">
                <tr style="background:#eef2ff;">
                  <th align="left" style="${headerStyle}">PC Name</th>
                  <th align="left" style="${headerStyle}">Extension Identity</th>
                  <th align="left" style="${headerStyle}">Status</th>
                  <th align="right" style="${headerStyle}">Tracked Runtime</th>
                  <th align="right" style="${headerStyle}">Utilization</th>
                  <th align="right" style="${headerStyle}">Cost Impact</th>
                  <th align="right" style="${headerStyle}">Savings Opportunity</th>
                </tr>
                ${extensionRows
                  .map((extension) => {
                    const pcNames =
                      extension.detectedPcNames.length > 0
                        ? extension.detectedPcNames.join(', ')
                        : currentPcName;
                    const savings =
                      extension.status === 'Reclaimable'
                        ? `+${formatCurrency(extension.monthlyCost)}`
                        : formatCurrency(0);
                    const savingsValue =
                      extension.status === 'Reclaimable' ? extension.monthlyCost : 0;

                    return `<tr>
                      <td style="${cellStyle}">${escapeEmailHtml(pcNames)}</td>
                      <td style="${cellStyle}"><strong>${escapeEmailHtml(extension.name)}</strong><br /><span style="color:#64748b;">${escapeEmailHtml(extension.subscriptionType)}</span><br /><span style="color:#64748b;">${escapeEmailHtml(extension.parentApps.join(', '))}</span></td>
                      <td style="${cellStyle}">${statusBadgeHtml(extension.status)}</td>
                      <td align="right" style="${cellStyle}">${runtimeBreakdownHtml(extension)}</td>
                      <td align="right" style="${cellStyle}">${extension.utilizationPercent}%</td>
                      <td align="right" style="${costImpactStyle}">-${formatCurrency(extension.monthlyCost)}</td>
                      <td align="right" style="${getSavingsStyle(savingsValue)}">${savings}</td>
                    </tr>`;
                  })
                  .join('')}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createEmailSummaryBody({
  evaluationWindow,
  aggregates,
  usageByApp,
  extensionAttributionRows,
  currentPcName,
  config,
  latestTelemetry,
}) {
  const updatedAt = latestTelemetry?.timestamp
    ? new Date(latestTelemetry.timestamp).toLocaleTimeString()
    : null;
  const runtimeBreakdownText = (entry) => {
    const isAgentEntry = entry.appType === 'agent' || entry.type === 'agent';
    const showAutomationWork = isAgentEntry || entry.hasAgentExtension;
    return [
      formatRuntime(entry.totalRuntimeSeconds),
      !isAgentEntry ? `Manual Work ${formatRuntime(getManualWorkedSeconds(entry))}` : null,
      showAutomationWork
        ? `Automation Work ${formatRuntime(entry.automationWorkedSeconds || 0)}`
        : null,
      `Idle ${formatRuntime(entry.idleRuntimeSeconds || 0)}`,
    ]
      .filter(Boolean)
      .join('; ');
  };

  const baseLines = [
    'License intelligence',
    '',
    'License Utilizations',
    'Live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.',
    '',
    `Total Monthly Software Spend: ${formatCurrency(aggregates.totalMonthlySoftwareSpend)}`,
    'App license cost + AI license cost',
    `Identified Monthly Savings: ${formatCurrency(aggregates.totalMonthlySavings)}`,
    'Reclaimable app cost + AI license cost',
    `Reclaimable Licenses: ${aggregates.totalReclaimableLicenses} from ${aggregates.totalLicenses} total licenses`,
    `${aggregates.reclaimableSeats} App Licenses + ${aggregates.reclaimableAgentExtensions} AI Licenses`,
    '',
    'App Licenses',
    'License decisions are finalized at the end of each evaluation window. Idle grace periods are configured inside each reclaim policy.',
    `Evaluation window: ${formatDateTime(evaluationWindow.startsAt)} - ${formatDateTime(
      evaluationWindow.endsAt
    )}`,
    `${evaluationWindow.sampleCount} telemetry samples${updatedAt ? `, Updated ${updatedAt}` : ''}`,
    '',
    `Overall monthly cost: ${formatCurrency(aggregates.trackedMonthlyCost)}`,
    `Identified monthly savings: ${formatCurrency(aggregates.totalSavings)}`,
    `App licenses: ${aggregates.totalSeats}`,
    `Actively working: ${aggregates.activeSeats}`,
    '',
    'App Licenses:',
  ];

  const appLines = [...(usageByApp || [])]
    .map(
      (entry) =>
        `${entry.pcName} | ${entry.displayName} | ${entry.status} | ${runtimeBreakdownText(
          entry
        )} | ${entry.utilizationPercent}% utilization | -${formatCurrency(
          entry.monthlyCost
        )} cost | ${
          entry.savingsOpportunity > 0 ? `+${formatCurrency(entry.savingsOpportunity)}` : formatCurrency(0)
        } savings`
  );

  const extensionLines = [...(extensionAttributionRows || [])].map((extension) => {
    const pcNames =
      extension.detectedPcNames.length > 0
        ? extension.detectedPcNames.join(', ')
        : currentPcName;
    const savings =
      extension.status === 'Reclaimable'
        ? `+${formatCurrency(extension.monthlyCost)}`
        : formatCurrency(0);

    return `${pcNames} | ${extension.name} | ${extension.subscriptionType} | ${extension.parentApps.join(
      ', '
    )} | ${extension.status} | ${runtimeBreakdownText(extension)} | ${
      extension.utilizationPercent
    }% utilization | -${formatCurrency(extension.monthlyCost)} cost | ${savings} savings`;
  });

  const textBody = [
    ...baseLines,
    ...appLines,
    '',
    'AI Licenses',
    'Nested extension usage is counted only while the host application is focused.',
    '',
    `Overall monthly cost: ${formatCurrency(aggregates.totalExtensionMonthlyCost)}`,
    `Identified monthly savings: ${formatCurrency(aggregates.totalExtensionSavings)}`,
    `AI Agent Licenses: ${aggregates.totalAgentExtensions}`,
    `Actively working: ${aggregates.activeExtensions}`,
    '',
    ...extensionLines,
    '',
    'Delivered by AllionOne',
  ].join('\n');
  const htmlBody = createEmailSummaryHtml({
    evaluationWindow,
    aggregates,
    usageByApp,
    extensionAttributionRows,
    currentPcName,
    config,
    latestTelemetry,
  });

  return { text: textBody, html: htmlBody };
}

function getUtilizationStatus(cpuUtilization, memoryUtilization) {
  if (cpuUtilization < 10 && memoryUtilization < 25) {
    return {
      label: 'Low Utilization',
      className: 'utilization-low',
    };
  }

  if (cpuUtilization >= 35 || memoryUtilization >= 45) {
    return {
      label: 'Optimized',
      className: 'utilization-optimized',
    };
  }

  return {
    label: 'Watch',
    className: 'utilization-watch',
  };
}

function getCloudProviderClass(provider) {
  return `provider-${provider.toLowerCase()}`;
}

function HistoricalTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const isDateLabel = String(label).includes('T');

  return (
    <div className="chart-tooltip">
      <strong>{isDateLabel ? formatDateTick(label) : label}</strong>
      {payload.map((entry) => {
        const isCurrency = entry.dataKey === 'totalWaste' || entry.dataKey === 'totalSavings';

        return (
          <div className="chart-tooltip-row" key={entry.dataKey}>
            <span style={{ background: entry.color }} />
            <small>{entry.name}</small>
            <b>
              {isCurrency
                ? formatCurrency(entry.value)
                : `${formatNumber(entry.value)} min`}
            </b>
          </div>
        );
      })}
    </div>
  );
}

function PeakUsageDot(props) {
  const { cx, cy, dataKey, payload, stroke, series = engagementVelocity } = props;
  const peakValue = Math.max(...series.map((entry) => Number(entry[dataKey]) || 0));

  if (payload[dataKey] !== peakValue) {
    return <circle cx={cx} cy={cy} r={2.5} fill="#ffffff" stroke={stroke} strokeWidth={1.5} />;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="#ffffff"
      stroke={stroke}
      strokeWidth={2.4}
    />
  );
}

function ChartLegend({ payload }) {
  if (!payload?.length) return null;

  return (
    <div className="chart-legend">
      {payload.map((entry) => (
        <span className="chart-legend-item" key={entry.value}>
          <i style={{ background: entry.color }} />
          {entry.value}
        </span>
      ))}
    </div>
  );
}

function normalizeCostLookupName(value) {
  return String(value || '').trim().toLowerCase();
}

function getCostAliasKeys(name) {
  const normalizedName = normalizeCostLookupName(name);
  if (!normalizedName) return [];

  const withoutExtension = normalizedName.replace(/\.[^/.]+$/, '');
  const displayName = appDisplayNames[normalizedName];
  const aliases = [normalizedName, withoutExtension];

  if (displayName) {
    aliases.push(normalizeCostLookupName(displayName));
  }

  return Array.from(new Set(aliases.filter(Boolean)));
}

function setCatalogCost(costMap, key, cost) {
  const numericCost = Number(cost);
  if (!key || !Number.isFinite(numericCost)) return;

  const existingCost = costMap.get(key);
  costMap.set(
    key,
    Number.isFinite(existingCost) ? Math.max(existingCost, numericCost) : numericCost
  );
}

function setCatalogCostAliases(costMap, name, cost) {
  getCostAliasKeys(name).forEach((alias) => setCatalogCost(costMap, alias, cost));
}

function setCatalogValue(valueMap, key, value) {
  if (!key || !value) return;
  valueMap.set(key, value);
}

function createAppCostCatalog(payload = {}) {
  const appCosts = new Map();
  const extensionCosts = new Map();
  const extensionParentCosts = new Map();
  const extensionSubscriptionTypes = new Map();
  const extensionParentSubscriptionTypes = new Map();

  (payload.apps || []).forEach((entry) => {
    const cost = readCostValue(entry);
    setCatalogCostAliases(appCosts, entry?.name || entry?.app_name, cost);
  });

  (payload.extensions || []).forEach((entry) => {
    const extensionName = entry?.name || entry?.extension_name;
    const parentApp = entry?.parent_app || entry?.parentApp;
    const cost = readCostValue(entry);
    const subscriptionType = entry?.subscriptionType || entry?.subscription_type;

    setCatalogCostAliases(extensionCosts, extensionName, cost);
    getCostAliasKeys(extensionName).forEach((extensionAlias) => {
      setCatalogValue(extensionSubscriptionTypes, extensionAlias, subscriptionType);
    });

    getCostAliasKeys(parentApp).forEach((parentAlias) => {
      getCostAliasKeys(extensionName).forEach((extensionAlias) => {
        setCatalogCost(
          extensionParentCosts,
          `${parentAlias}::${extensionAlias}`,
          cost
        );
        setCatalogValue(
          extensionParentSubscriptionTypes,
          `${parentAlias}::${extensionAlias}`,
          subscriptionType
        );
      });
    });
  });

  return {
    appCosts,
    extensionCosts,
    extensionParentCosts,
    extensionSubscriptionTypes,
    extensionParentSubscriptionTypes,
  };
}

const appCostCatalog = createAppCostCatalog(appCostData);

function findCatalogCost(costMap, name) {
  const aliases = getCostAliasKeys(name);

  for (const alias of aliases) {
    const exactCost = costMap.get(alias);
    if (Number.isFinite(exactCost)) return exactCost;
  }

  const matchingEntry = Array.from(costMap.entries()).find(([catalogName]) =>
    aliases.some(
      (alias) =>
        alias.includes(catalogName) || catalogName.includes(alias)
    )
  );

  return Number.isFinite(matchingEntry?.[1]) ? matchingEntry[1] : null;
}

function findExtensionCatalogCost(extension, costCatalog = appCostCatalog) {
  const extensionName =
    typeof extension === 'string' ? extension : extension?.name;
  const parentApps = Array.isArray(extension?.parentApps)
    ? extension.parentApps
    : [];

  for (const parentApp of parentApps) {
    for (const parentAlias of getCostAliasKeys(parentApp)) {
      for (const extensionAlias of getCostAliasKeys(extensionName)) {
        const parentCost = costCatalog.extensionParentCosts.get(
          `${parentAlias}::${extensionAlias}`
        );
        if (Number.isFinite(parentCost)) return parentCost;
      }
    }
  }

  return findCatalogCost(costCatalog.extensionCosts, extensionName);
}

function findExtensionCatalogSubscriptionType(extension, costCatalog = appCostCatalog) {
  const extensionName =
    typeof extension === 'string' ? extension : extension?.name;
  const parentApps = Array.isArray(extension?.parentApps)
    ? extension.parentApps
    : [];

  for (const parentApp of parentApps) {
    for (const parentAlias of getCostAliasKeys(parentApp)) {
      for (const extensionAlias of getCostAliasKeys(extensionName)) {
        const parentSubscriptionType =
          costCatalog.extensionParentSubscriptionTypes.get(
            `${parentAlias}::${extensionAlias}`
          );
        if (parentSubscriptionType) return parentSubscriptionType;
      }
    }
  }

  for (const extensionAlias of getCostAliasKeys(extensionName)) {
    const subscriptionType =
      costCatalog.extensionSubscriptionTypes.get(extensionAlias);
    if (subscriptionType) return subscriptionType;
  }

  return null;
}

function getMonthlyCost(appName, index, costCatalog = appCostCatalog) {
  const configuredCost = findCatalogCost(costCatalog.appCosts, appName);
  if (Number.isFinite(configuredCost)) return configuredCost;

  const normalizedName = String(appName || '').toLowerCase();
  const matchingKey = Object.keys(pricingMap).find((key) =>
    normalizedName.includes(key.toLowerCase())
  );

  if (matchingKey) {
    return pricingMap[matchingKey];
  }

  return fallbackCosts[index % fallbackCosts.length];
}

function getCostKey(pcName, appName) {
  return `${String(pcName || '').toLowerCase()}::${String(appName || '').toLowerCase()}`;
}

function getSyncedAppCost(costOverrides, pcName, appName, fallbackCost) {
  const syncedCost = costOverrides[getCostKey(pcName, appName)];
  return Number.isFinite(syncedCost) ? syncedCost : fallbackCost;
}

function readCostValue(entry) {
  const value =
    entry?.monthly_cost ??
    entry?.monthlyCost ??
    entry?.unit_monthly_cost ??
    entry?.license_cost ??
    entry?.licenseCost ??
    entry?.cost ??
    entry?.amount;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getExtensionMonthlyCost(extension, index, costCatalog = appCostCatalog) {
  const configCost = Number(extension?.license_cost ?? extension?.licenseCost);
  if (Number.isFinite(configCost)) return configCost;

  const configuredCost = findExtensionCatalogCost(extension, costCatalog);
  if (Number.isFinite(configuredCost)) return configuredCost;

  const extensionName = typeof extension === 'string' ? extension : extension?.name;
  const normalizedName = String(extensionName || '').toLowerCase();
  const matchingKey = Object.keys(extensionPricingMap).find((key) =>
    normalizedName.includes(key)
  );

  if (matchingKey) {
    return extensionPricingMap[matchingKey];
  }

  return fallbackExtensionCosts[index % fallbackExtensionCosts.length];
}

function getConfiguredModelSubscriptionTypes(extension, modelName) {
  const modelSpecificTypes = extension.aiModelLicenseTypes?.[modelName];
  if (modelSpecificTypes?.length > 0) return modelSpecificTypes;

  const normalizedModelName = modelName.toLowerCase();
  const matchingKey = Object.keys(aiModelSubscriptionMap).find((key) =>
    normalizedModelName.includes(key)
  );

  if (matchingKey) {
    return [aiModelSubscriptionMap[matchingKey]];
  }

  return ['Subscription not reported'];
}

function getSubscriptionKey(subscriptionType) {
  return String(subscriptionType || '').trim().toLowerCase();
}

function addUniqueSubscriptionType(subscriptionTypes, subscriptionType) {
  const subscriptionKey = getSubscriptionKey(subscriptionType);
  if (!subscriptionKey) return;

  const hasSubscriptionType = subscriptionTypes.some(
    (existingType) => getSubscriptionKey(existingType) === subscriptionKey
  );

  if (!hasSubscriptionType) {
    subscriptionTypes.push(subscriptionType);
  }
}

function getDiscoveredAppMonthlyCost(appName, index, costCatalog = appCostCatalog) {
  const configuredCost = findCatalogCost(costCatalog.appCosts, appName);
  if (Number.isFinite(configuredCost)) return configuredCost;

  const normalizedName = String(appName || '').toLowerCase();
  const matchingKey = Object.keys(pricingMap).find((key) =>
    normalizedName.includes(key.toLowerCase())
  );

  if (matchingKey) {
    return pricingMap[matchingKey];
  }

  return fallbackDiscoveredAppCosts[index % fallbackDiscoveredAppCosts.length];
}

function getAppIcon(appName) {
  return appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function titleCaseIdentifier(identifier) {
  return identifier
    .replace(/\.[^/.]+$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getReadableAppIdentity(appName) {
  const normalizedName = String(appName).trim();
  const lookupKey = normalizedName.toLowerCase();
  const displayName = appDisplayNames[lookupKey] || titleCaseIdentifier(normalizedName);

  return {
    displayName,
    rawName: normalizedName,
    shouldShowRawName: displayName.toLowerCase() !== lookupKey,
  };
}

function getTelemetryPcName(payload) {
  return (
    payload?.pc_name ||
    payload?.pcName ||
    payload?.computer_name ||
    payload?.computerName ||
    payload?.hostname ||
    payload?.device_name ||
    payload?.deviceName ||
    'Unknown device'
  );
}

// License Utilizations groups usage by what is paid for: one row per license
// on each PC, with the surfaces it is used through (desktop app, extensions in
// other apps, web) underneath. A host app such as VS Code keeps its own row
// and lists the extensions that run in it, so no runtime or cost is repeated.
const STATUS_RANK = { Active: 0, Evaluating: 1, Reclaimable: 2, 'Not installed': 3 };

// Web addresses of common licenses, keyed by licenseKey(subscription name).
const KNOWN_WEB_APPS = {
  claude: 'https://claude.ai',
  codex: 'https://chatgpt.com/codex',
  githubcopilot: 'https://github.com/copilot',
  copilot: 'https://copilot.microsoft.com',
  figma: 'https://www.figma.com',
  zoom: 'https://app.zoom.us',
  postman: 'https://web.postman.co',
  vscode: 'https://vscode.dev',
  visualstudiocode: 'https://vscode.dev',
  notion: 'https://www.notion.so',
  miro: 'https://miro.com',
  canva: 'https://www.canva.com',
  microsoftteams: 'https://teams.microsoft.com',
  teams: 'https://teams.microsoft.com',
  microsoft365: 'https://www.office.com',
  adobecreativecloud: 'https://creativecloud.adobe.com',
};

function webAddressHost(value) {
  try {
    return new URL(String(value || '')).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function licenseKey(value) {
  return String(value || '').toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');
}

// Surfaces the Tracker has actually seen used.
function trackedSurfaceCount(group) {
  return group.surfaces.filter((surface) => !surface.notTracked && surface.lastSeenAt).length;
}

function groupStatus(surfaces) {
  const ranked = [...surfaces].sort(
    (first, second) => (STATUS_RANK[first.status] ?? 9) - (STATUS_RANK[second.status] ?? 9)
  );
  const best = ranked[0];
  if (!best) return { status: 'Evaluating', reason: 'No usage reported yet' };
  // Not installed only when no surface is installed; otherwise the best surface decides.
  const installed = ranked.find((surface) => surface.status !== 'Not installed');
  const decider = installed || best;
  return { status: decider.status, reason: decider.reclaimReason || '' };
}

const SURFACE_ORDER = { 'Desktop app': 0, Extension: 1, 'Web app': 2 };

function inventoryItemId(appType, name) {
  return `${appType}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function isAiLicenseGroup(group) {
  if (productSurfaces(group.productId).some((entry) => String(entry.category).startsWith('AI'))) return true;
  return group.surfaces.some((surface) => surface.surface === 'Extension' && surface.type === 'agent' && !surface.host);
}

function catalogSurfaceLabel(entry) {
  if (entry.appType === 'Extension') return 'Extension';
  if (entry.appType === 'Web URL') return 'Web app';
  return 'Desktop app';
}

function emptySurface(fields) {
  return {
    status: '',
    notTracked: true,
    monthlyCost: 0,
    totalRuntimeSeconds: 0,
    workedRuntimeSeconds: 0,
    automationWorkedSeconds: 0,
    idleRuntimeSeconds: 0,
    ...fields,
  };
}

function buildLicenseGroups(deviceUsages, deploymentPolicyRecords = [], inventoryApps = []) {
  const subscriptionFor = (pcName, appName) => {
    const record = deploymentPolicyRecords.find(
      (item) =>
        !item.parent_app &&
        String(item.target_pc || '').toLowerCase() === String(pcName || '').toLowerCase() &&
        String(item.app_name || '').toLowerCase() === String(appName || '').toLowerCase()
    );
    return record?.subscriptionType || '';
  };
  const hostName = (host) => getReadableAppIdentity(host).displayName;
  const groups = [];

  deviceUsages.forEach((usage) => {
    const pcName = usage.currentPcName;
    const pcGroups = new Map();
    const addSurface = (key, name, icon, surface) => {
      if (!pcGroups.has(key)) {
        pcGroups.set(key, { id: `${pcName}|${key}`, pcName, name, icon, surfaces: [], hostsExtensions: [] });
      }
      const group = pcGroups.get(key);
      if (surface.productId) group.productId = surface.productId;
      group.surfaces.push(surface);
      return group;
    };
    // A recognised surface names its product, which is the license it belongs to.
    const productKey = (catalog) => (catalog?.product ? licenseKey(PRODUCTS[catalog.product] || catalog.product) : null);
    const findGroup = (candidates) => {
      for (const candidate of candidates.map(licenseKey).filter(Boolean)) {
        if (pcGroups.has(candidate)) return candidate;
        const match = [...pcGroups.keys()].find((key) => candidate.startsWith(key));
        if (match) return match;
      }
      return null;
    };
    const groupByApp = new Map();
    const hostedBy = new Map();
    const noteHost = (host, name) => {
      const hostKey = String(host || '').toLowerCase();
      if (!hostedBy.has(hostKey)) hostedBy.set(hostKey, new Set());
      hostedBy.get(hostKey).add(name);
    };

    usage.usageByApp.forEach((entry) => {
      const catalog = findCatalogSurface({ appType: 'Application', processName: entry.appName });
      const name = (catalog && PRODUCTS[catalog.product]) || subscriptionFor(pcName, entry.appName) || entry.displayName;
      const key = productKey(catalog) || licenseKey(name);
      groupByApp.set(String(entry.appName).toLowerCase(), { key, name, icon: entry.icon });
      const group = addSurface(key, name, entry.icon, {
        ...entry,
        hasAgentExtension: entry.hasAgentExtension || entry.automationWorkedSeconds > 0,
        surface: 'Desktop app',
        detail: entry.rawName || entry.appName,
        catalogId: catalog?.id,
        productId: catalog?.product,
      });
      group.inventoryApp = inventoryApps.find(
        (app) => String(app.processName).toLowerCase() === String(entry.appName).toLowerCase()
      );
    });
    const licenseOf = (appName) => groupByApp.get(String(appName || '').toLowerCase());

    // Extensions with their own detection rule (GitHub Copilot, Codex).
    usage.usageByExtension.forEach((extension) => {
      const catalog = findCatalogSurface({ appType: 'Extension', processName: extension.name, appName: extension.name });
      const candidates = [...(extension.subscriptionTypes || []), extension.name];
      const key = productKey(catalog) || findGroup(candidates) || licenseKey(candidates[0]);
      const name = (catalog && PRODUCTS[catalog.product]) || candidates[0];
      // The hosts it has actually been seen in, from the Tracker.
      const hostRows = usage.usageByEmbedded.filter((row) => row.appName === extension.name);
      hostRows.forEach((row) => noteHost(row.host, name));
      const hosts = hostRows.map((row) => hostName(row.host));
      addSurface(key, name, extension.icon, {
        ...extension,
        surface: 'Extension',
        detail: hosts.length > 0 ? `${extension.name} · used in ${hosts.join(', ')}` : extension.name,
        lastSeenAt: hostRows.map((row) => row.lastSeenAt).filter(Boolean).sort().at(-1) || extension.lastSeenAt,
        catalogId: catalog?.id,
        productId: catalog?.product,
      });
    });

    // The licensed program itself working inside another app (Claude Code in VS Code).
    usage.usageByEmbedded.forEach((row) => {
      const license = licenseOf(row.appName);
      if (!license) return;
      noteHost(row.host, license.name);
      addSurface(license.key, license.name, license.icon, {
        ...row,
        type: 'agent',
        status: '',
        monthlyCost: 0,
        surface: 'Extension',
        detail: `Used in ${hostName(row.host)}`,
      });
    });

    // The license's web version open in the focused browser tab.
    usage.usageByWeb.forEach((row) => {
      const license = licenseOf(row.appName);
      if (!license) return;
      const group = pcGroups.get(license.key);
      const web = productSurfaces(group?.productId).find((entry) => entry.appType === 'Web URL');
      addSurface(license.key, license.name, license.icon, {
        ...row,
        status: '',
        monthlyCost: 0,
        surface: 'Web app',
        detail: web ? `https://${web.url}` : KNOWN_WEB_APPS[license.key] || 'Web version',
        catalogId: web?.id,
      });
    });

    // Web addresses deployed from the inventory (Web URL items).
    usage.usageByUrl.forEach((url) => {
      const address = licenseKey(url.url);
      const host = webAddressHost(url.url);
      const catalog = findCatalogSurface({ appType: 'Web URL', url: url.url });
      const key =
        (pcGroups.has(productKey(catalog)) && productKey(catalog)) ||
        [...pcGroups.keys()].find(
          (candidate) =>
            candidate &&
            (address.includes(candidate) || (host && webAddressHost(KNOWN_WEB_APPS[candidate]) === host))
        );
      if (!key) return;
      const group = pcGroups.get(key);
      if (group.surfaces.some((surface) => surface.surface === 'Web app' && !surface.notTracked)) return;
      group.surfaces.push({
        ...url,
        catalogId: catalog?.id,
        surface: 'Web app',
        detail: url.url,
        status: '',
        monthlyCost: 0,
        totalRuntimeSeconds: url.trackedRuntimeSeconds,
      });
    });

    pcGroups.forEach((group, key) => {
      // A recognised product shows each kind of surface it has; one not seen yet says so.
      const present = new Set(group.surfaces.map((surface) => surface.surface));
      const { webUrl, trackExtensions } = group.inventoryApp || {};
      if (webUrl && !present.has('Web app')) {
        present.add('Web app');
        group.surfaces.push(emptySurface({ surface: 'Web app', detail: webUrl }));
      }
      productSurfaces(group.productId).forEach((entry) => {
        const label = catalogSurfaceLabel(entry);
        if (present.has(label)) return;
        if (label === 'Extension' && trackExtensions === false) return;
        present.add(label);
        group.surfaces.push(
          emptySurface({
            surface: label,
            catalogId: entry.id,
            detail:
              label === 'Web app'
                ? `https://${entry.url}`
                : label === 'Extension'
                  ? entry.appName
                  : entry.processName || entry.appName,
          })
        );
      });
      if (trackExtensions === true && !present.has('Extension')) {
        group.surfaces.push(emptySurface({ surface: 'Extension', detail: 'Any extension' }));
      }
      // Every license shows its web line.
      if (!present.has('Web app')) {
        group.surfaces.push(
          emptySurface({ surface: 'Web app', detail: KNOWN_WEB_APPS[key] || 'No web address set' })
        );
      }
      group.surfaces.sort(
        (first, second) => (SURFACE_ORDER[first.surface] ?? 1) - (SURFACE_ORDER[second.surface] ?? 1)
      );
    });

    pcGroups.forEach((group) => {
      const hostApps = group.surfaces
        .filter((surface) => surface.surface === 'Desktop app' && surface.appName)
        .map((surface) => String(surface.appName).toLowerCase());
      const hosted = new Set();
      hostApps.forEach((host) => (hostedBy.get(host) || []).forEach((name) => hosted.add(name)));
      hosted.delete(group.name);
      group.hostsExtensions = [...hosted].map((name) => ({ name }));
      const decided = group.surfaces.filter((surface) => surface.status);
      const { status, reason } = groupStatus(decided);
      const sum = (field) => group.surfaces.reduce((total, surface) => total + (Number(surface[field]) || 0), 0);
      // Surfaces of one license share its cost; take it once.
      const monthlyCost = Math.max(0, ...group.surfaces.map((surface) => Number(surface.monthlyCost) || 0));
      groups.push({
        ...group,
        status,
        reclaimReason: reason,
        monthlyCost,
        savingsOpportunity: status === 'Reclaimable' ? monthlyCost : 0,
        totalRuntimeSeconds: sum('totalRuntimeSeconds'),
        workedRuntimeSeconds: sum('workedRuntimeSeconds'),
        automationWorkedSeconds: sum('automationWorkedSeconds'),
        idleRuntimeSeconds: sum('idleRuntimeSeconds'),
        hasAgentExtension: group.surfaces.some((surface) => surface.type === 'agent' || surface.hasAgentExtension),
      });
    });
  });
  return groups;
}

// A seat below its policy's active time stays in use when its user meets any
// vendor activity field in the policy (checked by the backend per deployed
// user). The group keeps the checks so the reason can say which one.
function applyVendorRuleResults(groups, results = []) {
  if (results.length === 0) return groups;
  const lower = (value) => String(value || '').trim().toLowerCase();
  return groups.map((group) => {
    const names = new Set([group.name, ...group.surfaces.flatMap((surface) => [surface.appName, surface.name])].map(lower));
    const result = results.find((item) => lower(item.pcName) === lower(group.pcName) && names.has(lower(item.processName)));
    if (!result) return group;
    const met = (result.checks || []).filter((check) => check.met);
    const described = (check) =>
      check.kind === 'within'
        ? `${check.label} ${check.threshold} days (${check.value === 0 ? 'today' : `${check.value} days ago`})`
        : `${check.label} ${check.value} (needs ${check.threshold})`;
    const vendorRule = { ...result, metText: met.map(described).join('; ') };
    if (group.status !== 'Reclaimable' || met.length === 0) return { ...group, vendorRule };
    return {
      ...group,
      vendorRule,
      status: 'Active',
      reclaimReason: `Kept by vendor activity: ${vendorRule.metText}${result.mode === 'sample' ? ' (sample data)' : ''}`,
      savingsOpportunity: 0,
    };
  });
}

const DEVICE_LIVE_MS = 15 * 60 * 1000;

// Older Trackers send no installed_apps; RabbitMQ events nest the sample in `usage`.
function getInstalledApps(payload) {
  const installed = payload?.usage?.installed_apps || payload?.installed_apps;
  return installed && typeof installed === 'object' && !Array.isArray(installed) ? installed : null;
}

// Decisions for the evaluation window that has just closed. A window with no
// samples (PC off or offline) still closes, with zero worked runtime.
function computeCompletedDecisions({
  telemetryHistory,
  config,
  currentPcName,
  deploymentPolicyRecords,
  evaluationSeriesStartsAt,
  evaluationWindow,
  effectiveEvaluationWindowSeconds,
  completedEvaluationDecisions,
}) {
  const originalStartsAt = evaluationSeriesStartsAt;
  if (!config || !originalStartsAt || evaluationWindow.startsAt <= originalStartsAt) {
    return {};
  }

  const completedAt = evaluationWindow.startsAt;
  const completedStartsAt = completedAt - effectiveEvaluationWindowSeconds * 1000;
  const countersByName = new Map();
  telemetryHistory.forEach((payload) => {
    const timestampMs = getTelemetryTimestampMs(payload);
    if (
      timestampMs === null ||
      timestampMs < completedStartsAt ||
      timestampMs >= completedAt
    ) return;

    getUsageEntries(payload).forEach((entry) => {
      const current = countersByName.get(entry.app_name) || createUsageCounters();
      const next = readUsageCounters(entry);
      Object.keys(current).forEach((key) => {
        if (typeof current[key] === 'number') current[key] += Number(next[key]) || 0;
      });
      countersByName.set(entry.app_name, current);
    });
  });


  const nextDecisions = {};
  const addDecision = (name, type, policy, workedRuntimeSeconds, consumedTokens = 0) => {
    const key = getEvaluationDecisionKey(
      currentPcName,
      type,
      name,
      originalStartsAt
    );
    const existing = completedEvaluationDecisions[key];
    if (existing?.completedAt >= completedAt) return;
    nextDecisions[key] = {
      ...getReclaimDecision({
        policy,
        workedRuntimeSeconds,
        consumedTokens,
        evaluationComplete: true,
      }),
      completedAt,
    };
  };

  (config.licensed_apps || []).forEach((appName) => {
    const counters = countersByName.get(appName) || createUsageCounters();
    const type = getAppType(config, appName);
    const policy = getStoredReclaimPolicy(
      deploymentPolicyRecords,
      currentPcName,
      appName,
      getAppPolicy(config, appName),
      { type }
    );
    addDecision(appName, type, policy, licenseWorkedSeconds(countersByName, appName));
  });

  getUniqueExtensionRules(config.extensions || []).forEach((extension) => {
    const counters = extensionUsageCounters(countersByName, extension.name);
    const policy = getStoredReclaimPolicy(
      deploymentPolicyRecords,
      currentPcName,
      extension.name,
      extension.reclaimPolicy || DEFAULT_RECLAIM_POLICY,
      { type: extension.type, parentApp: extension.parentApps }
    );
    addDecision(
      extension.name,
      extension.type,
      policy,
      extension.type === 'agent'
        ? counters.automationWorkedSeconds
        : counters.workedRuntimeSeconds,
      counters.consumedTokens
    );
  });

  return nextDecisions;
}

// One Tracker's samples through its evaluation window and reclaim policies.
// App runs it for the focused device, and for every registered device in the
// License Utilizations table.
function computeDeviceUsage({
  telemetryHistory,
  savedConfig,
  deploymentPolicyRecords,
  lastDeploymentConfig,
  onboardedAppLicenses,
  costOverrides,
  completedEvaluationDecisions: storedEvaluationDecisions,
  currentTimeMs,
}) {
  const latestTelemetry = telemetryHistory.at(-1) || null;
  const currentPcName = getTelemetryPcName(latestTelemetry);
  // Trackers no longer serve their runtime config to the browser (telemetry
  // goes through the backend), so derive it from the saved deployment records
  // when no stored config exists.
  const config =
    savedConfig || deriveTrackerConfig(deploymentPolicyRecords, lastDeploymentConfig, currentPcName);
  const effectiveUsageWindowSeconds =
    config?.usage_window_seconds || DEFAULT_USAGE_WINDOW_SECONDS;
  const fallbackEvaluationWindowSeconds = getOnboardedEvaluationWindowSeconds(
    onboardedAppLicenses,
    DEFAULT_RECLAIM_POLICY.evaluation_window_seconds
  );
  const effectiveEvaluationWindow = getDeploymentEvaluationWindowConfig(
    deploymentPolicyRecords,
    currentPcName,
    fallbackEvaluationWindowSeconds
  );
  const effectiveEvaluationWindowSeconds = effectiveEvaluationWindow.seconds;

  const telemetryWindow = (() => {
    const latestTimestampMs = getTelemetryTimestampMs(latestTelemetry);
    const fallbackTimestampMs = Date.now();
    const windowEndsAt = latestTimestampMs || fallbackTimestampMs;
    const windowStartsAt = windowEndsAt - effectiveUsageWindowSeconds * 1000;

    const windowHistory = telemetryHistory.filter((payload) => {
      const timestampMs = getTelemetryTimestampMs(payload);
      return timestampMs !== null && timestampMs >= windowStartsAt;
    });

    const firstSampleTimestampMs =
      windowHistory.length > 0
        ? getTelemetryTimestampMs(windowHistory[0])
        : null;

    return {
      history: windowHistory,
      startsAt: firstSampleTimestampMs || windowStartsAt,
      endsAt: windowEndsAt,
      sampleCount: windowHistory.length,
    };
  })();

  const evaluationSeriesStartsAt = (() => {
    if (effectiveEvaluationWindow.startsAt) return effectiveEvaluationWindow.startsAt;
    const firstTelemetryTimestamp = telemetryHistory
      .map(getTelemetryTimestampMs)
      .filter((value) => value !== null)
      .sort((first, second) => first - second)[0];
    return firstTelemetryTimestamp || telemetryWindow.endsAt;
  })();

  const evaluationWindow = (() => {
    const baseWindow = getCurrentEvaluationWindow(
      evaluationSeriesStartsAt,
      evaluationSeriesStartsAt + effectiveEvaluationWindowSeconds * 1000,
      currentTimeMs
    );
    const windowStartsAt = baseWindow.startsAt;
    const windowEndsAt = baseWindow.endsAt;
    const windowHistory = telemetryHistory.filter((payload) => {
      const timestampMs = getTelemetryTimestampMs(payload);
      return (
        timestampMs !== null &&
        timestampMs >= windowStartsAt &&
        timestampMs <= windowEndsAt
      );
    });

    return {
      history: windowHistory,
      startsAt: windowStartsAt,
      endsAt: windowEndsAt,
      sampleCount: windowHistory.length,
      isAgentReported: false,
      hasExpiredReportedWindow: false,
    };
  })();

  const newDecisions = computeCompletedDecisions({
    telemetryHistory,
    config,
    currentPcName,
    deploymentPolicyRecords,
    evaluationSeriesStartsAt,
    evaluationWindow,
    effectiveEvaluationWindowSeconds,
    completedEvaluationDecisions: storedEvaluationDecisions,
  });
  const completedEvaluationDecisions = { ...storedEvaluationDecisions, ...newDecisions };

  const accumulatedUsage = (() => {
    const usageMap = new Map();

    if (evaluationWindow.hasExpiredReportedWindow) {
      return usageMap;
    }

    const history = evaluationWindow.history;

    history.forEach((payload) => {
      getUsageEntries(payload).forEach((entry) => {
        const existing = usageMap.get(entry.app_name) || createUsageCounters();
        const next = readUsageCounters(entry);
        usageMap.set(entry.app_name, {
          trackedRuntimeSeconds:
            existing.trackedRuntimeSeconds + next.trackedRuntimeSeconds,
          foregroundRuntimeSeconds:
            existing.foregroundRuntimeSeconds + next.foregroundRuntimeSeconds,
          workedRuntimeSeconds:
            existing.workedRuntimeSeconds + next.workedRuntimeSeconds,
          automationWorkedSeconds:
            existing.automationWorkedSeconds + next.automationWorkedSeconds,
          backgroundAutomationWorkedSeconds:
            existing.backgroundAutomationWorkedSeconds +
            next.backgroundAutomationWorkedSeconds,
          idleRuntimeSeconds:
            existing.idleRuntimeSeconds + next.idleRuntimeSeconds,
          consumedTokens: existing.consumedTokens + next.consumedTokens,
          selectedAiModel: next.selectedAiModel || existing.selectedAiModel,
          tokenSource: next.tokenSource || existing.tokenSource,
        });
      });
    });
    return usageMap;
  })();

  // While the PC is live, its latest report says which deployed apps the
  // Tracker found installed; a missing one shows as Not installed.
  const latestSampleMs = getTelemetryTimestampMs(latestTelemetry);
  const installedApps =
    latestSampleMs !== null && currentTimeMs - latestSampleMs <= DEVICE_LIVE_MS
      ? getInstalledApps(latestTelemetry)
      : null;

  const usageByApp = (() => {
    if (!config) return [];

    return config.licensed_apps.map((appName, index) => {
      const appIdentity = getReadableAppIdentity(appName);
      const usageCounters = getUsageCounters(accumulatedUsage, appName);
      const totalRuntimeSeconds = usageCounters.trackedRuntimeSeconds;
      const workedRuntimeSeconds = usageCounters.workedRuntimeSeconds;
      const automationWorkedSeconds = usageCounters.automationWorkedSeconds;
      const idleRuntimeSeconds = usageCounters.idleRuntimeSeconds;
      const baseMonthlyCost = getMonthlyCost(appName, index);
      const monthlyCost = getSyncedAppCost(
        costOverrides,
        currentPcName,
        appName,
        baseMonthlyCost
      );
      const appType = getAppType(config, appName);
      const reclaimPolicy = getStoredReclaimPolicy(
        deploymentPolicyRecords,
        currentPcName,
        appName,
        getAppPolicy(config, appName),
        { type: appType }
      );
      const firstSeenAt = getAppFirstSeenAt(config, appName);
      const telemetryLastResetForAppMs = getTelemetryLastResetForAppMs(
        latestTelemetry,
        appName
      );
      const lastSeenAt = telemetryLastResetForAppMs
        ? new Date(telemetryLastResetForAppMs).toISOString()
        : getLastSeenAt(config, telemetryHistory, appName);
      const hasAgentExtension = appHasAgentExtension(config, appName);
      const notInstalled = installedApps?.[String(appName).toLowerCase()] === false;
      const policyUsageCounters = {
        ...usageCounters,
        workedRuntimeSeconds: licenseWorkedSeconds(accumulatedUsage, appName),
      };
      const reclaimDecision = getReclaimDecision({
        policy: reclaimPolicy,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        previousDecision:
          completedEvaluationDecisions[
            getEvaluationDecisionKey(
              currentPcName,
              appType,
              appName,
              evaluationSeriesStartsAt
            )
          ],
      });

      return {
        appName,
        ...appIdentity,
        pcName: currentPcName,
        icon: getAppIcon(appIdentity.displayName),
        status: notInstalled ? 'Not installed' : reclaimDecision.status,
        appType,
        hasAgentExtension,
        reclaimReason: notInstalled ? 'The Tracker did not find this app on the PC' : reclaimDecision.reason,
        firstSeenAt,
        lastSeenAt,
        reclaimPolicy,
        totalRuntimeSeconds,
        workedRuntimeSeconds,
        automationWorkedSeconds,
        idleRuntimeSeconds,
        utilizationPercent: getPolicyUtilizationPercent(
          workedRuntimeSeconds,
          reclaimPolicy
        ),
        monthlyCost,
        savingsOpportunity: !notInstalled && reclaimDecision.savingsEligible ? monthlyCost : 0,
      };
    });
  })();

  const usageByUrl = (() => {
    if (!config?.tracked_urls) return [];

    return config.tracked_urls.map((url) => ({
      url,
      ...getUsageCounters(accumulatedUsage, `url:${url}`),
    }));
  })();

  // Surfaces the Tracker found on its own; listed once seen in any sample, with
  // this window's counters.
  const surfaceNames = new Set();
  telemetryHistory.forEach((payload) =>
    getUsageEntries(payload).forEach((entry) => {
      const name = String(entry.app_name || '');
      if (name.startsWith('ext:') || name.startsWith('web:')) surfaceNames.add(name);
    })
  );
  const surfaceRow = (name, fields) => {
    const counters = getUsageCounters(accumulatedUsage, name);
    return {
      ...fields,
      ...counters,
      totalRuntimeSeconds: counters.trackedRuntimeSeconds,
      lastSeenAt: getLastSeenAt(null, telemetryHistory, name),
    };
  };
  const usageByEmbedded = [...surfaceNames]
    .filter((name) => name.startsWith('ext:'))
    .map((name) => {
      const [appName, host] = name.slice('ext:'.length).split('@');
      return surfaceRow(name, { appName, host });
    });
  const usageByWeb = [...surfaceNames]
    .filter((name) => name.startsWith('web:'))
    .map((name) => surfaceRow(name, { appName: name.slice('web:'.length) }));

  const usageByExtension = (() => {
    if (!config?.extensions) return [];

    return getUniqueExtensionRules(config.extensions).map((extension, index) => {
      const usageCounters = extensionUsageCounters(accumulatedUsage, extension.name);
      const isAgentExtension = extension.type === 'agent';
      const automationWorkedSeconds = usageCounters.automationWorkedSeconds;
      const totalRuntimeSeconds = isAgentExtension
        ? automationWorkedSeconds
        : usageCounters.trackedRuntimeSeconds;
      const workedRuntimeSeconds = isAgentExtension
        ? automationWorkedSeconds
        : usageCounters.workedRuntimeSeconds;
      const idleRuntimeSeconds = usageCounters.idleRuntimeSeconds;
      const unitMonthlyCost = getExtensionMonthlyCost(extension, index);
      const lastSeenAt = getLastSeenAt(
        config,
        telemetryHistory,
        extension.name,
        extension.lastSeenAt
      );
      const reclaimPolicy = getStoredReclaimPolicy(
        deploymentPolicyRecords,
        currentPcName,
        extension.name,
        extension.reclaimPolicy || DEFAULT_RECLAIM_POLICY,
        { type: extension.type, parentApp: extension.parentApps }
      );
      const policyUsageCounters = {
        ...usageCounters,
        workedRuntimeSeconds,
      };
      const modelUsage = getModelUsageForExtension(accumulatedUsage, extension.name);
      const activeModelNames = modelUsage
        .filter((model) => model.workedRuntimeSeconds > 0)
        .map((model) => model.name);
      const selectedAiModel =
        usageCounters.selectedAiModel ||
        modelUsage.find((model) => model.name)?.name ||
        null;
      const consumedTokens =
        usageCounters.consumedTokens ||
        modelUsage.reduce((sum, model) => sum + model.consumedTokens, 0);
      const tokenSource =
        usageCounters.tokenSource ||
        modelUsage.find((model) => model.tokenSource)?.tokenSource ||
        null;
      const reclaimDecision = getReclaimDecision({
        policy: reclaimPolicy,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        consumedTokens,
        previousDecision:
          completedEvaluationDecisions[
            getEvaluationDecisionKey(
              currentPcName,
              extension.type,
              extension.name,
              evaluationSeriesStartsAt
            )
          ],
      });
      const detectedPcNames = getDetectedPcNamesForUsage(
        telemetryHistory,
        extension.name
      );
      const detectedSeatCount =
        detectedPcNames.length > 0 || totalRuntimeSeconds === 0
          ? detectedPcNames.length
          : 1;
      const configuredSeatCount = Math.max(1, extension.parentApps.length);
      const modelLicenseBreakdown = getModelLicenseBreakdown({
        ...extension,
        modelUsage,
        aiModels: extension.aiModels,
      });

      return {
        ...extension,
        icon: getAppIcon(extension.name),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * configuredSeatCount,
        detectedPcNames,
        detectedSeatCount,
        configuredSeatCount,
        activeModelNames,
        modelUsage,
        modelLicenseBreakdown,
        status: reclaimDecision.status,
        reclaimReason: reclaimDecision.reason,
        reclaimPolicy,
        firstSeenAt: extension.firstSeenAt,
        lastSeenAt,
        selectedAiModel,
        consumedTokens,
        tokenSource,
        totalRuntimeSeconds,
        workedRuntimeSeconds,
        automationWorkedSeconds,
        idleRuntimeSeconds,
        utilizationPercent: getPolicyUtilizationPercent(
          workedRuntimeSeconds,
          reclaimPolicy
        ),
      };
    });
  })();

  return {
    latestTelemetry,
    currentPcName,
    config,
    effectiveUsageWindowSeconds,
    effectiveEvaluationWindow,
    effectiveEvaluationWindowSeconds,
    telemetryWindow,
    evaluationSeriesStartsAt,
    evaluationWindow,
    accumulatedUsage,
    usageByApp,
    usageByUrl,
    usageByExtension,
    usageByEmbedded,
    usageByWeb,
    newDecisions,
  };
}

function getHourlyEngagementKey(timestampMs) {
  const date = new Date(timestampMs);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

function formatHourlyEngagementLabel(timestampMs) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestampMs));
}

function getUniqueExtensionRules(extensions = []) {
  const extensionMap = new Map();

  extensions.forEach((extension) => {
    if (!extension?.name) return;

    const key = extension.name;
    const existing = extensionMap.get(key) || {
      name: extension.name,
      parentApps: [],
      aiModels: [],
      aiModelLicenseTypes: {},
      subscriptionTypes: [],
      identifiers: [],
      matchAll: [],
      reclaimPolicy: extension.reclaim_policy,
      license_cost: extension.license_cost,
      firstSeenAt: extension.first_seen_at,
      lastSeenAt: extension.last_seen_at || extension.lastSeenAt,
      type: extension.type || 'extension',
    };

    if (extension.parent_app && !existing.parentApps.includes(extension.parent_app)) {
      existing.parentApps.push(extension.parent_app);
    }

    if (extension.ai_model && !existing.aiModels.includes(extension.ai_model)) {
      existing.aiModels.push(extension.ai_model);
    }

    if (extension.ai_model) {
      const licenseType =
        extension.subscriptionType ||
        extension.ai_model_subscription ||
        extension.ai_model_license_type ||
        extension.ai_model_licence_type ||
        extension.subscription_type ||
        extension.license_type ||
        extension.licence_type ||
        extension.plan ||
        extension.tier;

      if (licenseType) {
        const existingLicenseTypes =
          existing.aiModelLicenseTypes[extension.ai_model] || [];

        addUniqueSubscriptionType(existingLicenseTypes, licenseType);

        existing.aiModelLicenseTypes[extension.ai_model] = existingLicenseTypes;
      }
    }

      const subscriptionType = extension.subscriptionType || extension.subscription_type;
    const catalogSubscriptionType = findExtensionCatalogSubscriptionType({
      name: extension.name,
      parentApps: extension.parent_app ? [extension.parent_app] : existing.parentApps,
    });
    const displaySubscriptionType = subscriptionType || catalogSubscriptionType;
    addUniqueSubscriptionType(existing.subscriptionTypes, displaySubscriptionType);

    if (extension.ai_model && !subscriptionType && catalogSubscriptionType) {
      const existingLicenseTypes =
        existing.aiModelLicenseTypes[extension.ai_model] || [];
      addUniqueSubscriptionType(existingLicenseTypes, catalogSubscriptionType);
      existing.aiModelLicenseTypes[extension.ai_model] = existingLicenseTypes;
    }

    if (!existing.reclaimPolicy && extension.reclaim_policy) {
      existing.reclaimPolicy = extension.reclaim_policy;
    }

    if (!existing.firstSeenAt && extension.first_seen_at) {
      existing.firstSeenAt = extension.first_seen_at;
    }

    if (!existing.lastSeenAt && (extension.last_seen_at || extension.lastSeenAt)) {
      existing.lastSeenAt = extension.last_seen_at || extension.lastSeenAt;
    }

    if (extension.type && !existing.type) {
      existing.type = extension.type;
    }

    (extension.identifiers || []).forEach((identifier) => {
      if (!existing.identifiers.includes(identifier)) {
        existing.identifiers.push(identifier);
      }
    });

    (extension.match_all || []).forEach((identifier) => {
      if (!existing.matchAll.includes(identifier)) {
        existing.matchAll.push(identifier);
      }
    });

    extensionMap.set(key, existing);
  });

  return Array.from(extensionMap.values());
}

function getModelUsageForExtension(usageMap, extensionName) {
  const usagePrefix = `ai_model:${extensionName}:`;

  return Array.from(usageMap.entries())
    .filter(([appName]) => appName.startsWith(usagePrefix))
    .map(([appName, counters]) => {
      const usageCounters = counters || createUsageCounters();
      return {
        name: appName.slice(usagePrefix.length),
        totalRuntimeSeconds: usageCounters.trackedRuntimeSeconds,
        workedRuntimeSeconds: usageCounters.workedRuntimeSeconds,
        automationWorkedSeconds: usageCounters.automationWorkedSeconds,
        idleRuntimeSeconds: usageCounters.idleRuntimeSeconds,
        consumedTokens: usageCounters.consumedTokens,
        tokenSource: usageCounters.tokenSource,
      };
    })
    .sort((firstModel, secondModel) =>
      secondModel.workedRuntimeSeconds - firstModel.workedRuntimeSeconds
    );
}

function getDetectedPcNamesForUsage(history, appName) {
  const detectedPcNames = new Set();

  history.forEach((payload) => {
    const hasUsage = getUsageEntries(payload).some(
      (entry) =>
        entry.app_name === appName &&
        readUsageCounters(entry).foregroundRuntimeSeconds > 0
    );

    if (hasUsage) {
      detectedPcNames.add(getTelemetryPcName(payload));
    }
  });

  return Array.from(detectedPcNames).sort();
}

function getModelLicenseBreakdown(extension) {
  const activeModelNames = extension.modelUsage
    .filter((model) => model.workedRuntimeSeconds > 0)
    .map((model) => model.name);
  const modelNames =
    activeModelNames.length > 0 ? activeModelNames : extension.aiModels;

  if (modelNames.length === 0) {
    return [];
  }

  return modelNames.flatMap((modelName) =>
    getConfiguredModelSubscriptionTypes(extension, modelName).map(
      (subscriptionType) => ({
        name: modelName,
        subscriptionType,
      })
    )
  );
}

export default function App({ user = null, onSignOut = null }) {
  const portalClientId = useMemo(getPortalClientId, []);
  // agent_started_at per device; a change means that Tracker restarted.
  const agentStartedAtRef = useRef(new Map());
  // received_at of the newest stored sample; polls request only newer ones.
  const lastTelemetryReceivedAtRef = useRef(null);
  const [hasLoadedPersistentState, setHasLoadedPersistentState] = useState(false);
  const [activeView, setActiveView] = useState('unified-dashboard');
  const [savedConfig, setConfig] = useState(null);
  const [newestTelemetry, setLatestTelemetry] = useState(null);
  const [allTelemetryHistory, setTelemetryHistory] = useState([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(Date.now());
  const [error, setError] = useState('');
  const [emailSummaryStatus, setEmailSummaryStatus] = useState('');
  const [emailSummaryWindowKey, setEmailSummaryWindowKey] = useState(null);
  // Email-triggered workflows are intentionally paused while the in-app assistant is the entry point.
  const [sendEvaluationEmailEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [dispatchingDeviceId, setDispatchingDeviceId] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState('');
  const [costOverrides, setCostOverrides] = useState({});
  const [isDeployingAgent, setIsDeployingAgent] = useState(false);
  const [deployTarget, setDeployTarget] = useState('');
  const [deployForm, setDeployForm] = useState({
    pcName: '',
    user: '',
  });
  const [lastDeploymentConfig, setLastDeploymentConfig] = useState(null);
  const [deploymentPolicyRecords, setDeploymentPolicyRecords] = useState([]);
  const [completedEvaluationDecisions, setCompletedEvaluationDecisions] = useState(
    readCompletedEvaluationDecisions
  );
  // The app whose policies the App Rules editor is open on.
  const [editingRuleAppId, setEditingRuleAppId] = useState('');
  const [ruleDraft, setRuleDraft] = useState(() => ruleToDraft(NEW_POLICY_RULE));
  const [appRuleStatus, setAppRuleStatus] = useState('');
  const [onboardAppId, setOnboardAppId] = useState('');
  const [onboardPolicyId, setOnboardPolicyId] = useState('');
  // The policy open in App Rules: an id, '__new__' for a new one, '' when none is open.
  const [rulePolicyId, setRulePolicyId] = useState('');
  const [rulePolicyName, setRulePolicyName] = useState('');
  const [onboardStatus, setOnboardStatus] = useState('');
  const [licensedApps, setLicensedApps] = useState([]);
  // Every inventory app and extension, with the rule that applies to it.
  const onboardedAppLicenses = useMemo(
    () => buildRuleLicenses(licensedApps),
    [licensedApps]
  );
  // Policies live on each inventory app now; nothing is saved here any more.
  const licensePolicies = useMemo(() => [], []);
  const [licenseRequests, setLicenseRequests] = useState([]);
  const [licenseApprovalStatus, setLicenseApprovalStatus] = useState('');
  const [deviceOwners, setDeviceOwners] = useState([]);
  const [deviceOwnerDrafts, setDeviceOwnerDrafts] = useState({});
  const [deviceOwnerStatus, setDeviceOwnerStatus] = useState('');
  const [licenseAppForm, setLicenseAppForm] = useState(DEFAULT_LICENSE_APP_FORM);
  const [pickedCatalogEntry, setPickedCatalogEntry] = useState(null);
  const [plansAppId, setPlansAppId] = useState('');
  // A Recognised apps card for an app not in the inventory yet.
  const [newCatalogApp, setNewCatalogApp] = useState(null);
  const [skippedCompanionIds, setSkippedCompanionIds] = useState(() => new Set());
  const [editingInventoryAppId, setEditingInventoryAppId] = useState('');
  const [licenseOnboardingStatus, setLicenseOnboardingStatus] = useState('');
  const [isAppCatalogOpen, setIsAppCatalogOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  // Usage views follow one Tracker at a time: the selected device, otherwise
  // the first live one, so samples from different PCs are never merged.
  const focusDeviceId = useMemo(() => {
    const selected = selectedDeviceId.startsWith('device-') ? selectedDeviceId.slice('device-'.length) : '';
    if (selected && deviceOwners.some((device) => device.deviceId === selected)) return selected;
    const live = deviceOwners.find(
      (device) => device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 15 * 60 * 1000
    );
    return live?.deviceId || deviceOwners[0]?.deviceId || newestTelemetry?.device_id || '';
  }, [deviceOwners, newestTelemetry?.device_id, selectedDeviceId]);
  const liveDeviceKey = focusDeviceId ? `device-${focusDeviceId}` : '';
  const telemetryHistory = useMemo(
    () => (focusDeviceId ? allTelemetryHistory.filter((sample) => sample.device_id === focusDeviceId) : allTelemetryHistory),
    [allTelemetryHistory, focusDeviceId]
  );
  const latestTelemetry = telemetryHistory.at(-1) || null;
  const [showAgentDetails, setShowAgentDetails] = useState(false);
  const [isNavCollapsedAfterSelect, setIsNavCollapsedAfterSelect] = useState(false);
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState('ceo-monthly');
  const [selectedReportDimensions, setSelectedReportDimensions] = useState([
    'Department',
    'App',
  ]);
  const [selectedReportMetrics, setSelectedReportMetrics] = useState([
    'Cost',
    'Waste',
  ]);
  const [reportFrequency, setReportFrequency] = useState('Weekly');
  const [deliveryChannel, setDeliveryChannel] = useState('Email');
  const [historicalRange, setHistoricalRange] = useState(30);
  const [sortConfig, setSortConfig] = useState({
    key: 'savingsOpportunity',
    direction: 'desc',
  });
  const [cloudProviderFilter, setCloudProviderFilter] = useState('All');
  const [cloudRegionFilter, setCloudRegionFilter] = useState('All');

  useEffect(() => {
    const isSuccessMessage = /\b(added to|updated in|onboarded|removed)\b/i.test(
      licenseOnboardingStatus
    );
    if (!isSuccessMessage) return undefined;

    const timeoutId = window.setTimeout(() => setLicenseOnboardingStatus(''), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [licenseOnboardingStatus]);

  useEffect(() => {
    Promise.all([
      fetch(`${BACKEND_BASE_URL}/api/state`, {
        headers: { 'X-Client-Id': portalClientId },
      }).then((response) => {
        if (!response.ok) throw new Error(`State request failed with status ${response.status}`);
        return response.json();
      }),
      fetch(`${BACKEND_BASE_URL}/api/telemetry`).then((response) => {
        if (!response.ok) throw new Error(`History request failed with status ${response.status}`);
        return response.json();
      }),
      fetch(`${BACKEND_BASE_URL}/api/license-requests`).then((response) => {
        if (!response.ok) throw new Error(`License request load failed with status ${response.status}`);
        return response.json();
      }),
    ])
      .then(([savedState, savedTelemetry, savedLicenseRequests]) => {
        if (savedState.costOverrides) setCostOverrides(savedState.costOverrides);
        if (savedState.config) setConfig(savedState.config);
        if (savedState.lastDeploymentConfig) setLastDeploymentConfig(savedState.lastDeploymentConfig);
        if (Array.isArray(savedState.deploymentPolicyRecords)) setDeploymentPolicyRecords(savedState.deploymentPolicyRecords);
        if (savedState.completedEvaluationDecisions) setCompletedEvaluationDecisions(savedState.completedEvaluationDecisions);
        if (Array.isArray(savedState.licensedApps)) {
          setLicensedApps(migrateLicensePolicies(savedState.licensedApps, savedState.onboardedAppLicenses));
        }
        if (savedState.emailSummaryWindowKey) setEmailSummaryWindowKey(savedState.emailSummaryWindowKey);
        if (savedState.selectedReportTemplateId) setSelectedReportTemplateId(savedState.selectedReportTemplateId);
        if (Array.isArray(savedState.selectedReportDimensions)) setSelectedReportDimensions(savedState.selectedReportDimensions);
        if (Array.isArray(savedState.selectedReportMetrics)) setSelectedReportMetrics(savedState.selectedReportMetrics);
        if (savedState.reportFrequency) setReportFrequency(savedState.reportFrequency);
        if (savedState.deliveryChannel) setDeliveryChannel(savedState.deliveryChannel);
        if (savedState.historicalRange) setHistoricalRange(savedState.historicalRange);
        if (Array.isArray(savedTelemetry)) {
          setTelemetryHistory(savedTelemetry);
          setLatestTelemetry(savedTelemetry.at(-1) || null);
          lastTelemetryReceivedAtRef.current =
            savedTelemetry.at(-1)?.received_at || lastTelemetryReceivedAtRef.current;
        }
        setLicenseRequests(savedLicenseRequests.requests || []);
        setHasLoadedPersistentState(true);
      })
      .catch((err) => setError('Failed to load saved backend data: ' + err.message));
  }, [portalClientId]);

  useEffect(() => {
    if (!hasLoadedPersistentState) return;
    const timeoutId = window.setTimeout(() => {
      fetch(`${BACKEND_BASE_URL}/api/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': portalClientId,
        },
        body: JSON.stringify({
          costOverrides,
          config: savedConfig,
          lastDeploymentConfig,
          deploymentPolicyRecords,
          completedEvaluationDecisions,
          licensePolicies,
          licensedApps,
          onboardedAppLicenses,
          emailSummaryWindowKey,
          sendEvaluationEmailEnabled,
          selectedReportTemplateId,
          selectedReportDimensions,
          selectedReportMetrics,
          reportFrequency,
          deliveryChannel,
          historicalRange,
        }),
      }).catch((err) => setError('Failed to save backend data: ' + err.message));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [
    hasLoadedPersistentState,
    costOverrides,
    savedConfig,
    lastDeploymentConfig,
    deploymentPolicyRecords,
    completedEvaluationDecisions,
    licensePolicies,
    licensedApps,
    onboardedAppLicenses,
    emailSummaryWindowKey,
    sendEvaluationEmailEnabled,
    selectedReportTemplateId,
    selectedReportDimensions,
    selectedReportMetrics,
    reportFrequency,
    deliveryChannel,
    historicalRange,
    portalClientId,
  ]);

  const heroCopy = {
    'unified-dashboard': {
      eyebrow: 'Executive command center',
      title: 'Unified Spend Optimization Dashboard',
      description:
        'One decision-making view that merges software licenses, AI tooling, and cloud assets into waste, savings, and efficiency signals.',
    },
    dashboard: {
      eyebrow: 'License intelligence',
      title: 'License Utilizations',
      description:
        'Live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.',
    },
    'agent-management': {
      eyebrow: 'Tracker fleet management',
      title: 'Tracker Management',
      description:
        'Monitor endpoint health, active expensive licenses, and redeploy trackers from one operational view.',
    },
    'apps-inventory': {
      eyebrow: 'Software catalog',
      title: 'Enterprise Apps Inventory',
      description:
        'The catalog of applications and AI extensions that license onboarding, approvals and trackers draw from.',
    },
    'cloud-asset-management': {
      eyebrow: 'Cloud FinOps',
      title: 'Cloud Asset Management',
      description:
        'A single pane of glass for multi-cloud inventory, spend exposure, zombie assets, and right-sizing actions.',
    },
    'reporting-insights': {
      eyebrow: 'Reporting automation',
      title: 'Reporting & Insights Center',
      description:
        'Create executive, audit, FinOps, and AI adoption reports with reusable templates, custom fields, exports, and scheduled distribution.',
    },
    'ai-tools': {
      eyebrow: 'AI subscription intelligence',
      title: 'AI Tools',
      description:
        'Seats, spend, activity and reclaim candidates for Claude, Codex and GitHub Copilot from each vendor admin API.',
    },
    'license-approvals': {
      eyebrow: 'Request Approval Governance',
      title: 'Approvals',
      description:
        'Review requests routed to each app owner or administrator during license onboarding.',
    },
    'ai-assistant': {
      eyebrow: 'Grounded license intelligence',
      title: 'AI Assistant',
      description:
        'Ask natural-language questions about license availability, completed decisions, utilization, and savings opportunities.',
    },
  }[activeView];

  const usageInputs = useMemo(
    () => ({
      savedConfig,
      deploymentPolicyRecords,
      lastDeploymentConfig,
      onboardedAppLicenses,
      costOverrides,
      completedEvaluationDecisions,
      currentTimeMs,
    }),
    [
      completedEvaluationDecisions,
      costOverrides,
      currentTimeMs,
      deploymentPolicyRecords,
      lastDeploymentConfig,
      onboardedAppLicenses,
      savedConfig,
    ]
  );
  const focusUsage = useMemo(
    () => computeDeviceUsage({ ...usageInputs, telemetryHistory }),
    [telemetryHistory, usageInputs]
  );
  const {
    currentPcName,
    config,
    effectiveUsageWindowSeconds,
    effectiveEvaluationWindow,
    effectiveEvaluationWindowSeconds,
    telemetryWindow,
    evaluationSeriesStartsAt,
    evaluationWindow,
    accumulatedUsage,
    usageByApp,
    usageByExtension,
  } = focusUsage;
  // Every registered device, online or not: License Utilizations rows and
  // window decisions.
  const allDeviceUsages = useMemo(() => {
    const historyByDevice = new Map();
    allTelemetryHistory.forEach((sample) => {
      if (!sample.device_id) return;
      if (!historyByDevice.has(sample.device_id)) historyByDevice.set(sample.device_id, []);
      historyByDevice.get(sample.device_id).push(sample);
    });
    const others = deviceOwners
      .filter((device) => device.deviceId !== focusDeviceId && historyByDevice.has(device.deviceId))
      .map((device) => computeDeviceUsage({ ...usageInputs, telemetryHistory: historyByDevice.get(device.deviceId) }));
    return [focusUsage, ...others];
  }, [allTelemetryHistory, deviceOwners, focusDeviceId, focusUsage, usageInputs]);
  const allDevicesUsageByApp = useMemo(
    () => allDeviceUsages.flatMap((usage) => usage.usageByApp),
    [allDeviceUsages]
  );
  // Vendor activity rules the backend checked for each deployed user.
  const [vendorRuleResults, setVendorRuleResults] = useState([]);
  useEffect(() => {
    const load = () =>
      fetch(`${BACKEND_BASE_URL}/api/vendor-rule-results`)
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((body) => setVendorRuleResults(body.results || []))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  // "Sample data" adds fictional PCs to License Utilizations for demos; it is
  // remembered per browser and never saved with the portal's data.
  const [showSampleLicenses, setShowSampleLicenses] = useState(() => {
    try {
      return window.localStorage.getItem('license-sample-data') === 'on';
    } catch {
      return false;
    }
  });
  const toggleSampleLicenses = (on) => {
    setShowSampleLicenses(on);
    try {
      window.localStorage.setItem('license-sample-data', on ? 'on' : 'off');
    } catch {
      // Storage blocked: the switch still works for this visit.
    }
  };
  const allLicenseGroups = useMemo(() => {
    const real = applyVendorRuleResults(buildLicenseGroups(allDeviceUsages, deploymentPolicyRecords, licensedApps), vendorRuleResults);
    return showSampleLicenses ? [...real, ...sampleLicenseGroups()] : real;
  }, [allDeviceUsages, deploymentPolicyRecords, licensedApps, vendorRuleResults, showSampleLicenses]);
  // End User Licenses shows all of them, apps only, or AI tools and agents only.
  const licenseGroups = allLicenseGroups;
  // One row per software product: real ones from the inventory's plans and
  // the seats on PCs, plus the sample products while Sample data is on.
  const licenseProductRows = useMemo(() => {
    const real = buildProductRows({ groups: allLicenseGroups.filter((group) => !group.sample), inventoryApps: licensedApps });
    // Sample data replaces the real rows, so sample and real products with the
    // same name never sit side by side.
    const rows = showSampleLicenses ? sampleProductRows(allLicenseGroups.filter((group) => group.sample)) : real;
    return rows;
  }, [allLicenseGroups, licensedApps, showSampleLicenses]);
  // The product open in License Utilizations: Core App Engagement then shows
  // its use on each PC.
  const [engagementProduct, setEngagementProduct] = useState(null);
  const engagementChart = useMemo(
    () => (engagementProduct ? appEngagementSeries(engagementProduct, allTelemetryHistory) : null),
    [allTelemetryHistory, engagementProduct]
  );
  const [collapsedLicenseGroups, setCollapsedLicenseGroups] = useState(() => new Set());
  const toggleLicenseGroup = (groupId) =>
    setCollapsedLicenseGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  const licenseSummary = useMemo(() => {
    const reclaimable = licenseGroups.filter((group) => group.status === 'Reclaimable');
    return {
      monthlyCost: licenseGroups.reduce((sum, group) => sum + group.monthlyCost, 0),
      savings: licenseGroups.reduce((sum, group) => sum + group.savingsOpportunity, 0),
      total: licenseGroups.length,
      active: licenseGroups.filter((group) => group.status === 'Active').length,
      reclaimable: reclaimable.length,
      reclaimableAi: reclaimable.filter(isAiLicenseGroup).length,
    };
  }, [licenseGroups]);

  // Persist decisions for windows that closed on any registered device.
  useEffect(() => {
    const nextDecisions = Object.assign({}, ...allDeviceUsages.map((usage) => usage.newDecisions));
    if (Object.keys(nextDecisions).length === 0) return;
    setCompletedEvaluationDecisions((current) => ({ ...current, ...nextDecisions }));
  }, [allDeviceUsages]);



  const discoveredApplications = useMemo(() => {
    if (!config) return [];

    const trackedUrlNames = new Set(
      (config.tracked_urls || []).map((url) => `url:${url}`)
    );
    const extensionNames = new Set(
      getUniqueExtensionRules(config.extensions || []).map((extension) => extension.name)
    );
    const appMap = new Map();

    (config.licensed_apps || []).forEach((appName, index) => {
      const appIdentity = getReadableAppIdentity(appName);
      const usageCounters = getUsageCounters(accumulatedUsage, appName);
      const totalRuntimeSeconds = usageCounters.trackedRuntimeSeconds;
      const workedRuntimeSeconds = usageCounters.workedRuntimeSeconds;
      const automationWorkedSeconds = usageCounters.automationWorkedSeconds;
      const idleRuntimeSeconds = usageCounters.idleRuntimeSeconds;
      const baseUnitMonthlyCost = getMonthlyCost(appName, index);
      const unitMonthlyCost = getSyncedAppCost(
        costOverrides,
        currentPcName,
        appName,
        baseUnitMonthlyCost
      );
      const appType = getAppType(config, appName);
      const reclaimPolicy = getStoredReclaimPolicy(
        deploymentPolicyRecords,
        currentPcName,
        appName,
        getAppPolicy(config, appName),
        { type: appType }
      );
      const firstSeenAt = getAppFirstSeenAt(config, appName);
      const telemetryLastResetForAppMs = getTelemetryLastResetForAppMs(
        latestTelemetry,
        appName
      );
      const lastSeenAt = telemetryLastResetForAppMs
        ? new Date(telemetryLastResetForAppMs).toISOString()
        : getLastSeenAt(config, telemetryHistory, appName);
      const hasAgentExtension = appHasAgentExtension(config, appName);
      const policyUsageCounters = usageCounters;
      const reclaimDecision = getReclaimDecision({
        policy: reclaimPolicy,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        previousDecision:
          completedEvaluationDecisions[
            getEvaluationDecisionKey(
              currentPcName,
              appType,
              appName,
              evaluationSeriesStartsAt
            )
          ],
      });
      const detectedPcNames = getDetectedPcNamesForUsage(telemetryHistory, appName);
      const detectedSeatCount = detectedPcNames.length;

      appMap.set(appName, {
        appName,
        ...appIdentity,
        category: 'Licensed app',
        appType,
        hasAgentExtension,
        icon: getAppIcon(appIdentity.displayName),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * detectedSeatCount,
        detectedPcNames,
        detectedSeatCount,
        status: reclaimDecision.status,
        reclaimReason: reclaimDecision.reason,
        reclaimPolicy,
        firstSeenAt,
        lastSeenAt,
        totalRuntimeSeconds,
        workedRuntimeSeconds,
        automationWorkedSeconds,
        idleRuntimeSeconds,
        utilizationPercent: getPolicyUtilizationPercent(
          workedRuntimeSeconds,
          reclaimPolicy
        ),
      });
    });

    Array.from(accumulatedUsage.entries()).forEach(([appName, usageCounters], index) => {
      const totalRuntimeSeconds = usageCounters.trackedRuntimeSeconds;
      const workedRuntimeSeconds = usageCounters.workedRuntimeSeconds;
      const automationWorkedSeconds = usageCounters.automationWorkedSeconds;
      const idleRuntimeSeconds = usageCounters.idleRuntimeSeconds;
      if (totalRuntimeSeconds <= 0) return;
      if (appMap.has(appName)) return;
      if (appName.startsWith('url:')) return;
      if (appName.startsWith('ai_model:')) return;
      if (appName.startsWith('ext:') || appName.startsWith('web:')) return;
      if (trackedUrlNames.has(appName)) return;
      if (extensionNames.has(appName)) return;

      const appIdentity = getReadableAppIdentity(appName);
      const unitMonthlyCost = getDiscoveredAppMonthlyCost(appName, index);
      const detectedPcNames = getDetectedPcNamesForUsage(telemetryHistory, appName);
      const detectedSeatCount = detectedPcNames.length > 0 ? detectedPcNames.length : 1;
      const lastSeenAt = getLastSeenAt(config, telemetryHistory, appName);

      appMap.set(appName, {
        appName,
        ...appIdentity,
        category: 'Discovered app',
        appType: 'discovered',
        hasAgentExtension: false,
        icon: getAppIcon(appIdentity.displayName),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * detectedSeatCount,
        detectedPcNames,
        detectedSeatCount,
        lastSeenAt,
        totalRuntimeSeconds,
        workedRuntimeSeconds,
        automationWorkedSeconds,
        idleRuntimeSeconds,
        utilizationPercent: getUtilizationPercent(workedRuntimeSeconds, totalRuntimeSeconds),
      });
    });

    return Array.from(appMap.values())
      .sort(
        (firstApp, secondApp) =>
          secondApp.monthlyCost - firstApp.monthlyCost ||
          secondApp.totalRuntimeSeconds - firstApp.totalRuntimeSeconds ||
          firstApp.displayName.localeCompare(secondApp.displayName)
      );
  }, [
    config,
    accumulatedUsage,
    completedEvaluationDecisions,
    costOverrides,
    currentPcName,
    currentTimeMs,
    deploymentPolicyRecords,
    evaluationSeriesStartsAt,
    evaluationWindow.isAgentReported,
    latestTelemetry,
    telemetryHistory,
    telemetryWindow.endsAt,
  ]);

  const aggregates = useMemo(() => {
    const totalWaste = allDevicesUsageByApp.reduce(
      (sum, entry) => sum + entry.savingsOpportunity,
      0
    );
    const activeCost = allDevicesUsageByApp.reduce(
      (sum, entry) =>
        entry.status === 'Active' ? sum + entry.monthlyCost : sum,
      0
    );
    const trackedMonthlyCost = allDevicesUsageByApp.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );
    const activeSeats = allDevicesUsageByApp.filter((entry) => entry.status === 'Active').length;
    const totalSeats = allDevicesUsageByApp.length;
    const activeExtensions = usageByExtension.filter(
      (entry) => entry.type === 'agent' && entry.status === 'Active'
    ).length;
    const totalAgentExtensions = usageByExtension.filter(
      (entry) => entry.type === 'agent'
    ).length;
    const totalExtensionRuntimeSeconds = usageByExtension.reduce(
      (sum, entry) => sum + entry.totalRuntimeSeconds,
      0
    );
    const totalExtensionWorkedSeconds = usageByExtension.reduce(
      (sum, entry) => sum + entry.workedRuntimeSeconds,
      0
    );
    const totalExtensionAutomationWorkedSeconds = usageByExtension.reduce(
      (sum, entry) => sum + entry.automationWorkedSeconds,
      0
    );
    const totalExtensionIdleSeconds = usageByExtension.reduce(
      (sum, entry) => sum + entry.idleRuntimeSeconds,
      0
    );
    const totalExtensionMonthlyCost = usageByExtension.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );
    const totalExtensionSavings = usageByExtension.reduce(
      (sum, entry) => sum + (entry.status === 'Reclaimable' ? entry.monthlyCost : 0),
      0
    );
    const licenseEfficiencyScore =
      totalSeats > 0 ? Math.round((activeSeats / totalSeats) * 100) : 0;
    const reclaimableSeats = Math.max(0, totalSeats - activeSeats);
    const reclaimableAgentExtensions = Math.max(
      0,
      totalAgentExtensions - activeExtensions
    );
    const totalReclaimableLicenses = reclaimableSeats + reclaimableAgentExtensions;
    const totalActiveLicenses = activeSeats + activeExtensions;
    const totalLicenses = totalSeats + totalAgentExtensions;

    return {
      totalWaste,
      totalSavings: totalWaste,
      totalMonthlySavings: totalWaste + totalExtensionSavings,
      activeCost,
      totalMonthlySoftwareSpend: trackedMonthlyCost + totalExtensionMonthlyCost,
      trackedMonthlyCost,
      activeSeats,
      totalSeats,
      reclaimableSeats,
      activeExtensions,
      totalAgentExtensions,
      reclaimableAgentExtensions,
      totalReclaimableLicenses,
      totalActiveLicenses,
      totalLicenses,
      totalExtensions: usageByExtension.length,
      totalExtensionRuntimeSeconds,
      totalExtensionWorkedSeconds,
      totalExtensionAutomationWorkedSeconds,
      totalExtensionIdleSeconds,
      totalExtensionMonthlyCost,
      totalExtensionSavings,
      licenseEfficiencyScore,
    };
  }, [allDevicesUsageByApp, usageByExtension]);

  const extensionAttributionRows = useMemo(
    () =>
      usageByExtension.flatMap((extension) => {
        if (extension.modelLicenseBreakdown.length === 0) {
          return [
            {
              ...extension,
              rowId: `${extension.name}:unknown:unknown`,
              modelName: 'unknown',
              subscriptionType:
                extension.subscriptionTypes?.[0] || 'Subscription not reported',
            },
          ];
        }

        return extension.modelLicenseBreakdown.map((model) => ({
          ...extension,
          rowId: `${extension.name}:${model.name}:${model.subscriptionType}`,
          modelName: model.name,
          subscriptionType: model.subscriptionType,
        }));
      }),
    [usageByExtension]
  );

  const sortedLicenseGroups = useMemo(() => {
    const key = sortConfig.key === 'appName' ? 'name' : sortConfig.key;
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    return [...licenseGroups].sort((first, second) => {
      const firstValue = first[key] ?? '';
      const secondValue = second[key] ?? '';
      if (typeof firstValue === 'number' && typeof secondValue === 'number') {
        return (firstValue - secondValue) * direction;
      }
      return String(firstValue).localeCompare(String(secondValue)) * direction;
    });
  }, [licenseGroups, sortConfig]);

  const sortedUsageByApp = useMemo(() => {
    const sortableRows = [...allDevicesUsageByApp];

    sortableRows.sort((firstRow, secondRow) => {
      const firstValue = firstRow[sortConfig.key];
      const secondValue = secondRow[sortConfig.key];

      if (sortConfig.key.endsWith('SeenAt')) {
        const firstTime = getFirstSeenTimestampMs(firstValue) || 0;
        const secondTime = getFirstSeenTimestampMs(secondValue) || 0;
        return sortConfig.direction === 'asc'
          ? firstTime - secondTime
          : secondTime - firstTime;
      }

      if (typeof firstValue === 'string') {
        return sortConfig.direction === 'asc'
          ? firstValue.localeCompare(secondValue || '')
          : (secondValue || '').localeCompare(firstValue);
      }

      return sortConfig.direction === 'asc'
        ? firstValue - secondValue
        : secondValue - firstValue;
    });

    return sortableRows;
  }, [allDevicesUsageByApp, sortConfig]);

  const costReductionBars = useMemo(
    () => [
      {
        label: 'Mock monthly spend',
        value: TOTAL_MONTHLY_SOFTWARE_SPEND,
        tone: 'neutral',
      },
      {
        label: 'Tracked license cost',
        value: aggregates.trackedMonthlyCost,
        tone: 'info',
      },
      {
        label: 'Active productive cost',
        value: aggregates.activeCost,
        tone: 'success',
      },
      {
        label: 'Reclaimable savings',
        value: aggregates.totalSavings,
        tone: 'danger',
      },
    ],
    [aggregates]
  );

  const costReductionLinePoints = useMemo(() => {
    const maxValue = Math.max(
      TOTAL_MONTHLY_SOFTWARE_SPEND,
      ...costReductionBars.map((entry) => entry.value),
      1
    );
    const chartWidth = 100;
    const chartHeight = 100;
    const horizontalGap =
      costReductionBars.length > 1
        ? chartWidth / (costReductionBars.length - 1)
        : chartWidth;

    return costReductionBars.map((entry, index) => ({
      ...entry,
      x: index * horizontalGap,
      y: chartHeight - (entry.value / maxValue) * chartHeight,
      percent: Math.round((entry.value / TOTAL_MONTHLY_SOFTWARE_SPEND) * 100),
    }));
  }, [costReductionBars]);

  const costReductionPolyline = useMemo(
    () =>
      costReductionLinePoints
        .map((point) => `${point.x},${point.y}`)
        .join(' '),
    [costReductionLinePoints]
  );

  const historicalTrendData = useMemo(
    () => usageHistory.slice(-Math.min(historicalRange, usageHistory.length)),
    [historicalRange]
  );

  const fleetDevices = useMemo(() => {
    const activeExpensiveApps = usageByApp.filter(
      (entry) => entry.status === 'Active' && entry.monthlyCost >= 20
    );
    const onboardedLicenseCost = onboardedAppLicenses.reduce(
      (sum, app) => sum + app.monthlyCost,
      0
    );
    const activeExpensiveLicenses =
      activeExpensiveApps.length + onboardedAppLicenses.length;
    const activeExpensiveLicenseCost = activeExpensiveApps.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    ) + onboardedLicenseCost;

    // Devices that report telemetry (device register), with their owner's
    // work email. The focused device carries the live usage figures.
    const registeredDevices = deviceOwners.map((device) => ({
      id: `device-${device.deviceId}`,
      pcName: device.pcName,
      user: device.ownerEmail || 'Not linked',
      ownerEmail: device.ownerEmail || '',
      // The register refreshes last-seen at most every 5 minutes, so allow 15.
      isLive: Boolean(device.lastSeenAt) && Date.now() - new Date(device.lastSeenAt).getTime() < 15 * 60 * 1000,
      activeLicenseCount: null,
      totalLicenseCost: null,
      agentVersion: 'Tracker',
      policy: '—',
      trackedApps: [],
      registered: true,
    }));

    return registeredDevices.map((device) => ({
      ...device,
      activeLicenseCount:
        device.id === liveDeviceKey ? activeExpensiveLicenses : device.activeLicenseCount,
      totalLicenseCost:
        device.id === liveDeviceKey ? activeExpensiveLicenseCost : device.totalLicenseCost,
      trackedApps:
        device.id === liveDeviceKey
          ? [
              ...usageByApp
                .filter((entry) => entry.monthlyCost > 0)
                .map((entry) => entry.appName),
              ...onboardedAppLicenses.map((app) => app.appName),
            ]
          : device.trackedApps,
    }));
  }, [deviceOwners, liveDeviceKey, onboardedAppLicenses, usageByApp]);

  const selectedDevice = useMemo(
    () =>
      fleetDevices.find((device) => device.id === selectedDeviceId) ||
      fleetDevices.find((device) => device.id === liveDeviceKey) ||
      fleetDevices[0],
    [fleetDevices, liveDeviceKey, selectedDeviceId]
  );

  const selectedDeviceApps = useMemo(() => {
    if (!selectedDevice) return [];

    if (selectedDevice.id === liveDeviceKey) {
      const onboardedAppEntries = onboardedAppLicenses.map((app) => ({
        appName: app.appName,
        displayName: app.appName,
        processName: app.appName,
        icon: getAppIcon(app.appName),
        hasAgentExtension: false,
        status: 'Onboarded',
        totalRuntimeSeconds: 0,
        workedRuntimeSeconds: 0,
        automationWorkedSeconds: 0,
        idleRuntimeSeconds: 0,
        utilizationPercent: 0,
        monthlyCost: app.monthlyCost,
        policyName: app.policy.name,
        source: 'onboarded-license',
      }));

      return [
        ...usageByApp.filter((entry) => entry.monthlyCost > 0),
        ...onboardedAppEntries,
      ];
    }

    return selectedDevice.trackedApps.map((appName, index) => {
      const appIdentity = getReadableAppIdentity(appName);
      const baseMonthlyCost = getMonthlyCost(appName, index);
      const monthlyCost = getSyncedAppCost(
        costOverrides,
        selectedDevice.pcName,
        appName,
        baseMonthlyCost
      );
      const totalRuntimeSeconds = selectedDevice.isLive
        ? (index + 1) * 1880
        : index * 420;

      return {
        appName,
        ...appIdentity,
        icon: getAppIcon(appIdentity.displayName),
        hasAgentExtension: appHasAgentExtension(config, appName),
        status:
          selectedDevice.isLive && totalRuntimeSeconds >= RECLAIMABLE_THRESHOLD_SECONDS
            ? 'Active'
            : 'Reclaimable',
        totalRuntimeSeconds,
        workedRuntimeSeconds: totalRuntimeSeconds,
        automationWorkedSeconds: 0,
        idleRuntimeSeconds: 0,
        utilizationPercent: getUtilizationPercent(totalRuntimeSeconds, totalRuntimeSeconds),
        monthlyCost,
      };
    });
  }, [config, costOverrides, onboardedAppLicenses, selectedDevice, usageByApp]);

  const selectedDeviceEngagementSeries = useMemo(
    () =>
      selectedDeviceApps
        .filter((entry) => entry.monthlyCost > 0)
        .sort(
          (firstApp, secondApp) =>
            secondApp.workedRuntimeSeconds - firstApp.workedRuntimeSeconds ||
            secondApp.monthlyCost - firstApp.monthlyCost ||
            firstApp.displayName.localeCompare(secondApp.displayName)
        )
        .map((entry, index) => ({
          appName: entry.appName,
          dataKey: `app${index}`,
          name: entry.displayName,
          color: engagementChartColors[index % engagementChartColors.length],
        })),
    [selectedDeviceApps]
  );

  const selectedDeviceEngagementData = useMemo(() => {
    if (!selectedDevice || selectedDeviceEngagementSeries.length === 0) {
      return [];
    }

    if (selectedDevice.id !== liveDeviceKey) return [];

    const latestTimestampMs =
      getTelemetryTimestampMs(latestTelemetry) || Date.now();
    const latestHour = new Date(latestTimestampMs);
    latestHour.setMinutes(0, 0, 0);
    const firstHourMs = latestHour.getTime() - 23 * 60 * 60 * 1000;
    const seriesByAppName = new Map(
      selectedDeviceEngagementSeries.map((series) => [series.appName, series])
    );
    const buckets = new Map();

    for (let index = 0; index < 24; index += 1) {
      const bucketMs = firstHourMs + index * 60 * 60 * 1000;
      const point = {
        time: formatHourlyEngagementLabel(bucketMs),
      };
      selectedDeviceEngagementSeries.forEach((series) => {
        point[series.dataKey] = 0;
      });
      buckets.set(getHourlyEngagementKey(bucketMs), point);
    }

    telemetryHistory.forEach((payload) => {
      const timestampMs = getTelemetryTimestampMs(payload);
      if (timestampMs === null || timestampMs < firstHourMs) return;

      const bucket = buckets.get(getHourlyEngagementKey(timestampMs));
      if (!bucket) return;

      getUsageEntries(payload).forEach((usageEntry) => {
        const series = seriesByAppName.get(usageEntry.app_name);
        if (!series) return;

        const counters = readUsageCounters(usageEntry);
        const activeMinutes = Math.round(counters.workedRuntimeSeconds / 60);
        bucket[series.dataKey] = Math.max(bucket[series.dataKey], activeMinutes);
      });
    });

    const currentBucket = buckets.get(getHourlyEngagementKey(latestTimestampMs));
    if (currentBucket) {
      selectedDeviceEngagementSeries.forEach((series) => {
        const appEntry = selectedDeviceApps.find(
          (entry) => entry.appName === series.appName
        );
        const activeMinutes = Math.round(
          (appEntry?.workedRuntimeSeconds || 0) / 60
        );
        currentBucket[series.dataKey] = Math.max(
          currentBucket[series.dataKey],
          activeMinutes
        );
      });
    }

    return Array.from(buckets.values());
  }, [
    latestTelemetry,
    selectedDevice,
    selectedDeviceApps,
    selectedDeviceEngagementSeries,
    telemetryHistory,
  ]);

  const selectedDeviceTrackingMetrics = useMemo(() => {
    const selectedAppNames = new Set(
      selectedDeviceApps.map((entry) => entry.appName)
    );
    const licensedApplications = selectedDeviceApps.filter(
      (entry) => entry.monthlyCost > 0
    );
    const agentExtensions = usageByExtension.filter(
      (extension) =>
        extension.type === 'agent' &&
        (extension.parentApps.length === 0 ||
          extension.parentApps.some((parentApp) => selectedAppNames.has(parentApp)))
    );
    const activeLicensedApplications = licensedApplications.filter(
      (entry) => entry.status === 'Active'
    );
    const activeAgentExtensions = agentExtensions.filter(
      (extension) => extension.status === 'Active'
    );
    const appLicenseCost = licensedApplications.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );
    const aiLicenseCost = agentExtensions.reduce(
      (sum, extension) => sum + extension.monthlyCost,
      0
    );

    return {
      totalLicenseCount: licensedApplications.length + agentExtensions.length,
      activeLicenseCount:
        activeLicensedApplications.length + activeAgentExtensions.length,
      totalLicenseCost: appLicenseCost + aiLicenseCost,
      agentExtensionCount: agentExtensions.length,
      trackedApplicationCount: licensedApplications.length,
    };
  }, [selectedDeviceApps, usageByExtension]);

  const selectedDeviceLastHeartbeat = useMemo(() => {
    if (!selectedDevice?.isLive) return 'No heartbeat in the last 24h';
    if (selectedDevice.id === liveDeviceKey) {
      const lastResetMs = getTelemetryLastResetMs(latestTelemetry);
      const fallbackTelemetryMs = getTelemetryTimestampMs(latestTelemetry);
      const lastSeenMs = lastResetMs || fallbackTelemetryMs;
      if (lastSeenMs) return new Date(lastSeenMs).toLocaleString();
    }
    return new Date().toLocaleString();
  }, [latestTelemetry, selectedDevice]);

  const fleetSummary = useMemo(() => {
    const liveAgents = fleetDevices.filter((device) => device.isLive).length;
    const activeLicenses = fleetDevices.reduce(
      (sum, device) => sum + device.activeLicenseCount,
      0
    );
    const totalLicenseCost = fleetDevices.reduce(
      (sum, device) => sum + device.totalLicenseCost,
      0
    );

    return {
      liveAgents,
      offlineAgents: fleetDevices.length - liveAgents,
      activeLicenses,
      totalLicenseCost,
      totalDevices: fleetDevices.length,
    };
  }, [fleetDevices]);

  const onboardedLicenseSummary = useMemo(
    () => ({
      count: onboardedAppLicenses.length,
      monthlyCost: onboardedAppLicenses.reduce(
        (sum, app) => sum + (Number(app.monthlyCost) || 0),
        0
      ),
    }),
    [onboardedAppLicenses]
  );

  const appRuleSummary = useMemo(() => {
    const apps = ruleApps(licensedApps);
    return {
      policies: inventoryRuleApps(licensedApps).reduce((sum, app) => sum + appPolicies(app).length, 0),
      apps: inventoryRuleApps(licensedApps).filter((app) => appPolicies(app).length > 0).length,
      withoutPolicy: apps.filter((app) => !selectedPolicy(app)).length,
    };
  }, [licensedApps]);

  // The picked app's other surfaces (desktop app, extension, web) not yet in
  // the inventory.
  const companionSurfaces = useMemo(() => {
    const entry = pickedCatalogEntry;
    if (!entry?.product || editingInventoryAppId) return [];
    if (entry.appType !== licenseAppForm.appType || entry.appName !== licenseAppForm.appName) return [];
    return productSurfaces(entry.product)
      .filter((surface) => surface.id !== entry.id && !surface.autoDetected && !inventoryMatch(surface, licensedApps));
  }, [editingInventoryAppId, licenseAppForm.appName, licenseAppForm.appType, licensedApps, pickedCatalogEntry]);

  const cloudRegionOptions = useMemo(
    () => Array.from(new Set(cloudInventory.map((resource) => resource.region))).sort(),
    []
  );

  const filteredCloudInventory = useMemo(
    () =>
      cloudInventory.filter((resource) => {
        const matchesProvider =
          cloudProviderFilter === 'All' || resource.provider === cloudProviderFilter;
        const matchesRegion =
          cloudRegionFilter === 'All' || resource.region === cloudRegionFilter;

        return matchesProvider && matchesRegion;
      }),
    [cloudProviderFilter, cloudRegionFilter]
  );

  const cloudSpendByProvider = useMemo(
    () =>
      Object.entries(
        cloudInventory.reduce((providerMap, resource) => {
          providerMap[resource.provider] =
            (providerMap[resource.provider] || 0) + resource.monthlyBurn;
          return providerMap;
        }, {})
      ).map(([provider, value]) => ({
        provider,
        value,
      })),
    []
  );

  const cloudSpendByDepartment = useMemo(() => {
    const departmentMap = new Map();

    cloudInventory.forEach((resource) => {
      const existing = departmentMap.get(resource.department) || {
        department: resource.department,
        AWS: 0,
        Azure: 0,
        GCP: 0,
      };

      existing[resource.provider] += resource.monthlyBurn;
      departmentMap.set(resource.department, existing);
    });

    return Array.from(departmentMap.values()).sort((firstDept, secondDept) =>
      firstDept.department.localeCompare(secondDept.department)
    );
  }, []);

  const cloudSummary = useMemo(() => {
    const monthlyBurn = cloudInventory.reduce(
      (sum, resource) => sum + resource.monthlyBurn,
      0
    );
    const zombieWaste = zombieCloudAssets.reduce(
      (sum, resource) => sum + resource.monthlyBurn,
      0
    );
    const rightSizingSavings = rightSizingRecommendations.reduce(
      (sum, recommendation) => sum + recommendation.monthlySavings,
      0
    );

    return {
      monthlyBurn,
      projectedAnnualCost: monthlyBurn * 12,
      zombieWaste,
      rightSizingSavings,
      resourceCount: cloudInventory.length,
    };
  }, []);

  // Enterprise Infrastructure Platform (Azure, Snowflake, Datadog):
  // its monthly forecast and identified savings replace the older placeholder
  // cloud figures in the dashboard totals.
  const [platformStats, setPlatformStats] = useState(null);
  // License Utilizations capsules: End User (the original page), Platform, AI.
  const [licenseCategory, setLicenseCategory] = useState('end-user');
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_BASE_URL}/api/platforms`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { if (!cancelled && payload) setPlatformStats(payload); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const unifiedSummary = useMemo(() => {
    const platformSpend = platformStats?.totals.forecastCost || 0;
    const platformSavings = platformStats?.totals.savingsMonthly || 0;
    // AI tools & agents: this month's figure from the spend trend (sample).
    const aiToolsSpend = unifiedSpendTrend[unifiedSpendTrend.length - 1].aiAgents;
    const totalManagedSpend = TOTAL_MONTHLY_SOFTWARE_SPEND + aiToolsSpend + platformSpend;
    const combinedMonthlyWaste = aggregates.totalWaste + platformSavings;
    const optimizationScore =
      totalManagedSpend > 0
        ? Math.max(
            0,
            Math.round(((totalManagedSpend - combinedMonthlyWaste) / totalManagedSpend) * 100)
          )
        : 0;

    const nextRenewal = platformStats?.renewals.find((item) => item.daysToNotice >= 0) || null;

    return {
      totalManagedSpend,
      combinedMonthlyWaste,
      optimizationScore,
      platformSpend,
      platformSavings,
      aiToolsSpend,
      spendSplit: [
        { name: 'Enterprise Infra Platform', value: Math.round(platformSpend) },
        { name: 'AI Tools & Agents', value: aiToolsSpend },
        { name: 'End User Apps', value: TOTAL_MONTHLY_SOFTWARE_SPEND },
      ].filter((slice) => slice.value > 0),
      noticeIn90: platformStats?.totals.noticeIn90 || 0,
      nextRenewal,
    };
  }, [aggregates.totalWaste, platformStats]);

  // Six-month trend: the platform line ends at this month's forecast; earlier
  // months follow the same illustrative growth as the other sample series.
  const spendTrend = useMemo(() => {
    const current = platformStats?.totals.forecastCost || 0;
    const shape = [0.84, 0.87, 0.9, 0.93, 0.97, 1];
    return unifiedSpendTrend.map((month, index) => ({ ...month, enterprisePlatforms: Math.round(current * shape[index]) }));
  }, [platformStats]);

  // Top 5 savings per category. End User and AI lists start from the real
  // reclaimable licences the Trackers found, then sample actions fill the rest;
  // the platform list comes from the Enterprise Infrastructure Platform data.
  const topSavingsByCategory = useMemo(() => {
    const top = (items) => items.filter((item) => item.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5);
    const reclaimedApps = Object.values(
      usageByApp
        .filter((entry) => entry.savingsOpportunity > 0)
        .reduce((groups, entry) => {
          const name = entry.displayName || entry.appName;
          const group = groups[name] || { name, impact: 0, pcs: [] };
          group.impact += entry.savingsOpportunity;
          group.pcs.push(entry.pcName);
          return { ...groups, [name]: group };
        }, {})
    ).map((group) => ({
      id: `tracked:${group.name}`,
      action: `Reclaim ${group.pcs.length} idle ${group.name} license${group.pcs.length === 1 ? '' : 's'}`,
      detail: `Measured by the Tracker on ${group.pcs.join(', ')}`,
      impact: Math.round(group.impact),
    }));
    const reclaimedAi = usageByExtension
      .filter((entry) => entry.status === 'Reclaimable' && entry.monthlyCost > 0)
      .map((entry) => ({
        id: `tracked-ai:${entry.name}`,
        action: `Reclaim idle ${entry.name} seats`,
        detail: 'No assistant activity measured by the Tracker in the review window',
        impact: Math.round(entry.monthlyCost),
      }));
    const endUserSamples = [
      { id: 'adobe-harvest', action: 'Harvest 12 idle Adobe licenses', impact: 960, detail: 'Recover design seats with less than 1 hour active runtime' },
      { id: 'figma-downgrade', action: 'Downgrade 4 idle Figma Full seats to View', impact: 180, detail: 'No file activity in 30 days' },
      { id: 'zoom-basic', action: 'Move 6 Zoom users with no sign-in in 30 days to Basic', impact: 80, detail: 'Licensed seats nobody has used this month' },
    ];
    const aiSamples = [
      { id: 'claude-budget', action: 'Set Claude Code spend limits for 2 users over budget', impact: 180, detail: 'Month-to-date spend above their budget' },
      { id: 'copilot-downgrade', action: 'Downgrade 5 unused Copilot seats', impact: 100, detail: 'Move inactive users to request-based assignment' },
      { id: 'codex-reclaim', action: 'Reclaim 2 idle Codex seats', impact: 60, detail: 'No Codex turns in 14 days' },
    ];
    return {
      platform: top((platformStats?.opportunities || []).map((item) => ({ id: item.id, action: item.action, detail: item.detail, impact: Math.round(item.impact) }))),
      endUser: top([...reclaimedApps, ...endUserSamples]),
      ai: top([...reclaimedAi, ...aiSamples]),
    };
  }, [platformStats, usageByApp, usageByExtension]);

  const selectedReportTemplate = useMemo(
    () =>
      reportTemplates.find((template) => template.id === selectedReportTemplateId) ||
      reportTemplates[0],
    [selectedReportTemplateId]
  );

  const nextRunDate = useMemo(() => {
    const date = new Date();
    const daysToAdd = {
      Daily: 1,
      Weekly: 7,
      Monthly: 30,
    }[reportFrequency];

    date.setDate(date.getDate() + daysToAdd);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  }, [reportFrequency]);

  const reportRecipients = useMemo(
    () =>
      deliveryChannel === 'Slack'
        ? ['#finance-ops', '#it-asset-review', '#platform-finops']
        : [
            'ceo@agentops.local',
            'finance@agentops.local',
            'it-audit@agentops.local',
          ],
    [deliveryChannel]
  );

  const reportPreviewStats = useMemo(
    () => [
      {
        label: 'Included dimensions',
        value: selectedReportDimensions.length,
      },
      {
        label: 'Included metrics',
        value: selectedReportMetrics.length,
      },
      {
        label: 'Estimated rows',
        value:
          Math.max(1, selectedReportDimensions.length) *
          Math.max(1, selectedReportMetrics.length) *
          48,
      },
    ],
    [selectedReportDimensions, selectedReportMetrics]
  );

  const emailRecipient = appConfig?.email?.trim();
  const isEmailSummaryReady =
    Boolean(config) &&
    Boolean(latestTelemetry) &&
    evaluationWindow.sampleCount > 0 &&
    (sortedUsageByApp.length > 0 || extensionAttributionRows.length > 0);

  const sendEmailSummary = useCallback(async () => {
    if (!sendEvaluationEmailEnabled) {
      throw new Error('Evaluation emails are disabled in Settings.');
    }
    if (!emailRecipient) {
      throw new Error('Recipient email is not configured.');
    }

    if (!evaluationWindow?.endsAt) {
      throw new Error('Evaluation window is not ready yet.');
    }

    if (!isEmailSummaryReady) {
      throw new Error('License Utilizations data is still loading.');
    }

    const windowKey = `${evaluationWindow.startsAt}-${evaluationWindow.endsAt}`;
    if (emailSummaryWindowKey === windowKey || sentEmailSummaryWindowKeys.has(windowKey)) {
      setEmailSummaryStatus('Evaluation summary already sent for this window.');
      return;
    }

    if (pendingEmailSummaryWindowKeys.has(windowKey)) {
      setEmailSummaryStatus('Evaluation summary is already being sent for this window.');
      return;
    }

    pendingEmailSummaryWindowKeys.add(windowKey);

    try {
      setEmailSummaryStatus(`Sending evaluation summary to ${emailRecipient}...`);
      const subject = createEmailSummarySubject(evaluationWindow.endsAt);
      const { text, html } = createEmailSummaryBody({
        evaluationWindow,
        aggregates,
        usageByApp: sortedUsageByApp,
        extensionAttributionRows,
        currentPcName,
        config,
        latestTelemetry,
      });

      const response = await fetch('http://localhost:3000/send-email-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: emailRecipient,
          subject,
          body: text,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Email service failed: ${errorText || response.statusText}`);
      }

      sentEmailSummaryWindowKeys.add(windowKey);
      setEmailSummaryStatus('');
      setEmailSummaryWindowKey(windowKey);
    } catch (err) {
      pendingEmailSummaryWindowKeys.delete(windowKey);
      throw err;
    }
  }, [
    emailRecipient,
    evaluationWindow,
    isEmailSummaryReady,
    emailSummaryWindowKey,
    aggregates,
    sortedUsageByApp,
    extensionAttributionRows,
    currentPcName,
    config,
    latestTelemetry,
    sendEvaluationEmailEnabled,
  ]);

  useEffect(() => {
    if (
      !sendEvaluationEmailEnabled ||
      !emailRecipient ||
      !evaluationWindow.endsAt ||
      !isEmailSummaryReady
    ) {
      return undefined;
    }

    const windowKey = `${evaluationWindow.startsAt}-${evaluationWindow.endsAt}`;
    if (emailSummaryWindowKey === windowKey || sentEmailSummaryWindowKeys.has(windowKey)) {
      return undefined;
    }

    const executeSend = () => {
      sendEmailSummary().catch((err) => {
        setEmailSummaryStatus(`Email send failed: ${err.message}`);
      });
    };

    const nowMs = Date.now();
    if (nowMs >= evaluationWindow.endsAt) {
      executeSend();
      return undefined;
    }

    const timeoutId = window.setTimeout(
      executeSend,
      Math.max(0, evaluationWindow.endsAt - nowMs)
    );
    return () => window.clearTimeout(timeoutId);
  }, [
    emailRecipient,
    evaluationWindow.endsAt,
    evaluationWindow.startsAt,
    isEmailSummaryReady,
    emailSummaryWindowKey,
    aggregates,
    sortedUsageByApp,
    extensionAttributionRows,
    currentPcName,
    config,
    latestTelemetry,
    sendEmailSummary,
    sendEvaluationEmailEnabled,
  ]);

  const toggleReportDimension = (dimension) => {
    setSelectedReportDimensions((currentDimensions) =>
      currentDimensions.includes(dimension)
        ? currentDimensions.filter((item) => item !== dimension)
        : [...currentDimensions, dimension]
    );
  };

  const toggleReportMetric = (metric) => {
    setSelectedReportMetrics((currentMetrics) =>
      currentMetrics.includes(metric)
        ? currentMetrics.filter((item) => item !== metric)
        : [...currentMetrics, metric]
    );
  };

  const requestSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction:
        currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const renderSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ^' : ' v';
  };

  const handleDispatch = (deviceId) => {
    setDispatchingDeviceId(deviceId);
    window.setTimeout(() => {
      setDispatchingDeviceId('');
    }, 1600);
  };

  const handleRevoke = (deviceId) => {
    setRevokingDeviceId(deviceId);
    window.setTimeout(() => {
      setRevokingDeviceId('');
    }, 1600);
  };

  const handleDeployInputChange = (event) => {
    const { name, value } = event.target;
    setDeployForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  };

  const handleLicenseAppInputChange = (event) => {
    const { name, value } = event.target;
    setLicenseAppForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  };

  const handleDeployAgent = (event) => {
    event.preventDefault();

    const normalizedPcName = deployForm.pcName.trim().toUpperCase();
    const assignedUser = deployForm.user.trim();
    if (!normalizedPcName) {
      setDeployTarget('Enter a PC name to prepare deployment.');
      return;
    }

    if (onboardedAppLicenses.length === 0) {
      setDeployTarget('Onboard at least one app before deployment.');
      return;
    }

    const deploymentConfig = buildAgentDeploymentConfig({
      pcName: normalizedPcName,
      user: assignedUser,
      licensedApps: onboardedAppLicenses,
      inventoryApps: licensedApps,
    });

    // The deployment records drive evaluation on the dashboard; the config
    // goes to the PC's Tracker through the broker.
    const nextRecords = buildDeploymentPolicyRecords(deploymentConfig, onboardedAppLicenses);
    setIsDeployingAgent(true);
    setDeployTarget(`Sending the tracker config to ${normalizedPcName}…`);
    fetch(`${BACKEND_BASE_URL}/api/tracker-deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': portalClientId },
      body: JSON.stringify({ pcName: normalizedPcName, userEmail: assignedUser, config: deploymentConfig }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Deployment failed with status ${response.status}`);
        return body;
      })
      .then((result) => {
        const nextRecordIds = new Set(nextRecords.map(getDeploymentRecordId));
        setDeploymentPolicyRecords((currentRecords) => [
          ...currentRecords.filter((record) => !nextRecordIds.has(getDeploymentRecordId(record))),
          ...nextRecords,
        ]);
        setLastDeploymentConfig(deploymentConfig);
        setDeployTarget(
          result.deviceFound
            ? `Tracker config for ${normalizedPcName} sent (${deploymentConfig.licensed_apps.length} apps). The Tracker applies it within seconds, or when the PC is next online.`
            : `${normalizedPcName} hasn't connected yet. Its tracker config waits and is sent as soon as the PC reports in.`
        );
        setDeployForm((currentForm) => ({ ...currentForm, pcName: '', user: '' }));
        loadTrackerDeployments();
      })
      .catch((err) => setDeployTarget(`Couldn't deploy to ${normalizedPcName}: ${err.message}`))
      .finally(() => setIsDeployingAgent(false));
  };

  // Each PC's latest Deploy Tracker push and whether it has gone out.
  const [trackerDeployments, setTrackerDeployments] = useState([]);
  const loadTrackerDeployments = useCallback(() => {
    fetch(`${BACKEND_BASE_URL}/api/tracker-deployments`)
      .then((response) => (response.ok ? response.json() : { deployments: [] }))
      .then((body) => setTrackerDeployments(body.deployments || []))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadTrackerDeployments();
    const timer = window.setInterval(loadTrackerDeployments, 15000);
    return () => window.clearInterval(timer);
  }, [loadTrackerDeployments]);

  // Back from "Sign in with GitHub" (Connect): open the inventory page and say how it went.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('integration')) return;
    if (params.get('view')) setActiveView(params.get('view'));
    setLicenseOnboardingStatus(
      params.get('result') === 'connected'
        ? 'GitHub Copilot connected. Live data appears on the AI Tools page.'
        : `GitHub Copilot was not connected: ${params.get('message') || 'sign-in failed'}`
    );
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const handleAddEnterpriseInventoryItem = (event) => {
    event.preventDefault();

    const appName = licenseAppForm.appName.trim();
    const processName = licenseAppForm.processName.trim();
    const url = licenseAppForm.url.trim();
    const owner = licenseAppForm.owner.trim();
    const ownerEmail = licenseAppForm.ownerEmail.trim();
    const appType = licenseAppForm.appType;
    const parentApp = licenseAppForm.parentApp.trim();
    const subscriptionType = licenseAppForm.subscriptionType.trim();

    if (appType === 'Web URL' && !url) {
      setLicenseOnboardingStatus('Enter the web URL.');
      return;
    }

    if (appType !== 'Web URL' && !appName) {
      setLicenseOnboardingStatus('Enter an app name to add inventory.');
      return;
    }

    if (!owner) {
      setLicenseOnboardingStatus('Enter the app owner name.');
      return;
    }

    if (!ownerEmail) {
      setLicenseOnboardingStatus('Enter the owner email.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      setLicenseOnboardingStatus('Enter a valid owner email.');
      return;
    }

    if (appType === 'Extension' && !subscriptionType) {
      setLicenseOnboardingStatus('Enter the extension subscription type.');
      return;
    }

    const productName = companionSurfaces.length > 0 ? PRODUCTS[pickedCatalogEntry.product] : '';
    const nextId = inventoryItemId(appType, appType === 'Web URL' ? url : appName);
    const currentItem = licensedApps.find((app) => app.id === (editingInventoryAppId || nextId));
    const nextApp = {
      id: nextId,
      appName: appType === 'Web URL' ? url : appName,
      processName,
      url,
      // Cost comes from the app's plans.
      monthlyCost: currentItem?.monthlyCost ?? 0,
      owner,
      ownerEmail,
      appType,
      parentApp,
      subscriptionType: subscriptionType || productName,
      onboardedAt: new Date().toISOString(),
    };
    // Other surfaces of the same license: the cost stays on the main item.
    const companionItems = companionSurfaces
      .filter((surface) => !skippedCompanionIds.has(surface.id))
      .map((surface) => ({
        id: inventoryItemId(surface.appType, surface.appType === 'Web URL' ? surface.url : surface.appName),
        appName: surface.appType === 'Web URL' ? surface.url : surface.appName,
        processName: surface.processName || '',
        url: surface.url || '',
        monthlyCost: 0,
        owner,
        ownerEmail,
        appType: surface.appType,
        parentApp: '',
        subscriptionType: productName,
        bundledWith: nextApp.id,
        onboardedAt: nextApp.onboardedAt,
      }));

    if (
      editingInventoryAppId &&
      editingInventoryAppId !== nextApp.id &&
      licensedApps.some((app) => app.id === nextApp.id)
    ) {
      setLicenseOnboardingStatus(`${appName} ${appType.toLowerCase()} already exists.`);
      return;
    }

    setLicensedApps((currentApps) => {
      const existingIndex = currentApps.findIndex(
        (app) => app.id === (editingInventoryAppId || nextApp.id)
      );

      const merged =
        existingIndex === -1
          ? [...currentApps, nextApp]
          : currentApps.map((app, index) => (index === existingIndex ? { ...app, ...nextApp } : app));
      const known = new Set(merged.map((app) => app.id));
      return [...merged, ...companionItems.filter((item) => !known.has(item.id))];
    });
    setLicenseOnboardingStatus(
      `${appName} ${appType.toLowerCase()} ${
        editingInventoryAppId ? 'updated in' : 'added to'
      } Enterprise Apps Inventory${
        companionItems.length > 0
          ? `, with ${companionItems.map((item) => item.appName).join(' and ')}`
          : ''
      }.`
    );
    setLicenseAppForm(DEFAULT_LICENSE_APP_FORM);
    setPickedCatalogEntry(null);
    setSkippedCompanionIds(new Set());
    setEditingInventoryAppId('');
    // An app outside the catalog still needs its process name.
    if (appType !== 'Web URL' && !processName) setPlansAppId(nextApp.id);
  };

  const applyCatalogEntry = (entry) => {
    setPickedCatalogEntry(entry);
    setSkippedCompanionIds(new Set());
    setLicenseAppForm((currentForm) => ({
      ...currentForm,
      appType: entry.appType,
      appName: entry.appName,
      processName: entry.processName || '',
      ...(entry.appType === 'Extension'
        ? { parentApp: '', subscriptionType: entry.subscriptionType || currentForm.subscriptionType }
        : {}),
    }));
    setLicenseOnboardingStatus('');
  };

  // A catalog card opens the app's plans over the catalog, for a new app as a
  // draft that saving adds.
  const handleSelectCatalogApp = (entry) => {
    const existing = inventoryMatch(entry, licensedApps);
    if (existing) {
      openAppPlans(existing);
      return;
    }
    setNewCatalogApp({
      id: inventoryItemId(entry.appType, entry.appName),
      appName: entry.appName,
      processName: entry.processName || '',
      url: entry.url || '',
      appType: entry.appType,
      parentApp: '',
      subscriptionType: PRODUCTS[entry.product] || entry.subscriptionType || '',
    });
  };

  const handleAddNewCatalogApp = (changes) => {
    setLicensedApps((currentApps) => [
      ...currentApps,
      { monthlyCost: 0, owner: '', ownerEmail: '', ...newCatalogApp, ...changes, onboardedAt: new Date().toISOString() },
    ]);
    setLicenseOnboardingStatus(`${newCatalogApp.appName} added to Enterprise Apps Inventory. Add its owner with the edit button.`);
    setNewCatalogApp(null);
  };

  // Bundled surfaces share the main app's plans.
  const openAppPlans = (app) => {
    const mainApp = licensedApps.find((item) => item.id === app.bundledWith);
    setPlansAppId((mainApp || app).id);
  };

  const handleSaveAppPlans = (changes) => {
    const applyChanges = (app) => (app.id === plansAppId ? { ...app, ...changes } : app);
    setLicensedApps((currentApps) => currentApps.map(applyChanges));
    setPlansAppId('');
  };

  // Onboard Apps: which inventory apps the tracker watches on users' PCs, and
  // the policy each is evaluated with.
  const onboardApp = licensedApps.find((item) => item.id === onboardAppId) || null;

  const pickOnboardApp = (appId) => {
    const app = licensedApps.find((item) => item.id === appId);
    setOnboardStatus('');
    setOnboardAppId(appId);
    setOnboardPolicyId(app?.policyId || appPolicies(app)[0]?.id || '');
  };

  const handleOnboardApp = (event) => {
    event.preventDefault();
    if (!onboardApp) {
      setOnboardStatus('Choose an app from Enterprise Apps Inventory.');
      return;
    }
    const policy = appPolicies(onboardApp).find((item) => item.id === onboardPolicyId) || null;
    if (!policy) {
      setOnboardStatus(`Create a policy for ${onboardApp.appName} in App Rules first.`);
      return;
    }
    const bundled = licensedApps.filter((item) => item.bundledWith === onboardApp.id && item.appType !== 'Web URL');
    const wasOnboarded = Boolean(onboardApp.onboarded);
    setLicensedApps((currentApps) =>
      currentApps.map((item) => (item.id === onboardApp.id ? { ...item, onboarded: true, policyId: policy.id } : item))
    );
    setOnboardStatus(
      `${onboardApp.appName} ${wasOnboarded ? 'updated' : 'onboarded'}${
        bundled.length > 0 && !wasOnboarded ? `, with ${bundled.map((item) => item.appName).join(' and ')}` : ''
      }, using the ${policy.name} policy.`
    );
    setOnboardAppId('');
    setOnboardPolicyId('');
  };

  const handleRemoveOnboardedApp = (appId) => {
    const app = licensedApps.find((item) => item.id === appId);
    setLicensedApps((currentApps) => currentApps.map((item) => (item.id === appId ? { ...item, onboarded: false } : item)));
    if (onboardAppId === appId) setOnboardAppId('');
    setOnboardStatus(`${app?.appName || 'App'} is no longer tracked.`);
  };

  // App Rules: named policies per app.
  const ruleApp = licensedApps.find((item) => item.id === editingRuleAppId) || null;
  const ruleAppVendorFields = ruleApp ? vendorRuleFields(findCatalogSurface(ruleApp)?.product) : [];
  const NEW_POLICY = '__new__';

  const loadRuleForm = (appId, nextPolicyId) => {
    const app = licensedApps.find((item) => item.id === appId);
    const policy = appPolicies(app).find((item) => item.id === nextPolicyId);
    setEditingRuleAppId(appId);
    setRulePolicyId(nextPolicyId);
    setRulePolicyName(policy?.name || '');
    setRuleDraft(ruleToDraft(policy?.rule || NEW_POLICY_RULE));
    setAppRuleStatus('');
  };

  // Picking an app opens its first policy, or a new one when it has none.
  const selectRuleApp = (appId) => {
    const app = licensedApps.find((item) => item.id === appId);
    loadRuleForm(appId, appPolicies(app)[0]?.id || NEW_POLICY);
  };

  const handleRuleDraftChange = (event) => {
    const { name, value } = event.target;
    setAppRuleStatus('');
    setRuleDraft((current) => ({ ...current, [name]: value }));
  };

  const handleVendorRuleChange = (fieldId, value) => {
    setAppRuleStatus('');
    setRuleDraft((current) => ({ ...current, vendor: { ...current.vendor, [fieldId]: value } }));
  };

  const handleSaveRuleForm = (event) => {
    event.preventDefault();
    if (!editingRuleAppId) return;
    const rule = draftToRule(ruleDraft, ruleAppVendorFields);
    const problem = ruleError(rule);
    if (problem) {
      setAppRuleStatus(problem);
      return;
    }
    const isNew = rulePolicyId === NEW_POLICY;
    const nameProblem = policyNameError(ruleApp, rulePolicyName, isNew ? '' : rulePolicyId);
    if (nameProblem) {
      setAppRuleStatus(nameProblem);
      return;
    }
    const savedId = isNew ? policyId(rulePolicyName) : rulePolicyId;
    setLicensedApps((currentApps) =>
      currentApps.map((item) =>
        item.id === ruleApp.id ? savePolicy(item, { id: savedId, name: rulePolicyName, rule: normalizeRule(rule) }) : item
      )
    );
    setAppRuleStatus(`${ruleApp.appName}: ${rulePolicyName.trim()} policy ${isNew ? 'created' : 'saved'}.`);
    setEditingRuleAppId('');
    setRulePolicyId('');
  };

  // A policy an onboarded app is using stays until the app is moved to another.
  const handleRemovePolicy = (appId, removedId) => {
    const app = licensedApps.find((item) => item.id === appId);
    const policy = appPolicies(app).find((item) => item.id === removedId);
    if (app?.onboarded && app.policyId === removedId) {
      setAppRuleStatus(`${app.appName} is onboarded with ${policy?.name}. Pick another policy for it in Onboard Apps first.`);
      return;
    }
    setLicensedApps((currentApps) =>
      currentApps.map((item) =>
        item.id === appId
          ? {
              ...item,
              policies: appPolicies(item).filter((entry) => entry.id !== removedId),
              policyId: item.policyId === removedId ? '' : item.policyId,
            }
          : item
      )
    );
    if (editingRuleAppId === appId && rulePolicyId === removedId) setEditingRuleAppId('');
    setAppRuleStatus(`${app?.appName || 'App'}: ${policy?.name || 'policy'} removed.`);
  };

  const handleEditInventoryApp = (app) => {
    setEditingInventoryAppId(app.id);
    setLicenseAppForm({
      appName: app.appType === 'Web URL' ? '' : app.appName,
      processName: app.processName,
      url: app.url || '',
      owner: app.owner || '',
      ownerEmail: app.ownerEmail || '',
      appType: app.appType,
      parentApp: app.parentApp || '',
      subscriptionType: app.subscriptionType || '',
    });
    setLicenseOnboardingStatus(`Editing ${app.appName} inventory item.`);
  };

  const handleRemoveInventoryApp = (appId) => {
    const removedApp = licensedApps.find((app) => app.id === appId);
    setLicensedApps((currentApps) => currentApps.filter((app) => app.id !== appId));

    if (editingInventoryAppId === appId) {
      setEditingInventoryAppId('');
      setLicenseAppForm(DEFAULT_LICENSE_APP_FORM);
    }

    if (editingRuleAppId === appId) setEditingRuleAppId('');

    setLicenseOnboardingStatus(
      `${removedApp?.appName || 'Inventory item'} removed from inventory.`
    );
  };

  const handleExploreDevice = (deviceId) => {
    setSelectedDeviceId(deviceId);
    setShowAgentDetails(true);
  };

  const handleExploreDashboardAgent = (pcName) => {
    const matchingDevice = fleetDevices.find((device) => device.pcName === pcName);
    setSelectedDeviceId(matchingDevice?.id || liveDeviceKey);
    setActiveView('agent-management');
    setShowAgentDetails(true);
  };

  const resetForAgentStartChange = (payload) => {
    const nextAgentStartedAt = getAgentStartedTimestampMs(payload);
    if (!nextAgentStartedAt) return false;

    const deviceKey = payload.device_id || payload.device_name || '';
    const previousAgentStartedAt = agentStartedAtRef.current.get(deviceKey);
    agentStartedAtRef.current.set(deviceKey, nextAgentStartedAt);

    return Boolean(previousAgentStartedAt) && previousAgentStartedAt !== nextAgentStartedAt;
  };

  const loadTelemetry = () => {
    // Tracker samples arrive through the portal backend (RabbitMQ worker or the
    // HTTPS ingest function). After the first load, poll only for samples
    // received since the newest one already held.
    const since = lastTelemetryReceivedAtRef.current;
    fetch(`${BACKEND_BASE_URL}/api/telemetry${since ? `?since=${encodeURIComponent(since)}` : ''}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Telemetry request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const incoming = Array.isArray(data) ? data : [];
        setError('');
        if (since && incoming.length === 0) return;
        lastTelemetryReceivedAtRef.current = incoming.at(-1)?.received_at || since;
        const latest = incoming.at(-1) || null;
        const agentRestarted = latest ? resetForAgentStartChange(latest) : false;
        setLatestTelemetry((current) => latest || current);
        setTelemetryHistory((current) => {
          const sampleKey = (sample) => `${sample.device_id || sample.device_name}|${sample.timestamp}`;
          if (agentRestarted) {
            const restartedDevice = latest.device_id || latest.device_name;
            return [...current.filter((sample) => (sample.device_id || sample.device_name) !== restartedDevice), latest];
          }
          if (!since) return incoming;
          const known = new Set(current.map(sampleKey));
          return [...current, ...incoming.filter((sample) => !known.has(sampleKey(sample)))];
        });
      })
      .catch((err) => {
        setError('Failed to fetch telemetry: ' + err.message);
      });
  };

  const resetUsage = () => {
    setTelemetryHistory([]);
    setLatestTelemetry(null);
  };

  // Requests arrive from chat and email at any time: reload them when the
  // approvals page opens and every 15 s while it shows.
  useEffect(() => {
    if (activeView !== 'license-approvals') return undefined;
    const load = () => {
      fetch(`${BACKEND_BASE_URL}/api/license-requests`)
        .then((response) => {
          if (!response.ok) throw new Error(`License request load failed with status ${response.status}`);
          return response.json();
        })
        .then((payload) => setLicenseRequests(payload.requests || []))
        .catch((error) => setLicenseApprovalStatus(error.message));
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [activeView]);

  // Device register: on start (the focused device) and on Tracker Management.
  useEffect(() => {
    if (deviceOwners.length > 0 && activeView !== 'agent-management') return;
    fetch(`${BACKEND_BASE_URL}/api/devices`)
      .then((response) => {
        if (!response.ok) throw new Error(`Device load failed with status ${response.status}`);
        return response.json();
      })
      .then((payload) => setDeviceOwners(payload.devices || []))
      .catch((error) => setDeviceOwnerStatus(error.message));
  }, [activeView]);

  // Empty email clears the admin override (the Tracker-reported user applies again).
  const saveDeviceOwner = async (device, ownerEmail) => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/devices/${encodeURIComponent(device.deviceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerEmail }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update device owner');
      setDeviceOwners((current) => current.map((entry) => entry.deviceId === device.deviceId ? payload.device : entry));
      setDeviceOwnerDrafts((current) => {
        const next = { ...current };
        delete next[device.deviceId];
        return next;
      });
      setDeviceOwnerStatus(`${device.pcName} now belongs to ${payload.device.ownerEmail || 'no one'}.`);
    } catch (error) {
      setDeviceOwnerStatus(error.message);
    }
  };

  const decideLicenseRequest = async (request, action) => {
    const declineReason = action === 'decline'
      ? window.prompt(`Provide a reason for declining ${request.requestedApp}.`)
      : '';
    if (action === 'decline' && !declineReason?.trim()) return;

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/license-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, declineReason }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update request');
      setLicenseRequests((current) =>
        current.map((entry) => entry.id === request.id ? payload.request : entry)
      );
      const push = payload.configPush;
      const pushNote = action !== 'approve' || !push
        ? ''
        : push.queued
          ? ` Monitoring config sent to ${push.pcName}; the tracker picks it up when the PC is online.`
          : push.reason === 'no_device'
            ? ' No device is on record for the requester, so nothing was sent to a tracker.'
            : ' The monitoring config could not be queued; deploy it from the Deploy screen.';
      setLicenseApprovalStatus(`${request.requestedApp} request ${action === 'approve' ? 'accepted' : 'declined'}.${pushNote}`);
    } catch (error) {
      setLicenseApprovalStatus(error.message);
    }
  };

  const handleNavSelection = (event, nextView) => {
    if (nextView === 'cloud-asset-management') {
      setActiveView('unified-dashboard');
      setShowAgentDetails(false);
      setIsNavCollapsedAfterSelect(true);
      event.currentTarget.blur();
      return;
    }

    setActiveView(nextView);
    setShowAgentDetails(false);
    setIsNavCollapsedAfterSelect(true);
    event.currentTarget.blur();
  };

  useEffect(() => {
    const clockIntervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);

    return () => window.clearInterval(clockIntervalId);
  }, []);

  useEffect(() => {
    loadTelemetry();

    const intervalId = window.setInterval(() => {
      loadTelemetry();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="app-shell">
      <AppNavigation
        activeView={activeView}
        collapsed={isNavCollapsedAfterSelect}
        isSettingsOpen={isSettingsOpen}
        onNavigate={handleNavSelection}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onResetCollapse={() => setIsNavCollapsedAfterSelect(false)}
        user={user}
        onSignOut={onSignOut}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <main className="main-content">
        {activeView !== 'ai-assistant' && (
          <header className="hero">
            <NetworkCanvas className="hero-network" area={6000} maxNodes={45} reach={100} />
            <div>
              <p className="eyebrow">{heroCopy.eyebrow}</p>
              <h1>{heroCopy.title}</h1>
              <p>{heroCopy.description}</p>
            </div>
          </header>
        )}

        {error &&
          !(
            activeView === 'reporting-insights' &&
            error.startsWith('Failed to fetch telemetry:')
          ) && <div className="error-message">{error}</div>}
        {activeView === 'ai-tools' && <AiToolsView />}

        {activeView === 'ai-assistant' && (
          <ChatAssistant backendBaseUrl={BACKEND_BASE_URL} clientId={portalClientId} userEmail={user?.email || ''} />
        )}

        {activeView === 'unified-dashboard' && (
          <>
          <section className="north-star-grid" aria-label="North star metrics">
            <article className="north-star-card">
              <span>Total Managed Spend</span>
              <strong>{formatCurrency(unifiedSummary.totalManagedSpend)}</strong>
              <small>
                End user apps, {formatCurrency(unifiedSummary.aiToolsSpend)} AI tools & agents and {formatCurrency(unifiedSummary.platformSpend)} enterprise platforms (monthly)
              </small>
            </article>
            <article className="north-star-card north-star-waste">
              <span>Combined Monthly Waste</span>
              <strong>{formatCurrency(unifiedSummary.combinedMonthlyWaste)}</strong>
              <small>
                Idle licenses, plus {formatCurrency(unifiedSummary.platformSavings)} of platform waste: idle warehouses and hosts, orphaned resources, inactive users
              </small>
            </article>
            <article className="north-star-card optimization-card">
              <span>Optimization Score</span>
              <div className="optimization-gauge">
                <strong>{unifiedSummary.optimizationScore}%</strong>
                <i style={{ width: `${unifiedSummary.optimizationScore}%` }} />
              </div>
              <small>Distance from a zero-waste operating model</small>
            </article>
            <article className="north-star-card">
              <span>Platform Renewals</span>
              <strong>{unifiedSummary.noticeIn90}</strong>
              <small>
                {unifiedSummary.nextRenewal
                  ? `Notice deadlines in 90 days. Next: ${unifiedSummary.nextRenewal.platform}, ${unifiedSummary.nextRenewal.name} in ${unifiedSummary.nextRenewal.daysToNotice} days`
                  : 'Notice deadlines in the next 90 days'}
              </small>
            </article>
          </section>

          <div className="unified-trend-row">
          <section className="panel compact-panel trends-panel">
            <div className="panel-header">
              <div>
                <h2>Cross-Domain Spend Trend</h2>
                <p>Six-month cost movement across end user apps, AI tools & agents (left axis) and enterprise platforms (right axis).</p>
              </div>
            </div>
            <div className="chart-frame unified-trend-frame">
              <ResponsiveContainer width="100%" height={330}>
                <AreaChart
                  data={spendTrend}
                  margin={{ top: 16, right: 18, left: 0, bottom: 2 }}
                >
                  <defs>
                    <linearGradient id="desktopSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#39a7e8" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#39a7e8" stopOpacity={0.12} />
                    </linearGradient>
                    <linearGradient id="aiSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8e44ad" stopOpacity={0.58} />
                      <stop offset="100%" stopColor="#8e44ad" stopOpacity={0.12} />
                    </linearGradient>
                    <linearGradient id="platformSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f39c12" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#f39c12" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="cloudSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#27ae60" stopOpacity={0.62} />
                      <stop offset="100%" stopColor="#27ae60" stopOpacity={0.13} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#edf2f7"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#7b8ba0', fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="apps"
                    tickFormatter={(value) => `$${formatNumber(value)}`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#7b8ba0', fontSize: 12 }}
                    width={58}
                  />
                  <YAxis
                    yAxisId="platforms"
                    orientation="right"
                    tickFormatter={(value) => `$${formatNumber(Math.round(value / 1000))}k`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#b9770e', fontSize: 12 }}
                    width={52}
                  />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend content={<ChartLegend />} />
                  <Area
                    yAxisId="apps"
                    dataKey="desktopSoftware"
                    name="End User Apps"
                    stackId="spend"
                    type="monotone"
                    stroke="#2980b9"
                    strokeWidth={2.2}
                    fill="url(#desktopSpendGradient)"
                  />
                  <Area
                    yAxisId="apps"
                    dataKey="aiAgents"
                    name="AI Tools & Agents"
                    stackId="spend"
                    type="monotone"
                    stroke="#8e44ad"
                    strokeWidth={2.2}
                    fill="url(#aiSpendGradient)"
                  />
                  {unifiedSummary.platformSpend > 0 && (
                    <Area
                      yAxisId="platforms"
                      dataKey="enterprisePlatforms"
                      name="Enterprise Infra Platform"
                      type="monotone"
                      stroke="#d68910"
                      strokeWidth={2.2}
                      strokeDasharray="5 3"
                      fill="url(#platformSpendGradient)"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel compact-panel spend-split-panel">
            <div className="panel-header">
              <div>
                <h2>Spend Split</h2>
                <p>How this month's {formatCurrency(unifiedSummary.totalManagedSpend)} of managed spend divides.</p>
              </div>
            </div>
            <ChartGrid charts={[{ id: 'spend-split', title: 'Total managed spend', type: 'pie', format: 'usd', data: unifiedSummary.spendSplit }]} />
            <ul className="spend-split-list">
              {unifiedSummary.spendSplit.map((slice) => (
                <li key={slice.name}>
                  <span>{slice.name}</span>
                  <strong>{formatCurrency(slice.value)}</strong>
                  <small>{Math.round((slice.value / unifiedSummary.totalManagedSpend) * 100)}%</small>
                </li>
              ))}
            </ul>
          </section>
          </div>

          <section className="savings-category-grid">
            {[
              ['platform', 'Enterprise Infra Platform', 'Idle capacity, orphaned resources and commitments across Azure, Snowflake and Datadog.'],
              ['endUser', 'End User Apps', 'Idle and underused seats in the apps people use.'],
              ['ai', 'AI Tools & Agent', 'Idle AI seats, low-use plans and spend over budget.'],
            ].map(([key, title, description]) => (
              <article className="panel compact-panel savings-category-panel" key={key}>
                <div className="panel-header">
                  <div>
                    <h2>Top 5 Savings Opportunities - {title}</h2>
                    <p>{description}</p>
                  </div>
                  <span className="savings-category-total">
                    {formatCurrency(topSavingsByCategory[key].reduce((total, item) => total + item.impact, 0))}/mo
                  </span>
                </div>
                {topSavingsByCategory[key].length ? (
                  <div className="savings-opportunity-list">
                    {topSavingsByCategory[key].map((opportunity, index) => (
                      <div className="savings-opportunity-item" key={opportunity.id}>
                        <span className="opportunity-rank">{index + 1}</span>
                        <div>
                          <strong>{opportunity.action}</strong>
                          <small>{opportunity.detail}</small>
                        </div>
                        <b>{formatCurrency(opportunity.impact)}/mo</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-value">No savings found yet.</p>
                )}
              </article>
            ))}

          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Departmental Cost Attribution</h2>
                <p>Team-level accountability across enterprise app license and AI tooling costs.</p>
              </div>
            </div>
            <div className="table-wrap attribution-table-wrap">
              <table className="department-cost-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Enterprise App Cost</th>
                    <th>AI Tools & Agents Cost</th>
                    <th>Efficiency %</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentCostAttribution.map((team) => (
                    <tr key={team.team}>
                      <td>
                        <strong>{team.team}</strong>
                      </td>
                      <td>{formatCurrency(team.desktopCost)}</td>
                      <td>{formatCurrency(team.aiToolingCost)}</td>
                      <td>
                        <div className="efficiency-cell">
                          <span>{team.efficiency}%</span>
                          <i style={{ width: `${team.efficiency}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}

        {activeView === 'license-approvals' && (
          <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Requester approval routing</h2>
                  <p>Each request is routed to the app owner configured during license onboarding.</p>
                </div>
                <span className="last-updated">{licenseRequests.length} requests</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Requester</th>
                      <th>Approving manager</th>
                      <th>Item</th>
                      <th>Target device</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {licenseRequests.length === 0 ? (
                      <tr><td colSpan="7">No license requests yet.</td></tr>
                    ) : licenseRequests.map((request) => (
                      <tr key={request.id}>
                        <td><strong>{request.requesterName}</strong><small>{request.requesterEmail}</small></td>
                        <td><strong>{request.approvingManagerName}</strong><small>{request.approvingManagerEmail}</small></td>
                        <td>
                          {request.requestedApp}
                          {request.source === 'email' && <small>Raised by AI agent from email</small>}
                        </td>
                        <td>
                          {request.targetDevice?.pcName
                            ? <strong>{request.targetDevice.pcName}</strong>
                            : request.status === 'awaiting_device'
                              ? <small>Asked requester: {request.candidateDevices.map((device) => device.pcName).join(', ')}</small>
                              : <span className="muted-value">Not on record</span>}
                        </td>
                        <td>
                          {request.reason}
                          {request.status === 'declined' && <small>Declined: {request.declineReason}</small>}
                        </td>
                        <td>
                          <span className={`status-badge ${(LICENSE_REQUEST_STATUS[request.status] || LICENSE_REQUEST_STATUS.unknown).className}`}>
                            {(LICENSE_REQUEST_STATUS[request.status] || LICENSE_REQUEST_STATUS.unknown).label}
                          </span>
                        </td>
                        <td>
                          {request.status === 'pending_approval' ? (
                            <label className="filter-control license-decision-control">
                              <select
                                aria-label={`Decision for ${request.requesterName}'s ${request.requestedApp} request`}
                                value=""
                                onChange={(event) => decideLicenseRequest(request, event.target.value)}
                              >
                                <option value="" disabled>Choose action</option>
                                <option value="approve">Accept</option>
                                <option value="decline">Decline</option>
                              </select>
                            </label>
                          ) : <span className="muted-value">Decided</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {licenseApprovalStatus && <p className="email-summary-status">{licenseApprovalStatus}</p>}
            </section>
        )}


        {activeView === 'reporting-insights' && (
          <ReportsInsights builder={false ? (
          <>
          <section className="summary-grid report-summary-grid" aria-label="Reporting summary">
            <article className="summary-card">
              <span>Active Schedules</span>
              <strong>12</strong>
              <small>Automated reports across finance, IT, and engineering</small>
            </article>
            <article className="summary-card summary-card-success">
              <span>Current Template</span>
              <strong>{selectedReportTemplate.name}</strong>
              <small>{selectedReportTemplate.audience} - {selectedReportTemplate.format}</small>
            </article>
            <article className="summary-card">
              <span>Next Run</span>
              <strong>{nextRunDate}</strong>
              <small>{reportFrequency} delivery via {deliveryChannel}</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Export Ready</span>
              <strong>3</strong>
              <small>PDF, Excel/CSV, and JSON output profiles available</small>
            </article>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Report Template Gallery</h2>
                <p>One-click templates for leadership, compliance, infrastructure, and engineering adoption reporting.</p>
              </div>
              <span className="last-updated">4 templates</span>
            </div>
            <div className="report-template-grid">
              {reportTemplates.map((template) => (
                <article
                  className={
                    selectedReportTemplateId === template.id
                      ? 'report-template-card active'
                      : 'report-template-card'
                  }
                  key={template.id}
                >
                  <div className="report-template-topline">
                    <span className={`report-accent ${template.accent}`} />
                    <small>{template.audience}</small>
                  </div>
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                  <div className="report-template-meta">
                    <span>{template.owner}</span>
                    <span>{template.cadence}</span>
                    <span>{template.format}</span>
                  </div>
                  <div className="report-section-list">
                    {template.includedSections.map((section) => (
                      <span key={section}>{section}</span>
                    ))}
                  </div>
                  <button
                    className="report-select-button"
                    type="button"
                    onClick={() => setSelectedReportTemplateId(template.id)}
                  >
                    {selectedReportTemplateId === template.id
                      ? 'Selected Template'
                      : 'Use Template'}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="report-builder-grid">
            <article className="panel compact-panel">
              <div className="panel-header">
                <div>
                  <h2>Custom Report Builder</h2>
                  <p>Select dimensions and metrics to shape an analysis-ready report query.</p>
                </div>
              </div>
              <div className="query-builder">
                <div className="query-builder-column">
                  <h3>Dimensions</h3>
                  {reportDimensions.map((dimension) => (
                    <label className="query-check" key={dimension}>
                      <input
                        checked={selectedReportDimensions.includes(dimension)}
                        type="checkbox"
                        onChange={() => toggleReportDimension(dimension)}
                      />
                      <span>{dimension}</span>
                    </label>
                  ))}
                </div>
                <div className="query-builder-column">
                  <h3>Metrics</h3>
                  {reportMetrics.map((metric) => (
                    <label className="query-check" key={metric}>
                      <input
                        checked={selectedReportMetrics.includes(metric)}
                        type="checkbox"
                        onChange={() => toggleReportMetric(metric)}
                      />
                      <span>{metric}</span>
                    </label>
                  ))}
                </div>
                <div className="query-preview-card">
                  <span>Query Preview</span>
                  <strong>
                    {selectedReportDimensions.join(' + ') || 'No dimensions'}
                  </strong>
                  <small>
                    Metrics: {selectedReportMetrics.join(', ') || 'none selected'}
                  </small>
                  <div className="report-preview-stats">
                    {reportPreviewStats.map((stat) => (
                      <div key={stat.label}>
                        <span>{stat.label}</span>
                        <b>{formatNumber(stat.value)}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="panel compact-panel">
              <div className="panel-header">
                <div>
                  <h2>Distribution Settings</h2>
                  <p>Schedule recurring report delivery to email or Slack recipients.</p>
                </div>
              </div>
              <div className="distribution-panel">
                <div className="distribution-controls">
                  <label className="filter-control">
                    <span>Frequency</span>
                    <select
                      value={reportFrequency}
                      onChange={(event) => setReportFrequency(event.target.value)}
                    >
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Channel</span>
                    <select
                      value={deliveryChannel}
                      onChange={(event) => setDeliveryChannel(event.target.value)}
                    >
                      <option>Email</option>
                      <option>Slack</option>
                    </select>
                  </label>
                </div>
                <div className="next-run-card">
                  <span>Next Run Date</span>
                  <strong>{nextRunDate}</strong>
                  <small>{selectedReportTemplate.name} will be delivered {reportFrequency.toLowerCase()}.</small>
                </div>
                <div className="recipient-list">
                  <span>Recipients</span>
                  {reportRecipients.map((recipient) => (
                    <div key={recipient}>
                      <strong>{recipient}</strong>
                      <small>{deliveryChannel === 'Slack' ? 'Slack channel' : 'Email recipient'}</small>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Export Engine</h2>
                <p>Generate presentation, finance-analysis, or integration-ready outputs from the selected report.</p>
              </div>
            </div>
            <div className="export-engine-grid">
              <article>
                <span>PDF</span>
                <strong>Branded Executive Pack</strong>
                <small>Highly styled, non-editable report for leadership presentation.</small>
                <button type="button">Export PDF</button>
              </article>
              <article>
                <span>Excel / CSV</span>
                <strong>Raw Finance Rows</strong>
                <small>Analysis-ready rows for finance modeling, pivots, and reconciliation.</small>
                <button type="button">Export Excel/CSV</button>
              </article>
              <article>
                <span>JSON</span>
                <strong>Enterprise Integration</strong>
                <small>Structured payload for BI, workflow, and internal platform ingestion.</small>
                <button type="button">Export JSON</button>
              </article>
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Report History & Versioning</h2>
                <p>Previously generated reports with versions, owners, download links, and sharing actions.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="report-history-table">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Type</th>
                    <th>Generated</th>
                    <th>Version</th>
                    <th>Format</th>
                    <th>Owner</th>
                    <th>Download</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {reportHistory.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <strong>{report.name}</strong>
                      </td>
                      <td>{report.type}</td>
                      <td>{report.generatedAt}</td>
                      <td>{report.version}</td>
                      <td>{report.format}</td>
                      <td>{report.owner}</td>
                      <td>
                        <button className="download-link-button" type="button">
                          Download
                        </button>
                      </td>
                      <td>
                        <button className="share-icon-button" type="button" aria-label={`Share ${report.name}`}>
                          <span className="action-symbol">↗</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
          ) : <CustomReportBuilder />} />
        )}

        {activeView === 'dashboard' && (
          <>
          {/* An open app's page has no category switch; All software brings it back. */}
          {!engagementProduct && <LicenseCategoryTabs value={licenseCategory} onChange={setLicenseCategory} />}
          {licenseCategory === 'platform' && <PlatformLicenses />}
          {licenseCategory === 'end-user' && (
          <>
          {(
          <>
          <LicenseOverview
              inventoryApps={licensedApps}
              rows={licenseProductRows}
              showSample={showSampleLicenses}
              subtitle="Seats bought, seats in use on PCs, and what each costs. Open a product to see the evidence behind every seat."
              title="Licenses"
              onToggleSample={toggleSampleLicenses}
              onSelectRow={setEngagementProduct}
            />

          <section className="panel compact-panel trends-panel">
            <div className="panel-header">
              <div>
                <h2>Historical Trends</h2>
                <p>Financial recovery and core application engagement over time.</p>
              </div>
              <div className="range-toggle" aria-label="Historical time range">
                {[7, 30, 90].map((range) => (
                  <button
                    className={historicalRange === range ? 'active' : ''}
                    key={range}
                    type="button"
                    onClick={() => setHistoricalRange(range)}
                  >
                    {range} Days
                  </button>
                ))}
              </div>
            </div>
            <div className="trends-grid">
              <article className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <h3>Cost Recovery Trend</h3>
                    <p>Savings overtake waste as licenses are harvested.</p>
                  </div>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart
                      data={historicalTrendData}
                      margin={{ top: 16, right: 18, left: 0, bottom: 2 }}
                    >
                      <defs>
                        <linearGradient id="wasteGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#e74c3c" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#e74c3c" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#27ae60" stopOpacity={0.38} />
                          <stop offset="100%" stopColor="#27ae60" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#edf2f7"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateTick}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                      />
                      <YAxis
                        tickFormatter={(value) => `$${formatNumber(value)}`}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                        width={58}
                      />
                      <Tooltip content={<HistoricalTooltip />} />
                      <Legend content={<ChartLegend />} />
                      <Area
                        dataKey="totalWaste"
                        name="Identified Waste"
                        type="monotone"
                        stroke="#e74c3c"
                        strokeWidth={2.4}
                        fill="url(#wasteGradient)"
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                      />
                      <Area
                        dataKey="totalSavings"
                        name="Cumulative Savings"
                        type="monotone"
                        stroke="#27ae60"
                        strokeWidth={2.4}
                        fill="url(#savingsGradient)"
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <h3>
                      Core App Engagement (24h Velocity)
                      {engagementChart ? ` · ${engagementProduct.name}` : ''}
                    </h3>
                    <p>
                      {engagementChart
                        ? `Active minutes by hour on each PC using ${engagementProduct.name}${engagementChart.sample ? ' (sample data)' : ''}.`
                        : 'Active minutes by hour for key engineering and design apps.'}
                    </p>
                  </div>
                </div>
                <div className="chart-frame">
                  {engagementChart && engagementChart.lines.length === 0 ? (
                    <p className="empty-state">No PC has reported {engagementProduct.name} use in the last 24 hours.</p>
                  ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={engagementChart ? engagementChart.data : engagementVelocity}
                      margin={{ top: 16, right: 18, left: 0, bottom: 2 }}
                    >
                      <CartesianGrid
                        stroke="#edf2f7"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        interval={2}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                        width={52}
                        label={{
                          value: 'Active Minutes',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#7b8ba0',
                          fontSize: 12,
                        }}
                      />
                      <Tooltip content={<HistoricalTooltip />} />
                      {!engagementChart && <Legend content={<ChartLegend />} />}
                      {(engagementChart
                        ? engagementChart.lines
                        : [
                            { key: 'adobeCc', name: 'Adobe CC', color: '#e74c3c' },
                            { key: 'figma', name: 'Figma', color: '#8e44ad' },
                            { key: 'vsCode', name: 'VS Code', color: '#2980b9' },
                          ]
                      ).map((line) => (
                        <Line
                          activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                          dataKey={line.key}
                          dot={<PeakUsageDot series={engagementChart ? engagementChart.data : engagementVelocity} />}
                          key={line.key}
                          name={line.name}
                          stroke={line.color}
                          strokeWidth={2.4}
                          type="monotone"
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  )}
                </div>
              </article>
            </div>
          </section>
          </>
          )}
          </>
          )}
          </>
        )}

        {activeView === 'cloud-asset-management' && (
          <>
          <section className="summary-grid cloud-summary-grid" aria-label="Cloud financial summary">
            <article className="summary-card">
              <span>Monthly Cloud Burn</span>
              <strong>{formatCurrency(cloudSummary.monthlyBurn)}</strong>
              <small>{cloudSummary.resourceCount} resources across AWS, Azure, and GCP</small>
            </article>
            <article className="summary-card">
              <span>Projected Annual Cost</span>
              <strong>{formatCurrency(cloudSummary.projectedAnnualCost)}</strong>
              <small>Based on current monthly run rate</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Zombie Waste</span>
              <strong>{formatCurrency(cloudSummary.zombieWaste)}</strong>
              <small>Unattached or idle assets billing this month</small>
            </article>
            <article className="summary-card summary-card-success">
              <span>Right-Size Savings</span>
              <strong>{formatCurrency(cloudSummary.rightSizingSavings)}</strong>
              <small>Potential monthly reduction from recommended downgrades</small>
            </article>
          </section>

          <section className="panel cloud-connectors-panel">
            <div className="panel-header">
              <div>
                <h2>Cloud Connectors</h2>
                <p>API account health for provider billing, inventory, and utilization sync.</p>
              </div>
            </div>
            <div className="connector-grid">
              {cloudConnectors.map((connector) => (
                <article className="connector-card" key={connector.provider}>
                  <div className="connector-provider">
                    <span
                      className={`provider-icon ${getCloudProviderClass(
                        connector.provider
                      )}`}
                    >
                      {connector.provider}
                    </span>
                    <div>
                      <strong>{connector.provider}</strong>
                      <small>{connector.account}</small>
                    </div>
                  </div>
                  <span
                    className={`connector-status status-${connector.status
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`}
                  >
                    {connector.status}
                  </span>
                  <small>Last sync: {connector.lastSync}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Multi-Cloud Inventory</h2>
                <p>Provider, region, cost, and utilization posture across live cloud assets.</p>
              </div>
              <div className="cloud-filter-actions" aria-label="Cloud inventory filters">
                <label className="filter-control">
                  <span>Provider</span>
                  <select
                    value={cloudProviderFilter}
                    onChange={(event) => setCloudProviderFilter(event.target.value)}
                  >
                    <option>All</option>
                    <option>AWS</option>
                    <option>Azure</option>
                    <option>GCP</option>
                  </select>
                </label>
                <label className="filter-control">
                  <span>Region</span>
                  <select
                    value={cloudRegionFilter}
                    onChange={(event) => setCloudRegionFilter(event.target.value)}
                  >
                    <option>All</option>
                    {cloudRegionOptions.map((region) => (
                      <option key={region}>{region}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="table-wrap cloud-table-wrap">
              <table className="cloud-inventory-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Resource Name</th>
                    <th>Region</th>
                    <th>Resource Type</th>
                    <th>Monthly Burn Rate</th>
                    <th>Projected Annual Cost</th>
                    <th>CPU / Memory</th>
                    <th>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCloudInventory.map((resource) => {
                    const utilizationStatus = getUtilizationStatus(
                      resource.cpuUtilization,
                      resource.memoryUtilization
                    );

                    return (
                      <tr key={resource.id}>
                        <td>
                          <span className="provider-chip">
                            <span
                              className={`provider-dot ${getCloudProviderClass(
                                resource.provider
                              )}`}
                            />
                            {resource.provider}
                          </span>
                        </td>
                        <td>
                          <div className="resource-name-stack">
                            <strong>{resource.name}</strong>
                            <small>{resource.department}</small>
                          </div>
                        </td>
                        <td>{resource.region}</td>
                        <td>{resource.type}</td>
                        <td>{formatCurrency(resource.monthlyBurn)}</td>
                        <td>{formatCurrency(resource.monthlyBurn * 12)}</td>
                        <td>
                          <div className="utilization-stack">
                            <span>CPU {resource.cpuUtilization}%</span>
                            <div className="utilization-meter">
                              <i style={{ width: `${resource.cpuUtilization}%` }} />
                            </div>
                            <span>Mem {resource.memoryUtilization}%</span>
                            <div className="utilization-meter">
                              <i style={{ width: `${resource.memoryUtilization}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${utilizationStatus.className}`}
                          >
                            {utilizationStatus.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCloudInventory.length === 0 && (
                    <tr>
                      <td colSpan="8" className="empty-state">
                        No cloud resources match the selected provider and region.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel compact-panel zombie-panel">
            <div className="panel-header">
              <div>
                <h2>Waste & Zombie Detector</h2>
                <p>Unattached, orphaned, and idle assets that are still generating spend.</p>
              </div>
              <span className="danger-pill">
                {formatCurrency(cloudSummary.zombieWaste)} monthly waste
              </span>
            </div>

            <div className="table-wrap">
              <table className="zombie-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Resource</th>
                    <th>Region</th>
                    <th>Asset Type</th>
                    <th>Monthly Waste</th>
                    <th>Signal</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {zombieCloudAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <span className="provider-chip">
                          <span
                            className={`provider-dot ${getCloudProviderClass(
                              asset.provider
                            )}`}
                          />
                          {asset.provider}
                        </span>
                      </td>
                      <td>
                        <strong>{asset.resourceName}</strong>
                      </td>
                      <td>{asset.region}</td>
                      <td>{asset.type}</td>
                      <td className="savings-value">{formatCurrency(asset.monthlyBurn)}</td>
                      <td>
                        <span className="pc-list">{asset.reason}</span>
                      </td>
                      <td>
                        <button className="reclaim-resource-button" type="button">
                          Reclaim Resource
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Right-Sizing Recommendation Engine</h2>
                <p>Commercial downgrade opportunities ranked by utilization and savings impact.</p>
              </div>
              <span className="savings-pill">
                Potential Monthly Savings {formatCurrency(cloudSummary.rightSizingSavings)}
              </span>
            </div>
            <div className="rightsizing-grid">
              {rightSizingRecommendations.map((recommendation) => (
                <article className="rightsizing-card" key={recommendation.id}>
                  <div className="connector-provider">
                    <span
                      className={`provider-icon ${getCloudProviderClass(
                        recommendation.provider
                      )}`}
                    >
                      {recommendation.provider}
                    </span>
                    <div>
                      <strong>{recommendation.resourceName}</strong>
                      <small>{recommendation.currentSize}</small>
                    </div>
                  </div>
                  <p>
                    {recommendation.provider} {recommendation.currentSize} is only
                    using {recommendation.cpuUtilization}% CPU.
                  </p>
                  <div className="recommendation-callout">
                    <span>Recommendation</span>
                    <strong>{recommendation.recommendation}</strong>
                  </div>
                  <div className="rightsizing-savings">
                    <span>Save</span>
                    <strong>{formatCurrency(recommendation.monthlySavings)}/mo</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel compact-panel trends-panel">
            <div className="panel-header">
              <div>
                <h2>Global Cloud Spend Visualization</h2>
                <p>Provider concentration and department ownership across the blended cloud estate.</p>
              </div>
            </div>
            <div className="cloud-visual-grid">
              <article className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <h3>Spend by Provider</h3>
                    <p>AWS vs. Azure vs. GCP monthly burn.</p>
                  </div>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={270}>
                    <PieChart>
                      <Pie
                        data={cloudSpendByProvider}
                        dataKey="value"
                        nameKey="provider"
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={94}
                        paddingAngle={4}
                      >
                        {cloudSpendByProvider.map((entry) => (
                          <Cell
                            fill={cloudProviderColors[entry.provider]}
                            key={entry.provider}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend content={<ChartLegend />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <h3>Spend by Department</h3>
                    <p>Stacked monthly burn by owner and provider.</p>
                  </div>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart
                      data={cloudSpendByDepartment}
                      margin={{ top: 16, right: 18, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid
                        stroke="#edf2f7"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="department"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                      />
                      <YAxis
                        tickFormatter={(value) => `$${formatNumber(value)}`}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#7b8ba0', fontSize: 12 }}
                        width={58}
                      />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend content={<ChartLegend />} />
                      <Bar dataKey="AWS" stackId="cloud" fill={cloudProviderColors.AWS} />
                      <Bar dataKey="Azure" stackId="cloud" fill={cloudProviderColors.Azure} />
                      <Bar dataKey="GCP" stackId="cloud" fill={cloudProviderColors.GCP} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>
          </section>
          </>
        )}

        {activeView === 'agent-management' && !showAgentDetails && (
          <>
          <section className="summary-grid" aria-label="Fleet summary">
            <article className="summary-card">
              <span>Live Trackers</span>
              <strong>{fleetSummary.liveAgents}</strong>
              <small>{fleetSummary.totalDevices} devices registered</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Offline Trackers</span>
              <strong>{fleetSummary.offlineAgents}</strong>
              <small>Devices needing redeploy or investigation</small>
            </article>
            <article className="summary-card">
              <span>Total License Cost</span>
              <strong>{formatCurrency(fleetSummary.totalLicenseCost)}</strong>
              <small>{fleetSummary.activeLicenses} expensive licenses detected</small>
            </article>
            <article className="summary-card summary-card-success">
              <span>Tracked Apps</span>
              <strong>{onboardedLicenseSummary.count}</strong>
              <small>
                {formatCurrency(onboardedLicenseSummary.monthlyCost)} monthly in scope
              </small>
            </article>
            <article className="summary-card">
              <span>Policies</span>
              <strong>{appRuleSummary.policies}</strong>
              <small>
                Across {appRuleSummary.apps} {appRuleSummary.apps === 1 ? 'app' : 'apps'}
                {appRuleSummary.withoutPolicy > 0 ? ` · ${appRuleSummary.withoutPolicy} onboarded without a policy` : ''}
              </small>
            </article>
          </section>

          <section className="panel deploy-panel">
            <div className="panel-header">
              <div>
                <h2>Deploy Tracker to New PC</h2>
                <p>Prepare an installer assignment for a new endpoint before it joins the monitored fleet.</p>
              </div>
              {deployTarget && (
                <span className="deployment-status">{deployTarget}</span>
              )}
            </div>
            <form
              className="deploy-form endpoint-deploy-form"
              onSubmit={handleDeployAgent}
            >
              <label>
                <span>PC Name</span>
                <input
                  name="pcName"
                  placeholder="ENG-PC-045"
                  type="text"
                  value={deployForm.pcName}
                  onChange={handleDeployInputChange}
                />
              </label>
              <label>
                <span>User Email</span>
                <input
                  name="user"
                  placeholder="name@alliontechnologies.com"
                  type="email"
                  value={deployForm.user}
                  onChange={handleDeployInputChange}
                />
              </label>
              <button
                className="deploy-agent-button"
                disabled={isDeployingAgent}
                type="submit"
              >
                {isDeployingAgent ? (
                  <>
                    <span className="button-spinner" />
                    Deploying
                  </>
                ) : (
                  <>
                    <span className="action-symbol">+</span>
                    Deploy Tracker
                  </>
                )}
              </button>
            </form>
            {trackerDeployments.length > 0 && (
              <div className="table-wrap tracker-deployment-list">
                <table>
                  <thead>
                    <tr>
                      <th>PC</th>
                      <th>User Email</th>
                      <th>Apps</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...trackerDeployments]
                      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                      .map((deployment) => {
                        const status = {
                          sent: { label: 'Sent to tracker', className: 'status-active' },
                          pending: { label: 'Sending…', className: 'status-observing' },
                          waiting_device: { label: 'Waiting for PC to connect', className: 'status-neutral' },
                          superseded: { label: 'Replaced by a newer deployment', className: 'status-neutral' },
                        }[deployment.status] || { label: deployment.status, className: 'status-neutral' };
                        return (
                          <tr key={deployment.pcName}>
                            <td><strong>{deployment.pcName}</strong></td>
                            <td>{deployment.userEmail || '—'}</td>
                            <td>{deployment.apps.join(', ') || '—'}</td>
                            <td>
                              <span className={`status-badge ${status.className}`}>{status.label}</span>
                              {deployment.sentAt && (
                                <small className="tracker-deployment-time">
                                  {new Date(deployment.sentAt).toLocaleString()}
                                </small>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
            {lastDeploymentConfig && (
              <div className="agent-config-preview">
                <div className="agent-config-preview-header">
                  <div>
                    <h3>Last Tracker Config Sent</h3>
                    <p>
                      Generated config includes{' '}
                      {lastDeploymentConfig.licensed_apps.length} licensed app
                      {lastDeploymentConfig.licensed_apps.length === 1
                        ? ''
                        : 's'}.
                    </p>
                  </div>
                  <span>{lastDeploymentConfig.tracked_urls.length} tracked URLs</span>
                </div>
                <pre>
                  {JSON.stringify(lastDeploymentConfig, null, 2)}
                </pre>
              </div>
            )}
          </section>

          <section className="panel app-rules-panel">
            <div className="panel-header">
              <div>
                <h2>Onboard Apps</h2>
                <p>Choose which inventory apps the tracker watches on users’ PCs, and the policy each is evaluated with.</p>
              </div>
              {onboardStatus && <span className="deployment-status">{onboardStatus}</span>}
            </div>
            <form className="deploy-form app-license-onboarding-form" onSubmit={handleOnboardApp}>
              <label>
                <span>App Name</span>
                <InventoryAppPicker apps={inventoryRuleApps(licensedApps)} value={onboardAppId} onChange={pickOnboardApp} />
              </label>
              <label>
                <span>Policy</span>
                <select
                  disabled={!onboardApp}
                  value={onboardPolicyId}
                  onChange={(event) => {
                    setOnboardStatus('');
                    setOnboardPolicyId(event.target.value);
                  }}
                >
                  {onboardApp && appPolicies(onboardApp).length === 0 && <option value="">No policies yet</option>}
                  {appPolicies(onboardApp).map((policy) => (
                    <option key={policy.id} value={policy.id}>{policy.name}</option>
                  ))}
                </select>
              </label>
              <button className="deploy-agent-button" type="submit">
                <span className="action-symbol">+</span>
                {onboardApp?.onboarded ? 'Update App' : 'Onboard App'}
              </button>
            </form>
            {ruleApps(licensedApps).length > 0 && (
              <div className="table-wrap onboarded-license-list">
                <table>
                  <thead>
                    <tr>
                      <th>Onboarded App</th>
                      <th>Policy</th>
                      <th>Monthly Cost</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ruleApps(licensedApps).map((app) => {
                      const bundled = licensedApps.filter((item) => item.bundledWith === app.id);
                      const policy = selectedPolicy(app);
                      return (
                        <tr key={app.id}>
                          <td>
                            <div className="device-identity">
                              <AppInventoryIcon appName={app.appName} className="inventory-list-icon" />
                              <div>
                                <strong>{app.appName}</strong>
                                <span>
                                  {app.appType === 'Extension' ? 'Extension' : 'Desktop app'}
                                  {bundled.length > 0 ? ` · with ${bundled.map((item) => item.appName).join(', ')}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className={policy ? undefined : 'app-rules-missing'}>{policy ? policy.name : 'No policy: not tracked'}</td>
                          <td>{formatCurrency(Number(app.monthlyCost) || 0)}</td>
                          <td>
                            <div className="policy-actions">
                              <button
                                aria-label={`Change ${app.appName} policy`}
                                className="policy-icon-button policy-icon-button-edit"
                                title="Change policy"
                                type="button"
                                onClick={() => pickOnboardApp(app.id)}
                              >
                                <span aria-hidden="true">✎</span>
                              </button>
                              <button
                                aria-label={`Stop tracking ${app.appName}`}
                                className="policy-icon-button policy-icon-button-remove"
                                title="Stop tracking"
                                type="button"
                                onClick={() => handleRemoveOnboardedApp(app.id)}
                              >
                                <span aria-hidden="true">×</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel app-rules-panel">
            <div className="panel-header">
              <div>
                <h2>App Rules</h2>
                <p>
                  Create policies for each app, one per department for example, and set when a seat counts as in use.
                  An app is onboarded with one of its policies.
                </p>
              </div>
              {appRuleStatus && <span className="deployment-status">{appRuleStatus}</span>}
            </div>
            {/* Only the Save button saves: Enter in a field doesn't submit. */}
            <form
              className="app-rule-form"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
              }}
              onSubmit={handleSaveRuleForm}
            >
              <div className="deploy-form app-rule-row app-rule-app-row">
                <label>
                  <span>App Name</span>
                  <InventoryAppPicker
                    apps={inventoryRuleApps(licensedApps)}
                    value={editingRuleAppId}
                    onChange={selectRuleApp}
                  />
                </label>
                {ruleApp && (
                  <label>
                    <span>Policy</span>
                    {rulePolicyId === NEW_POLICY ? (
                      <div className="app-rule-new-policy">
                        <input
                          aria-label="New policy name"
                          autoFocus={appPolicies(ruleApp).length > 0}
                          placeholder="New policy name, e.g. Design team"
                          type="text"
                          value={rulePolicyName}
                          onChange={(event) => {
                            setAppRuleStatus('');
                            setRulePolicyName(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && appPolicies(ruleApp).length > 0) {
                              loadRuleForm(ruleApp.id, appPolicies(ruleApp)[0].id);
                            }
                          }}
                        />
                        {appPolicies(ruleApp).length > 0 && (
                          <button
                            aria-label="Back to the policy list"
                            className="app-rule-new-policy-cancel"
                            title="Back to the policy list"
                            type="button"
                            onClick={() => loadRuleForm(ruleApp.id, appPolicies(ruleApp)[0].id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ) : (
                      <select value={rulePolicyId} onChange={(event) => loadRuleForm(ruleApp.id, event.target.value)}>
                        {appPolicies(ruleApp).map((policy) => (
                          <option key={policy.id} value={policy.id}>{policy.name}</option>
                        ))}
                        <option value={NEW_POLICY}>+ Create new policy</option>
                      </select>
                    )}
                  </label>
                )}
              </div>
              {editingRuleAppId && (
                <>
                  <div className="app-rule-group">
                    <h3>Active use on PCs</h3>
                    <p>Measured by the tracker.</p>
                    <div className="deploy-form app-rule-row">
                      <label>
                        <span>Evaluation Window</span>
                        <input
                          min="0.1"
                          name="windowValue"
                          step="0.1"
                          type="number"
                          value={ruleDraft.windowValue}
                          onChange={handleRuleDraftChange}
                        />
                      </label>
                      <label>
                        <span>Window Unit</span>
                        <select name="windowUnit" value={ruleDraft.windowUnit} onChange={handleRuleDraftChange}>
                          {WINDOW_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Active Threshold</span>
                        <input
                          min="0.1"
                          name="threshold"
                          step="0.1"
                          type="number"
                          value={ruleDraft.threshold}
                          onChange={handleRuleDraftChange}
                        />
                      </label>
                      <label>
                        <span>Threshold Unit</span>
                        <select name="thresholdUnit" value={ruleDraft.thresholdUnit} onChange={handleRuleDraftChange}>
                          {TIME_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>

                  {ruleApp && (
                    <div className="app-rule-group">
                      <h3>Vendor activity</h3>
                      {ruleAppVendorFields.length > 0 ? (
                        <>
                          <p>
                            From {ruleApp.appName}’s APIs, per user, in the same evaluation window. Leave a field blank
                            to skip it. The seat counts as in use if active use or any filled field is met.
                          </p>
                          <div className="deploy-form app-rule-row">
                            {ruleAppVendorFields.map((field) => (
                              <label key={field.id}>
                                <span>{field.kind === 'within' ? `${field.label} (days)` : `${field.label} (at least)`}</span>
                                <input
                                  max={field.max}
                                  min="1"
                                  placeholder="Not used"
                                  step="1"
                                  type="number"
                                  value={ruleDraft.vendor?.[field.id] ?? ''}
                                  onChange={(event) => handleVendorRuleChange(field.id, event.target.value)}
                                />
                                <small>{field.source}</small>
                              </label>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p>{ruleApp.appName} has no vendor activity data, so its policies use active use on PCs only.</p>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="app-rule-actions">
                {ruleApp && rulePolicyId && rulePolicyId !== NEW_POLICY && (
                  <button
                    className="download-link-button"
                    type="button"
                    onClick={() => handleRemovePolicy(ruleApp.id, rulePolicyId)}
                  >
                    Remove Policy
                  </button>
                )}
                <button className="deploy-agent-button" disabled={!editingRuleAppId} type="submit">
                  <span className="action-symbol">+</span>
                  {rulePolicyId === NEW_POLICY ? 'Create Policy' : 'Save Policy'}
                </button>
              </div>
            </form>
          </section>

          <section className="panel fleet-management-panel">
            <div className="panel-header">
              <div>
                <h2>Fleet Management View</h2>
                <p>Deployment health by device with quick redeploy actions.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>PC Name & User</th>
                    <th>Tracker Status</th>
                    <th>Active License Count</th>
                    <th>Total License Cost</th>
                    <th>Action</th>
                    <th>Revoke</th>
                    <th>Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {fleetDevices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <div className="device-identity">
                          <strong>{device.pcName}</strong>
                          <span>{device.user}</span>
                        </div>
                      </td>
                      <td>
                        <span className="agent-status">
                          <span
                            className={`status-dot ${
                              device.isLive ? 'dot-live' : 'dot-offline'
                            }`}
                          />
                          {device.isLive ? 'Live' : 'Offline'}
                        </span>
                      </td>
                      <td>
                        <span className="license-count">
                          {device.activeLicenseCount}
                        </span>
                      </td>
                      <td>{formatCurrency(device.totalLicenseCost)}</td>
                      <td>
                        <button
                          className="dispatch-button"
                          disabled={dispatchingDeviceId === device.id}
                          type="button"
                          onClick={() => handleDispatch(device.id)}
                        >
                          {dispatchingDeviceId === device.id ? (
                            <>
                              <span className="button-spinner" />
                              Dispatching
                            </>
                          ) : (
                            <>
                              <span className="action-symbol">↻</span>
                              Redeploy
                            </>
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          className="revoke-button"
                          disabled={revokingDeviceId === device.id}
                          type="button"
                          onClick={() => handleRevoke(device.id)}
                        >
                          {revokingDeviceId === device.id ? (
                            <>
                              <span className="button-spinner revoke-spinner" />
                              Revoking
                            </>
                          ) : (
                            <>
                              <span className="action-symbol">×</span>
                              Revoke
                            </>
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          className={
                            selectedDevice?.id === device.id
                              ? 'explore-button active'
                              : 'explore-button'
                          }
                          type="button"
                          onClick={() => handleExploreDevice(device.id)}
                        >
                          <span className="action-symbol">›</span>
                          Explore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          </>
        )}

        {activeView === 'apps-inventory' && (
          <section className="panel license-onboarding-panel">
            <div className="panel-header">
              <div>
                <h2>Enterprise Apps Inventory</h2>
                <p>Add applications and AI extensions to the inventory catalog used by license onboarding.</p>
              </div>
              <button
                aria-expanded={isAppCatalogOpen}
                aria-haspopup="dialog"
                aria-label="Open recognised apps catalog"
                className="app-catalog-launcher"
                title="Recognised apps catalog"
                type="button"
                onClick={() => setIsAppCatalogOpen(true)}
              >
                <span className="nine-dot-icon" aria-hidden="true">
                  <i /><i /><i /><i /><i /><i /><i /><i /><i />
                </span>
                <span>Recognised apps</span>
              </button>
            </div>
            <form
              className="deploy-form license-onboarding-form"
              onSubmit={handleAddEnterpriseInventoryItem}
            >
              {licenseAppForm.appType === 'Web URL' ? (
                <label>
                  <span>URL</span>
                  <input
                    name="url"
                    placeholder="google.com"
                    type="text"
                    value={licenseAppForm.url}
                    onChange={handleLicenseAppInputChange}
                  />
                </label>
              ) : (
                <>
                  <div className="app-name-field">
                    <span>App Name</span>
                    <AppNamePicker
                      value={licenseAppForm.appName}
                      onPick={applyCatalogEntry}
                      onTypeName={(appName) => {
                        setPickedCatalogEntry(null);
                        // A typed app is a desktop app; a recognised app's
                        // detection doesn't carry over to it.
                        setLicenseAppForm((currentForm) => ({
                          ...currentForm,
                          appName,
                          ...(pickedCatalogEntry ? { appType: 'Application', parentApp: '', subscriptionType: '' } : {}),
                          processName: pickedCatalogEntry ? '' : currentForm.processName,
                        }));
                      }}
                    />
                  </div>
                </>
              )}
              <label>
                <span>Owner</span>
                <input
                  name="owner"
                  placeholder="Farhan Dulip"
                  type="text"
                  value={licenseAppForm.owner}
                  onChange={handleLicenseAppInputChange}
                />
              </label>
              <label>
                <span>Owner Email</span>
                <input
                  name="ownerEmail"
                  placeholder="farhan@example.com"
                  type="email"
                  value={licenseAppForm.ownerEmail}
                  onChange={handleLicenseAppInputChange}
                />
              </label>
              {licenseAppForm.appType === 'Extension' && (
                <>
                  <label>
                    <span>Subscription</span>
                    <input
                      name="subscriptionType"
                      placeholder="Copilot Business"
                      type="text"
                      value={licenseAppForm.subscriptionType}
                      onChange={handleLicenseAppInputChange}
                    />
                  </label>
                </>
              )}
              {companionSurfaces.length > 0 && (
                <fieldset className="companion-surfaces">
                  <legend>Also track {PRODUCTS[pickedCatalogEntry.product]} through</legend>
                  {companionSurfaces.map((surface) => (
                    <label className="companion-surface" key={surface.id}>
                      <input
                        checked={!skippedCompanionIds.has(surface.id)}
                        type="checkbox"
                        onChange={(event) =>
                          setSkippedCompanionIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.delete(surface.id);
                            else next.add(surface.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>
                          {surface.appType === 'Web URL'
                            ? `Web app · ${surface.url}`
                            : surface.appType === 'Extension'
                              ? `Extension · ${surface.appName}`
                              : `Desktop app · ${surface.appName}`}
                        </strong>
                        <small>
                          {surface.verified ? 'Detection verified' : 'Detection not yet verified on a PC'}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <button className="deploy-agent-button" type="submit">
                <span className="action-symbol">+</span>
                {editingInventoryAppId ? 'Save Inventory' : 'Add Inventory'}
              </button>
            </form>
            {licenseOnboardingStatus && (
              <p className="deployment-status inventory-form-status" role="status">{licenseOnboardingStatus}</p>
            )}

            {licensedApps.length > 0 && (
              <div className="table-wrap onboarded-license-list">
                <table>
                  <thead>
                    <tr>
                      <th>Inventory Item</th>
                      <th>Plans</th>
                      <th>Owner</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Monthly Cost</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {licensedApps.map((app) => (
                      <tr className="inventory-app-row" key={app.id} onClick={() => openAppPlans(app)}>
                        <td>
                          <div className="device-identity">
                            <AppInventoryIcon appName={app.appName} className="inventory-list-icon" />
                            <div>
                              <button
                                className="inventory-app-open"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAppPlans(app);
                                }}
                              >
                                {app.appName}
                              </button>
                              <span>{app.appType}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {app.bundledWith ? (
                            <span className="muted-value">Included</span>
                          ) : planSummary(app).missing ? (
                            <span className="status-badge status-reclaimable">Plans missing</span>
                          ) : (
                            planSummary(app).label
                          )}
                        </td>
                        <td>
                          {app.owner || <span className="status-badge status-reclaimable">Owner missing</span>}
                        </td>
                        <td>{app.ownerEmail || '-'}</td>
                        <td>{app.appType}</td>
                        <td>{formatCurrency(app.monthlyCost)}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="policy-actions">
                            <button
                              aria-label={`Edit ${app.appName} inventory item`}
                              className="policy-icon-button policy-icon-button-edit"
                              title="Edit inventory item"
                              type="button"
                              onClick={() => handleEditInventoryApp(app)}
                            >
                              <span aria-hidden="true">✎</span>
                            </button>
                            <button
                              aria-label={`Remove ${app.appName} inventory item`}
                              className="policy-icon-button policy-icon-button-remove"
                              title="Remove inventory item"
                              type="button"
                              onClick={() => handleRemoveInventoryApp(app.id)}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeView === 'apps-inventory' && (
          <AppCatalog
            inventory={licensedApps}
            isOpen={isAppCatalogOpen}
            onClose={() => setIsAppCatalogOpen(false)}
            onSelect={handleSelectCatalogApp}
            plansOpen={Boolean(plansAppId || newCatalogApp)}
          />
        )}

        {activeView === 'apps-inventory' && newCatalogApp && (
          <AppPlansModal
            app={newCatalogApp}
            bundledApps={[]}
            isNew
            key={newCatalogApp.id}
            onClose={() => setNewCatalogApp(null)}
            onSave={handleAddNewCatalogApp}
          />
        )}

        {activeView === 'apps-inventory' && licensedApps.some((app) => app.id === plansAppId) && (
          <AppPlansModal
            app={licensedApps.find((app) => app.id === plansAppId)}
            bundledApps={licensedApps.filter((app) => app.bundledWith === plansAppId)}
            key={plansAppId}
            onClose={() => setPlansAppId('')}
            onSave={handleSaveAppPlans}
          />
        )}

        {activeView === 'agent-management' && showAgentDetails && selectedDevice && (
            <section className="panel detail-panel">
              <div className="panel-header">
                <div>
                  <h2>{selectedDevice.pcName} Tracker Details</h2>
                  <p>
                    Live tracker runtime, tracked software, policy, and telemetry
                    heartbeat for this machine.
                  </p>
                </div>
                <div className="detail-actions">
                  <span
                    className={`status-badge ${
                      selectedDevice.isLive ? 'status-active' : 'status-reclaimable'
                    }`}
                  >
                    {selectedDevice.isLive ? 'Live tracking' : 'Offline'}
                  </span>
                  <button
                    className="back-button"
                    type="button"
                    onClick={() => setShowAgentDetails(false)}
                  >
                    Back
                  </button>
                </div>
              </div>

              <div className="detail-grid">
                <article className="detail-card">
                  <span>Tracker Runtime</span>
                  <strong>{selectedDevice.agentVersion}</strong>
                  <small>Policy: {selectedDevice.policy}</small>
                </article>
                <article className="detail-card">
                  <span>Last Seen</span>
                  <strong>{selectedDevice.isLive ? 'Online' : 'Stale'}</strong>
                  <small>{selectedDeviceLastHeartbeat}</small>
                </article>
                <article className="detail-card">
                  <span>Tracking Load</span>
                  <strong>{selectedDeviceApps.length}</strong>
                  <small>
                    {selectedDevice.id === liveDeviceKey
                      ? `${telemetryHistory.length} telemetry samples stored`
                      : 'No telemetry yet'}
                  </small>
                </article>
              </div>

              {selectedDeviceEngagementData.length > 0 && (
                <div className="agent-engagement-section">
                  <article className="chart-card">
                    <div className="chart-card-header">
                      <div>
                        <h3>Core App Engagement (24h Velocity)</h3>
                        <p>Active minutes by hour for this tracker's highest-cost tracked apps.</p>
                      </div>
                    </div>
                    <div className="chart-frame">
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart
                          data={selectedDeviceEngagementData}
                          margin={{ top: 16, right: 18, left: 0, bottom: 2 }}
                        >
                          <CartesianGrid
                            stroke="#edf2f7"
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="time"
                            tickLine={false}
                            axisLine={false}
                            interval={2}
                            tick={{ fill: '#7b8ba0', fontSize: 12 }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#7b8ba0', fontSize: 12 }}
                            width={52}
                            label={{
                              value: 'Active Minutes',
                              angle: -90,
                              position: 'insideLeft',
                              fill: '#7b8ba0',
                              fontSize: 12,
                            }}
                          />
                          <Tooltip content={<HistoricalTooltip />} />
                          <Legend content={<ChartLegend />} />
                          {selectedDeviceEngagementSeries.map((series) => (
                            <Line
                              activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                              dataKey={series.dataKey}
                              dot={false}
                              key={series.dataKey}
                              name={series.name}
                              stroke={series.color}
                              strokeWidth={2.4}
                              type="monotone"
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </article>
                </div>
              )}

              <div className="detail-content">
                <div>
                  <h3>Tracked Software Licenses</h3>
                  <div className="tracked-app-list">
                    {selectedDeviceApps.map((entry) => (
                      <div className="tracked-app-item" key={entry.appName}>
                        <span className="app-icon">{entry.icon}</span>
                        <div>
                          <strong>{entry.displayName}</strong>
                          <div className="tracked-app-details">
                            {entry.shouldShowRawName && <small>{entry.rawName}</small>}
                            <small>
                              {formatRuntime(entry.workedRuntimeSeconds)} worked
                              {entry.hasAgentExtension &&
                                `, ${formatRuntime(entry.automationWorkedSeconds)} automation`}
                              {`, ${formatRuntime(entry.idleRuntimeSeconds)} idle`}
                            </small>
                            <small>{formatCurrency(entry.monthlyCost)} monthly cost</small>
                            <small>
                              last tracked at {formatLastTrackedInline(entry.lastSeenAt)}
                            </small>
                          </div>
                        </div>
                        <span
                          className={`status-badge ${getStatusBadgeClass(entry.status)}`}
                          title={entry.reclaimReason}
                        >
                          {entry.status}
                        </span>
                      </div>
                    ))}
                    {selectedDeviceApps.length === 0 && (
                      <div className="empty-inline">
                        Waiting for tracked software telemetry from this tracker.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3>Tracker Information</h3>
                  <div className="tracking-feed">
                    <div>
                      <span>Machine user</span>
                      <strong>{selectedDevice.user}</strong>
                    </div>
                    <div>
                      <span>Tracker status</span>
                      <strong>{selectedDevice.isLive ? 'Streaming' : 'Disconnected'}</strong>
                    </div>
                    <div>
                      <span>Active Licenses</span>
                      <strong>{selectedDeviceTrackingMetrics.activeLicenseCount}</strong>
                    </div>
                    <div>
                      <span>Total Licenses</span>
                      <strong>{selectedDeviceTrackingMetrics.totalLicenseCount}</strong>
                    </div>
                    <div>
                      <span>Total license cost</span>
                      <strong>
                        {formatCurrency(selectedDeviceTrackingMetrics.totalLicenseCost)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {selectedDevice.id === liveDeviceKey && usageByExtension.length > 0 && (
                <div className="detail-extension-section">
                  <h3>AI Licenses</h3>
                  <div className="tracked-app-list">
                    {usageByExtension.map((extension) => (
                      <div className="tracked-app-item" key={extension.name}>
                        <span className="app-icon extension-icon">{extension.icon}</span>
                        <div>
                          <strong>{extension.name}</strong>
                          <div className="tracked-app-details">
                            <small>
                              {formatRuntime(extension.workedRuntimeSeconds)} worked,
                              {` ${formatRuntime(extension.automationWorkedSeconds)} automation, `}
                              {formatRuntime(extension.idleRuntimeSeconds)} idle
                            </small>
                            <small>
                              {formatCurrency(extension.unitMonthlyCost)} monthly cost
                            </small>
                            <small>
                              last tracked at {formatLastTrackedInline(extension.lastSeenAt)}
                            </small>
                          </div>
                        </div>
                        <span
                          className={`status-badge ${getStatusBadgeClass(extension.status)}`}
                          title={extension.reclaimReason}
                        >
                          {extension.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedDevice.registered && <UserAiTools email={selectedDevice.ownerEmail} />}
            </section>
        )}
      </main>
    </div>
  );
}
