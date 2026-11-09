import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SAMPLE_REPORT_PRODUCTS as PRODUCTS, money } from './sampleReportData';

// The sample combined report the Report Builder's AI prompt draws in the chat.
// Figures come from the License Utilizations sample products, so both pages agree.
const COLORS = { 'AI tool': '#7c3aed', App: '#2563eb' };
const sum = (key) => PRODUCTS.reduce((total, product) => total + product[key], 0);

export default function CombinedReportPreview() {
  const spend = sum('cost');
  const seats = sum('seats');
  const assigned = sum('assigned');
  const saving = sum('saving');
  const reclaim = PRODUCTS.filter((product) => product.reclaimable > 0).sort((a, b) => b.saving - a.saving);

  return (
    <div className="combined-report">
      <div className="combined-report-head">
        <strong>Combined licence report · Last 30 days</strong>
        <span className="status-badge status-neutral">Sample report</span>
      </div>

      <div className="combined-report-kpis">
        <div><span>Monthly spend</span><strong>{money(spend)}</strong></div>
        <div><span>Seats assigned</span><strong>{assigned.toLocaleString()} of {seats.toLocaleString()}</strong></div>
        <div><span>Utilization</span><strong>{Math.round((assigned / seats) * 100)}%</strong></div>
        <div className="combined-report-saving"><span>Reclaimable</span><strong>{money(saving)}/mo</strong></div>
      </div>

      <div className="combined-report-chart">
        <span className="combined-report-label">Monthly spend by product</span>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={PRODUCTS} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#edf2f7" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(value) => `$${value / 1000}k`} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip formatter={(value) => money(value)} />
            <Bar dataKey="cost" name="Monthly spend" radius={[6, 6, 0, 0]}>
              {PRODUCTS.map((product) => <Cell fill={COLORS[product.kind]} key={product.name} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="combined-report-legend">
          <span><i style={{ background: COLORS['AI tool'] }} /> AI tools</span>
          <span><i style={{ background: COLORS.App }} /> End user apps</span>
        </div>
      </div>

      <div className="combined-report-table">
        <span className="combined-report-label">Reclaim opportunities</span>
        <table>
          <thead>
            <tr><th>Product</th><th>Reclaimable seats</th><th>Saving / month</th></tr>
          </thead>
          <tbody>
            {reclaim.map((product) => (
              <tr key={product.name}>
                <td>{product.name}</td>
                <td>{product.reclaimable}</td>
                <td>{money(product.saving)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="combined-report-summary">
        AI tools are {Math.round((PRODUCTS.filter((p) => p.kind === 'AI tool').reduce((t, p) => t + p.cost, 0) / spend) * 100)}% of licence spend.
        Reclaiming the {reclaim.reduce((t, p) => t + p.reclaimable, 0)} flagged seats saves {money(saving)} a month, led by Codex.
        Enterprise platforms join this report in Phase 2.
      </p>
    </div>
  );
}
