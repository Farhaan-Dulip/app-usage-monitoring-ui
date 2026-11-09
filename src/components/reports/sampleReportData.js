// Sample products behind the Report Builder's AI reports. They match the
// License Utilizations sample products (src/utils/licenseOverview.js): seats
// bought and assigned, monthly cost, reclaimable seats and days to renewal.
export const SAMPLE_REPORT_PRODUCTS = [
  // AI tools also carry sessions in the last 30 days and how many of them were
  // agentic (agent mode, Claude Code, Codex tasks) rather than chat or autocomplete.
  { name: 'GitHub Copilot', kind: 'AI tool', seats: 600, assigned: 552, active: 531, cost: 23400, reclaimable: 12, renewalInDays: 210, sessions: 18400, agenticSessions: 6990 },
  { name: 'Codex', kind: 'AI tool', seats: 500, assigned: 428, active: 380, cost: 15000, reclaimable: 39, renewalInDays: 38, sessions: 6120, agenticSessions: 4530 },
  { name: 'Claude', kind: 'AI tool', seats: 400, assigned: 371, active: 346, cost: 10000, reclaimable: 13, renewalInDays: 121, sessions: 9840, agenticSessions: 5120 },
  { name: 'Postman', kind: 'App', seats: 200, assigned: 162, active: 135, cost: 3800, reclaimable: 21, renewalInDays: 64 },
  { name: 'Figma', kind: 'App', seats: 120, assigned: 74, active: 58, cost: 1800, reclaimable: 0, renewalInDays: 17 },
].map((product) => ({
  ...product,
  seatCost: product.cost / product.seats,
  saving: Math.round((product.reclaimable * product.cost) / product.seats),
}));

// AI use per month, the last six months (sample), all as percentages:
// - adoption: employees actively using any AI tool, out of all employees
//   (SAMPLE_EMPLOYEES); November's 66% is the 1,257 active AI users
// - active: active users as a share of assigned AI seats
// - agentic: agentic sessions as a share of all AI sessions
// - tokens: token optimization score, the share of input tokens served from
//   cache (Claude cache_read, Codex cached_input) rather than sent again
export const SAMPLE_EMPLOYEES = 1900;
export const SAMPLE_AI_TREND = [
  { month: 'Jun', adoption: 34, active: 78, agentic: 21, tokens: 42 },
  { month: 'Jul', adoption: 41, active: 82, agentic: 26, tokens: 47 },
  { month: 'Aug', adoption: 48, active: 86, agentic: 31, tokens: 53 },
  { month: 'Sep', adoption: 55, active: 89, agentic: 37, tokens: 58 },
  { month: 'Oct', adoption: 61, active: 91, agentic: 43, tokens: 63 },
  { month: 'Nov', adoption: 66, active: 93, agentic: 48, tokens: 67 },
];

export const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
