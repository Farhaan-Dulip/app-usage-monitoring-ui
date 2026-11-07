import { useEffect, useMemo, useRef, useState } from 'react';
import AppInventoryIcon from './AppInventoryIcon';
import LineIcon from './LineIcon';
import { daysUntil, trackerEvidence, vendorEvidence } from '../utils/licenseOverview';

const STATUS_OPTIONS = ['All', 'Active', 'Reclaimable', 'Evaluating', 'Not installed'];
const RENEWAL_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: '30', label: 'Within 30 days' },
  { id: '90', label: 'Within 90 days' },
  { id: 'none', label: 'No renewal date' },
];
const SORTABLE = { name: 'name', totalSeats: 'totalSeats', assigned: 'assigned', available: 'available', utilization: 'utilization', renewalDate: 'renewalDate', activeCount: 'activeCount', reclaimableCount: 'reclaimableCount', evaluatingCount: 'evaluatingCount' };

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
const count = (value) => (value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(value));
const dateLabel = (date) =>
  date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

function statusClass(status) {
  if (status === 'Active') return 'status-active';
  if (status === 'Reclaimable') return 'status-reclaimable';
  if (status === 'Evaluating') return 'status-observing';
  return 'status-neutral';
}

// License Utilizations: KPI cards, filters and one row per software product.
// Clicking a product opens its seats in place of the table, with the evidence
// behind each seat's status; "All software" goes back.
export default function LicenseOverview({ rows, inventoryApps, showSample, onToggleSample, onSelectRow, title, subtitle }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [status, setStatus] = useState('All');
  const [renewal, setRenewal] = useState('all');
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
  const [viewRowId, setViewRowId] = useState('');
  // The product open in detail, kept in step with the rows (Sample data on/off).
  const viewRow = rows.find((row) => row.id === viewRowId) || null;
  const openRow = (row) => setViewRowId(row.id);
  // The page's engagement chart follows the open product and the seats its
  // filters leave.
  const [visibleSeatIds, setVisibleSeatIds] = useState(null);
  const seatKey = visibleSeatIds ? visibleSeatIds.join('|') : '';
  useEffect(() => {
    if (!viewRow) {
      onSelectRow?.(null);
      return;
    }
    const seats = visibleSeatIds ? viewRow.seats.filter((seat) => visibleSeatIds.includes(seat.id)) : viewRow.seats;
    onSelectRow?.({ ...viewRow, seats });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRow?.id, viewRow?.seats.length, seatKey]);

  const categories = useMemo(() => ['All', ...new Set(rows.map((row) => row.category).sort())], [rows]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const now = Date.now();
    const list = rows.filter((row) => {
      if (term && !`${row.name} ${row.description}`.toLowerCase().includes(term)) return false;
      if (category !== 'All' && row.category !== category) return false;
      // A status matches products with at least one seat in it.
      if (status === 'Active' && !(row.activeCount > 0)) return false;
      if (status === 'Reclaimable' && !(row.reclaimableCount > 0)) return false;
      if (status === 'Evaluating' && !(row.evaluatingCount > 0)) return false;
      if (status === 'Not installed' && !row.seats.some((seat) => seat.status === status)) return false;
      const days = daysUntil(row.renewalDate, now);
      if (renewal === 'none' && row.renewalDate) return false;
      if ((renewal === '30' || renewal === '90') && !(days !== null && days >= 0 && days <= Number(renewal))) return false;
      return true;
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const first = a[sort.key];
      const second = b[sort.key];
      if (first === null || first === undefined) return 1;
      if (second === null || second === undefined) return -1;
      return (typeof first === 'number' ? first - second : String(first).localeCompare(String(second))) * direction;
    });
  }, [rows, search, category, status, renewal, sort]);

  // The cards cover every product, or just the one open in detail.
  const totals = useMemo(() => {
    const scope = viewRow ? [viewRow] : rows;
    const known = scope.filter((row) => row.totalSeats !== null);
    const total = known.reduce((sum, row) => sum + row.totalSeats, 0);
    const assigned = scope.reduce((sum, row) => sum + row.assigned, 0);
    const assignedOfKnown = known.reduce((sum, row) => sum + row.assigned, 0);
    const available = known.reduce((sum, row) => sum + (row.available || 0), 0);
    return {
      total,
      assigned,
      available,
      assignedPct: total ? Math.round((assignedOfKnown / total) * 100) : null,
      availablePct: total ? Math.round((available / total) * 100) : null,
      cost: scope.reduce((sum, row) => sum + (Number(row.monthlyCost) || 0), 0),
      savings: scope.reduce((sum, row) => sum + (Number(row.savings) || 0), 0),
      missingPlans: scope.length - known.length,
    };
  }, [rows, viewRow]);

  // Filtering by Active, Reclaimable or Evaluating shows only that count column.
  const only = ['Active', 'Reclaimable', 'Evaluating'].includes(status) ? status : null;
  const showActive = !only || only === 'Active';
  const showReclaimable = !only || only === 'Reclaimable';
  const showEvaluating = !only || only === 'Evaluating';

  const reset = () => {
    setSearch('');
    setCategory('All');
    setStatus('All');
    setRenewal('all');
  };
  const toggleSort = (key) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  const sortMark = (key) => (sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕');

  return (
    <section className="license-overview" aria-label={title}>
      <div className="license-overview-head">
        {viewRow ? (
          <AppHeader
            row={viewRow}
            onBack={() => {
              setVisibleSeatIds(null);
              setViewRowId('');
            }}
          />
        ) : (
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        )}
        <label className="sample-data-switch" title="Adds fictional products and seats to show every status and the vendor admin data">
          <input checked={showSample} type="checkbox" onChange={(event) => onToggleSample(event.target.checked)} />
          Sample data
        </label>
      </div>

      <div className="license-kpis">
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="layers" size={22} /></span>
          <div>
            <span>Total Licenses</span>
            <strong>{count(totals.total)}</strong>
          </div>
          {totals.missingPlans > 0 && <small className="license-kpi-chip" title="Apps without plans have no seat count">{totals.missingPlans} without plans</small>}
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="users" size={22} /></span>
          <div>
            <span>Assigned</span>
            <strong>{count(totals.assigned)}</strong>
          </div>
          {totals.assignedPct !== null && <small className="license-kpi-chip">{totals.assignedPct}%</small>}
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="box" size={22} /></span>
          <div>
            <span>Available</span>
            <strong>{count(totals.available)}</strong>
          </div>
          {totals.availablePct !== null && <small className="license-kpi-chip">{totals.availablePct}%</small>}
        </article>
        <article className="license-kpi">
          <span className="license-kpi-icon"><LineIcon name="coins" size={22} /></span>
          <div>
            <span>Est. Monthly Cost</span>
            <strong>{money(totals.cost)}</strong>
          </div>
          {totals.savings > 0 && <small className="license-kpi-chip license-kpi-chip-good" title="Monthly cost of reclaimable seats">{money(totals.savings)} reclaimable</small>}
        </article>
      </div>

      {viewRow ? (
        <SeatsDetail
          inventoryApps={inventoryApps}
          key={viewRow.id}
          row={viewRow}
          onVisibleSeats={setVisibleSeatIds}
        />
      ) : (
      <>
      <div className="license-filters">
        <label className="license-search">
          <span className="sr-only">Search software</span>
          <LineIcon name="search" size={16} />
          <input placeholder="Search software (e.g., Codex, Postman…)" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item} value={item}>Category: {item}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((item) => <option key={item} value={item}>Status: {item}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Renewal</span>
          <select value={renewal} onChange={(event) => setRenewal(event.target.value)}>
            {RENEWAL_OPTIONS.map((item) => <option key={item.id} value={item.id}>Renewal: {item.label}</option>)}
          </select>
        </label>
        <button className="license-reset" type="button" onClick={reset}>Reset</button>
      </div>

      <div className="table-wrap license-product-table">
        <table>
          <thead>
            <tr>
              {[
                ['name', 'Software Name'],
                ['totalSeats', 'Total Licenses'],
                ['assigned', 'Assigned'],
                ['available', 'Available'],
                ['utilization', 'Utilization'],
                ['renewalDate', 'Renewal Date'],
                ...(showActive ? [['activeCount', 'Active']] : []),
                ...(showReclaimable ? [['reclaimableCount', 'Reclaimable']] : []),
                ...(showEvaluating ? [['evaluatingCount', 'Evaluating']] : []),
              ].map(([key, label]) => (
                <th key={key}>
                  <button type="button" onClick={() => toggleSort(SORTABLE[key])}>{label}{sortMark(key)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const days = daysUntil(row.renewalDate);
              return (
                <tr
                  aria-label={`Open ${row.name} seats`}
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
                        <span className="license-product-title">
                          <strong>{row.name}</strong>
                          {row.sample && <small className="sample-row-tag">Sample</small>}
                        </span>
                        <span>{row.description}</span>
                      </div>
                    </div>
                  </td>
                  <td>{count(row.totalSeats)}</td>
                  <td>{count(row.assigned)}</td>
                  <td>{count(row.available)}</td>
                  <td>
                    {row.utilization === null ? (
                      <span className="muted-value" title="Add plans in Enterprise Apps Inventory to see seats">No plan</span>
                    ) : (
                      <div className="license-utilization">
                        <strong>{row.utilization}%</strong>
                        <span><i style={{ width: `${Math.min(100, row.utilization)}%` }} /></span>
                      </div>
                    )}
                  </td>
                  <td>
                    {row.renewalDate ? (
                      <div className="license-renewal">
                        <span><LineIcon name="calendar" size={15} /> {dateLabel(row.renewalDate)}</span>
                        <small>{days >= 0 ? `(${days} days)` : `(${-days} days ago)`}</small>
                      </div>
                    ) : (
                      <span className="muted-value">—</span>
                    )}
                  </td>
                  {showActive && (
                    <td>
                      <span className={`status-badge ${row.activeCount > 0 ? 'status-active' : 'status-neutral'}`}>
                        Active ({count(row.activeCount)})
                      </span>
                    </td>
                  )}
                  {showReclaimable && (
                    <td>
                      <span className={`status-badge ${row.reclaimableCount > 0 ? 'status-reclaimable' : 'status-neutral'}`}>
                        Reclaimable ({count(row.reclaimableCount)})
                      </span>
                    </td>
                  )}
                  {showEvaluating && (
                    <td>
                      <span className={`status-badge ${row.evaluatingCount > 0 ? 'status-observing' : 'status-neutral'}`}>
                        Evaluating ({count(row.evaluatingCount)})
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={6 + Number(showActive) + Number(showReclaimable) + Number(showEvaluating)}>
                  {rows.length === 0 ? 'Add apps with plans in Enterprise Apps Inventory, or turn on Sample data.' : 'No software matches these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      </>
      )}
    </section>
  );
}


// The open app's name and plan, in place of the page title.
function AppHeader({ row, onBack }) {
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [row.id]);
  const days = daysUntil(row.renewalDate);
  return (
    <div className="license-app-header">
      <button className="license-back" type="button" onClick={onBack}>← All software</button>
      <div className="license-seats-head">
        <AppInventoryIcon appName={row.name} className="inventory-list-icon" />
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            {row.name}
            {row.sample && <small className="sample-row-tag">Sample</small>}
          </h2>
          <p>
            {count(row.assigned)} assigned of {count(row.totalSeats)} · {money(row.monthlyCost)}/month
            {row.renewalDate ? ` · renews ${dateLabel(row.renewalDate)}${days >= 0 ? ` (${days} days)` : ''}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

function SeatsDetail({ row, inventoryApps, onVisibleSeats }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const seats = useMemo(() => {
    const term = search.trim().toLowerCase();
    return row.seats.filter((seat) => {
      if (term && !String(seat.pcName).toLowerCase().includes(term)) return false;
      if (status !== 'All' && seat.status !== status) return false;
      return true;
    });
  }, [row.seats, search, status]);
  const filtering = search.trim() || status !== 'All';
  useEffect(() => {
    onVisibleSeats?.(filtering ? seats.map((seat) => seat.id) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtering, seats.map((seat) => seat.id).join('|')]);
  const reset = () => {
    setSearch('');
    setStatus('All');
  };
  const shown = row.seats.length;
  return (
    <section className="license-seats-detail" aria-label={`${row.name} seats`}>
      <div className="license-filters license-seat-filters">
        <label className="license-search">
          <span className="sr-only">Search PCs</span>
          <LineIcon name="search" size={16} />
          <input placeholder="Search PC (e.g., SAMPLE-ENG-01)" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((item) => <option key={item} value={item}>Status: {item}</option>)}
          </select>
        </label>
        <button className="license-reset" type="button" onClick={reset}>Reset</button>
      </div>
      {shown < row.assigned && shown > 0 && (
        <p className="license-seats-note">
          {filtering ? `${seats.length} of the ${shown} seats with tracker data match.` : `Showing the ${shown} seats with tracker data.`}
        </p>
      )}
      <div className="license-seats-card">
        <table className="license-seats-table">
          <thead>
            <tr>
              <th>License</th>
              <th>Status</th>
              <th>Evidence</th>
              <th>Savings</th>
            </tr>
          </thead>
          <tbody>
              {seats.map((seat) => {
                const tracker = trackerEvidence(seat, inventoryApps);
                const vendor = vendorEvidence(seat);
                return (
                  <tr key={seat.id}>
                    <td>
                      <strong>{seat.name}</strong>
                      <small>{seat.pcName}</small>
                    </td>
                    <td><span className={`status-badge ${statusClass(seat.status)}`} title={seat.reclaimReason}>{seat.status}</span></td>
                    <td>
                      <span className={`license-evidence license-evidence-${tracker.tone}`}><LineIcon name="monitor" size={15} /> {tracker.text}</span>
                      <span className={`license-evidence license-evidence-${vendor.tone}`}><LineIcon name="cloud" size={15} /> {vendor.text}</span>
                    </td>
                    <td className={seat.savingsOpportunity > 0 ? 'savings-value' : 'muted-value'}>
                      {seat.savingsOpportunity > 0 ? `+${money(seat.savingsOpportunity)}` : money(0)}
                    </td>
                  </tr>
                );
              })}
              {seats.length === 0 && (
                <tr>
                  <td className="empty-state" colSpan="4">
                    {shown === 0 ? 'No seats deployed to a PC yet.' : 'No seats match these filters.'}
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
