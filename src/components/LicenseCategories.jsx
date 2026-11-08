import { useEffect, useMemo, useState } from 'react';
import AppInventoryIcon from './AppInventoryIcon';
import LicenseOverview from './LicenseOverview';
import LineIcon from './LineIcon';
import { platformRows } from '../utils/licenseOverview';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const LICENSE_CATEGORIES = [
  { id: 'end-user', label: 'End User Licenses' },
  { id: 'platform', label: 'Enterprise Platform Licenses' },
];


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

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);

const PLATFORM_LABELS = {
  nameColumn: 'Platform',
  total: 'Total Commitment',
  assigned: 'Consumed',
  available: 'Remaining',
  cost: 'Est. Monthly Cost',
  back: '← All platforms',
  search: 'Search platform (e.g., Azure, Snowflake…)',
  seatColumn: 'Resource',
  seatSearch: 'Search resource (e.g., vm-build-01)',
  assignedOf: 'consumed of',
  noTotal: 'No commitment',
  noTotalHint: 'Add the contract commitment to see how much is used',
  missingTotals: 'without a commitment',
  savingsHint: 'Monthly savings from reclaimable resources',
  empty: 'No platform contracts yet.',
  noMatch: 'No platforms match these filters.',
  noSeats: 'No resources reported for this platform yet.',
  noSeatMatch: 'No resources match these filters.',
};

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
const PACE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'under', label: 'Under-using' },
  { id: 'on-track', label: 'On track' },
  { id: 'over', label: 'Overage likely' },
];
const NOTICE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: '30', label: 'Within 30 days' },
  { id: '90', label: 'Within 90 days' },
];
const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

// The list page: each platform's contract (what it's licensed by, the
// entitlement, commitment pace, cost and the next notice deadline). Opening a
// platform shows its usage and resources.
function PlatformContracts({ rows, openRow }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [pace, setPace] = useState('all');
  const [notice, setNotice] = useState('all');
  const categories = useMemo(() => ['All', ...new Set(rows.map((row) => row.category).sort())], [rows]);
  const filtered = rows.filter((row) => {
    const platform = row.platform;
    const term = search.trim().toLowerCase();
    if (term && !`${row.name} ${row.category}`.toLowerCase().includes(term)) return false;
    if (category !== 'All' && row.category !== category) return false;
    if (pace !== 'all' && platform.licensing?.pace?.status !== pace) return false;
    const days = platform.nextRenewal?.daysToNotice;
    if (notice !== 'all' && !(days !== undefined && days >= 0 && days <= Number(notice))) return false;
    return true;
  });
  const platforms = rows.map((row) => row.platform);
  const committed = platforms.reduce((total, platform) => total + (Number(platform.contract?.commitmentAmount) || 0), 0);
  const spend = platforms.reduce((total, platform) => total + (Number(platform.forecastCost) || 0), 0);
  const savings = platforms.reduce((total, platform) => total + (Number(platform.savingsMonthly) || 0), 0);
  const noticeSoon = platforms.filter((platform) => {
    const days = platform.nextRenewal?.daysToNotice;
    return days !== undefined && days >= 0 && days <= 90;
  }).length;
  const offPace = platforms.filter((platform) => platform.licensing?.pace && platform.licensing.pace.status !== 'on-track').length;
  const reset = () => {
    setSearch('');
    setCategory('All');
    setPace('all');
    setNotice('all');
  };

  return (
    <>
      <div className="license-kpis">
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="coins" size={22} /></span>
          <div>
            <span>Est. Monthly Platform Spend</span>
            <strong>{money(spend)}</strong>
          </div>
          <small className="license-kpi-chip">{platforms.length} platforms</small>
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="layers" size={22} /></span>
          <div>
            <span>Committed Value</span>
            <strong>{money(committed)}</strong>
          </div>
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="box" size={22} /></span>
          <div>
            <span>Identified Monthly Savings</span>
            <strong>{money(savings)}</strong>
          </div>
          {savings > 0 && <small className="license-kpi-chip license-kpi-chip-good" title="Idle capacity, orphaned resources and idle hosts">Reclaimable</small>}
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="calendar" size={22} /></span>
          <div>
            <span>Contracts Needing Attention</span>
            <strong>{noticeSoon}</strong>
          </div>
          <small className="license-kpi-chip" title="Notice deadlines in the next 90 days; commitments off pace">
            {offPace} off pace
          </small>
        </article>
      </div>

      <div className="license-filters">
        <label className="license-search">
          <span className="sr-only">Search platforms</span>
          <LineIcon name="search" size={16} />
          <input placeholder="Search platform (e.g., Azure, Snowflake…)" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item} value={item}>Category: {item}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Commitment pace</span>
          <select value={pace} onChange={(event) => setPace(event.target.value)}>
            {PACE_OPTIONS.map((item) => <option key={item.id} value={item.id}>Pace: {item.label}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Notice deadline</span>
          <select value={notice} onChange={(event) => setNotice(event.target.value)}>
            {NOTICE_OPTIONS.map((item) => <option key={item.id} value={item.id}>Notice: {item.label}</option>)}
          </select>
        </label>
        <button className="license-reset" type="button" onClick={reset}>Reset</button>
      </div>

      <div className="table-wrap license-product-table">
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Licensed By</th>
              <th>Entitlement</th>
              <th>Commitment Pace</th>
              <th>Monthly Cost</th>
              <th>Savings</th>
              <th>Next Notice Deadline</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const platform = row.platform;
              const paceInfo = platform.licensing?.pace;
              const renewal = platform.nextRenewal;
              return (
                <tr
                  aria-label={`Open ${row.name} usage`}
                  className="license-product-row"
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target === event.currentTarget) openRow(row);
                  }}
                >
                  <td>
                    <div className="license-product-name">
                      <AppInventoryIcon appName={row.name} className="inventory-list-icon" />
                      <div>
                        <span className="license-product-title"><strong>{row.name}</strong></span>
                        <span>{row.category}</span>
                      </div>
                    </div>
                  </td>
                  <td>{platform.licensing?.unit || '—'}</td>
                  <td>{platform.licensing?.entitlement || '—'}</td>
                  <td>
                    {paceInfo ? (
                      <div className="license-renewal">
                        <span className={`status-badge ${PACE[paceInfo.status][1]}`}>{PACE[paceInfo.status][0]}</span>
                        <small>{percent(paceInfo.projectedPercent)} by term end</small>
                      </div>
                    ) : '—'}
                  </td>
                  <td>{money(platform.forecastCost)}</td>
                  <td className={platform.savingsMonthly > 0 ? 'savings-value' : 'muted-value'}>{money(platform.savingsMonthly)}</td>
                  <td>
                    {renewal ? (
                      <div className="license-renewal">
                        <span className={`status-badge ${RENEWAL[renewal.status]?.[1] || 'status-neutral'}`}>{RENEWAL[renewal.status]?.[0] || renewal.status}</span>
                        <small>{renewal.noticeDate} · {renewal.daysToNotice} days</small>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="empty-state" colSpan="7">{rows.length === 0 ? 'No platform contracts yet.' : 'No platforms match these filters.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Enterprise Platform Licenses: contracts on the list page, and each
// platform's usage (commitment consumed, resources with the platform API's
// evidence) when it's opened.
export function PlatformLicenses({ onSelectRow }) {
  return <PlatformOverview onSelectRow={onSelectRow} />;
}

function PlatformOverview({ onSelectRow }) {
  const { data, error } = useJson('/api/platforms');
  const rows = useMemo(() => platformRows(data?.platforms), [data]);
  if (error) return <p className="error-message">{error}</p>;
  if (!data) return <p className="muted-value">Loading platform licenses…</p>;
  return (
    <LicenseOverview
      amount={money}
      labels={PLATFORM_LABELS}
      renderList={(props) => <PlatformContracts {...props} />}
      rows={rows}
      subtitle="Commitments, capacity and user tiers for each platform, with how much of each commitment is on pace to be used by term end. Open a platform to see its usage and resources."
      title="Enterprise Platform Licenses"
      onSelectRow={onSelectRow}
    />
  );
}
