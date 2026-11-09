// Sample vendor API data for the sample PCs' licences, shown on a PC's details
// page. Each entry uses the fields the real connector reads from that vendor
// (services/aiTools for Claude, Codex and Copilot; vendorRuleFields for
// Postman and Figma), with values that match the sample seats elsewhere.
const SAMPLE_VENDOR_DATA = {
  'SAMPLE-ENG-01|Claude': {
    source: 'Claude Admin API · Claude Code usage report',
    metrics: [
      ['Sessions', '46'],
      ['Tokens', '1.21M'],
      ['Lines added', '8,240'],
      ['Commits', '31'],
      ['Pull requests', '12'],
      ['Accepted edits', '412'],
      ['Acceptance rate', '94%'],
      ['Active days', '18'],
      ['Est. cost (month)', '$38.20'],
    ],
  },
  'SAMPLE-ENG-02|Claude': {
    source: 'Claude Admin API · Claude Code usage report',
    metrics: [
      ['Sessions', '6'],
      ['Tokens', '148K'],
      ['Lines added', '910'],
      ['Commits', '3'],
      ['Pull requests', '1'],
      ['Accepted edits', '64'],
      ['Acceptance rate', '88%'],
      ['Active days', '2'],
      ['Est. cost (month)', '$4.10'],
    ],
  },
  'SAMPLE-ENG-01|GitHub Copilot': {
    source: 'GitHub Copilot metrics API',
    metrics: [
      ['Plan', 'Business'],
      ['Prompts (28 days)', '612'],
      ['Accept rate', '31%'],
      ['Agentic index', '7.2'],
      ['Pattern', 'Agent mode'],
      ['Last editor', 'VS Code'],
    ],
  },
  'SAMPLE-ENG-03|Codex': {
    source: 'Codex Analytics API',
    metrics: [
      ['Threads', '54'],
      ['Turns', '286'],
      ['Tokens', '3.4M'],
      ['Credits', '41.5'],
      ['Active days', '14'],
      ['Clients', 'CLI, VS Code'],
    ],
  },
  'SAMPLE-SALES-01|Codex': {
    source: 'Codex Analytics API',
    note: 'Not listed by Codex Analytics: no use in the last 30 days.',
    metrics: [
      ['Threads', '0'],
      ['Turns', '0'],
      ['Tokens', '0'],
      ['Credits', '0'],
    ],
  },
  'SAMPLE-QA-01|Postman': {
    source: 'Postman audit log (Enterprise)',
    metrics: [
      ['Last sign-in', '26 days ago'],
      ['Seat type', 'Enterprise'],
    ],
  },
  'SAMPLE-QA-02|Postman': {
    source: 'Postman audit log (Enterprise)',
    metrics: [
      ['Last sign-in', 'Today'],
      ['Seat type', 'Enterprise'],
    ],
  },
  'SAMPLE-DESIGN-01|Figma': {
    source: 'Figma activity log',
    metrics: [
      ['Files edited', '0'],
      ['Files viewed', '3'],
      ['Seat type', 'Full'],
    ],
  },
  'SAMPLE-DESIGN-02|Figma': {
    source: 'Figma activity log',
    metrics: [
      ['Files edited', '14'],
      ['Files viewed', '52'],
      ['Seat type', 'Full'],
    ],
  },
};

export function sampleVendorData(pcName, appName) {
  return SAMPLE_VENDOR_DATA[`${pcName}|${appName}`] || null;
}
