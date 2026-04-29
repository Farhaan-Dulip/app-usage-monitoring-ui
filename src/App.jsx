import { useEffect, useMemo, useState } from 'react';

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

export default function App() {
  const [config, setConfig] = useState(null);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [error, setError] = useState('');
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

  const usageByApp = useMemo(() => {
    if (!config) return [];

    return config.licensed_apps.map((appName, index) => {
      const totalRuntimeSeconds = accumulatedUsage.get(appName) || 0;
      const monthlyCost = getMonthlyCost(appName, index);
      const isReclaimable = totalRuntimeSeconds < RECLAIMABLE_THRESHOLD_SECONDS;

      return {
        appName,
        icon: getAppIcon(appName),
        status: isReclaimable ? 'Reclaimable' : 'Active',
        totalRuntimeSeconds,
        monthlyCost,
        savingsOpportunity: isReclaimable ? monthlyCost : 0,
      };
    });
  }, [config, accumulatedUsage]);

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
    const activeSeats = usageByApp.filter((entry) => entry.status === 'Active').length;
    const totalSeats = usageByApp.length;
    const licenseEfficiencyScore =
      totalSeats > 0 ? Math.round((activeSeats / totalSeats) * 100) : 0;

    return {
      totalWaste,
      totalSavings: totalWaste,
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

  const requestSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction:
        currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const renderSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
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
      <header className="hero">
        <div>
          <p className="eyebrow">License intelligence</p>
          <h1>Software Utilization Command Center</h1>
          <p>
            Live app usage telemetry translated into spend visibility, reclaimable
            seats, and savings opportunities.
          </p>
        </div>
        <button className="reset-button" onClick={resetUsage}>
          Reset usage
        </button>
      </header>

      {error && <div className="error-message">{error}</div>}

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
            {aggregates.activeSeats} active of {aggregates.totalSeats} licensed seats
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
                  <button type="button" onClick={() => requestSort('monthlyCost')}>
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
              </tr>
            </thead>
            <tbody>
              {sortedUsageByApp.map((entry) => (
                <tr key={entry.appName}>
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
                      entry.savingsOpportunity > 0 ? 'savings-value' : 'muted-value'
                    }
                  >
                    {entry.savingsOpportunity > 0
                      ? `-${formatCurrency(entry.savingsOpportunity)}`
                      : formatCurrency(0)}
                  </td>
                </tr>
              ))}
              {sortedUsageByApp.length === 0 && (
                <tr>
                  <td colSpan="5" className="empty-state">
                    Waiting for licensed app configuration.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {usageByUrl.length > 0 && (
        <section className="panel compact-panel">
          <div className="panel-header">
            <div>
              <h2>Web URL Usage</h2>
              <p>Tracked browser destinations included in the telemetry feed.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Runtime</th>
                  <th>Seconds</th>
                </tr>
              </thead>
              <tbody>
                {usageByUrl.map((entry) => (
                  <tr key={entry.url}>
                    <td>{entry.url}</td>
                    <td>{formatRuntime(entry.total_runtime_seconds)}</td>
                    <td>{entry.total_runtime_seconds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
