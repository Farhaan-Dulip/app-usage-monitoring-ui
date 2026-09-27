export const reportTemplates = [
  {
    id: 'ceo-monthly', name: 'CEO Monthly', audience: 'Executive Summary',
    description: 'High-level financial gains, managed spend, waste reduction, and savings progress for leadership.',
    owner: 'Executive Office', cadence: 'Monthly', format: 'PDF', accent: 'report-accent-blue',
    includedSections: ['Financial gains', 'Waste reduction', 'Optimization score'],
  },
  {
    id: 'it-audit', name: 'IT Audit', audience: 'Compliance',
    description: 'Detailed inventory of software installations compared with active usage and reclaimable seats.',
    owner: 'IT Operations', cadence: 'Weekly', format: 'Excel', accent: 'report-accent-red',
    includedSections: ['Installations', 'Usage evidence', 'License status'],
  },
  {
    id: 'cloud-finops', name: 'Cloud FinOps', audience: 'Infrastructure',
    description: 'Cloud right-sizing, provider spend, zombie resources, and cleanup opportunities by account.',
    owner: 'Platform Engineering', cadence: 'Weekly', format: 'PDF + CSV', accent: 'report-accent-green',
    includedSections: ['Right-sizing', 'Orphaned assets', 'Provider spend'],
  },
  {
    id: 'ai-adoption', name: 'AI Adoption', audience: 'Engineering',
    description: 'Copilot, Cursor, and AI extension utilization with model adoption and developer efficiency signals.',
    owner: 'Engineering Enablement', cadence: 'Monthly', format: 'JSON', accent: 'report-accent-purple',
    includedSections: ['AI seats', 'Selected models', 'Developer efficiency'],
  },
];

export const reportDimensions = ['User', 'Department', 'App', 'Cloud Provider'];
export const reportMetrics = ['Cost', 'Active Time', 'Waste', 'CPU %'];

export const reportHistory = [
  { id: 'rpt-1048', name: 'CEO Monthly - April Close', type: 'Executive Summary', generatedAt: 'May 01, 2026 09:00', version: 'v4', format: 'PDF', owner: 'Finance Ops' },
  { id: 'rpt-1042', name: 'IT Audit - License Evidence', type: 'Compliance', generatedAt: 'Apr 28, 2026 16:20', version: 'v2', format: 'XLSX', owner: 'IT Operations' },
  { id: 'rpt-1039', name: 'Cloud FinOps - Orphan Cleanup', type: 'Infrastructure', generatedAt: 'Apr 25, 2026 11:45', version: 'v3', format: 'CSV', owner: 'Platform Engineering' },
  { id: 'rpt-1031', name: 'AI Adoption - Engineering Rollout', type: 'Engineering', generatedAt: 'Apr 18, 2026 14:10', version: 'v1', format: 'JSON', owner: 'Engineering Enablement' },
];
