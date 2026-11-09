import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SAMPLE_REPORT_PRODUCTS, money } from './sampleReportData';

const WINDOW_DAYS = 90;

// The sample "right-size before renewal" report the Report Builder's AI prompt
// draws in the chat: each contract renewing in the next 90 days, the seats to
// drop at renewal (never assigned, plus flagged as reclaimable) and the yearly
// saving. Figures come from the License Utilizations sample products.
export default function RenewalSavingsPreview() {
  const renewals = SAMPLE_REPORT_PRODUCTS
    .filter((product) => product.renewalInDays <= WINDOW_DAYS)
    .map((product) => {
      const unassigned = product.seats - product.assigned;
      const cut = unassigned + product.reclaimable;
      return {
        ...product,
        unassigned,
        cut,
        keep: product.seats - cut,
        yearly: Math.round(cut * product.seatCost * 12),
      };
    })
    .sort((a, b) => a.renewalInDays - b.renewalInDays);
  const total = renewals.reduce((sum, product) => sum + product.yearly, 0);
  const biggest = [...renewals].sort((a, b) => b.yearly - a.yearly)[0];
  const next = renewals[0];

  return (
    <div className="combined-report">
      <div className="combined-report-head">
        <strong>Right-size before renewal · Next {WINDOW_DAYS} days</strong>
        <span className="status-badge status-neutral">Sample report</span>
      </div>

      <div className="combined-report-kpis">
        <div className="combined-report-saving"><span>Yearly saving</span><strong>{money(total)}</strong></div>
        <div><span>Renewals due</span><strong>{renewals.length} in {WINDOW_DAYS} days</strong></div>
        <div><span>Next renewal</span><strong>{next.name} · {next.renewalInDays} days</strong></div>
        <div><span>Biggest win</span><strong>{biggest.name}</strong></div>
      </div>

      <div className="combined-report-chart">
        <span className="combined-report-label">Yearly saving if right-sized at renewal</span>
        <ResponsiveContainer width="100%" height={60 + renewals.length * 46}>
          <BarChart data={renewals} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#edf2f7" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(value) => `$${Math.round(value / 1000)}k`} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#0f172a' }} axisLine={false} tickLine={false} width={80} />
            <Tooltip formatter={(value) => money(value)} />
            <Bar dataKey="yearly" name="Yearly saving" fill="#15803d" radius={[0, 6, 6, 0]} barSize={22}>
              <LabelList dataKey="yearly" position="right" formatter={(value) => money(value)} style={{ fontSize: 12, fill: '#15803d', fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="combined-report-table">
        <span className="combined-report-label">What to do before each renewal</span>
        <table>
          <thead>
            <tr><th>Product</th><th>Renews in</th><th>Seats now → at renewal</th><th>Why</th><th>Yearly saving</th></tr>
          </thead>
          <tbody>
            {renewals.map((product) => (
              <tr key={product.name}>
                <td>{product.name}</td>
                <td>{product.renewalInDays} days</td>
                <td>{product.seats} → {product.keep}</td>
                <td>
                  {product.unassigned} never assigned
                  {product.reclaimable > 0 ? `, ${product.reclaimable} unused` : ''}
                </td>
                <td>{money(product.yearly)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="combined-report-summary">
        {renewals.length} contracts renew in the next {WINDOW_DAYS} days. Renewing them at the seats people actually use
        saves {money(total)} a year, with {biggest.name} the largest at {money(biggest.yearly)}. {next.name} renews first,
        in {next.renewalInDays} days, so its seat count needs deciding now.
      </p>
    </div>
  );
}
