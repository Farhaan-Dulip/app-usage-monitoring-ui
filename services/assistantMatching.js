// App-name matching and request detection shared by the assistant routes.
// Telemetry and evaluation decisions record process names (for example
// `postman.exe`), while inventory and users refer to display names
// (`Postman`), so lookups must consider both.

const APP_NAME_FIELDS = ['appName', 'app_name', 'name', 'application'];

export function normalizeAppName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns every normalized name the requested app is known by: the request
// itself plus the display and process names of matching inventory records.
export function buildAppAliases(appName, inventoryRecords = []) {
  const requested = normalizeAppName(appName);
  const aliases = new Set(requested ? [requested] : []);
  inventoryRecords.forEach((record) => {
    const names = [record?.appName, record?.processName, record?.app_name, record?.name]
      .map(normalizeAppName)
      .filter(Boolean);
    if (names.includes(requested)) names.forEach((name) => aliases.add(name));
  });
  return [...aliases];
}

export function recordMatchesAliases(record, aliases) {
  const aliasSet = new Set(aliases);
  return APP_NAME_FIELDS.some((field) => aliasSet.has(normalizeAppName(record?.[field])));
}

// MongoDB filter matching any alias, with or without a `.exe` suffix, in any
// of the app-name fields used across collections.
export function appAliasFilter(aliases) {
  const patterns = aliases.map((alias) => new RegExp(`^${escapeRegex(alias)}(?:\\.exe)?$`, 'i'));
  return { $or: APP_NAME_FIELDS.map((field) => ({ [field]: { $in: patterns } })) };
}

const QUESTION_START =
  /^(which|what|who|when|where|why|how|list|show|are there|is there|do i|does|did|have i)\b/i;
const REQUEST_INTENT = [
  /\b(submit|create|raise|open|start|file|place)\s+(a\s+|an\s+|my\s+|new\s+)*(license\s+|access\s+|seat\s+)?request\b/i,
  /\b(i\s+(want|need|would\s+like)\s+to\s+request)\b/i,
  /^(please\s+)?request\s+(a|an|access|one)\b/i,
];

// True only for explicit instructions to file a license request, not for
// questions that merely mention requests or licenses.
export function isExplicitLicenseRequest(question) {
  const text = String(question || '').trim();
  if (!text || QUESTION_START.test(text)) return false;
  if (!/\b(license|licence|access|seat)\b/i.test(text)) return false;
  return REQUEST_INTENT.some((pattern) => pattern.test(text));
}
