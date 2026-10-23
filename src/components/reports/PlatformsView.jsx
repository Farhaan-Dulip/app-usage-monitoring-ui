import { useEffect, useState } from 'react';
import AppInventoryIcon from '../AppInventoryIcon';
import { ChartGrid, DataTable, KpiCards, formatValue } from './DashboardView';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function useJson(path, version) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_BASE_URL}${path}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        return response.json();
      })
      .then((data) => { if (!cancelled) setState({ data, error: '' }); })
      .catch((error) => { if (!cancelled) setState({ data: null, error: error.message }); });
    return () => { cancelled = true; };
  }, [path, version]);
  return state;
}

const RENEWAL_LABEL = { due: 'Notice due', soon: 'Within 90 days', later: 'Later', locked: 'Notice passed', expired: 'Expired' };
const RENEWAL_CLASS = { due: 'status-reclaimable', soon: 'status-observing', later: 'status-active', locked: 'status-neutral', expired: 'status-neutral' };

function RenewalBadge({ item }) {
  if (!item) return null;
  return <span className={`status-badge ${RENEWAL_CLASS[item.status] || 'status-neutral'}`}>{RENEWAL_LABEL[item.status] || item.status}</span>;
}

const RENEWAL_COLUMNS = [
  { key: 'platform', label: 'Platform', format: 'text' },
  { key: 'name', label: 'Item', format: 'text' },
  { key: 'type', label: 'Type', format: 'text' },
  { key: 'status', label: 'Status', format: 'status' },
  { key: 'noticeDate', label: 'Notice deadline', format: 'text' },
  { key: 'daysToNotice', label: 'Days to notice', format: 'number' },
  { key: 'endDate', label: 'Ends', format: 'text' },
  { key: 'autoRenew', label: 'Auto-renew', format: 'text' },
  { key: 'amount', label: 'Value', format: 'usd' },
];

export function PlatformsOverview({ onOpenPlatform }) {
  const { data, error } = useJson('/api/platforms');
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading platforms…</p>;
  const { totals } = data;
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Enterprise Infrastructure Platform</h2>
            <p>Cost, infrastructure insights, contracts and renewal deadlines across your platforms. Read-only: nothing is changed in the platforms.</p>
          </div>
        </div>
        <KpiCards kpis={[
          { label: 'Month to date, all platforms', value: totals.mtdCost, format: 'usd' },
          { label: 'Forecast, month end', value: totals.forecastCost, format: 'usd' },
          { label: 'Savings identified / month', value: totals.savingsMonthly, format: 'usd' },
          { label: 'Notice deadlines in 90 days', value: totals.noticeIn90, format: 'number' },
        ]} />
        <div className="report-app-grid platform-grid">
          {data.platforms.map((platform) => (
            <button className="report-app-card platform-card" key={platform.id} type="button" onClick={() => onOpenPlatform(platform)}>
              <span className="platform-card-head">
                <AppInventoryIcon appName={platform.name} className="report-app-icon" />
                <span className="report-app-text">
                  <strong>{platform.name}</strong>
                  <small>{platform.category}</small>
                </span>
              </span>
              <span className="platform-card-stats">
                <span><small>Month to date</small><strong>{formatValue(platform.mtdCost, 'usd')}</strong></span>
                <span><small>Savings / month</small><strong>{formatValue(platform.savingsMonthly, 'usd')}</strong></span>
              </span>
              {platform.nextRenewal && (
                <span className="platform-card-renewal">
                  <RenewalBadge item={platform.nextRenewal} />
                  <small>Notice by {platform.nextRenewal.noticeDate} · {platform.nextRenewal.daysToNotice} days</small>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Renewal calendar</h2>
            <p>Contracts and reservations across all platforms, soonest notice deadline first.</p>
          </div>
        </div>
        <DataTable table={{ title: 'Upcoming renewals', columns: RENEWAL_COLUMNS, rows: data.renewals }} />
      </section>
    </>
  );
}

const CONTRACT_INPUTS = [
  ['agreement', 'Agreement', 'text'],
  ['contractNumber', 'Contract number', 'text'],
  ['startDate', 'Start date', 'date'],
  ['endDate', 'End date', 'date'],
  ['commitmentAmount', 'Commitment amount', 'number'],
  ['consumedAmount', 'Consumed to date', 'number'],
  ['currency', 'Currency', 'text'],
  ['discountPercent', 'Discount (%)', 'number'],
  ['noticeDays', 'Notice period (days)', 'number'],
  ['billing', 'Billing', 'text'],
  ['owner', 'Owner', 'text'],
  ['notes', 'Notes', 'text'],
];

function ContractEditor({ platformId, contract, onSaved, onCancel }) {
  const [values, setValues] = useState(() => Object.fromEntries([...CONTRACT_INPUTS.map(([key]) => [key, contract[key] ?? '']), ['autoRenew', Boolean(contract.autoRenew)]]));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = async (method, body) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/platforms/${encodeURIComponent(platformId)}/contract`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
      onSaved();
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <form className="platform-contract-form" onSubmit={(event) => { event.preventDefault(); send('PUT', values); }}>
      <div className="platform-contract-fields">
        {CONTRACT_INPUTS.map(([key, label, type]) => (
          <label key={key} className={key === 'agreement' || key === 'notes' ? 'platform-contract-wide' : ''}>
            <span>{label}</span>
            <input
              type={type}
              step={type === 'number' ? 'any' : undefined}
              min={type === 'number' ? 0 : undefined}
              value={values[key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
        <label className="platform-contract-check">
          <input type="checkbox" checked={values.autoRenew} onChange={(event) => setValues((current) => ({ ...current, autoRenew: event.target.checked }))} />
          <span>Renews automatically</span>
        </label>
      </div>
      {message && <p className="ai-tool-note ai-tool-error">{message}</p>}
      <div className="platform-contract-actions">
        <button className="platform-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save contract'}</button>
        <button className="platform-button platform-button-secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {contract.source === 'saved' && (
          <button className="link-button" type="button" disabled={busy} onClick={() => send('DELETE')}>Remove saved contract (back to sample)</button>
        )}
      </div>
    </form>
  );
}

function Section({ section, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{section.title}</h2>
          {section.description && <p>{section.description}</p>}
        </div>
        {children}
      </div>
      {section.notes?.map((note) => <p className="ai-tool-note" key={note}>{note}</p>)}
      <KpiCards kpis={section.kpis} />
      {section.charts?.length > 0 && <ChartGrid charts={section.charts} />}
      {section.tables?.map((table) => (
        <DataTable key={table.title} table={{ ...table, rows: table.rows.map((row, index) => ({ id: row.id ?? `${table.title}-${index}`, ...row })) }} />
      ))}
    </section>
  );
}

export function PlatformDashboard({ platform }) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const { data, error } = useJson(`/api/platforms/${encodeURIComponent(platform.id)}`, version);
  if (error) return <p className="ai-tool-note ai-tool-error">{error}</p>;
  if (!data) return <p className="muted-value">Loading {platform.name}…</p>;
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div className="report-dashboard-title">
            <AppInventoryIcon appName={data.platform.name} className="report-app-icon" />
            <div>
              <h2>{data.platform.name}</h2>
              <p>{data.platform.category} · {data.api.name}</p>
            </div>
          </div>
          <div className="platform-dashboard-summary">
            <span><small>Month to date</small><strong>{formatValue(data.summary.mtdCost, 'usd')}</strong></span>
            <span><small>Forecast</small><strong>{formatValue(data.summary.forecastCost, 'usd')}</strong></span>
            <span><small>Savings / month</small><strong>{formatValue(data.summary.savingsMonthly, 'usd')}</strong></span>
          </div>
        </div>
      </section>

      {data.sections.map((section) => (
        <Section key={section.id} section={section}>
          {section.id === 'contract' && !editing && (
            <button className="platform-button platform-button-secondary" type="button" onClick={() => setEditing(true)}>Edit contract</button>
          )}
        </Section>
      )).flatMap((element, index) => (data.sections[index].id === 'contract' && editing ? [
        element,
        <section className="panel" key="contract-editor">
          <div className="panel-header"><div><h2>Edit contract</h2><p>Saved in the portal and used for the commitment pace and renewal deadlines.</p></div></div>
          <ContractEditor
            platformId={data.platform.id}
            contract={data.contract}
            onCancel={() => setEditing(false)}
            onSaved={() => { setEditing(false); setVersion((value) => value + 1); }}
          />
        </section>,
      ] : [element]))}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Data source</h2>
            <p>The read-only API calls behind this dashboard. Shown with sample data in each API's response format until the platform is connected.</p>
          </div>
        </div>
        <ul className="report-endpoints">
          {data.api.endpoints.map((endpoint) => (
            <li key={endpoint.path}>
              <code>{endpoint.path}</code>
              <span className={`status-badge ${endpoint.verified === 'docs' ? 'status-active' : endpoint.verified.includes('unverified') || endpoint.verified.includes('contract') ? 'status-reclaimable' : 'status-observing'}`}>{endpoint.verified}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
