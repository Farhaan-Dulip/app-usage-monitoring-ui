// Vendor activity rule fields per product, shared by the portal's App Rules
// form (src/utils/appRules.js) and the backend check (vendorRuleMonitor.js).
//
// Rule fields each app's vendor APIs can feed, per user, from the data its
// connector reads. 'atLeast' counts events in the evaluation window; 'within'
// is days since the vendor last saw the user.
export const VENDOR_RULE_FIELDS = {
  figma: [
    { id: 'figmaFilesEdited', label: 'Files edited', kind: 'atLeast', source: 'Activity log: file edit events' },
    { id: 'figmaFilesViewed', label: 'Files viewed', kind: 'atLeast', source: 'Activity log: file view events' },
  ],
  zoom: [{ id: 'zoomSignedIn', label: 'Signed in within', kind: 'within', source: 'Users: last sign-in time' }],
  // Postman's audit log has sign-ins, not work events; it keeps 180 days.
  postman: [
    { id: 'postmanSignedIn', label: 'Signed in within', kind: 'within', max: 180, source: 'Audit log: last sign-in (Postman Enterprise, up to 180 days)' },
  ],
  // Claude Code only: chat in the desktop app or claude.ai isn't in this
  // report, so these keep a seat but never reclaim one on their own.
  claude: [
    { id: 'claudeUsedWithin', label: 'Used Claude Code within', kind: 'within', source: 'Claude Code usage report: latest day with sessions' },
    { id: 'claudeActiveDays', label: 'Active days', kind: 'atLeast', source: 'Claude Code usage report: days with sessions' },
    { id: 'claudeAcceptedEdits', label: 'Accepted edits', kind: 'atLeast', source: 'Claude Code usage report: accepted edit and write actions' },
  ],
  copilot: [
    { id: 'copilotAccepted', label: 'Accepted suggestions', kind: 'atLeast', source: 'Usage metrics: code acceptances' },
    { id: 'copilotActive', label: 'Active within', kind: 'within', source: 'Seats: last activity' },
  ],
  // Codex Analytics covers the CLI, IDE extension and app. It lists only
  // people who used Codex: anyone missing counts as no use.
  codex: [
    { id: 'codexUsedWithin', label: 'Used Codex within', kind: 'within', source: 'Codex usage: latest day with turns' },
    { id: 'codexActiveDays', label: 'Active days', kind: 'atLeast', source: 'Codex usage: days with turns' },
    { id: 'codexTurns', label: 'Turns', kind: 'atLeast', source: 'Codex usage: turns per user' },
  ],
};

export function vendorField(measure) {
  return Object.values(VENDOR_RULE_FIELDS).flat().find((field) => field.id === measure) || null;
}

// The product a measure belongs to (e.g. postmanSignedIn -> postman).
export function productOfMeasure(measure) {
  return Object.entries(VENDOR_RULE_FIELDS).find(([, fields]) => fields.some((field) => field.id === measure))?.[0] || null;
}
