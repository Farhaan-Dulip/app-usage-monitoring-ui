import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SAMPLE_AI_TREND, SAMPLE_EMPLOYEES, SAMPLE_REPORT_PRODUCTS, money } from './sampleReportData';

const percent = (value) => `${value}%`;

// The three lines of the AI use chart, drawn like the PC page's App Engagement chart.
const LINES = [
  { key: 'adoption', name: 'AI adoption (employees using AI)', color: '#2563eb' },
  { key: 'active', name: 'Active seats (vs inactive)', color: '#7c3aed' },
  { key: 'agentic', name: 'Agentic share of sessions', color: '#0f766e' },
  { key: 'tokens', name: 'Token optimization score', color: '#f59e0b' },
];

// The sample AI adoption report the Report Builder's AI prompt draws in the
// chat: seats in use, how much of the use is agentic and how well tokens are
// reused, as one chart over six months, then each tool in a table. Seat
// figures match the License Utilizations sample products.
export default function AiAdoptionPreview() {
  const tools = SAMPLE_REPORT_PRODUCTS
    .filter((product) => product.kind === 'AI tool')
    .map((tool) => {
      const inactive = tool.assigned - tool.active;
      return {
        ...tool,
        inactive,
        adoption: Math.round((tool.active / tool.assigned) * 100),
        inactiveCost: Math.round(inactive * tool.seatCost),
        agentic: Math.round((tool.agenticSessions / tool.sessions) * 100),
      };
    })
    .sort((a, b) => b.adoption - a.adoption);
  const assigned = tools.reduce((sum, tool) => sum + tool.assigned, 0);
  const active = tools.reduce((sum, tool) => sum + tool.active, 0);
  const inactiveCost = tools.reduce((sum, tool) => sum + tool.inactiveCost, 0);
  const sessions = tools.reduce((sum, tool) => sum + tool.sessions, 0);
  const agentic = Math.round((tools.reduce((sum, tool) => sum + tool.agenticSessions, 0) / sessions) * 100);
  const first = SAMPLE_AI_TREND[0];
  const last = SAMPLE_AI_TREND[SAMPLE_AI_TREND.length - 1];
  const lowest = tools[tools.length - 1];
  const mostAgentic = [...tools].sort((a, b) => b.agentic - a.agentic)[0];

  return (
    <div className="combined-report">
      <div className="combined-report-head">
        <strong>AI adoption · Last 6 months</strong>
        <span className="status-badge status-neutral">Sample report</span>
      </div>

      <div className="combined-report-kpis">
        <div><span>Active seats</span><strong>{Math.round((active / assigned) * 100)}%</strong><small>{active.toLocaleString()} of {assigned.toLocaleString()} assigned</small></div>
        <div><span>Agentic sessions</span><strong>{agentic}%</strong><small>of {sessions.toLocaleString()} AI sessions</small></div>
        <div><span>Token optimization</span><strong>{last.tokens}%</strong><small>of input tokens from cache</small></div>
        <div className="combined-report-saving"><span>Inactive seats cost</span><strong>{money(inactiveCost)}/mo</strong><small>{assigned - active} seats</small></div>
      </div>

      <div className="combined-report-chart">
        <span className="combined-report-label">AI use, last 6 months</span>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={SAMPLE_AI_TREND} margin={{ top: 16, right: 18, left: 0, bottom: 2 }}>
            <CartesianGrid stroke="#edf2f7" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#7b8ba0', fontSize: 12 }} />
            <YAxis
              domain={[0, 100]}
              tickFormatter={percent}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#7b8ba0', fontSize: 12 }}
              width={52}
              label={{ value: 'Percent', angle: -90, position: 'insideLeft', fill: '#7b8ba0', fontSize: 12 }}
            />
            <Tooltip formatter={percent} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {LINES.map((line) => (
              <Line
                activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                dataKey={line.key}
                dot={false}
                key={line.key}
                name={line.name}
                stroke={line.color}
                strokeWidth={2.4}
                type="monotone"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="combined-report-table">
        <span className="combined-report-label">By tool, last 30 days</span>
        <table>
          <thead>
            <tr><th>AI tool</th><th>Seats assigned</th><th>Active users</th><th>Active seats</th><th>Agentic sessions</th><th>Inactive seats</th><th>Inactive cost / month</th></tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name}>
                <td>{tool.name}</td>
                <td>{tool.assigned}</td>
                <td>{tool.active}</td>
                <td>{tool.adoption}%</td>
                <td>{tool.agentic}%</td>
                <td>{tool.inactive}</td>
                <td>{money(tool.inactiveCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="combined-report-summary">
        AI adoption reached {last.adoption}% of the {SAMPLE_EMPLOYEES.toLocaleString()} employees, up from {first.adoption}% in {first.month}.
        {' '}Since then, active seats rose from {first.active}% to {last.active}%, agentic sessions from {first.agentic}% to
        {' '}{last.agentic}%, and token optimization from {first.tokens}% to {last.tokens}%. {mostAgentic.name} is the most agentic
        tool at {mostAgentic.agentic}%. {lowest.name} has the most inactive seats ({lowest.inactive}), so it is the first to
        follow up: offer training to the people who need it, and reclaim the rest.
      </p>
    </div>
  );
}
