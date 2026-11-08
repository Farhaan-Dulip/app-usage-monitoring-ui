import LineIcon from './LineIcon';
import { trackerEvidence, vendorEvidence } from '../utils/licenseOverview';

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);

const BADGE = {
  Active: 'status-active',
  Reclaimable: 'status-reclaimable',
  Evaluating: 'status-observing',
};

// One row per licence seat on a PC: name and PC, status, the evidence behind
// it (tracker time and vendor usage) and the savings, one after another.
export default function DeviceSeatList({ seats }) {
  if (seats.length === 0) {
    return <div className="empty-inline">No licence seats on this PC yet.</div>;
  }
  return seats.map((seat) => {
    const lines = seat.evidence || [
      { ...trackerEvidence(seat, []), icon: 'monitor' },
      { ...vendorEvidence(seat), icon: 'cloud' },
    ];
    return (
      <div className="device-seat-row" key={seat.id}>
        <div className="device-seat-name">
          <strong>{seat.name}</strong>
          <small>{seat.pcName}</small>
        </div>
        <span className={`status-badge ${BADGE[seat.status] || 'status-neutral'}`} title={seat.reclaimReason}>
          {seat.status}
        </span>
        <div className="device-seat-evidence">
          {lines.map((line, index) => (
            <span className={`license-evidence license-evidence-${line.tone}`} key={index}>
              <LineIcon name={line.icon || 'cloud'} size={15} /> {line.text}
            </span>
          ))}
        </div>
        <span className={seat.savingsOpportunity > 0 ? 'savings-value' : 'muted-value'}>
          {seat.savingsOpportunity > 0 ? `+${money(seat.savingsOpportunity)}` : money(0)}
        </span>
      </div>
    );
  });
}
