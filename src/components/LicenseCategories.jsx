import { useEffect, useState } from 'react';
import AppInventoryIcon from './AppInventoryIcon';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const LICENSE_CATEGORIES = [
  { id: 'end-user', label: 'End User Licenses' },
  { id: 'platform', label: 'Enterprise Platform Licenses' },
];

const usd = (value, digits = 2) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0);
const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

function useJson(path) {
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
  }, [path]);
  return state;
}

// Capsule tabs under the License Utilizations header.
export function LicenseCategoryTabs({ value, onChange }) {
  return (
    <div className="license-capsules" role="tablist" aria-label="License categories">
      {LICENSE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={value === category.id}
          className={value === category.id ? 'license-capsule active' : 'license-capsule'}
          onClick={() => onChange(category.id)}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
}

const RENEWAL = {
  due: ['Notice due', 'status-reclaimable'],
  soon: ['Within 90 days', 'status-observing'],
  later: ['Later', 'status-active'],
  locked: ['Notice passed', 'status-neutral'],
  expired: ['Expired', 'status-neutral'],
};
const PACE = {
  under: ['Under-using', 'status-observing'],
  'on-track': ['On track', 'status-active'],
  over: ['Overage likely', 'status-reclaimable'],
};

export function PlatformLicenses() {
  const { data, error } = useJson('/api/platforms');
  if (error) return <p className="error-message">{error}</p>;
  if (!data) return <p className="muted-value">Loading platform licenses…</p>;
  const { platforms, totals } = data;
  const committed = platforms.reduce((total, platform) => total + (platform.contract.commitmentAmount || 0), 0);
  const atRisk = platforms.filter((platform) => platform.licensing.pace && platform.licensing.pace.status !== 'on-track').length;
  return (
    <>
      <section className="summary-grid" aria-label="Platform license summary">
        <article className="summary-card">
          <span>Total Monthly Platform Spend</span>
          <strong>{usd(totals.forecastCost)}</strong>
          <small>Month-end forecast across {platforms.length} platforms</small>
        </article>
        <article className="summary-card summary-card-alert">
          <span>Identified Monthly Savings</span>
          <strong>{usd(totals.savingsMonthly)}</strong>
          <small>Idle capacity, orphaned resources and inactive users</small>
        </article>
        <article className="summary-card">
          <span>Contracts Needing Attention</span>
          <strong>
            {totals.noticeIn90}{' '}
            <small className="inline-strong-note">notice deadlines in 90 days</small>
          </strong>
          <small>{atRisk} commitment{atRisk === 1 ? '' : 's'} off pace (under-use or overage)</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Enterprise Platform Licenses</h2>
            <p>Commitments, capacity and user tiers for each platform, with how much of each commitment is on pace to be used by term end.</p>
          </div>
        </div>
        <div className="extension-summary-grid" aria-label="Platform license totals">
          <div>
            <span>Month to date</span>
            <strong>{usd(totals.mtdCost)}</strong>
          </div>
          <div>
            <span>Committed value</span>
            <strong>{usd(committed, 0)}</strong>
            <small>Across current contracts</small>
          </div>
          <div>
            <span>Platforms</span>
            <strong>{platforms.length}</strong>
            <small>{platforms.map((platform) => platform.name.replace('Microsoft ', '')).join(', ')}</small>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Licensed by</th>
                <th>Entitlement</th>
                <th>Commitment pace</th>
                <th>Monthly cost</th>
                <th>Savings</th>
                <th>Next notice deadline</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => {
                const pace = platform.licensing.pace;
                const renewal = platform.nextRenewal;
                return (
                  <tr key={platform.id}>
                    <td>
                      <span className="license-category-app">
                        <AppInventoryIcon appName={platform.name} className="license-category-icon" />
                        <span><strong>{platform.name}</strong><small>{platform.category}</small></span>
                      </span>
                    </td>
                    <td>{platform.licensing.unit}</td>
                    <td>{platform.licensing.entitlement}</td>
                    <td>
                      {pace ? (
                        <span className="license-category-pace">
                          <span className={`status-badge ${PACE[pace.status][1]}`}>{PACE[pace.status][0]}</span>
                          <small>{percent(pace.projectedPercent)} by term end</small>
                        </span>
                      ) : '—'}
                    </td>
                    <td>{usd(platform.forecastCost)}</td>
                    <td>{usd(platform.savingsMonthly)}</td>
                    <td>
                      {renewal ? (
                        <span className="license-category-pace">
                          <span className={`status-badge ${RENEWAL[renewal.status]?.[1] || 'status-neutral'}`}>{RENEWAL[renewal.status]?.[0] || renewal.status}</span>
                          <small>{renewal.noticeDate} · {renewal.daysToNotice} days</small>
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

// AI licenses under End User Licenses: vendor seats and spend, then the
// license table (children) for AI tools and agents tracked on PCs.
export function AiToolLicenses({ children }) {
  const { data, error } = useJson('/api/ai-tools/overview');
  if (error) return <><p className="error-message">{error}</p>{children}</>;
  if (!data) return <><p className="muted-value">Loading AI tool licenses…</p>{children}</>;
  const tools = data.vendors.map((vendor) => {
    const members = vendor.members || [];
    const seatsKpi = vendor.kpis?.find((kpi) => kpi.label === 'Seats');
    return {
      ...vendor,
      seats: seatsKpi ? seatsKpi.value : members.length,
      active: members.filter((member) => member.status === 'active').length,
      idle: members.filter((member) => member.status !== 'active'),
      spend: sum(members, (member) => member.mtdSpend),
      savings: vendor.idle?.estimatedMonthlySavings || 0,
    };
  });
  const totalSeats = sum(tools, (tool) => tool.seats);
  const idleSeats = tools.flatMap((tool) => tool.idle.map((member) => ({ ...member, tool: tool.name, idleDays: tool.idle?.idleDays })));
  return (
    <>
      <section className="summary-grid" aria-label="AI tool license summary">
        <article className="summary-card">
          <span>Total Monthly AI Spend</span>
          <strong>{usd(sum(tools, (tool) => tool.spend))}</strong>
          <small>Month to date across {tools.length} AI tools</small>
        </article>
        <article className="summary-card summary-card-alert">
          <span>Identified Monthly Savings</span>
          <strong>{usd(sum(tools, (tool) => tool.savings))}</strong>
          <small>Idle seats that can be reclaimed or downgraded</small>
        </article>
        <article className="summary-card">
          <span>Reclaimable AI Licenses</span>
          <strong>
            {idleSeats.length}{' '}
            <small className="inline-strong-note">from {totalSeats} total seats</small>
          </strong>
          <small>{tools.map((tool) => `${tool.idle.length} ${tool.name}`).join(' + ')}</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>AI Tools & Agent Licenses</h2>
            <p>Seats, activity and spend for each AI tool from its vendor admin API. Agents built on these tools are counted under their tool for now.</p>
          </div>
        </div>
        <div className="extension-summary-grid" aria-label="AI tool license totals">
          <div>
            <span>AI seats</span>
            <strong>{totalSeats}</strong>
            <small>{sum(tools, (tool) => tool.active)} active in the review window</small>
          </div>
          <div>
            <span>Month-to-date spend</span>
            <strong>{usd(sum(tools, (tool) => tool.spend))}</strong>
          </div>
          <div>
            <span>Idle seats</span>
            <strong>{idleSeats.length}</strong>
            <small>No activity in the vendor's review window</small>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>AI tool</th>
                <th>Seats</th>
                <th>Active</th>
                <th>Idle</th>
                <th>Month-to-date spend</th>
                <th>Savings</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.id}>
                  <td>
                    <span className="license-category-app">
                      <AppInventoryIcon appName={tool.name} className="license-category-icon" />
                      <span><strong>{tool.name}</strong><small>{tool.product}</small></span>
                    </span>
                  </td>
                  <td>{tool.seats}</td>
                  <td>{tool.active}</td>
                  <td>{tool.idle.length}</td>
                  <td>{usd(tool.spend)}</td>
                  <td>{usd(tool.savings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {children}
    </>
  );
}
