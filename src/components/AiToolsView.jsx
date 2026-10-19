import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PeopleBudgets from './PeopleBudgets';
import ConnectDialog, { useIntegrations } from './ConnectDialog';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const MODE = {
  live: { label: 'Live', className: 'status-active' },
  sample: { label: 'Sample data', className: 'status-observing' },
  error: { label: 'Connection error', className: 'status-reclaimable' },
};
const STATUS = {
  active: { label: 'Active', className: 'status-active' },
  idle: { label: 'Idle', className: 'status-reclaimable' },
  never: { label: 'No activity', className: 'status-neutral' },
};

function formatValue(value, format) {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'usd') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'compact') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  if (format === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  return String(value);
}

function lastActive(value) {
  if (!value) return 'Never';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

function VendorCard({ vendor, onConnect }) {
  const mode = MODE[vendor.mode] || MODE.sample;
  return (
    <section className="panel ai-tool-panel">
      <div className="panel-header">
        <div>
          <h2>{vendor.name}</h2>
          <p>{vendor.product}</p>
        </div>
        <div className="connect-actions">
          <span className={`status-badge ${mode.className}`}>{mode.label}</span>
          <button className="download-link-button" type="button" onClick={() => onConnect(vendor.id)}>
            {vendor.mode === 'sample' ? 'Connect' : 'Manage connection'}
          </button>
        </div>
      </div>

      {vendor.mode === 'sample' && (
        <p className="ai-tool-note">
          Fictional sample data in the vendor's documented format. Connect an admin credential to see your organisation's data: {vendor.connect}
          {!vendor.contractVerified && ' The endpoint and field names for this API still need checking against the vendor reference on the first live call.'}
        </p>
      )}
      {vendor.mode === 'error' && <p className="ai-tool-note ai-tool-error">The live call failed, so no data is shown: {vendor.error}</p>}

      {vendor.kpis && (
        <>
          <div className="ai-tool-kpis">
            {vendor.kpis.map((kpi) => (
              <div className="ai-tool-kpi" key={kpi.label} title={kpi.hint || ''}>
                <span>{kpi.label}</span>
                <strong>{formatValue(kpi.value, kpi.format)}</strong>
              </div>
            ))}
          </div>

          {vendor.daily?.points?.length > 0 && (
            <div className="ai-tool-chart">
              <span className="ai-tool-chart-label">{vendor.daily.label}</span>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={vendor.daily.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e3e9f2" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(day) => day.slice(5)} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(value) => formatValue(value, vendor.daily.format === 'usd' ? 'usd' : 'compact')} />
                  <Tooltip formatter={(value) => formatValue(value, vendor.daily.format)} />
                  <Area type="monotone" dataKey="value" stroke="#2f7fd8" fill="#2f7fd8" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {vendor.idle?.count > 0 && (
            <p className="ai-tool-note">
              <strong>{vendor.idle.count} reclaim candidate{vendor.idle.count === 1 ? '' : 's'}</strong>
              {vendor.idle.estimatedMonthlySavings ? ` (about ${formatValue(vendor.idle.estimatedMonthlySavings, 'usd')}/month)` : ''}. {vendor.idle.note}
            </p>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{vendor.id === 'copilot' ? 'GitHub user' : 'User'}</th>
                  <th>Status</th>
                  <th>Last active</th>
                  {vendor.memberColumns.map((column) => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {vendor.members.length === 0 ? (
                  <tr><td colSpan={3 + vendor.memberColumns.length}>No users reported.</td></tr>
                ) : vendor.members.map((member) => (
                  <tr key={member.id}>
                    <td><strong>{member.name}</strong>{member.email && member.email !== member.name && <small>{member.email}</small>}</td>
                    <td><span className={`status-badge ${(STATUS[member.status] || STATUS.never).className}`}>{(STATUS[member.status] || STATUS.never).label}</span></td>
                    <td>{lastActive(member.lastActiveAt)}</td>
                    {vendor.memberColumns.map((column) => <td key={column.key}>{formatValue(member[column.key], column.format)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function AiToolsView() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(null);
  const [integrations, reloadIntegrations] = useIntegrations();

  const load = useCallback((refresh = false) => {
    setLoading(true);
    fetch(`${BACKEND_BASE_URL}/api/ai-tools/overview${refresh ? '?refresh=1' : ''}`)
      .then((response) => {
        if (!response.ok) throw new Error(`AI tools request failed with status ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setOverview(payload);
        setError('');
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Connections</h2>
            <p>Each tool shows live organisation data once its admin credential is connected, and clearly marked sample data until then.</p>
          </div>
          <button className="download-link-button" type="button" disabled={loading} onClick={() => load(true)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {overview && (
          <div className="ai-tool-kpis">
            {overview.vendors.map((vendor) => (
              <div className="ai-tool-kpi" key={vendor.id}>
                <span>{vendor.name}</span>
                <strong className={`status-badge ${(MODE[vendor.mode] || MODE.sample).className}`}>{(MODE[vendor.mode] || MODE.sample).label}</strong>
              </div>
            ))}
          </div>
        )}
        {error && <p className="ai-tool-note ai-tool-error">{error}</p>}
      </section>
      {overview && <PeopleBudgets />}
      {overview?.vendors.map((vendor) => <VendorCard key={vendor.id} vendor={vendor} onConnect={setConnecting} />)}
      {connecting && (
        <ConnectDialog
          vendor={connecting}
          status={integrations?.vendors.find((item) => item.vendor === connecting)}
          canConnect={Boolean(integrations?.canConnect)}
          onClose={() => setConnecting(null)}
          onChanged={() => { reloadIntegrations(); load(true); }}
        />
      )}
    </>
  );
}

// AI tool activity of one person (a tracker's owner), shown on the tracker
// detail page. Matches each vendor's users by work email.
export function UserAiTools({ email }) {
  const [vendors, setVendors] = useState(null);
  const [person, setPerson] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!email) return;
    setVendors(null);
    setPerson(null);
    fetch(`${BACKEND_BASE_URL}/api/ai-tools/user?email=${encodeURIComponent(email)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`AI tools request failed with status ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setVendors(payload.vendors || []);
        setPerson(payload.person || null);
        setError('');
      })
      .catch((loadError) => setError(loadError.message));
  }, [email]);

  const budgetLine = (vendorId) => {
    const tool = person?.tools?.[vendorId];
    if (!tool) return null;
    const spend = tool.unit === 'USD' ? formatValue(tool.spend, 'usd') : `${formatValue(tool.spend, 'number')} credits`;
    const budget = tool.unit === 'USD' ? formatValue(tool.budget, 'usd') : `${formatValue(tool.budget, 'number')} credits`;
    const used = tool.used === null ? '' : ` (${Math.round(tool.used * 100)}%)`;
    return `Month to date: ${spend} of ${budget}${used}`;
  };

  return (
    <div className="detail-section">
      <div className="panel-header">
        <div>
          <h3>AI tools</h3>
          <p>{email ? `Claude, Codex and GitHub Copilot activity for ${email}.` : 'Link this device to an employee (Device owners) to see their AI tool activity.'}</p>
          {person && (
            <p>
              Employee ID: {person.employeeId || 'not set'} · Manager: {person.managerName || 'not set'}
              {person.department ? ` · ${person.department}` : ''}
            </p>
          )}
        </div>
      </div>
      {error && <p className="ai-tool-note ai-tool-error">{error}</p>}
      {email && vendors && (
        <div className="ai-tool-user-grid">
          {vendors.map((vendor) => {
            const mode = MODE[vendor.mode] || MODE.sample;
            const member = vendor.member;
            const status = member ? STATUS[member.status] || STATUS.never : null;
            return (
              <article className="ai-tool-kpi ai-tool-user-card" key={vendor.id}>
                <div className="ai-tool-user-head">
                  <strong>{vendor.name}</strong>
                  <span className={`status-badge ${mode.className}`}>{mode.label}</span>
                </div>
                {vendor.mode === 'error' ? (
                  <small className="ai-tool-error">{vendor.error}</small>
                ) : member ? (
                  <>
                    <div className="ai-tool-user-head">
                      <span className={`status-badge ${status.className}`}>{status.label}</span>
                      <small>Last active: {lastActive(member.lastActiveAt)}</small>
                    </div>
                    {budgetLine(vendor.id) && <small><strong>{budgetLine(vendor.id)}</strong></small>}
                    <dl className="ai-tool-user-metrics">
                      {vendor.memberColumns.map((column) => (
                        <div key={column.key}>
                          <dt>{column.label}</dt>
                          <dd>{formatValue(member[column.key], column.format)}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <small>
                    {vendor.id === 'copilot'
                      ? 'No Copilot seat matched. Seats are GitHub logins; map them to emails with -GithubLoginEmails.'
                      : `No ${vendor.name} account for this email.`}
                  </small>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
