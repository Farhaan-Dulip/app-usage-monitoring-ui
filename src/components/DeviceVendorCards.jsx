import AppInventoryIcon from './AppInventoryIcon';
import { sampleVendorData } from '../data/sampleVendorData';

const AI_PRODUCTS = new Set(['claude', 'codex', 'copilot']);
const API_NAMES = {
  claude: 'Claude Admin API',
  codex: 'Codex Analytics API',
  copilot: 'GitHub Copilot metrics API',
  postman: 'Postman audit log',
  figma: 'Figma activity log',
  zoom: 'Zoom users API',
};
const BADGE = {
  Active: 'status-active',
  Reclaimable: 'status-reclaimable',
  Evaluating: 'status-observing',
};

const hours = (seconds) => {
  const value = (Number(seconds) || 0) / 3600;
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}h`;
};

// A vendor rule check's value as the vendor reported it.
function checkValue(check) {
  if (check.kind !== 'within') return String(check.value ?? '—');
  if (check.value === null || check.value === undefined) return 'Never';
  if (check.value === 0) return 'Today';
  return `${check.value} ${check.value === 1 ? 'day' : 'days'} ago`;
}

// What the vendor's API reports for one seat: the sample values for a sample
// PC, else the values its vendor rule checks read from the live API.
function vendorDetails(seat) {
  if (seat.sample) return sampleVendorData(seat.pcName, seat.name);
  const checks = seat.vendorRule?.checks || [];
  if (checks.length === 0) return null;
  return {
    source: API_NAMES[seat.productId] || `${seat.name} API`,
    metrics: checks.map((check) => [check.label, checkValue(check)]),
  };
}

// Cards at the bottom of a PC's details page: one per licence on the PC, with
// the tracker's measure and what the vendor's API reports for that seat.
export default function DeviceVendorCards({ seats }) {
  if (seats.length === 0) return null;
  return (
    <div className="detail-section device-vendor-section">
      <div className="panel-header">
        <div>
          <h3>Licence data from vendor APIs</h3>
          <p>What each vendor reports for the licences on this PC, beside the tracker’s own measure.</p>
        </div>
      </div>
      <div className="device-vendor-grid">
        {seats.map((seat) => {
          const vendor = vendorDetails(seat);
          const isAi = AI_PRODUCTS.has(seat.productId);
          const worked = Number(seat.workedRuntimeSeconds) || 0;
          const agentic = isAi && worked > 0 ? Math.round(((Number(seat.automationWorkedSeconds) || 0) / worked) * 100) : null;
          return (
            <article className="device-vendor-card" key={seat.id}>
              <div className="device-vendor-head">
                <AppInventoryIcon appName={seat.name} className="inventory-list-icon" />
                <strong>{seat.name}</strong>
                <span className={`status-badge ${BADGE[seat.status] || 'status-neutral'}`}>{seat.status}</span>
              </div>

              <dl className="device-vendor-metrics device-vendor-tracker">
                <div>
                  <dt>Tracker active time</dt>
                  <dd>{hours(worked)}</dd>
                </div>
                {agentic !== null && (
                  <div>
                    <dt>Agentic AI use</dt>
                    <dd>{agentic}%</dd>
                  </div>
                )}
              </dl>

              {vendor ? (
                <>
                  {vendor.note && <p className="device-vendor-note">{vendor.note}</p>}
                  <dl className="device-vendor-metrics">
                    {vendor.metrics.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <small className="device-vendor-source">
                    {vendor.source}{seat.sample ? ' · sample data' : ''}
                  </small>
                </>
              ) : (
                <p className="device-vendor-note">No vendor API data for this licence yet.</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
