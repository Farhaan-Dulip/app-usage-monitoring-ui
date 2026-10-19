import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#2f7fd8', '#11a37f', '#d99a00', '#8c5cd6', '#e0565b', '#3aa6b9', '#74849a'];
const STATUS = {
  active: { label: 'Active', className: 'status-active' },
  idle: { label: 'Idle', className: 'status-reclaimable' },
  never: { label: 'No activity', className: 'status-neutral' },
};
export const MODE = {
  live: { label: 'Live', className: 'status-active' },
  sample: { label: 'Sample data', className: 'status-observing' },
  tracker: { label: 'Tracker data', className: 'status-neutral' },
  error: { label: 'Connection error', className: 'status-reclaimable' },
};

export function formatValue(value, format) {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'usd') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'hours') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} h`;
  if (format === 'compact') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  if (format === 'date') {
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return String(value);
    const days = Math.floor((Date.now() - time) / 86400000);
    return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  }
  if (format === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  return String(value);
}

const shortDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).slice(5) : String(value));

export function KpiCards({ kpis }) {
  if (!kpis?.length) return null;
  return (
    <div className="ai-tool-kpis report-kpis">
      {kpis.map((kpi) => (
        <div className="ai-tool-kpi" key={kpi.label} title={kpi.hint || ''}>
          <span>{kpi.label}</span>
          <strong>{formatValue(kpi.value, kpi.format)}</strong>
          {kpi.hint && <small>{kpi.hint}</small>}
        </div>
      ))}
    </div>
  );
}

function ChartCard({ chart }) {
  const format = chart.series?.[0]?.format;
  return (
    <article className="report-chart-card">
      <h3>{chart.title}</h3>
      {chart.data.length === 0 ? (
        <p className="muted-value">No data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          {chart.type === 'pie' ? (
            <PieChart>
              <Pie data={chart.data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {chart.data.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : chart.type === 'bar' ? (
            <BarChart data={chart.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e9f2" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={8} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(value) => formatValue(value, format)} />
              {chart.series.map((series, index) => (
                <Bar key={series.key} dataKey={series.key} name={series.label} fill={COLORS[index % COLORS.length]} radius={[4, 4, 0, 0]} stackId={chart.stacked ? 'stack' : undefined} />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={chart.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e9f2" vertical={false} />
              <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(value) => formatValue(value, format)} />
              {chart.series.length > 1 && <Legend />}
              {chart.series.map((series, index) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={COLORS[index % COLORS.length]}
                  fill={COLORS[index % COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  stackId={chart.stacked ? 'stack' : undefined}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      )}
    </article>
  );
}

export function ChartGrid({ charts }) {
  if (!charts?.length) return null;
  return <div className="report-chart-grid">{charts.map((chart) => <ChartCard key={chart.id} chart={chart} />)}</div>;
}

export function DataTable({ table }) {
  if (!table) return null;
  return (
    <div className="report-table">
      <h3>{table.title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{table.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr><td colSpan={table.columns.length}>No rows.</td></tr>
            ) : table.rows.map((row, index) => (
              <tr key={row.id || index}>
                {table.columns.map((column) => (
                  <td key={column.key}>
                    {column.format === 'status' ? (
                      <span className={`status-badge ${(STATUS[row[column.key]] || STATUS.never).className}`}>{(STATUS[row[column.key]] || STATUS.never).label}</span>
                    ) : column.key === 'name' ? (
                      <>
                        <strong>{row.name}</strong>
                        {row.email && row.email !== row.name && <small>{row.email}</small>}
                      </>
                    ) : (
                      formatValue(row[column.key], column.format)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
