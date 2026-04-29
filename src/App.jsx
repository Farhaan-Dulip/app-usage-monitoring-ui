import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
};

const fallbackCosts = [150, 95, 72, 49, 29, 18];

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

function getAppIcon(appName) {
  return appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
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

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [config, setConfig] = useState(null);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [error, setError] = useState('');
  const [dispatchingDeviceId, setDispatchingDeviceId] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('laptop-dx01');
  const [showAgentDetails, setShowAgentDetails] = useState(false);
  const [historicalRange, setHistoricalRange] = useState(30);
  const [sortConfig, setSortConfig] = useState({
    key: 'savingsOpportunity',
    direction: 'desc',
  });

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
      const totalRuntimeSeconds = accumulatedUsage.get(appName) || 0;
      const monthlyCost = getMonthlyCost(appName, index);
      const isReclaimable = totalRuntimeSeconds < RECLAIMABLE_THRESHOLD_SECONDS;

      return {
        appName,
        pcName: currentPcName,
        icon: getAppIcon(appName),
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
    const licenseEfficiencyScore =
      totalSeats > 0 ? Math.round((activeSeats / totalSeats) * 100) : 0;

    return {
      totalWaste,
      totalSavings: totalWaste,
      activeCost,
      trackedMonthlyCost,
      activeSeats,
      totalSeats,
      licenseEfficiencyScore,
    };
  }, [usageByApp]);

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
      const monthlyCost = getMonthlyCost(appName, index);
      const totalRuntimeSeconds = selectedDevice.isLive
        ? (index + 1) * 1880
        : index * 420;

      return {
        appName,
        icon: getAppIcon(appName),
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
      <nav className="top-nav" aria-label="Primary navigation">
        <div className="brand-mark">
          <span className="brand-icon">A</span>
          <span>AgentOps</span>
        </div>
        <div className="nav-actions">
          <button
            className={activeView === 'dashboard' ? 'nav-link active' : 'nav-link'}
            type="button"
            onClick={() => setActiveView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={
              activeView === 'agent-management' ? 'nav-link active' : 'nav-link'
            }
            type="button"
            onClick={() => {
              setActiveView('agent-management');
              setShowAgentDetails(false);
            }}
          >
            Agent Management
          </button>
        </div>
      </nav>

      <main className="main-content">
        <header className="hero">
          <div>
            <p className="eyebrow">
              {activeView === 'dashboard'
                ? 'License intelligence'
                : 'Fleet management'}
            </p>
            <h1>
              {activeView === 'dashboard'
                ? 'Software Utilization Command Center'
                : 'Agent Management'}
            </h1>
            <p>
              {activeView === 'dashboard'
                ? 'Live app usage telemetry translated into spend visibility, reclaimable seats, and savings opportunities.'
                : 'Monitor endpoint health, active expensive licenses, and redeploy agents from one operational view.'}
            </p>
          </div>
        </header>

        {error && <div className="error-message">{error}</div>}

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
                          <span>{entry.appName}</span>
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

          <section className="panel">
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
                          <strong>{entry.appName}</strong>
                          <small>
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
                  </div>
                </div>
              </div>
            </section>
        )}
      </main>
    </div>
  );
}
