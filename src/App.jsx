import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import appCostData from './app_costs.json';
import appConfig from './app_config.json';
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

const RECLAIMABLE_THRESHOLD_SECONDS = 60 * 60;
const TOTAL_MONTHLY_SOFTWARE_SPEND = 4250;
const DEFAULT_USAGE_WINDOW_SECONDS = 60 * 60;
const DEFAULT_RECLAIM_POLICY = {
  evaluation_window_seconds: 30 * 24 * 60 * 60,
  worked_threshold_seconds: RECLAIMABLE_THRESHOLD_SECONDS,
  minimum_observation_seconds: 7 * 24 * 60 * 60,
  token_threshold: 0,
  idle_threshold_seconds: 120,
};

const LICENSE_POLICY_OPTIONS = [
  {
    name: 'Finance baseline',
    evaluationWindowDays: 30,
    evaluationWindowValue: 30,
    evaluationWindowUnit: 'Days',
    workedThresholdHours: 1,
  },
  {
    name: 'Design suite',
    evaluationWindowDays: 45,
    evaluationWindowValue: 45,
    evaluationWindowUnit: 'Days',
    workedThresholdHours: 4,
  },
  {
    name: 'Engineering tools',
    evaluationWindowDays: 30,
    evaluationWindowValue: 30,
    evaluationWindowUnit: 'Days',
    workedThresholdHours: 8,
  },
  {
    name: 'Request based reclaim',
    evaluationWindowDays: 14,
    evaluationWindowValue: 14,
    evaluationWindowUnit: 'Days',
    workedThresholdHours: 1,
  },
];

const DEFAULT_LICENSE_APP_FORM = {
  appName: '',
  processName: '',
  url: '',
  monthlyCost: '',
  owner: '',
  ownerEmail: '',
  appType: 'Application',
  parentApp: '',
  subscriptionType: '',
};

const DEFAULT_ONBOARD_APP_LICENSE_FORM = {
  appId: '',
  policyName: LICENSE_POLICY_OPTIONS[0].name,
};

const DEFAULT_POLICY_REGISTRATION_FORM = {
  name: '',
  evaluationWindowValue: '30',
  evaluationWindowUnit: 'Days',
  workedThresholdHours: '1',
  minimumObservationDays: '7',
};

function getConfigKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function buildReclaimPolicy(policy, { includeTokenThreshold = false } = {}) {
  return {
    evaluation_window_seconds: getEvaluationWindowSeconds(policy),
    worked_threshold_seconds: getPolicyWindowSeconds(
      policy.workedThresholdHours,
      policy
    ),
    minimum_observation_seconds: getPolicyWindowSeconds(
      policy.minimumObservationDays || 7,
      policy
    ),
    idle_threshold_seconds: Number(
      policy.idleThresholdSeconds ??
        policy.idle_threshold_seconds ??
        DEFAULT_RECLAIM_POLICY.idle_threshold_seconds
    ),
    ...(includeTokenThreshold ? { token_threshold: 0 } : {}),
  };
}

function getEvaluationWindowSeconds(policy) {
  const value = policy.evaluationWindowValue ?? policy.evaluationWindowDays ?? 30;
  return getPolicyWindowSeconds(value, policy);
}

function getPolicyWindowSeconds(value, policy) {
  if (policy.evaluationWindowUnit === 'Minutes') {
    return value * 60;
  }

  if (policy.evaluationWindowUnit === 'Hours') {
    return value * 60 * 60;
  }

  return value * 24 * 60 * 60;
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

function buildAgentDeploymentConfig({ pcName, user, licensedApps, inventoryApps = [] }) {
  const applicationItems = licensedApps.filter((app) => app.appType === 'Application');
  const extensionItems = licensedApps.filter((app) => app.appType === 'Extension');
  const webUrlItems = inventoryApps.filter((app) => app.appType === 'Web URL');

  return {
    target_pc: pcName,
    assigned_user: user || 'Unassigned',
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
        .map((extension) => ({
          name: extension.processName || extension.appName,
          type: 'agent',
          subscriptionType: extension.subscriptionType,
          license_cost: extension.monthlyCost,
          dummy_model: '',
          model_signatures: [],
          identifiers: [],
          match_all: [],
          reclaim_policy: buildReclaimPolicy(extension.policy, {
            includeTokenThreshold: true,
          }),
        })),
    })),
    tracked_urls: webUrlItems.map((app) => app.url),
  };
}

const sentEmailSummaryWindowKeys = new Set();
const pendingEmailSummaryWindowKeys = new Set();

const pricingMap = {
  Adobe: 150,
  'Adobe Creative Cloud': 150,
  Photoshop: 35,
  Illustrator: 35,
  JetBrains: 29,
  IntelliJ: 29,
  WebStorm: 16,
  PyCharm: 24,
  'Microsoft 365': 22,
  Office: 22,
  Slack: 12.5,
  Figma: 15,
  Notion: 10,
  Jira: 8.15,
  Zoom: 16,
  Chrome: 0,
  Firefox: 0,
  Postman: 19,
  Notepad: 0,
  'Notepad++': 0,
  Docker: 24,
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
  cursor: 20,
  'cursor ai': 20,
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
  'docker desktop.exe': 'Docker Desktop',
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
  jetBrains: Math.max(3, Math.round(10 + Math.sin((hour - 10) / 2.6) * 16 + (hour >= 10 && hour <= 18 ? 42 : 0))),
  vsCode: Math.max(6, Math.round(18 + Math.sin((hour - 7) / 2.8) * 20 + (hour >= 8 && hour <= 19 ? 48 : 0))),
}));

const mockFleetDevices = [
  {
    id: 'laptop-dx01',
    pcName: 'LAPTOP-DX01',
    user: 'Farhan',
    isLive: true,
    activeLicenseCount: null,
    totalLicenseCost: null,
    agentVersion: '1.8.3',
    policy: 'Finance baseline',
  },
  {
    id: 'ws-fin-014',
    pcName: 'WS-FIN-014',
    user: 'Nadia',
    isLive: true,
    activeLicenseCount: 4,
    totalLicenseCost: 318,
    agentVersion: '1.8.1',
    policy: 'Finance baseline',
    trackedApps: ['Adobe Creative Cloud', 'Microsoft 365', 'Slack', 'Zoom'],
  },
  {
    id: 'design-mac-07',
    pcName: 'DESIGN-MAC-07',
    user: 'Ayesha',
    isLive: false,
    activeLicenseCount: 2,
    totalLicenseCost: 165,
    agentVersion: '1.7.9',
    policy: 'Design suite',
    trackedApps: ['Adobe Creative Cloud', 'Figma'],
  },
  {
    id: 'eng-pc-22',
    pcName: 'ENG-PC-22',
    user: 'Ravi',
    isLive: true,
    activeLicenseCount: 5,
    totalLicenseCost: 394,
    agentVersion: '1.8.3',
    policy: 'Engineering tools',
    trackedApps: ['JetBrains', 'PyCharm', 'Microsoft 365', 'Slack', 'Zoom'],
  },
];

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
    signal: 'Adobe / JetBrains',
    values: [8, 4, 12, 72, 88, 81, 46, 18],
    decision: 'Floating licenses viable outside business hours',
  },
  {
    domain: 'AI Agents',
    signal: 'Copilot / Cursor',
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

const reportTemplates = [
  {
    id: 'ceo-monthly',
    name: 'CEO Monthly',
    audience: 'Executive Summary',
    description:
      'High-level financial gains, managed spend, waste reduction, and savings progress for leadership.',
    owner: 'Executive Office',
    cadence: 'Monthly',
    format: 'PDF',
    accent: 'report-accent-blue',
    includedSections: ['Financial gains', 'Waste reduction', 'Optimization score'],
  },
  {
    id: 'it-audit',
    name: 'IT Audit',
    audience: 'Compliance',
    description:
      'Detailed inventory of software installations compared with active usage and reclaimable seats.',
    owner: 'IT Operations',
    cadence: 'Weekly',
    format: 'Excel',
    accent: 'report-accent-red',
    includedSections: ['Installations', 'Usage evidence', 'License status'],
  },
  {
    id: 'cloud-finops',
    name: 'Cloud FinOps',
    audience: 'Infrastructure',
    description:
      'Cloud right-sizing, provider spend, zombie resources, and cleanup opportunities by account.',
    owner: 'Platform Engineering',
    cadence: 'Weekly',
    format: 'PDF + CSV',
    accent: 'report-accent-green',
    includedSections: ['Right-sizing', 'Orphaned assets', 'Provider spend'],
  },
  {
    id: 'ai-adoption',
    name: 'AI Adoption',
    audience: 'Engineering',
    description:
      'Copilot, Cursor, and AI extension utilization with model adoption and developer efficiency signals.',
    owner: 'Engineering Enablement',
    cadence: 'Monthly',
    format: 'JSON',
    accent: 'report-accent-purple',
    includedSections: ['AI seats', 'Selected models', 'Developer efficiency'],
  },
];

const reportDimensions = ['User', 'Department', 'App', 'Cloud Provider'];
const reportMetrics = ['Cost', 'Active Time', 'Waste', 'CPU %'];

const reportHistory = [
  {
    id: 'rpt-1048',
    name: 'CEO Monthly - April Close',
    type: 'Executive Summary',
    generatedAt: 'May 01, 2026 09:00',
    version: 'v4',
    format: 'PDF',
    owner: 'Finance Ops',
  },
  {
    id: 'rpt-1042',
    name: 'IT Audit - License Evidence',
    type: 'Compliance',
    generatedAt: 'Apr 28, 2026 16:20',
    version: 'v2',
    format: 'XLSX',
    owner: 'IT Operations',
  },
  {
    id: 'rpt-1039',
    name: 'Cloud FinOps - Orphan Cleanup',
    type: 'Infrastructure',
    generatedAt: 'Apr 25, 2026 11:45',
    version: 'v3',
    format: 'CSV',
    owner: 'Platform Engineering',
  },
  {
    id: 'rpt-1031',
    name: 'AI Adoption - Engineering Rollout',
    type: 'Engineering',
    generatedAt: 'Apr 18, 2026 14:10',
    version: 'v1',
    format: 'JSON',
    owner: 'Engineering Enablement',
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

function getTelemetryEvaluationWindowMs(payload) {
  const firstUsageRow = payload?.usage?.[0] || {};
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
  const firstUsageRow = payload?.usage?.[0] || {};
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
  const usageEntry = (payload?.usage || []).find(
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

function getCurrentEvaluationWindow(windowStartsAt, windowEndsAt) {
  const nowMs = Date.now();
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

function getUsageCountersForWindow(history, appName, windowEndsAt, windowSeconds) {
  const counters = createUsageCounters();
  const windowStartsAt = windowEndsAt - windowSeconds * 1000;

  history.forEach((payload) => {
    const timestampMs = getTelemetryTimestampMs(payload);
    if (timestampMs === null || timestampMs < windowStartsAt) return;

    (payload.usage || []).forEach((entry) => {
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
    const usageEntry = (payload.usage || []).find(
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

function getObservationStartedAt(config, firstSeenAt) {
  const firstSeenMs = getFirstSeenTimestampMs(firstSeenAt);
  const agentStartedMs = getFirstSeenTimestampMs(getAgentStartedAt(config));
  const observationStartedMs = Math.max(firstSeenMs || 0, agentStartedMs || 0);

  if (observationStartedMs <= 0) return null;
  return new Date(observationStartedMs).toISOString();
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
  firstSeenAt,
  observationStartedAt,
  workedRuntimeSeconds,
  consumedTokens = 0,
  nowMs = Date.now(),
}) {
  const firstSeenMs = getFirstSeenTimestampMs(firstSeenAt);
  const observationStartedMs =
    getFirstSeenTimestampMs(observationStartedAt) || firstSeenMs;
  const minimumObservationSeconds = getPolicyValue(
    policy,
    'minimum_observation_seconds'
  );
  const requiredObservationSeconds = minimumObservationSeconds;
  const workedThresholdSeconds = getPolicyValue(policy, 'worked_threshold_seconds');
  const tokenThreshold = getPolicyValue(policy, 'token_threshold');

  if (!firstSeenMs && !observationStartedMs) {
    return {
      status: 'Insufficient Data',
      savingsEligible: false,
      reason: 'Waiting for first-seen evidence',
    };
  }

  const observedSeconds = Math.max(
    0,
    Math.floor((nowMs - observationStartedMs) / 1000)
  );
  if (observedSeconds < requiredObservationSeconds) {
    const remainingSeconds = requiredObservationSeconds - observedSeconds;
    return {
      status: 'Observing',
      savingsEligible: false,
      reason: `${formatRuntime(remainingSeconds)} until policy decision`,
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
  if (status === 'Observing') return 'status-observing';
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
  return `Software License Management summary - ${formatDateTime(windowEndsAt)}`;
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
  <title>Software License Management Summary</title>
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
              <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#d7e3f0;">Software Licsence Management - live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.</p>
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
              <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">Reclaimable licenses are evaluated per app policy after the minimum observation period. Idle grace periods are configured inside each reclaim policy.</p>
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
    'Software Licsence Management',
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
    'Reclaimable licenses are evaluated per app policy after the minimum observation period. Idle grace periods are configured inside each reclaim policy.',
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
    'Delivered by AgentOps UI',
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
  const { cx, cy, dataKey, payload, stroke } = props;
  const peakValue = Math.max(...engagementVelocity.map((entry) => entry[dataKey]));

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
    'LAPTOP-DX01'
  );
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

        if (!existingLicenseTypes.includes(licenseType)) {
          existingLicenseTypes.push(licenseType);
        }

        existing.aiModelLicenseTypes[extension.ai_model] = existingLicenseTypes;
      }
    }

      const subscriptionType = extension.subscriptionType || extension.subscription_type;
    const catalogSubscriptionType = findExtensionCatalogSubscriptionType({
      name: extension.name,
      parentApps: extension.parent_app ? [extension.parent_app] : existing.parentApps,
    });
    [catalogSubscriptionType, subscriptionType].forEach((candidateType) => {
      if (candidateType && !existing.subscriptionTypes.includes(candidateType)) {
        existing.subscriptionTypes.push(candidateType);
      }
    });

    if (extension.ai_model && catalogSubscriptionType) {
      const existingLicenseTypes =
        existing.aiModelLicenseTypes[extension.ai_model] || [];
      if (!existingLicenseTypes.includes(catalogSubscriptionType)) {
        existingLicenseTypes.push(catalogSubscriptionType);
      }
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
    const hasUsage = (payload.usage || []).some(
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

function NavIcon({ type }) {
  const icons = {
    brand: (
      <>
        <path d="M5.5 7.5h5A2.5 2.5 0 0 1 13 10v1.5A2.5 2.5 0 0 1 10.5 14h-5A2.5 2.5 0 0 1 3 11.5V10a2.5 2.5 0 0 1 2.5-2.5Z" />
        <path d="M8 7.5V4" />
        <path d="M6.25 11h.01" />
        <path d="M9.75 11h.01" />
        <path d="M6.5 14v1" />
        <path d="M9.5 14v1" />
      </>
    ),
    dashboard: (
      <>
        <path d="M3 8a5 5 0 0 1 10 0" />
        <path d="M4.5 12.5h7" />
        <path d="m8 8 2.6-2.6" />
        <path d="M8 8h.01" />
      </>
    ),
    software: (
      <>
        <path d="M3 4.5h10v7H3z" />
        <path d="M5 14h6" />
        <path d="M8 11.5V14" />
        <path d="M5 7h2" />
        <path d="M5 9h4" />
      </>
    ),
    agent: (
      <>
        <path d="M5 5.5h6v5H5z" />
        <path d="M8 5.5V3.5" />
        <path d="M4 8H2.5" />
        <path d="M13.5 8H12" />
        <path d="M6.5 8h.01" />
        <path d="M9.5 8h.01" />
        <path d="M6 12.5h4" />
      </>
    ),
    cloud: (
      <>
        <path d="M5.5 12.5H11a3 3 0 0 0 .45-5.97A4.25 4.25 0 0 0 3.28 8.1 2.35 2.35 0 0 0 5.5 12.5Z" />
        <path d="M6 15h4" />
      </>
    ),
    reports: (
      <>
        <path d="M4.5 2.75h5.2L12.5 5.6v7.65h-8z" />
        <path d="M9.5 2.9v3h2.85" />
        <path d="M6.25 8.25h4" />
        <path d="M6.25 10.5h2.5" />
        <path d="M6.25 12.75h3.25" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        {icons[type]}
      </g>
    </svg>
  );
}

function RuntimeBreakdown({ entry }) {
  const isAgentEntry = entry.appType === 'agent' || entry.type === 'agent';
  const showAutomationWork =
    isAgentEntry || entry.hasAgentExtension;

  return (
    <div className="runtime-breakdown">
      <strong>{formatRuntime(entry.totalRuntimeSeconds)}</strong>
      {!isAgentEntry && (
        <span>
          Manual Work {formatRuntime(getManualWorkedSeconds(entry))}
        </span>
      )}
      {showAutomationWork && (
        <span>
          Automation Work {formatRuntime(entry.automationWorkedSeconds || 0)}
        </span>
      )}
      <span>Idle {formatRuntime(entry.idleRuntimeSeconds || 0)}</span>
    </div>
  );
}

export default function App() {
  const agentStartedAtRef = useRef(null);
  const [activeView, setActiveView] = useState('unified-dashboard');
  const [config, setConfig] = useState(null);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [error, setError] = useState('');
  const [emailSummaryStatus, setEmailSummaryStatus] = useState('');
  const [emailSummaryWindowKey, setEmailSummaryWindowKey] = useState(null);
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
  const [licensePolicies, setLicensePolicies] = useState(LICENSE_POLICY_OPTIONS);
  const [policyRegistrationForm, setPolicyRegistrationForm] = useState(
    DEFAULT_POLICY_REGISTRATION_FORM
  );
  const [policyRegistrationStatus, setPolicyRegistrationStatus] = useState('');
  const [editingPolicyName, setEditingPolicyName] = useState('');
  const [licensedApps, setLicensedApps] = useState([]);
  const [onboardedAppLicenses, setOnboardedAppLicenses] = useState([]);
  const [onboardAppLicenseForm, setOnboardAppLicenseForm] = useState(
    DEFAULT_ONBOARD_APP_LICENSE_FORM
  );
  const [editingOnboardedLicenseId, setEditingOnboardedLicenseId] = useState('');
  const [licenseAppForm, setLicenseAppForm] = useState(DEFAULT_LICENSE_APP_FORM);
  const [editingInventoryAppId, setEditingInventoryAppId] = useState('');
  const [licenseOnboardingStatus, setLicenseOnboardingStatus] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('laptop-dx01');
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

  const heroCopy = {
    'unified-dashboard': {
      eyebrow: 'Executive command center',
      title: 'Unified Spend Optimization Dashboard',
      description:
        'One decision-making view that merges software licenses, AI tooling, and cloud assets into waste, savings, and efficiency signals.',
    },
    dashboard: {
      eyebrow: 'License intelligence',
      title: 'Software Licsence Management',
      description:
        'Live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.',
    },
    'agent-management': {
      eyebrow: 'Fleet management',
      title: 'Agent Management',
      description:
        'Monitor endpoint health, active expensive licenses, and redeploy agents from one operational view.',
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
  }[activeView];

  const effectiveUsageWindowSeconds =
    config?.usage_window_seconds || DEFAULT_USAGE_WINDOW_SECONDS;
  const effectiveEvaluationWindowSeconds = getConfigEvaluationWindowSeconds(config);

  const telemetryWindow = useMemo(() => {
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
  }, [effectiveUsageWindowSeconds, latestTelemetry, telemetryHistory]);

  const evaluationWindow = useMemo(() => {
    const agentWindow = getTelemetryEvaluationWindowMs(latestTelemetry);
    const reportedWindowEndsAt = agentWindow?.endsAt || telemetryWindow.endsAt;
    const reportedWindowStartsAt =
      agentWindow?.startsAt ||
      reportedWindowEndsAt - effectiveEvaluationWindowSeconds * 1000;
    const currentWindow = agentWindow
      ? getCurrentEvaluationWindow(reportedWindowStartsAt, reportedWindowEndsAt)
      : { startsAt: reportedWindowStartsAt, endsAt: reportedWindowEndsAt };
    const windowStartsAt = currentWindow.startsAt;
    const windowEndsAt = currentWindow.endsAt;
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
      isAgentReported: Boolean(agentWindow),
      hasExpiredReportedWindow: Boolean(agentWindow) && windowStartsAt !== agentWindow.startsAt,
    };
  }, [
    effectiveEvaluationWindowSeconds,
    latestTelemetry,
    telemetryHistory,
    telemetryWindow.endsAt,
  ]);

  const accumulatedUsage = useMemo(() => {
    const usageMap = new Map();

    if (evaluationWindow.hasExpiredReportedWindow) {
      return usageMap;
    }

    const history = evaluationWindow.isAgentReported
      ? evaluationWindow.history
      : telemetryWindow.history;

    history.forEach((payload) => {
      (payload.usage || []).forEach((entry) => {
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
  }, [
    evaluationWindow.hasExpiredReportedWindow,
    evaluationWindow.history,
    evaluationWindow.isAgentReported,
    telemetryWindow,
  ]);

  const currentPcName = useMemo(
    () => getTelemetryPcName(latestTelemetry),
    [latestTelemetry]
  );

  const usageByApp = useMemo(() => {
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
      const reclaimPolicy = getAppPolicy(config, appName);
      const firstSeenAt = getAppFirstSeenAt(config, appName);
      const observationStartedAt = getObservationStartedAt(config, firstSeenAt);
      const decisionObservationStartedAt = evaluationWindow.isAgentReported
        ? new Date(evaluationWindow.startsAt).toISOString()
        : observationStartedAt;
      const decisionFirstSeenAt = evaluationWindow.isAgentReported
        ? decisionObservationStartedAt
        : firstSeenAt;
      const decisionNowMs = evaluationWindow.isAgentReported
        ? Date.now()
        : telemetryWindow.endsAt;
      const telemetryLastResetForAppMs = getTelemetryLastResetForAppMs(
        latestTelemetry,
        appName
      );
      const lastSeenAt = telemetryLastResetForAppMs
        ? new Date(telemetryLastResetForAppMs).toISOString()
        : getLastSeenAt(config, telemetryHistory, appName);
      const appType = getAppType(config, appName);
      const hasAgentExtension = appHasAgentExtension(config, appName);
      const policyUsageCounters = evaluationWindow.isAgentReported
        ? usageCounters
        : getUsageCountersForWindow(
            telemetryHistory,
            appName,
            telemetryWindow.endsAt,
            getPolicyValue(reclaimPolicy, 'evaluation_window_seconds')
          );
      const reclaimDecision = getReclaimDecision({
        policy: reclaimPolicy,
        firstSeenAt: decisionFirstSeenAt,
        observationStartedAt: decisionObservationStartedAt,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        nowMs: decisionNowMs,
      });

      return {
        appName,
        ...appIdentity,
        pcName: currentPcName,
        icon: getAppIcon(appIdentity.displayName),
        status: reclaimDecision.status,
        appType,
        hasAgentExtension,
        reclaimReason: reclaimDecision.reason,
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
        savingsOpportunity: reclaimDecision.savingsEligible ? monthlyCost : 0,
      };
    });
  }, [
    config,
    accumulatedUsage,
    costOverrides,
    currentPcName,
    evaluationWindow.isAgentReported,
    latestTelemetry,
    telemetryHistory,
    telemetryWindow.endsAt,
  ]);

  const usageByUrl = useMemo(() => {
    if (!config?.tracked_urls) return [];

    return config.tracked_urls.map((url) => ({
      url,
      ...getUsageCounters(accumulatedUsage, `url:${url}`),
    }));
  }, [config, accumulatedUsage]);

  const usageByExtension = useMemo(() => {
    if (!config?.extensions) return [];

    return getUniqueExtensionRules(config.extensions).map((extension, index) => {
      const usageCounters = getUsageCounters(accumulatedUsage, extension.name);
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
      const reclaimPolicy = extension.reclaimPolicy || DEFAULT_RECLAIM_POLICY;
      const observationStartedAt = getObservationStartedAt(
        config,
        extension.firstSeenAt
      );
      const decisionObservationStartedAt = evaluationWindow.isAgentReported
        ? new Date(evaluationWindow.startsAt).toISOString()
        : observationStartedAt;
      const decisionFirstSeenAt = evaluationWindow.isAgentReported
        ? decisionObservationStartedAt
        : extension.firstSeenAt || decisionObservationStartedAt;
      const decisionNowMs = evaluationWindow.isAgentReported
        ? Date.now()
        : telemetryWindow.endsAt;
      const policyUsageCounters = evaluationWindow.isAgentReported
        ? {
            ...usageCounters,
            workedRuntimeSeconds,
          }
        : getUsageCountersForWindow(
            telemetryHistory,
            extension.name,
            telemetryWindow.endsAt,
            getPolicyValue(reclaimPolicy, 'evaluation_window_seconds')
          );
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
        firstSeenAt: decisionFirstSeenAt,
        observationStartedAt: decisionObservationStartedAt,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        consumedTokens,
        nowMs: decisionNowMs,
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
  }, [
    config,
    accumulatedUsage,
    evaluationWindow.isAgentReported,
    telemetryHistory,
    telemetryWindow.endsAt,
  ]);

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
      const reclaimPolicy = getAppPolicy(config, appName);
      const firstSeenAt = getAppFirstSeenAt(config, appName);
      const observationStartedAt = getObservationStartedAt(config, firstSeenAt);
      const decisionObservationStartedAt = evaluationWindow.isAgentReported
        ? new Date(evaluationWindow.startsAt).toISOString()
        : observationStartedAt;
      const decisionFirstSeenAt = evaluationWindow.isAgentReported
        ? decisionObservationStartedAt
        : firstSeenAt;
      const decisionNowMs = evaluationWindow.isAgentReported
        ? Date.now()
        : telemetryWindow.endsAt;
      const telemetryLastResetForAppMs = getTelemetryLastResetForAppMs(
        latestTelemetry,
        appName
      );
      const lastSeenAt = telemetryLastResetForAppMs
        ? new Date(telemetryLastResetForAppMs).toISOString()
        : getLastSeenAt(config, telemetryHistory, appName);
      const appType = getAppType(config, appName);
      const hasAgentExtension = appHasAgentExtension(config, appName);
      const policyUsageCounters = evaluationWindow.isAgentReported
        ? usageCounters
        : getUsageCountersForWindow(
            telemetryHistory,
            appName,
            telemetryWindow.endsAt,
            getPolicyValue(reclaimPolicy, 'evaluation_window_seconds')
          );
      const reclaimDecision = getReclaimDecision({
        policy: reclaimPolicy,
        firstSeenAt: decisionFirstSeenAt,
        observationStartedAt: decisionObservationStartedAt,
        workedRuntimeSeconds: policyUsageCounters.workedRuntimeSeconds,
        nowMs: decisionNowMs,
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
    costOverrides,
    currentPcName,
    evaluationWindow.isAgentReported,
    latestTelemetry,
    telemetryHistory,
    telemetryWindow.endsAt,
  ]);

  const aggregates = useMemo(() => {
    const totalWaste = usageByApp.reduce(
      (sum, entry) => sum + entry.savingsOpportunity,
      0
    );
    const activeCost = usageByApp.reduce(
      (sum, entry) =>
        entry.status === 'Active' ? sum + entry.monthlyCost : sum,
      0
    );
    const trackedMonthlyCost = usageByApp.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );
    const activeSeats = usageByApp.filter((entry) => entry.status === 'Active').length;
    const totalSeats = usageByApp.length;
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
  }, [usageByApp, usageByExtension]);

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

  const sortedUsageByApp = useMemo(() => {
    const sortableRows = [...usageByApp];

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
  }, [usageByApp, sortConfig]);

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

    return mockFleetDevices.map((device, index) => ({
      ...device,
      activeLicenseCount:
        index === 0 ? activeExpensiveLicenses : device.activeLicenseCount,
      totalLicenseCost:
        index === 0 ? activeExpensiveLicenseCost : device.totalLicenseCost,
      trackedApps:
        index === 0
          ? [
              ...usageByApp
                .filter((entry) => entry.monthlyCost > 0)
                .map((entry) => entry.appName),
              ...onboardedAppLicenses.map((app) => app.appName),
            ]
          : device.trackedApps,
    }));
  }, [onboardedAppLicenses, usageByApp]);

  const selectedDevice = useMemo(
    () =>
      fleetDevices.find((device) => device.id === selectedDeviceId) ||
      fleetDevices[0],
    [fleetDevices, selectedDeviceId]
  );

  const selectedDeviceApps = useMemo(() => {
    if (!selectedDevice) return [];

    if (selectedDevice.id === 'laptop-dx01') {
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

    if (selectedDevice.id !== 'laptop-dx01') {
      return engagementVelocity.map((entry) => {
        const point = { time: entry.time };
        selectedDeviceEngagementSeries.forEach((series, index) => {
          const sourceKey = ['adobeCc', 'jetBrains', 'vsCode'][index % 3];
          point[series.dataKey] = entry[sourceKey] || 0;
        });
        return point;
      });
    }

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

      (payload.usage || []).forEach((usageEntry) => {
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
        extension.parentApps.some((parentApp) => selectedAppNames.has(parentApp))
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
    if (selectedDevice.id === 'laptop-dx01') {
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
        (sum, app) => sum + app.monthlyCost,
        0
      ),
    }),
    [onboardedAppLicenses]
  );

  const registeredPolicySummary = useMemo(
    () => ({
      count: licensePolicies.length,
      fastestDecisionHours: Math.min(
        ...licensePolicies.map((policy) => getEvaluationWindowSeconds(policy) / 3600)
      ),
    }),
    [licensePolicies]
  );

  const enterpriseParentAppOptions = useMemo(
    () =>
      licensedApps
        .filter((app) => app.appType === 'Application')
        .map((app) => app.appName),
    [licensedApps]
  );

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

  const unifiedSummary = useMemo(() => {
    const totalManagedSpend =
      TOTAL_MONTHLY_SOFTWARE_SPEND + cloudSummary.monthlyBurn;
    const combinedMonthlyWaste =
      aggregates.totalWaste +
      cloudSummary.zombieWaste +
      cloudSummary.rightSizingSavings;
    const optimizationScore =
      totalManagedSpend > 0
        ? Math.max(
            0,
            Math.round(((totalManagedSpend - combinedMonthlyWaste) / totalManagedSpend) * 100)
          )
        : 0;

    return {
      totalManagedSpend,
      combinedMonthlyWaste,
      optimizationScore,
    };
  }, [aggregates.totalWaste, cloudSummary]);

  const topSavingsOpportunities = useMemo(
    () =>
      [
        {
          id: 'aws-rds-rightsize',
          domain: 'Cloud',
          action: 'Right-size AWS RDS (Production)',
          impact: 450,
          detail: 'Move prod-db-instance to the next lower committed tier',
          tone: 'danger',
        },
        {
          id: 'adobe-harvest',
          domain: 'Software',
          action: 'Harvest 12 idle Adobe licenses',
          impact: 960,
          detail: 'Recover design seats with less than 1 hour active runtime',
          tone: 'danger',
        },
        {
          id: 'copilot-downgrade',
          domain: 'AI Tooling',
          action: 'Downgrade 5 unused Copilot seats',
          impact: 100,
          detail: 'Move inactive users to request-based assignment',
          tone: 'warning',
        },
        {
          id: 'qa-schedule',
          domain: 'Cloud',
          action: 'Schedule QA cloud runners overnight',
          impact: 186,
          detail: 'Stop non-production compute outside test windows',
          tone: 'warning',
        },
        {
          id: 'jetbrains-harvest',
          domain: 'Software',
          action: 'Reassign underused JetBrains seats',
          impact: 145,
          detail: 'Shift named seats into a pooled developer allocation',
          tone: 'success',
        },
      ].sort((firstItem, secondItem) => secondItem.impact - firstItem.impact),
    []
  );

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
    if (!emailRecipient) {
      throw new Error('Recipient email is not configured.');
    }

    if (!evaluationWindow?.endsAt) {
      throw new Error('Evaluation window is not ready yet.');
    }

    if (!isEmailSummaryReady) {
      throw new Error('Software License Management data is still loading.');
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
  ]);

  useEffect(() => {
    if (!emailRecipient || !evaluationWindow.endsAt || !isEmailSummaryReady) {
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
      ...(name === 'appType' && value === 'Application'
        ? {
            parentApp: '',
            subscriptionType: '',
          }
        : {}),
      ...(name === 'appType' && value === 'Web URL'
        ? {
            appName: '',
            processName: '',
            parentApp: '',
            subscriptionType: '',
          }
        : {}),
    }));
  };

  const handleOnboardAppLicenseInputChange = (event) => {
    const { name, value } = event.target;
    setOnboardAppLicenseForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  };

  const handlePolicyRegistrationInputChange = (event) => {
    const { name, value } = event.target;
    setPolicyRegistrationForm((currentForm) => ({
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
      setDeployTarget('Onboard at least one app license before deployment.');
      return;
    }

    const deploymentConfig = buildAgentDeploymentConfig({
      pcName: normalizedPcName,
      user: assignedUser,
      licensedApps: onboardedAppLicenses,
      inventoryApps: licensedApps,
    });

    setIsDeployingAgent(true);
    setDeployTarget(
      `Preparing deployment for ${normalizedPcName} with ${onboardedAppLicenses.length} app licenses`
    );

    window.setTimeout(() => {
      setIsDeployingAgent(false);
      setLastDeploymentConfig(deploymentConfig);
      setDeployTarget(
        `Deployment config queued for ${normalizedPcName} with ${onboardedAppLicenses.length} app licenses`
      );
      setDeployForm((currentForm) => ({
        ...currentForm,
        pcName: '',
        user: '',
      }));
    }, 1600);
  };

  const handleRegisterPolicy = (event) => {
    event.preventDefault();

    const policyName = policyRegistrationForm.name.trim();
    const evaluationWindowValue = Number(policyRegistrationForm.evaluationWindowValue);
    const evaluationWindowUnit = policyRegistrationForm.evaluationWindowUnit;
    const workedThresholdHours = Number(policyRegistrationForm.workedThresholdHours);
    const minimumObservationDays = Number(policyRegistrationForm.minimumObservationDays);

    if (!policyName) {
      setPolicyRegistrationStatus('Enter a policy name to register.');
      return;
    }

    if (
      !Number.isFinite(evaluationWindowValue) ||
      evaluationWindowValue < 0.1 ||
      !Number.isFinite(workedThresholdHours) ||
      workedThresholdHours < 0.1 ||
      !Number.isFinite(minimumObservationDays) ||
      minimumObservationDays < 0.1
    ) {
      setPolicyRegistrationStatus('Policy timing values must be at least 0.1.');
      return;
    }

    const nextPolicy = {
      name: policyName,
      evaluationWindowValue,
      evaluationWindowUnit,
      evaluationWindowDays:
        evaluationWindowUnit === 'Days'
          ? evaluationWindowValue
          : evaluationWindowValue / 24,
      workedThresholdHours,
      minimumObservationDays,
    };

    const normalizedPolicyName = policyName.toLowerCase();
    const normalizedEditingPolicyName = editingPolicyName.toLowerCase();
    const existingPolicyIndex = licensePolicies.findIndex(
      (policy) => policy.name.toLowerCase() === normalizedPolicyName
    );
    const editingPolicyIndex = licensePolicies.findIndex(
      (policy) => policy.name.toLowerCase() === normalizedEditingPolicyName
    );

    if (
      editingPolicyName &&
      existingPolicyIndex !== -1 &&
      existingPolicyIndex !== editingPolicyIndex
    ) {
      setPolicyRegistrationStatus(`${policyName} policy already exists.`);
      return;
    }

    setLicensePolicies((currentPolicies) => {
      const existingIndex = currentPolicies.findIndex(
        (policy) => policy.name.toLowerCase() === normalizedPolicyName
      );
      const editingIndex = currentPolicies.findIndex(
        (policy) => policy.name.toLowerCase() === normalizedEditingPolicyName
      );

      if (editingPolicyName && editingIndex !== -1) {
        return currentPolicies.map((policy, index) =>
          index === editingIndex ? nextPolicy : policy
        );
      }

      if (existingIndex === -1) {
        return [...currentPolicies, nextPolicy];
      }

      return currentPolicies.map((policy, index) =>
        index === existingIndex ? { ...policy, ...nextPolicy } : policy
      );
    });
    setOnboardedAppLicenses((currentApps) =>
      currentApps.map((app) =>
        app.policy.name.toLowerCase() ===
        (editingPolicyName || nextPolicy.name).toLowerCase()
          ? { ...app, policy: nextPolicy }
          : app
      )
    );
    setOnboardAppLicenseForm((currentForm) => ({
      ...currentForm,
      policyName: nextPolicy.name,
    }));
    setPolicyRegistrationStatus(
      editingPolicyName
        ? `${nextPolicy.name} policy updated.`
        : `${nextPolicy.name} policy registered.`
    );
    setPolicyRegistrationForm(DEFAULT_POLICY_REGISTRATION_FORM);
    setEditingPolicyName('');
  };

  const handleEditPolicy = (policy) => {
    setEditingPolicyName(policy.name);
    setPolicyRegistrationForm({
      name: policy.name,
      evaluationWindowValue: String(
        policy.evaluationWindowValue ?? policy.evaluationWindowDays ?? 30
      ),
      evaluationWindowUnit: policy.evaluationWindowUnit || 'Days',
      workedThresholdHours: String(policy.workedThresholdHours),
      minimumObservationDays: String(policy.minimumObservationDays || 7),
    });
    setPolicyRegistrationStatus(`Editing ${policy.name} policy.`);
  };

  const handleRemovePolicy = (policyName) => {
    if (licensePolicies.length <= 1) {
      setPolicyRegistrationStatus('Keep at least one policy registered.');
      return;
    }

    const remainingPolicies = licensePolicies.filter(
      (policy) => policy.name !== policyName
    );
    const fallbackPolicy = remainingPolicies[0];

    setLicensePolicies(remainingPolicies);
    setOnboardedAppLicenses((currentApps) =>
      currentApps.map((app) =>
        app.policy.name === policyName ? { ...app, policy: fallbackPolicy } : app
      )
    );
    setOnboardAppLicenseForm((currentForm) => ({
      ...currentForm,
      policyName:
        currentForm.policyName === policyName
          ? fallbackPolicy.name
          : currentForm.policyName,
    }));

    if (editingPolicyName === policyName) {
      setPolicyRegistrationForm(DEFAULT_POLICY_REGISTRATION_FORM);
      setEditingPolicyName('');
    }

    setPolicyRegistrationStatus(`${policyName} policy removed.`);
  };

  const handleAddEnterpriseInventoryItem = (event) => {
    event.preventDefault();

    const appName = licenseAppForm.appName.trim();
    const processName = licenseAppForm.processName.trim();
    const url = licenseAppForm.url.trim();
    const monthlyCost = Number(licenseAppForm.monthlyCost);
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

    if (appType !== 'Web URL' && !processName) {
      setLicenseOnboardingStatus('Enter the app process name.');
      return;
    }

    if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) {
      setLicenseOnboardingStatus('Enter a valid monthly license cost.');
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

    if (appType === 'Extension' && !parentApp) {
      setLicenseOnboardingStatus('Choose a parent app for this extension.');
      return;
    }

    if (appType === 'Extension' && !subscriptionType) {
      setLicenseOnboardingStatus('Enter the extension subscription type.');
      return;
    }

    const nextApp = {
      id: `${appType}-${appType === 'Web URL' ? url : appName}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-'),
      appName: appType === 'Web URL' ? url : appName,
      processName,
      url,
      monthlyCost,
      owner,
      ownerEmail,
      appType,
      parentApp,
      subscriptionType,
      onboardedAt: new Date().toISOString(),
    };

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

      if (existingIndex === -1) {
        return [...currentApps, nextApp];
      }

      return currentApps.map((app, index) =>
        index === existingIndex ? { ...app, ...nextApp } : app
      );
    });
    setOnboardedAppLicenses((currentLicenses) =>
      currentLicenses.map((app) =>
        app.id === editingInventoryAppId || app.id === nextApp.id
          ? { ...app, ...nextApp, policy: app.policy }
          : app
      )
    );
    setLicenseOnboardingStatus(
      `${appName} ${appType.toLowerCase()} ${
        editingInventoryAppId ? 'updated in' : 'added to'
      } Enterprise Apps Inventory.`
    );
    setLicenseAppForm(DEFAULT_LICENSE_APP_FORM);
    setEditingInventoryAppId('');
  };

  const handleOnboardAppLicense = (event) => {
    event.preventDefault();

    const inventoryItem = licensedApps.find(
      (app) => app.id === onboardAppLicenseForm.appId
    );
    const selectedPolicy =
      licensePolicies.find(
        (policy) => policy.name === onboardAppLicenseForm.policyName
      ) || licensePolicies[0];

    if (!inventoryItem) {
      setLicenseOnboardingStatus('Choose an app from Enterprise Apps Inventory.');
      return;
    }

    const nextLicense = {
      ...inventoryItem,
      policy: selectedPolicy,
      onboardedAt: new Date().toISOString(),
    };

    setOnboardedAppLicenses((currentLicenses) => {
      const existingIndex = currentLicenses.findIndex(
        (app) => app.id === (editingOnboardedLicenseId || inventoryItem.id)
      );

      if (existingIndex === -1) {
        return [...currentLicenses, nextLicense];
      }

      return currentLicenses.map((app, index) =>
        index === existingIndex ? nextLicense : app
      );
    });
    setLicenseOnboardingStatus(
      `${inventoryItem.appName} license ${
        editingOnboardedLicenseId ? 'updated' : 'onboarded'
      } with ${selectedPolicy.name} policy.`
    );
    setOnboardAppLicenseForm({
      ...DEFAULT_ONBOARD_APP_LICENSE_FORM,
      policyName: selectedPolicy.name,
    });
    setEditingOnboardedLicenseId('');
  };

  const handleEditOnboardedLicense = (app) => {
    setEditingOnboardedLicenseId(app.id);
    setOnboardAppLicenseForm({
      appId: app.id,
      policyName: app.policy.name,
    });
    setLicenseOnboardingStatus(`Editing ${app.appName} license.`);
  };

  const handleRemoveOnboardedLicense = (appId) => {
    const removedLicense = onboardedAppLicenses.find((app) => app.id === appId);
    setOnboardedAppLicenses((currentLicenses) =>
      currentLicenses.filter((app) => app.id !== appId)
    );

    if (editingOnboardedLicenseId === appId) {
      setEditingOnboardedLicenseId('');
      setOnboardAppLicenseForm(DEFAULT_ONBOARD_APP_LICENSE_FORM);
    }

    setLicenseOnboardingStatus(
      `${removedLicense?.appName || 'App'} license removed.`
    );
  };

  const handleEditInventoryApp = (app) => {
    setEditingInventoryAppId(app.id);
    setLicenseAppForm({
      appName: app.appType === 'Web URL' ? '' : app.appName,
      processName: app.processName,
      url: app.url || '',
      monthlyCost: String(app.monthlyCost),
      owner: app.owner,
      ownerEmail: app.ownerEmail,
      appType: app.appType,
      parentApp: app.parentApp || '',
      subscriptionType: app.subscriptionType || '',
    });
    setLicenseOnboardingStatus(`Editing ${app.appName} inventory item.`);
  };

  const handleRemoveInventoryApp = (appId) => {
    const removedApp = licensedApps.find((app) => app.id === appId);
    setLicensedApps((currentApps) => currentApps.filter((app) => app.id !== appId));
    setOnboardedAppLicenses((currentLicenses) =>
      currentLicenses.filter((app) => app.id !== appId)
    );

    if (editingInventoryAppId === appId) {
      setEditingInventoryAppId('');
      setLicenseAppForm(DEFAULT_LICENSE_APP_FORM);
    }

    if (editingOnboardedLicenseId === appId) {
      setEditingOnboardedLicenseId('');
      setOnboardAppLicenseForm(DEFAULT_ONBOARD_APP_LICENSE_FORM);
    }

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
    setSelectedDeviceId(matchingDevice?.id || 'laptop-dx01');
    setActiveView('agent-management');
    setShowAgentDetails(true);
  };

  const resetForAgentStartChange = (payload) => {
    const nextAgentStartedAt = getAgentStartedTimestampMs(payload);
    if (!nextAgentStartedAt) return false;

    const previousAgentStartedAt = agentStartedAtRef.current;
    agentStartedAtRef.current = nextAgentStartedAt;

    if (!previousAgentStartedAt || previousAgentStartedAt === nextAgentStartedAt) {
      return false;
    }

    setTelemetryHistory([]);
    setLatestTelemetry(null);
    return true;
  };

  const loadConfig = () => {
    fetch('http://localhost:8080/config')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Config request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data.licensed_apps || !Array.isArray(data.licensed_apps)) {
          throw new Error('Config must include a licensed_apps array.');
        }
        if (data.tracked_urls && !Array.isArray(data.tracked_urls)) {
          throw new Error('tracked_urls must be an array.');
        }
        if (data.extensions && !Array.isArray(data.extensions)) {
          throw new Error('extensions must be an array.');
        }
        resetForAgentStartChange(data);
        setConfig(data);
        setError('');
      })
      .catch((err) => {
        setConfig(null);
        setError('Failed to fetch config: ' + err.message);
      });
  };

  const loadTelemetry = () => {
    fetch('http://localhost:8080/telemetry')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Telemetry request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const agentRestarted = resetForAgentStartChange(data);
        setLatestTelemetry(data);
        setError('');

        setTelemetryHistory((currentHistory) => {
          if (!data || !data.timestamp) {
            return currentHistory;
          }
          if (data.telemetry_pending) {
            return currentHistory;
          }

          const alreadyStored = currentHistory.some(
            (entry) => entry.timestamp === data.timestamp
          );
          if (alreadyStored) {
            return currentHistory;
          }

          return agentRestarted ? [data] : [...currentHistory, data];
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
    loadConfig();
    loadTelemetry();

    const intervalId = window.setInterval(() => {
      loadConfig();
      loadTelemetry();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="app-shell">
      <nav
        className={
          isNavCollapsedAfterSelect
            ? 'top-nav nav-collapsed-after-select'
            : 'top-nav'
        }
        aria-label="Primary navigation"
        onMouseLeave={() => setIsNavCollapsedAfterSelect(false)}
      >
        <div className="brand-mark">
          <span className="brand-icon">
            <NavIcon type="brand" />
          </span>
          <span>AgentOps</span>
        </div>
        <div className="nav-actions">
          <button
            className={
              activeView === 'unified-dashboard' ? 'nav-link active' : 'nav-link'
            }
            type="button"
            onClick={(event) => handleNavSelection(event, 'unified-dashboard')}
          >
            <span className="nav-glyph">
              <NavIcon type="dashboard" />
            </span>
            <span className="nav-label">Dashboard</span>
          </button>
          <button
            className={activeView === 'dashboard' ? 'nav-link active' : 'nav-link'}
            type="button"
            onClick={(event) => handleNavSelection(event, 'dashboard')}
          >
            <span className="nav-glyph">
              <NavIcon type="software" />
            </span>
            <span className="nav-label">Software Licsence Management</span>
          </button>
          <button
            className={
              activeView === 'agent-management' ? 'nav-link active' : 'nav-link'
            }
            type="button"
            onClick={(event) => handleNavSelection(event, 'agent-management')}
          >
            <span className="nav-glyph">
              <NavIcon type="agent" />
            </span>
            <span className="nav-label">Agent Management</span>
          </button>
          <button
            className={
              activeView === 'reporting-insights' ? 'nav-link active' : 'nav-link'
            }
            type="button"
            onClick={(event) => handleNavSelection(event, 'reporting-insights')}
          >
            <span className="nav-glyph">
              <NavIcon type="reports" />
            </span>
            <span className="nav-label">Reporting & Insights</span>
          </button>
        </div>
      </nav>

      <main className="main-content">
        <header className="hero">
          <div>
            <p className="eyebrow">{heroCopy.eyebrow}</p>
            <h1>{heroCopy.title}</h1>
            <p>{heroCopy.description}</p>
          </div>
        </header>

        {error && <div className="error-message">{error}</div>}
        {emailSummaryStatus && (
          <div className="email-summary-status">{emailSummaryStatus}</div>
        )}

        {activeView === 'unified-dashboard' && (
          <>
          <section className="north-star-grid" aria-label="North star metrics">
            <article className="north-star-card">
              <span>Total Managed Spend</span>
              <strong>{formatCurrency(unifiedSummary.totalManagedSpend)}</strong>
              <small>Desktop licenses plus current cloud monthly burn</small>
            </article>
            <article className="north-star-card north-star-waste">
              <span>Combined Monthly Waste</span>
              <strong>{formatCurrency(unifiedSummary.combinedMonthlyWaste)}</strong>
              <small>Idle licenses, orphaned cloud assets, and over-provisioned instances</small>
            </article>
            <article className="north-star-card optimization-card">
              <span>Optimization Score</span>
              <div className="optimization-gauge">
                <strong>{unifiedSummary.optimizationScore}%</strong>
                <i style={{ width: `${unifiedSummary.optimizationScore}%` }} />
              </div>
              <small>Distance from a zero-waste operating model</small>
            </article>
          </section>

          <section className="panel compact-panel trends-panel">
            <div className="panel-header">
              <div>
                <h2>Cross-Domain Spend Trend</h2>
                <p>Six-month cost movement across desktop software, AI agents, and cloud infrastructure.</p>
              </div>
            </div>
            <div className="chart-frame unified-trend-frame">
              <ResponsiveContainer width="100%" height={330}>
                <AreaChart
                  data={unifiedSpendTrend}
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
                    tickFormatter={(value) => `$${formatNumber(value)}`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#7b8ba0', fontSize: 12 }}
                    width={58}
                  />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend content={<ChartLegend />} />
                  <Area
                    dataKey="desktopSoftware"
                    name="Desktop Software"
                    stackId="spend"
                    type="monotone"
                    stroke="#2980b9"
                    strokeWidth={2.2}
                    fill="url(#desktopSpendGradient)"
                  />
                  <Area
                    dataKey="aiAgents"
                    name="AI Agents"
                    stackId="spend"
                    type="monotone"
                    stroke="#8e44ad"
                    strokeWidth={2.2}
                    fill="url(#aiSpendGradient)"
                  />
                  <Area
                    dataKey="cloudInfrastructure"
                    name="Cloud Infrastructure"
                    stackId="spend"
                    type="monotone"
                    stroke="#27ae60"
                    strokeWidth={2.2}
                    fill="url(#cloudSpendGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="unified-grid">
            <article className="panel compact-panel">
              <div className="panel-header">
                <div>
                  <h2>Top 5 Savings Opportunities</h2>
                  <p>Ranked actions across software, AI tooling, and cloud resources.</p>
                </div>
              </div>
              <div className="savings-opportunity-list">
                {topSavingsOpportunities.map((opportunity, index) => (
                  <div className="savings-opportunity-item" key={opportunity.id}>
                    <span className="opportunity-rank">{index + 1}</span>
                    <div>
                      <strong>{opportunity.action}</strong>
                      <small>{opportunity.domain} - {opportunity.detail}</small>
                    </div>
                    <b>{formatCurrency(opportunity.impact)}/mo</b>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel compact-panel">
              <div className="panel-header">
                <div>
                  <h2>Utilization Heatmap</h2>
                  <p>Peak usage windows for license pooling and workload scheduling.</p>
                </div>
              </div>
              <div className="heatmap-wrap">
                <div className="heatmap-hours">
                  <span />
                  {utilizationHeatmapHours.map((hour) => (
                    <b key={hour}>{hour}:00</b>
                  ))}
                </div>
                {utilizationHeatmapRows.map((row) => (
                  <div className="heatmap-row" key={row.domain}>
                    <div className="heatmap-label">
                      <strong>{row.domain}</strong>
                      <small>{row.signal}</small>
                    </div>
                    {row.values.map((value, index) => (
                      <span
                        className="heatmap-cell"
                        key={`${row.domain}-${utilizationHeatmapHours[index]}`}
                        style={{ '--intensity': value / 100 }}
                        title={`${value}% utilization`}
                      >
                        {value}
                      </span>
                    ))}
                    <small className="heatmap-decision">{row.decision}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Departmental Cost Attribution</h2>
                <p>Team-level accountability across desktop, cloud, and AI tooling costs.</p>
              </div>
            </div>
            <div className="table-wrap attribution-table-wrap">
              <table className="department-cost-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Desktop Cost</th>
                    <th>Cloud Cost</th>
                    <th>AI Tooling Cost</th>
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
                      <td>{formatCurrency(team.cloudCost)}</td>
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

        {activeView === 'reporting-insights' && (
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
        )}

        {activeView === 'dashboard' && (
          <>
          <section className="summary-grid" aria-label="Executive summary">
            <article className="summary-card">
              <span>Total Monthly Software Spend</span>
              <strong>{formatCurrency(aggregates.totalMonthlySoftwareSpend)}</strong>
              <small>App license cost + AI license cost</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Identified Monthly Savings</span>
              <strong>{formatCurrency(aggregates.totalMonthlySavings)}</strong>
              <small>Reclaimable app cost + AI license cost</small>
            </article>
            <article className="summary-card">
              <span>Reclaimable Licenses</span>
              <strong>
                {aggregates.totalReclaimableLicenses}{' '}
                <small className="inline-strong-note">
                  from {aggregates.totalLicenses} total licenses
                </small>
              </strong>
              <small>
                {aggregates.reclaimableSeats} App Licenses +{' '}
                {aggregates.reclaimableAgentExtensions} AI Licenses
              </small>
            </article>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>App Licenses</h2>
                <p>
                  Reclaimable licenses are evaluated per app policy after the
                  minimum observation period. Idle grace periods are configured
                  inside each reclaim policy.
                </p>
                <div className="tracking-window-meta">
                  <span>
                    Evaluation window: {formatDateTime(evaluationWindow.startsAt)} to{' '}
                    {formatDateTime(evaluationWindow.endsAt)}
                  </span>
                  <span>{evaluationWindow.sampleCount} telemetry samples</span>
                </div>
              </div>
              <div className="panel-actions">
                {latestTelemetry?.timestamp && (
                  <span className="last-updated">
                    Updated {new Date(latestTelemetry.timestamp).toLocaleTimeString()}
                  </span>
                )}
                <button
                  className="dispatch-button"
                  type="button"
                  onClick={() => {
                    sendEmailSummary().catch((err) => {
                      setEmailSummaryStatus(`Email send failed: ${err.message}`);
                    });
                  }}
                >
                  Send Email Summary Now
                </button>
              </div>
            </div>

            <div className="extension-summary-grid" aria-label="App license summary">
              <div>
                <span>Overall monthly cost</span>
                <strong>{formatCurrency(aggregates.trackedMonthlyCost)}</strong>
              </div>
              <div>
                <span>Identified Monthly Savings</span>
                <strong>{formatCurrency(aggregates.totalSavings)}</strong>
              </div>
              <div>
                <span>App Licenses</span>
                <strong>{aggregates.totalSeats}</strong>
                <small>{aggregates.activeSeats} Actively Working</small>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <button type="button" onClick={() => requestSort('pcName')}>
                        PC Name{renderSortIndicator('pcName')}
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => requestSort('appName')}>
                        App Identity{renderSortIndicator('appName')}
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => requestSort('status')}>
                        Status{renderSortIndicator('status')}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        onClick={() => requestSort('totalRuntimeSeconds')}
                      >
                        Tracked Runtime{renderSortIndicator('totalRuntimeSeconds')}
                      </button>
                    </th>
                    <th>Utilization</th>
                    <th>
                      <button
                        type="button"
                        onClick={() => requestSort('monthlyCost')}
                      >
                        Cost Impact{renderSortIndicator('monthlyCost')}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        onClick={() => requestSort('savingsOpportunity')}
                      >
                        Savings Opportunity{renderSortIndicator('savingsOpportunity')}
                      </button>
                    </th>
                    <th>Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsageByApp.map((entry) => (
                    <tr key={entry.appName}>
                      <td>
                        <span className="pc-name-chip">{entry.pcName}</span>
                      </td>
                      <td>
                        <div className="app-identity">
                          <span className="app-icon">{entry.icon}</span>
                          <span className="app-name-stack">
                            <strong>{entry.displayName}</strong>
                            {entry.shouldShowRawName && <small>{entry.rawName}</small>}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${getStatusBadgeClass(entry.status)}`}
                          title={entry.reclaimReason}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td><RuntimeBreakdown entry={entry} /></td>
                      <td>{entry.utilizationPercent}%</td>
                      <td className="cost-impact-value">
                        -{formatCurrency(entry.monthlyCost)}
                      </td>
                      <td
                        className={
                          entry.savingsOpportunity > 0
                            ? 'savings-value'
                            : 'muted-value'
                        }
                      >
                        {entry.savingsOpportunity > 0
                          ? `+${formatCurrency(entry.savingsOpportunity)}`
                          : formatCurrency(0)}
                      </td>
                      <td>
                        <button
                          className="explore-button"
                          type="button"
                          onClick={() => handleExploreDashboardAgent(entry.pcName)}
                        >
                          <span className="action-symbol">›</span>
                          Explore
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sortedUsageByApp.length === 0 && (
                    <tr>
                      <td colSpan="8" className="empty-state">
                        Waiting for licensed app configuration.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>AI Licenses</h2>
                <p>Nested extension usage is counted only while the host application is focused.</p>
              </div>
            </div>

            <div className="extension-summary-grid" aria-label="AI extension summary">
              <div>
                <span>Overall monthly cost</span>
                <strong>{formatCurrency(aggregates.totalExtensionMonthlyCost)}</strong>
              </div>
              <div>
                <span>Identified Monthly Savings</span>
                <strong>{formatCurrency(aggregates.totalExtensionSavings)}</strong>
              </div>
              <div>
                <span>AI Agent Licenses</span>
                <strong>{aggregates.totalAgentExtensions}</strong>
                <small>{aggregates.activeExtensions} Actively Working</small>
              </div>
            </div>

            <div className="table-wrap attribution-table-wrap">
              <table className="attribution-table extension-attribution-table">
                <thead>
                  <tr>
                    <th>PC Name</th>
                    <th>Extension Identity</th>
                    <th>Status</th>
                    <th>Tracked Runtime</th>
                    <th>Utilization</th>
                    <th>Cost Impact</th>
                    <th>Savings Opportunity</th>
                    <th>Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {extensionAttributionRows.map((extension) => (
                    <tr key={extension.rowId}>
                      <td>
                        <span className="pc-list">
                          {extension.detectedPcNames.length > 0
                            ? extension.detectedPcNames.join(', ')
                            : currentPcName}
                        </span>
                      </td>
                      <td>
                        <div className="app-identity">
                          <span className="app-icon extension-icon">
                            {extension.icon}
                          </span>
                          <span className="app-name-stack">
                            <strong>{extension.name}</strong>
                            <small>{extension.subscriptionType}</small>
                            <small>{extension.parentApps.join(', ')}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${getStatusBadgeClass(extension.status)}`}
                          title={extension.reclaimReason}
                        >
                          {extension.status}
                        </span>
                      </td>
                      <td><RuntimeBreakdown entry={extension} /></td>
                      <td>{extension.utilizationPercent}%</td>
                      <td className="cost-impact-value">
                        -{formatCurrency(extension.monthlyCost)}
                      </td>
                      <td
                        className={
                          extension.status === 'Reclaimable'
                            ? 'savings-value'
                            : 'muted-value'
                        }
                      >
                        {extension.status === 'Reclaimable'
                          ? `+${formatCurrency(extension.monthlyCost)}`
                          : formatCurrency(0)}
                      </td>
                      <td>
                        <button
                          className="explore-button"
                          type="button"
                          onClick={() =>
                            handleExploreDashboardAgent(
                              extension.detectedPcNames[0] || currentPcName
                            )
                          }
                        >
                          <span className="action-symbol">â€º</span>
                          Explore
                        </button>
                      </td>
                    </tr>
                  ))}
                  {extensionAttributionRows.length === 0 && (
                    <tr>
                      <td colSpan="8" className="empty-state">
                        Waiting for extension attribution rules from the agent.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

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
                    <h3>Core App Engagement (24h Velocity)</h3>
                    <p>Active minutes by hour for key engineering and design apps.</p>
                  </div>
                </div>
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={engagementVelocity}
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
                      <Line
                        dataKey="adobeCc"
                        name="Adobe CC"
                        type="monotone"
                        stroke="#e74c3c"
                        strokeWidth={2.4}
                        dot={<PeakUsageDot />}
                        activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                      />
                      <Line
                        dataKey="jetBrains"
                        name="JetBrains"
                        type="monotone"
                        stroke="#8e44ad"
                        strokeWidth={2.4}
                        dot={<PeakUsageDot />}
                        activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                      />
                      <Line
                        dataKey="vsCode"
                        name="VS Code"
                        type="monotone"
                        stroke="#2980b9"
                        strokeWidth={2.4}
                        dot={<PeakUsageDot />}
                        activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>
          </section>
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
              <span>Live Agents</span>
              <strong>{fleetSummary.liveAgents}</strong>
              <small>{fleetSummary.totalDevices} devices registered</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Offline Agents</span>
              <strong>{fleetSummary.offlineAgents}</strong>
              <small>Devices needing redeploy or investigation</small>
            </article>
            <article className="summary-card">
              <span>Total License Cost</span>
              <strong>{formatCurrency(fleetSummary.totalLicenseCost)}</strong>
              <small>{fleetSummary.activeLicenses} expensive licenses detected</small>
            </article>
            <article className="summary-card summary-card-success">
              <span>Onboarded Apps</span>
              <strong>{onboardedLicenseSummary.count}</strong>
              <small>
                {formatCurrency(onboardedLicenseSummary.monthlyCost)} monthly policy scope
              </small>
            </article>
            <article className="summary-card">
              <span>Registered Policies</span>
              <strong>{registeredPolicySummary.count}</strong>
              <small>
                Fastest reclaim decision in {formatRuntime(
                  registeredPolicySummary.fastestDecisionHours * 60 * 60
                )}
              </small>
            </article>
          </section>

          <section className="panel deploy-panel">
            <div className="panel-header">
              <div>
                <h2>Deploy Agent to New PC</h2>
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
                <span>Assigned User</span>
                <input
                  name="user"
                  placeholder="User name"
                  type="text"
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
                    Deploy Agent
                  </>
                )}
              </button>
            </form>
            {lastDeploymentConfig && (
              <div className="agent-config-preview">
                <div className="agent-config-preview-header">
                  <div>
                    <h3>Queued Agent Config</h3>
                    <p>
                      {lastDeploymentConfig.target_pc} receives{' '}
                      {lastDeploymentConfig.licensed_apps.length} licensed app
                      {lastDeploymentConfig.licensed_apps.length === 1
                        ? ''
                        : 's'}.
                    </p>
                  </div>
                  <span>{lastDeploymentConfig.assigned_user}</span>
                </div>
                <pre>
                  {JSON.stringify(lastDeploymentConfig, null, 2)}
                </pre>
              </div>
            )}
          </section>

          <section className="panel license-onboarding-panel">
            <div className="panel-header">
              <div>
                <h2>Onboard App License</h2>
                <p>Select an inventory app and attach the reclaim policy that will be sent with the agent config.</p>
              </div>
              {licenseOnboardingStatus && (
                <span className="deployment-status">{licenseOnboardingStatus}</span>
              )}
            </div>
            <form
              className="deploy-form app-license-onboarding-form"
              onSubmit={handleOnboardAppLicense}
            >
              <label>
                <span>App Name</span>
                <select
                  name="appId"
                  value={onboardAppLicenseForm.appId}
                  onChange={handleOnboardAppLicenseInputChange}
                >
                  <option value="">Select inventory app</option>
                  {licensedApps
                    .filter((app) => app.appType !== 'Web URL')
                    .map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.appName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Policy</span>
                <select
                  name="policyName"
                  value={onboardAppLicenseForm.policyName}
                  onChange={handleOnboardAppLicenseInputChange}
                >
                  {licensePolicies.map((policy) => (
                    <option key={policy.name}>{policy.name}</option>
                  ))}
                </select>
              </label>
              <button className="deploy-agent-button" type="submit">
                <span className="action-symbol">+</span>
                {editingOnboardedLicenseId ? 'Save License' : 'Onboard License'}
              </button>
            </form>

            {onboardedAppLicenses.length > 0 && (
              <div className="table-wrap onboarded-license-list">
                <table>
                  <thead>
                    <tr>
                      <th>Licensed App</th>
                      <th>Type</th>
                      <th>Monthly Cost</th>
                      <th>Attached Policy</th>
                      <th>Threshold</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onboardedAppLicenses.map((app) => (
                      <tr key={app.id}>
                        <td>
                          <div className="device-identity">
                            <strong>{app.appName}</strong>
                            <span>{app.processName}</span>
                          </div>
                        </td>
                        <td>{app.appType}</td>
                        <td>{formatCurrency(app.monthlyCost)}</td>
                        <td>{app.policy.name}</td>
                        <td>
                          {formatPolicyWindowValue(
                            app.policy.workedThresholdHours,
                            app.policy
                          )}{' '}
                          in{' '}
                          {formatEvaluationWindow(app.policy)}
                        </td>
                        <td>
                          <div className="policy-actions">
                            <button
                              aria-label={`Edit ${app.appName} license`}
                              className="policy-icon-button policy-icon-button-edit"
                              title="Edit license"
                              type="button"
                              onClick={() => handleEditOnboardedLicense(app)}
                            >
                              <span aria-hidden="true">✎</span>
                            </button>
                            <button
                              aria-label={`Remove ${app.appName} license`}
                              className="policy-icon-button policy-icon-button-remove"
                              title="Remove license"
                              type="button"
                              onClick={() => handleRemoveOnboardedLicense(app.id)}
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

          <section className="panel license-onboarding-panel">
            <div className="panel-header">
              <div>
                <h2>Enterprise Apps Inventory</h2>
                <p>Add applications and AI extensions to the inventory catalog used by license onboarding.</p>
              </div>
            </div>
            <form
              className="deploy-form license-onboarding-form"
              onSubmit={handleAddEnterpriseInventoryItem}
            >
              <label>
                <span>Type</span>
                <select
                  name="appType"
                  value={licenseAppForm.appType}
                  onChange={handleLicenseAppInputChange}
                >
                  <option>Application</option>
                  <option>Extension</option>
                  <option>Web URL</option>
                </select>
              </label>
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
                  <label>
                    <span>App Name</span>
                    <input
                      name="appName"
                      placeholder="GitHub Copilot"
                      type="text"
                      value={licenseAppForm.appName}
                      onChange={handleLicenseAppInputChange}
                    />
                  </label>
                  <label>
                    <span>Process Name</span>
                    <input
                      name="processName"
                      placeholder="code.exe"
                      type="text"
                      value={licenseAppForm.processName}
                      onChange={handleLicenseAppInputChange}
                    />
                  </label>
                </>
              )}
              <label>
                <span>Monthly Cost</span>
                <input
                  min="0"
                  name="monthlyCost"
                  placeholder="15"
                  step="0.01"
                  type="number"
                  value={licenseAppForm.monthlyCost}
                  onChange={handleLicenseAppInputChange}
                />
              </label>
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
                    <span>Parent App</span>
                    <select
                      name="parentApp"
                      value={licenseAppForm.parentApp}
                      onChange={handleLicenseAppInputChange}
                    >
                      <option value="">Select parent app</option>
                      {enterpriseParentAppOptions.map((appName) => (
                        <option key={appName}>{appName}</option>
                      ))}
                    </select>
                  </label>
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
              <button className="deploy-agent-button" type="submit">
                <span className="action-symbol">+</span>
                {editingInventoryAppId ? 'Save Inventory' : 'Add Inventory'}
              </button>
            </form>

            {licensedApps.length > 0 && (
              <div className="table-wrap onboarded-license-list">
                <table>
                  <thead>
                    <tr>
                      <th>Inventory Item</th>
                      <th>Process</th>
                      <th>Owner</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Parent App</th>
                      <th>Monthly Cost</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {licensedApps.map((app) => (
                      <tr key={app.id}>
                        <td>
                          <div className="device-identity">
                            <strong>{app.appName}</strong>
                            <span>{app.appType}</span>
                          </div>
                        </td>
                        <td>{app.appType === 'Web URL' ? app.url : app.processName}</td>
                        <td>{app.owner}</td>
                        <td>{app.ownerEmail}</td>
                        <td>{app.appType}</td>
                        <td>{app.appType === 'Extension' ? app.parentApp : '-'}</td>
                        <td>{formatCurrency(app.monthlyCost)}</td>
                        <td>
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

          <section className="panel policy-registration-panel">
            <div className="panel-header">
              <div>
                <h2>Register Policy</h2>
                <p>Create reusable reclaim policies for agent deployment and licensed app onboarding.</p>
              </div>
              {policyRegistrationStatus && (
                <span className="deployment-status">{policyRegistrationStatus}</span>
              )}
            </div>
            <form
              className="deploy-form policy-registration-form"
              onSubmit={handleRegisterPolicy}
            >
              <label>
                <span>Policy Name</span>
                <input
                  name="name"
                  placeholder="Executive apps"
                  type="text"
                  value={policyRegistrationForm.name}
                  onChange={handlePolicyRegistrationInputChange}
                />
              </label>
              <label>
                <span>Evaluation Window</span>
                <input
                  min="0.1"
                  name="evaluationWindowValue"
                  step="0.1"
                  type="number"
                  value={policyRegistrationForm.evaluationWindowValue}
                  onChange={handlePolicyRegistrationInputChange}
                />
              </label>
              <label>
                <span>Active Threshold</span>
                <input
                  min="0.1"
                  name="workedThresholdHours"
                  step="0.1"
                  type="number"
                  value={policyRegistrationForm.workedThresholdHours}
                  onChange={handlePolicyRegistrationInputChange}
                />
              </label>
              <label>
                <span>Observation Window</span>
                <input
                  min="0.1"
                  name="minimumObservationDays"
                  step="0.1"
                  type="number"
                  value={policyRegistrationForm.minimumObservationDays}
                  onChange={handlePolicyRegistrationInputChange}
                />
              </label>
              <label>
                <span>Window Unit</span>
                <select
                  name="evaluationWindowUnit"
                  value={policyRegistrationForm.evaluationWindowUnit}
                  onChange={handlePolicyRegistrationInputChange}
                >
                  <option>Days</option>
                  <option>Hours</option>
                  <option>Minutes</option>
                </select>
              </label>
              <button className="deploy-agent-button" type="submit">
                <span className="action-symbol">+</span>
                {editingPolicyName ? 'Save Policy' : 'Register Policy'}
              </button>
            </form>

            <div className="table-wrap policy-list">
              <table>
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Evaluation Window</th>
                    <th>Active Use Threshold</th>
                    <th>Minimum Observation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {licensePolicies.map((policy) => (
                    <tr key={policy.name}>
                      <td>
                        <div className="device-identity">
                          <strong>{policy.name}</strong>
                          <span>Reusable reclaim policy</span>
                        </div>
                      </td>
                      <td>{formatEvaluationWindow(policy)}</td>
                      <td>
                        {formatPolicyWindowValue(policy.workedThresholdHours, policy)}
                      </td>
                      <td>
                        {formatPolicyWindowValue(
                          policy.minimumObservationDays || 7,
                          policy
                        )}
                      </td>
                      <td>
                        <div className="policy-actions">
                          <button
                            aria-label={`Edit ${policy.name} policy`}
                            className="policy-icon-button policy-icon-button-edit"
                            title="Edit policy"
                            type="button"
                            onClick={() => handleEditPolicy(policy)}
                          >
                            <span aria-hidden="true">✎</span>
                          </button>
                          <button
                            aria-label={`Remove ${policy.name} policy`}
                            className="policy-icon-button policy-icon-button-remove"
                            title="Remove policy"
                            type="button"
                            onClick={() => handleRemovePolicy(policy.name)}
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
                    <th>Agent Status</th>
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

        {activeView === 'agent-management' && showAgentDetails && selectedDevice && (
            <section className="panel detail-panel">
              <div className="panel-header">
                <div>
                  <h2>{selectedDevice.pcName} Agent Details</h2>
                  <p>
                    Live agent runtime, tracked software, policy, and telemetry
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
                  <span>Agent Runtime</span>
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
                    {selectedDevice.id === 'laptop-dx01'
                      ? `${telemetryHistory.length} telemetry samples stored`
                      : 'Mock deployment profile'}
                  </small>
                </article>
              </div>

              {selectedDeviceEngagementData.length > 0 && (
                <div className="agent-engagement-section">
                  <article className="chart-card">
                    <div className="chart-card-header">
                      <div>
                        <h3>Core App Engagement (24h Velocity)</h3>
                        <p>Active minutes by hour for this agent's highest-cost tracked apps.</p>
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
                        Waiting for tracked software telemetry from this agent.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3>Agent Tracking Information</h3>
                  <div className="tracking-feed">
                    <div>
                      <span>Machine user</span>
                      <strong>{selectedDevice.user}</strong>
                    </div>
                    <div>
                      <span>Agent status</span>
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

              {selectedDevice.id === 'laptop-dx01' && usageByExtension.length > 0 && (
                <div className="detail-extension-section">
                  <h3>AI Licenses</h3>
                  <div className="tracked-app-list">
                    {usageByExtension.map((extension) => (
                      <div className="tracked-app-item" key={extension.name}>
                        <span className="app-icon extension-icon">{extension.icon}</span>
                        <div>
                          <strong>{extension.name}</strong>
                          <div className="tracked-app-details">
                            <small>parent apps: {extension.parentApps.join(', ')}</small>
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
            </section>
        )}
      </main>
    </div>
  );
}
