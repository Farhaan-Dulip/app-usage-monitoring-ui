import { useEffect, useState } from 'react';
import AppInventoryIcon from '../AppInventoryIcon';
import { ChartGrid, DataTable, KpiCards, MODE, formatValue } from './DashboardView';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function useJson(path) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setState({ data: null, error: '' });
    fetch(`${BACKEND_BASE_URL}${path}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        return response.json();
      })
      .then((data) => { if (!cancelled) setState({ data, error: '' }); })
      .catch((error) => { if (!cancelled) setState({ data: null, error: error.message }); });
    return () => { cancelled = true; };
  }, [path]);
  return state;
}

function Breadcrumb({ items }) {
  return (
    <nav className="report-breadcrumb" aria-label="Reports navigation">
      {items.map((item, index) => (
        <span key={item.label}>
          {index > 0 && <span className="report-breadcrumb-sep" aria-hidden="true">›</span>}
          {item.onClick ? <button className="link-button" type="button" onClick={item.onClick}>{item.label}</button> : <strong>{item.label}</strong>}
        </span>
      ))}
    </nav>
  );
}

const HUB_CARDS = [
  { id: 'licenses', title: 'Enterprise App Licenses', text: 'Seats, spend, activity and reclaim candidates for each licensed app, from its vendor admin API and the Trackers.', icon: '▦' },
  { id: 'tracker', title: 'Tracker Usage', text: 'What the Trackers measured on PCs in the last 30 days: active and idle time by app, PC and day.', icon: '◷' },
  { id: 'ai-tools', title: 'AI Tools & Agents', text: 'Review connected AI tools, agent usage, seat activity, and integration health.', icon: '✦' },
  { id: 'builder', title: 'Custom Report Builder', text: 'Create a tailored report from the inventory, license, usage, and reclaim data that matters to your team.', icon: '≡' },
];

const AI_TOOL_CARD_TOTALS = {
  claude: { licenses: 42, cost: 1260 },
  codex: { licenses: 28, cost: 840 },
  copilot: { licenses: 64, cost: 1216 },
};

const LICENSE_CARD_TOTALS = {
  claude: { licenses: 42, cost: 1260 },
  codex: { licenses: 28, cost: 840 },
  copilot: { licenses: 64, cost: 1216 },
  chatgpt: { licenses: 36, cost: 720 },
  cursor: { licenses: 24, cost: 480 },
  slack: { licenses: 85, cost: 1020 },
  zoom: { licenses: 48, cost: 720 },
  figma: { licenses: 31, cost: 930 },
  postman: { licenses: 27, cost: 675 },
  docker: { licenses: 22, cost: 550 },
  jetbrains: { licenses: 39, cost: 1170 },
  vscode: { licenses: 120, cost: 0 },
  'visual-studio': { licenses: 33, cost: 1485 },
};

function SectionTotal({ count, cost }) {
  return (
    <div className="report-section-total" aria-label={`${count} apps and ${formatValue(cost, 'usd')} total cost`}>
      <span>Total Apps <strong>{count}</strong></span>
      <b>{formatValue(cost, 'usd')}</b>
    </div>
  );
}

function AppCostSummary({ seats, cost, className = '' }) {
  return (
    <span className={`report-app-card-summary ${className}`.trim()} aria-label={`${seats} seats, ${formatValue(cost, 'usd')}`}>
      <span className="report-app-card-seats">
        <small>Seats</small>
        <strong>{seats}</strong>
      </span>
      <strong>{formatValue(cost, 'usd')}</strong>
    </span>
  );
}

function Hub({ onOpen }) {
  return (
    <section className="report-hub" aria-label="Reports">
      {HUB_CARDS.map((card) => (
        <button className="report-hub-card" key={card.id} type="button" onClick={() => onOpen(card.id)}>
          <span className="report-hub-icon" aria-hidden="true">{card.icon}</span>
          <strong>{card.title}</strong>
          <span>{card.text}</span>
          <span className="report-hub-open">Open ›</span>
        </button>
      ))}
    </section>
  );
}

function LicenseApps({ onOpenApp }) {
  const { data, error } = useJson('/api/reports/apps');
  const totalCost = data?.apps.reduce(
    (total, app) => total + (LICENSE_CARD_TOTALS[app.id]?.cost || 0),
    0
  ) || 0;
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading apps…</p>;
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Enterprise App Licenses</h2>
          <p>Choose an app to see its licence dashboard.</p>
        </div>
        <SectionTotal count={data.apps.length} cost={totalCost} />
      </div>
      <div className="report-app-grid">
        {data.apps.map((app) => {
          return (
            <button className="report-app-card" key={app.id} type="button" onClick={() => onOpenApp(app)}>
              <AppInventoryIcon appName={app.name} className="report-app-icon" />
              <span className="report-app-text">
                <strong>{app.name}</strong>
                <small>{app.vendor}</small>
              </span>
              <AppCostSummary seats={LICENSE_CARD_TOTALS[app.id]?.licenses || 0} cost={LICENSE_CARD_TOTALS[app.id]?.cost || 0} />
              {app.mode !== 'sample' && app.mode !== 'tracker' && (() => {
                const mode = MODE[app.mode] || MODE.tracker;
                return <span className={`status-badge ${mode.className}`}>{mode.label}</span>;
              })()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AppDashboard({ app }) {
  const { data, error } = useJson(`/api/reports/apps/${encodeURIComponent(app.id)}`);
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading {app.name}…</p>;
  const mode = MODE[data.mode] || MODE.sample;
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div className="report-dashboard-title">
            <AppInventoryIcon appName={data.app.name} className="report-app-icon" />
            <div>
              <h2>{data.app.name}</h2>
              <p>{data.app.vendor} · {data.api.name}</p>
            </div>
          </div>
          <div className="report-dashboard-header-actions">
            <AppCostSummary
              className="report-dashboard-cost-summary"
              seats={LICENSE_CARD_TOTALS[data.app.id]?.licenses || 0}
              cost={LICENSE_CARD_TOTALS[data.app.id]?.cost || 0}
            />
            {data.mode !== 'sample' && data.mode !== 'tracker' && <span className={`status-badge ${mode.className}`}>{mode.label}</span>}
          </div>
        </div>
        {data.mode === 'error' && <p className="ai-tool-note ai-tool-error">{data.error}</p>}
        {data.notes?.map((note) => <p className="ai-tool-note" key={note}>{note}</p>)}
        <KpiCards kpis={data.kpis} />
      </section>

      {data.charts?.length > 0 && (
        <section className="panel">
          <ChartGrid charts={data.charts} />
        </section>
      )}

      {data.table && (
        <section className="panel">
          <DataTable table={data.table} />
        </section>
      )}

      {data.mode !== 'tracker' && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Measured on PCs</h2>
              <p>Active time the Trackers recorded for {data.app.name} in the last 30 days (real telemetry).</p>
            </div>
          </div>
          <KpiCards kpis={data.tracker.kpis} />
          {data.tracker.devices.length > 0 ? (
            <DataTable
              table={{
                title: 'By PC',
                columns: [
                  { key: 'device', label: 'PC', format: 'text' },
                  { key: 'user', label: 'User', format: 'text' },
                  { key: 'hours', label: 'Active time', format: 'hours' },
                  { key: 'lastSeen', label: 'Last used', format: 'date' },
                ],
                rows: data.tracker.devices.map((device) => ({ ...device, id: device.device, user: device.user || '—' })),
              }}
            />
          ) : (
            <p className="muted-value">No Tracker has measured {data.app.name} yet. Add it to the inventory and deploy it to PCs to start measuring.</p>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Data source</h2>
            <p>The API calls behind this dashboard, and how sure the field names are.</p>
          </div>
        </div>
        {data.api.endpoints.length === 0 ? (
          <p className="muted-value">{data.app.name} has no admin API; the Tracker's measurements are the data.</p>
        ) : (
          <ul className="report-endpoints">
            {data.api.endpoints.map((endpoint) => (
              <li key={endpoint.path}>
                <code>{endpoint.path}</code>
                <span className={`status-badge ${endpoint.verified === 'docs' ? 'status-active' : endpoint.verified.includes('unverified') ? 'status-reclaimable' : 'status-observing'}`}>{endpoint.verified}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AiToolsAgents({ onOpenTool }) {
  const { data, error } = useJson('/api/ai-tools/overview');
  const totalCost = data?.vendors.reduce(
    (total, tool) => total + (AI_TOOL_CARD_TOTALS[tool.id]?.cost || 0),
    0
  ) || 0;
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading AI tools...</p>;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>AI Tools & Agents</h2>
          <p>Select a tool to review seats, activity, usage, and reclaim opportunities.</p>
        </div>
        <SectionTotal count={data.vendors.length} cost={totalCost} />
      </div>
      <div className="report-app-grid ai-tools-app-grid">
        {data.vendors.map((tool) => (
          <button className="report-app-card" key={tool.id} type="button" onClick={() => onOpenTool(tool)}>
            <AppInventoryIcon appName={tool.name} className="report-app-icon" />
            <span className="report-app-text">
              <strong>{tool.name}</strong>
              <small>{tool.product}</small>
            </span>
            <AppCostSummary seats={AI_TOOL_CARD_TOTALS[tool.id]?.licenses || 0} cost={AI_TOOL_CARD_TOTALS[tool.id]?.cost || 0} />
            {tool.mode !== 'sample' && (() => {
              const mode = MODE[tool.mode] || MODE.error;
              return <span className={`status-badge ${mode.className}`}>{mode.label}</span>;
            })()}
          </button>
        ))}
      </div>
    </section>
  );
}

function AiToolDashboard({ tool }) {
  const { data, error } = useJson('/api/ai-tools/overview');
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading {tool.name}...</p>;
  const vendor = data.vendors.find((item) => item.id === tool.id);
  if (!vendor) return <p className="ai-tool-note ai-tool-error">This AI tool is no longer available.</p>;
  const mode = MODE[vendor.mode] || MODE.sample;
  const statusData = ['active', 'idle', 'never'].map((status) => ({
    name: status === 'never' ? 'No activity' : `${status[0].toUpperCase()}${status.slice(1)}`,
    value: (vendor.members || []).filter((member) => member.status === status).length,
  }));
  const charts = [
    ...(vendor.daily?.points?.length ? [{
      id: 'daily-usage',
      title: vendor.daily.label || 'Daily usage',
      type: 'area',
      xKey: 'date',
      series: [{ key: 'value', label: vendor.daily.label || 'Usage', format: vendor.daily.format }],
      data: vendor.daily.points,
    }] : []),
    { id: 'seat-activity', title: 'Seats by activity', type: 'pie', data: statusData },
  ];
  const table = {
    title: 'Members',
    columns: [
      { key: 'name', label: 'User', format: 'text' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'lastActiveAt', label: 'Last active', format: 'date' },
      ...(vendor.memberColumns || []),
    ],
    rows: vendor.members || [],
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div className="report-dashboard-title">
            <AppInventoryIcon appName={vendor.name} className="report-app-icon" />
            <div>
              <h2>{vendor.name}</h2>
              <p>{vendor.product}</p>
            </div>
          </div>
          <div className="report-dashboard-header-actions">
            <AppCostSummary
              className="report-dashboard-cost-summary"
              seats={AI_TOOL_CARD_TOTALS[vendor.id]?.licenses || 0}
              cost={AI_TOOL_CARD_TOTALS[vendor.id]?.cost || 0}
            />
            {vendor.mode !== 'sample' && <span className={`status-badge ${mode.className}`}>{mode.label}</span>}
          </div>
        </div>
        {vendor.mode === 'error' && <p className="ai-tool-note ai-tool-error">{vendor.error}</p>}
        <KpiCards kpis={vendor.kpis} />
        {vendor.idle?.count > 0 && (
          <p className="ai-tool-note">
            <strong>{vendor.idle.count} reclaim candidate{vendor.idle.count === 1 ? '' : 's'}.</strong> {vendor.idle.note}
          </p>
        )}
      </section>
      {vendor.kpis && <section className="panel"><ChartGrid charts={charts} /></section>}
      {vendor.kpis && <section className="panel"><DataTable table={table} /></section>}
    </>
  );
}

function TrackerUsage() {
  const { data, error } = useJson('/api/reports/tracker-usage');
  const connectedPcs = data?.kpis.find((kpi) => kpi.label === 'PCs reporting (30 days)')?.value || 0;
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading tracker usage…</p>;
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Tracker Usage</h2>
            <p>Real telemetry from the Trackers over the last 30 days.</p>
          </div>
          <span className="tracker-connected-pcs">Connected PCs {connectedPcs}</span>
        </div>
        <KpiCards kpis={data.kpis} />
      </section>
      <section className="panel">
        <ChartGrid charts={data.charts} />
      </section>
      <section className="panel">
        <DataTable table={data.table} />
        <DataTable
          table={{
            title: 'By app',
            columns: [
              { key: 'app', label: 'App', format: 'text' },
              { key: 'hours', label: 'Active time', format: 'hours' },
              { key: 'idleHours', label: 'Idle time', format: 'hours' },
              { key: 'devices', label: 'PCs', format: 'number' },
            ],
            rows: data.appsTable.map((row) => ({ ...row, id: row.app })),
          }}
        />
      </section>
    </>
  );
}

// Reports & Insights: card hub > Enterprise App Licenses (apps > app dashboard),
// Tracker Usage, and the existing Report Builder (passed in as `builder`).
export default function ReportsInsights({ builder }) {
  const [view, setView] = useState('hub');
  const [app, setApp] = useState(null);
  const [tool, setTool] = useState(null);
  const home = { label: 'Reports & Insights', onClick: () => { setView('hub'); setApp(null); } };
  const crumbs = {
    hub: [{ label: 'Reports & Insights' }],
    licenses: [home, { label: 'Enterprise App Licenses' }],
    app: [home, { label: 'Enterprise App Licenses', onClick: () => { setView('licenses'); setApp(null); } }, { label: app?.name || '' }],
    tracker: [home, { label: 'Tracker Usage' }],
    builder: [home, { label: 'Report Builder' }],
    'ai-tools': [home, { label: 'AI Tools & Agents' }],
    'ai-tool': [home, { label: 'AI Tools & Agents', onClick: () => { setView('ai-tools'); setTool(null); } }, { label: tool?.name || '' }],
  };
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view, app]);

  return (
    <div className="reports-content">
      {view !== 'hub' && <Breadcrumb items={crumbs[view]} />}
      {view === 'hub' && <Hub onOpen={setView} />}
      {view === 'licenses' && <LicenseApps onOpenApp={(selected) => { setApp(selected); setView('app'); }} />}
      {view === 'app' && app && <AppDashboard app={app} />}
      {view === 'ai-tools' && <AiToolsAgents onOpenTool={(selected) => { setTool(selected); setView('ai-tool'); }} />}
      {view === 'ai-tool' && tool && <AiToolDashboard tool={tool} />}
      {view === 'tracker' && <TrackerUsage />}
      {view === 'builder' && builder}
    </div>
  );
}

export { formatValue };
