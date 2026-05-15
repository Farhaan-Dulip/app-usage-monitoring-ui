import { useEffect, useMemo, useState } from 'react';
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

function formatRuntime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
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

function getMonthlyCost(appName, index) {
  const normalizedName = appName.toLowerCase();
  const matchingKey = Object.keys(pricingMap).find((key) =>
    normalizedName.includes(key.toLowerCase())
  );

  if (matchingKey) {
    return pricingMap[matchingKey];
  }

  return fallbackCosts[index % fallbackCosts.length];
}

function getExtensionMonthlyCost(extensionName, index) {
  const normalizedName = extensionName.toLowerCase();
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

function getDiscoveredAppMonthlyCost(appName, index) {
  const normalizedName = appName.toLowerCase();
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
      identifiers: [],
      matchAll: [],
    };

    if (extension.parent_app && !existing.parentApps.includes(extension.parent_app)) {
      existing.parentApps.push(extension.parent_app);
    }

    if (extension.ai_model && !existing.aiModels.includes(extension.ai_model)) {
      existing.aiModels.push(extension.ai_model);
    }

    if (extension.ai_model) {
      const licenseType =
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
    .map(([appName, totalRuntimeSeconds]) => ({
      name: appName.slice(usagePrefix.length),
      totalRuntimeSeconds,
    }))
    .sort((firstModel, secondModel) =>
      secondModel.totalRuntimeSeconds - firstModel.totalRuntimeSeconds
    );
}

function getDetectedPcNamesForUsage(history, appName) {
  const detectedPcNames = new Set();

  history.forEach((payload) => {
    const hasUsage = (payload.usage || []).some(
      (entry) => entry.app_name === appName && entry.total_runtime_seconds > 0
    );

    if (hasUsage) {
      detectedPcNames.add(getTelemetryPcName(payload));
    }
  });

  return Array.from(detectedPcNames).sort();
}

function getModelLicenseBreakdown(extension) {
  const activeModelNames = extension.modelUsage
    .filter((model) => model.totalRuntimeSeconds > 0)
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

export default function App() {
  const [activeView, setActiveView] = useState('unified-dashboard');
  const [config, setConfig] = useState(null);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [error, setError] = useState('');
  const [dispatchingDeviceId, setDispatchingDeviceId] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState('');
  const [isDeployingAgent, setIsDeployingAgent] = useState(false);
  const [deployTarget, setDeployTarget] = useState('');
  const [deployForm, setDeployForm] = useState({
    pcName: '',
    user: '',
    policy: 'Finance baseline',
  });
  const [selectedDeviceId, setSelectedDeviceId] = useState('laptop-dx01');
  const [showAgentDetails, setShowAgentDetails] = useState(false);
  const [isNavCollapsedAfterSelect, setIsNavCollapsedAfterSelect] = useState(false);
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
  }[activeView];

  const accumulatedUsage = useMemo(() => {
    const usageMap = new Map();
    telemetryHistory.forEach((payload) => {
      (payload.usage || []).forEach((entry) => {
        const existing = usageMap.get(entry.app_name) || 0;
        usageMap.set(entry.app_name, existing + entry.total_runtime_seconds);
      });
    });
    return usageMap;
  }, [telemetryHistory]);

  const currentPcName = useMemo(
    () => getTelemetryPcName(latestTelemetry),
    [latestTelemetry]
  );

  const usageByApp = useMemo(() => {
    if (!config) return [];

    return config.licensed_apps.map((appName, index) => {
      const appIdentity = getReadableAppIdentity(appName);
      const totalRuntimeSeconds = accumulatedUsage.get(appName) || 0;
      const monthlyCost = getMonthlyCost(appName, index);
      const isReclaimable = totalRuntimeSeconds < RECLAIMABLE_THRESHOLD_SECONDS;

      return {
        appName,
        ...appIdentity,
        pcName: currentPcName,
        icon: getAppIcon(appIdentity.displayName),
        status: isReclaimable ? 'Reclaimable' : 'Active',
        totalRuntimeSeconds,
        monthlyCost,
        savingsOpportunity: isReclaimable ? monthlyCost : 0,
      };
    });
  }, [config, accumulatedUsage, currentPcName]);

  const usageByUrl = useMemo(() => {
    if (!config?.tracked_urls) return [];

    return config.tracked_urls.map((url) => ({
      url,
      total_runtime_seconds: accumulatedUsage.get(`url:${url}`) || 0,
    }));
  }, [config, accumulatedUsage]);

  const usageByExtension = useMemo(() => {
    if (!config?.extensions) return [];

    return getUniqueExtensionRules(config.extensions).map((extension, index) => {
      const totalRuntimeSeconds = accumulatedUsage.get(extension.name) || 0;
      const unitMonthlyCost = getExtensionMonthlyCost(extension.name, index);
      const detectedPcNames = getDetectedPcNamesForUsage(
        telemetryHistory,
        extension.name
      );
      const detectedSeatCount =
        detectedPcNames.length > 0 || totalRuntimeSeconds === 0
          ? detectedPcNames.length
          : 1;
      const modelUsage = getModelUsageForExtension(accumulatedUsage, extension.name);
      const activeModelNames = modelUsage
        .filter((model) => model.totalRuntimeSeconds > 0)
        .map((model) => model.name);
      const modelLicenseBreakdown = getModelLicenseBreakdown({
        ...extension,
        modelUsage,
        aiModels: extension.aiModels,
      });

      return {
        ...extension,
        icon: getAppIcon(extension.name),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * detectedSeatCount,
        detectedPcNames,
        detectedSeatCount,
        activeModelNames,
        modelUsage,
        modelLicenseBreakdown,
        status: totalRuntimeSeconds > 0 ? 'Detected' : 'Watching',
        totalRuntimeSeconds,
      };
    });
  }, [config, accumulatedUsage, telemetryHistory]);

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
      const totalRuntimeSeconds = accumulatedUsage.get(appName) || 0;
      const unitMonthlyCost = getMonthlyCost(appName, index);
      const detectedPcNames = getDetectedPcNamesForUsage(telemetryHistory, appName);
      const detectedSeatCount = detectedPcNames.length;

      appMap.set(appName, {
        appName,
        ...appIdentity,
        category: 'Licensed app',
        icon: getAppIcon(appIdentity.displayName),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * detectedSeatCount,
        detectedPcNames,
        detectedSeatCount,
        totalRuntimeSeconds,
      });
    });

    Array.from(accumulatedUsage.entries()).forEach(([appName, totalRuntimeSeconds], index) => {
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

      appMap.set(appName, {
        appName,
        ...appIdentity,
        category: 'Discovered app',
        icon: getAppIcon(appIdentity.displayName),
        unitMonthlyCost,
        monthlyCost: unitMonthlyCost * detectedSeatCount,
        detectedPcNames,
        detectedSeatCount,
        totalRuntimeSeconds,
      });
    });

    return Array.from(appMap.values())
      .sort(
        (firstApp, secondApp) =>
          secondApp.monthlyCost - firstApp.monthlyCost ||
          secondApp.totalRuntimeSeconds - firstApp.totalRuntimeSeconds ||
          firstApp.displayName.localeCompare(secondApp.displayName)
      );
  }, [config, accumulatedUsage, telemetryHistory]);

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
      (entry) => entry.totalRuntimeSeconds > 0
    ).length;
    const totalExtensionRuntimeSeconds = usageByExtension.reduce(
      (sum, entry) => sum + entry.totalRuntimeSeconds,
      0
    );
    const totalExtensionMonthlyCost = usageByExtension.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );
    const modelRuntimeMap = new Map();
    const configuredModelCounts = new Map();

    usageByExtension.forEach((extension) => {
      extension.modelUsage.forEach((model) => {
        modelRuntimeMap.set(
          model.name,
          (modelRuntimeMap.get(model.name) || 0) + model.totalRuntimeSeconds
        );
      });

      extension.aiModels.forEach((modelName) => {
        configuredModelCounts.set(
          modelName,
          (configuredModelCounts.get(modelName) || 0) + 1
        );
      });
    });

    const topRuntimeModel = Array.from(modelRuntimeMap.entries()).sort(
      (firstModel, secondModel) => secondModel[1] - firstModel[1]
    )[0];
    const topConfiguredModel = Array.from(configuredModelCounts.entries()).sort(
      (firstModel, secondModel) => secondModel[1] - firstModel[1]
    )[0];
    const primarySelectedModel =
      topRuntimeModel?.[0] || topConfiguredModel?.[0] || 'Unknown';
    const licenseEfficiencyScore =
      totalSeats > 0 ? Math.round((activeSeats / totalSeats) * 100) : 0;

    return {
      totalWaste,
      totalSavings: totalWaste,
      activeCost,
      trackedMonthlyCost,
      activeSeats,
      totalSeats,
      activeExtensions,
      totalExtensions: usageByExtension.length,
      totalExtensionRuntimeSeconds,
      totalExtensionMonthlyCost,
      primarySelectedModel,
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
              subscriptionType: 'Subscription not reported',
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

      if (typeof firstValue === 'string') {
        return sortConfig.direction === 'asc'
          ? firstValue.localeCompare(secondValue)
          : secondValue.localeCompare(firstValue);
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
    const activeExpensiveLicenses = activeExpensiveApps.length;
    const activeExpensiveLicenseCost = activeExpensiveApps.reduce(
      (sum, entry) => sum + entry.monthlyCost,
      0
    );

    return mockFleetDevices.map((device, index) => ({
      ...device,
      activeLicenseCount:
        index === 0 ? activeExpensiveLicenses : device.activeLicenseCount,
      totalLicenseCost:
        index === 0 ? activeExpensiveLicenseCost : device.totalLicenseCost,
      trackedApps:
        index === 0
          ? usageByApp.filter((entry) => entry.monthlyCost > 0).map((entry) => entry.appName)
          : device.trackedApps,
    }));
  }, [usageByApp]);

  const selectedDevice = useMemo(
    () =>
      fleetDevices.find((device) => device.id === selectedDeviceId) ||
      fleetDevices[0],
    [fleetDevices, selectedDeviceId]
  );

  const selectedDeviceApps = useMemo(() => {
    if (!selectedDevice) return [];

    if (selectedDevice.id === 'laptop-dx01') {
      return usageByApp.filter((entry) => entry.monthlyCost > 0);
    }

    return selectedDevice.trackedApps.map((appName, index) => {
      const appIdentity = getReadableAppIdentity(appName);
      const monthlyCost = getMonthlyCost(appName, index);
      const totalRuntimeSeconds = selectedDevice.isLive
        ? (index + 1) * 1880
        : index * 420;

      return {
        appName,
        ...appIdentity,
        icon: getAppIcon(appIdentity.displayName),
        status:
          selectedDevice.isLive && totalRuntimeSeconds >= RECLAIMABLE_THRESHOLD_SECONDS
            ? 'Active'
            : 'Reclaimable',
        totalRuntimeSeconds,
        monthlyCost,
      };
    });
  }, [selectedDevice, usageByApp]);

  const selectedDeviceLastHeartbeat = useMemo(() => {
    if (!selectedDevice?.isLive) return 'No heartbeat in the last 24h';
    if (selectedDevice.id === 'laptop-dx01' && latestTelemetry?.timestamp) {
      return new Date(latestTelemetry.timestamp).toLocaleString();
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

  const handleDeployAgent = (event) => {
    event.preventDefault();

    const normalizedPcName = deployForm.pcName.trim().toUpperCase();
    if (!normalizedPcName) {
      setDeployTarget('Enter a PC name to prepare deployment.');
      return;
    }

    setIsDeployingAgent(true);
    setDeployTarget(`Preparing deployment for ${normalizedPcName}`);

    window.setTimeout(() => {
      setIsDeployingAgent(false);
      setDeployTarget(`Deployment package queued for ${normalizedPcName}`);
      setDeployForm((currentForm) => ({
        ...currentForm,
        pcName: '',
        user: '',
      }));
    }, 1600);
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
        setLatestTelemetry(data);
        setError('');

        setTelemetryHistory((currentHistory) => {
          if (!data || !data.timestamp) {
            return currentHistory;
          }

          const alreadyStored = currentHistory.some(
            (entry) => entry.timestamp === data.timestamp
          );
          if (alreadyStored) {
            return currentHistory;
          }

          return [...currentHistory, data];
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
              activeView === 'cloud-asset-management'
                ? 'nav-link active'
                : 'nav-link'
            }
            type="button"
            onClick={(event) =>
              handleNavSelection(event, 'cloud-asset-management')
            }
          >
            <span className="nav-glyph">
              <NavIcon type="cloud" />
            </span>
            <span className="nav-label">Cloud Asset Management</span>
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

        {activeView === 'dashboard' && (
          <>
          <section className="summary-grid" aria-label="Executive summary">
            <article className="summary-card">
              <span>Total Monthly Software Spend</span>
              <strong>{formatCurrency(TOTAL_MONTHLY_SOFTWARE_SPEND)}</strong>
              <small>Mock licensed portfolio total</small>
            </article>
            <article className="summary-card summary-card-alert">
              <span>Identified Monthly Savings</span>
              <strong>{formatCurrency(aggregates.totalSavings)}</strong>
              <small>{formatCurrency(aggregates.totalWaste)} waste detected</small>
            </article>
            <article className="summary-card">
              <span>License Efficiency Score</span>
              <strong>{aggregates.licenseEfficiencyScore}%</strong>
              <small>
                {aggregates.activeSeats} active of {aggregates.totalSeats} licensed
                seats
              </small>
            </article>
            <article className="summary-card">
              <span>AI Extensions Detected</span>
              <strong>
                {aggregates.activeExtensions}/{aggregates.totalExtensions}
              </strong>
              <small>Nested extension counters bound to focused parent apps</small>
            </article>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Main Utilization Table</h2>
                <p>
                  Reclaimable licenses are seats with less than 1 hour of tracked
                  active runtime.
                </p>
              </div>
              {latestTelemetry?.timestamp && (
                <span className="last-updated">
                  Updated {new Date(latestTelemetry.timestamp).toLocaleTimeString()}
                </span>
              )}
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
                        Active Runtime{renderSortIndicator('totalRuntimeSeconds')}
                      </button>
                    </th>
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
                          className={`status-badge ${
                            entry.status === 'Active'
                              ? 'status-active'
                              : 'status-reclaimable'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td>{formatRuntime(entry.totalRuntimeSeconds)}</td>
                      <td>{formatCurrency(entry.monthlyCost)}</td>
                      <td
                        className={
                          entry.savingsOpportunity > 0
                            ? 'savings-value'
                            : 'muted-value'
                        }
                      >
                        {entry.savingsOpportunity > 0
                          ? `-${formatCurrency(entry.savingsOpportunity)}`
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
                      <td colSpan="7" className="empty-state">
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
                <h2>AI & Extension Attribution</h2>
                <p>Nested extension usage is counted only while the host application is focused.</p>
              </div>
            </div>

            <div className="extension-summary-grid" aria-label="AI extension summary">
              <div>
                <span>Overall monthly cost</span>
                <strong>{formatCurrency(aggregates.totalExtensionMonthlyCost)}</strong>
              </div>
              <div>
                <span>Total runtime</span>
                <strong>{formatRuntime(aggregates.totalExtensionRuntimeSeconds)}</strong>
              </div>
              <div>
                <span>Mostly selected model</span>
                <strong>{aggregates.primarySelectedModel}</strong>
              </div>
            </div>

            <div className="table-wrap attribution-table-wrap">
              <table className="attribution-table extension-attribution-table">
                <thead>
                  <tr>
                    <th>Extension Identity</th>
                    <th>Subscription Type</th>
                    <th>Status</th>
                    <th>Total Runtime</th>
                    <th>Fleet Monthly Cost</th>
                    <th>Unit Monthly Cost</th>
                    <th>Discovered PCs</th>
                    <th>Selected Model</th>
                  </tr>
                </thead>
                <tbody>
                  {extensionAttributionRows.map((extension) => (
                    <tr key={extension.rowId}>
                      <td>
                        <div className="app-identity">
                          <span className="app-icon extension-icon">
                            {extension.icon}
                          </span>
                          <span className="app-name-stack">
                            <strong>{extension.name}</strong>
                            <small>{extension.parentApps.join(', ')}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="pc-list">
                          {extension.subscriptionType}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            extension.status === 'Detected'
                              ? 'status-active'
                              : 'status-neutral'
                          }`}
                        >
                          {extension.status}
                        </span>
                      </td>
                      <td>{formatRuntime(extension.totalRuntimeSeconds)}</td>
                      <td>{formatCurrency(extension.monthlyCost)}</td>
                      <td>{formatCurrency(extension.unitMonthlyCost)} / PC</td>
                      <td>
                        <span className="pc-list">
                          {extension.detectedSeatCount > 0
                            ? `${extension.detectedSeatCount} PC${
                                extension.detectedSeatCount === 1 ? '' : 's'
                              } (${extension.detectedPcNames.join(', ')})`
                            : 'none yet'}
                        </span>
                      </td>
                      <td>
                        <span className="pc-list">
                          {extension.modelName}
                        </span>
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

          <section className="panel compact-panel">
            <div className="panel-header">
              <div>
                <h2>Application Attribution</h2>
                <p>All app identities from licensed configuration plus additional apps discovered in telemetry.</p>
              </div>
            </div>

            <div className="table-wrap attribution-table-wrap">
              <table className="attribution-table">
                <thead>
                  <tr>
                    <th>App Identity</th>
                    <th>Type</th>
                    <th>Total Runtime</th>
                    <th>Fleet Monthly Cost</th>
                    <th>Unit Monthly Cost</th>
                    <th>Discovered PCs</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredApplications.map((app) => (
                    <tr key={app.appName}>
                      <td>
                        <div className="app-identity">
                          <span className="app-icon">{app.icon}</span>
                          <span className="app-name-stack">
                            <strong>{app.displayName}</strong>
                            {app.shouldShowRawName && <small>{app.rawName}</small>}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            app.totalRuntimeSeconds > 0
                              ? 'status-active'
                              : 'status-neutral'
                          }`}
                        >
                          {app.totalRuntimeSeconds > 0 ? app.category : 'Watching'}
                        </span>
                      </td>
                      <td>{formatRuntime(app.totalRuntimeSeconds)}</td>
                      <td>{formatCurrency(app.monthlyCost)}</td>
                      <td>{formatCurrency(app.unitMonthlyCost)} / PC</td>
                      <td>
                        <span className="pc-list">
                          {app.detectedSeatCount} PC
                          {app.detectedSeatCount === 1 ? '' : 's'}
                          {app.detectedPcNames.length > 0
                            ? ` (${app.detectedPcNames.join(', ')})`
                            : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {discoveredApplications.length === 0 && (
                    <tr>
                      <td colSpan="6" className="empty-state">
                        Waiting for licensed app configuration or application telemetry.
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
            <form className="deploy-form" onSubmit={handleDeployAgent}>
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
              <label>
                <span>Policy</span>
                <select
                  name="policy"
                  value={deployForm.policy}
                  onChange={handleDeployInputChange}
                >
                  <option>Finance baseline</option>
                  <option>Design suite</option>
                  <option>Engineering tools</option>
                </select>
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
                  <span>Last Heartbeat</span>
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

              <div className="detail-content">
                <div>
                  <h3>Tracked Software Applications</h3>
                  <div className="tracked-app-list">
                    {selectedDeviceApps.map((entry) => (
                      <div className="tracked-app-item" key={entry.appName}>
                        <span className="app-icon">{entry.icon}</span>
                        <div>
                          <strong>{entry.displayName}</strong>
                          <small>
                            {entry.shouldShowRawName && `${entry.rawName} - `}
                            {formatRuntime(entry.totalRuntimeSeconds)} tracked,
                            {` ${formatCurrency(entry.monthlyCost)}`} monthly cost
                          </small>
                        </div>
                        <span
                          className={`status-badge ${
                            entry.status === 'Active'
                              ? 'status-active'
                              : 'status-reclaimable'
                          }`}
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
                  <h3>Live Tracking Information</h3>
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
                      <span>Active expensive licenses</span>
                      <strong>{selectedDevice.activeLicenseCount}</strong>
                    </div>
                    <div>
                      <span>Total license cost</span>
                      <strong>{formatCurrency(selectedDevice.totalLicenseCost)}</strong>
                    </div>
                    {selectedDevice.id === 'laptop-dx01' && usageByUrl.length > 0 && (
                      <div>
                        <span>Tracked URLs</span>
                        <strong>{usageByUrl.length}</strong>
                      </div>
                    )}
                    {selectedDevice.id === 'laptop-dx01' && usageByExtension.length > 0 && (
                      <div>
                        <span>AI extensions detected</span>
                        <strong>
                          {aggregates.activeExtensions}/{aggregates.totalExtensions}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedDevice.id === 'laptop-dx01' && usageByExtension.length > 0 && (
                <div className="detail-extension-section">
                  <h3>Nested AI Extension Attribution</h3>
                  <div className="tracked-app-list">
                    {usageByExtension.map((extension) => (
                      <div className="tracked-app-item" key={extension.name}>
                        <span className="app-icon extension-icon">{extension.icon}</span>
                        <div>
                          <strong>{extension.name}</strong>
                          <small>
                            {formatRuntime(extension.totalRuntimeSeconds)} tracked under{' '}
                            {extension.parentApps.join(', ')} -{' '}
                            {formatCurrency(extension.unitMonthlyCost)} monthly cost - selected model{' '}
                            {extension.activeModelNames.length > 0
                              ? extension.activeModelNames.join(', ')
                              : extension.aiModels.length > 0
                              ? extension.aiModels.join(', ')
                              : 'unknown'}
                          </small>
                        </div>
                        <span
                          className={`status-badge ${
                            extension.status === 'Detected'
                              ? 'status-active'
                              : 'status-neutral'
                          }`}
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
