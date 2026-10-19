// People view for the AI Tools page: who each tool user is (employee ID,
// manager, department), their monthly budget per tool, and month-to-date spend
// against it, rolled up by manager.
//
// Directory: imported from a CSV export (HR system or Entra ID) into
// `ai_people_directory`. Until something is imported, fictional sample people
// get a sample directory; real people without a directory row show "Not set".
// Budgets: `ai_tool_budgets`, a default per tool plus per-person overrides, in
// the tool's spend unit (Claude USD, Codex credits, Copilot AI credits).

// Starting defaults per tool, per person per month (changeable in the portal).
import { SAMPLE_NAMES } from './sampleData.js';

export const DEFAULT_BUDGETS = { claude: 100, codex: 200, copilot: 80 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PeopleError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '').replace(/^﻿/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

// Header names accepted for each directory field (case and spacing ignored).
const COLUMNS = {
  email: ['email', 'mail', 'work email', 'userprincipalname', 'upn'],
  name: ['name', 'display name', 'displayname', 'full name', 'employee name'],
  employeeId: ['employee id', 'employeeid', 'employee number', 'staff id'],
  managerName: ["manager's name", 'manager name', 'manager'],
  managerEmail: ['manager email', 'manager mail', 'manager upn'],
  department: ['department', 'team', 'business unit'],
};

export function parseDirectoryCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new PeopleError('The CSV is empty.', 400);
  const key = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const positions = Object.fromEntries(
    Object.entries(COLUMNS).map(([field, names]) => [field, header.findIndex((cell) => names.includes(key(cell)))])
  );
  if (positions.email < 0) throw new PeopleError('The CSV needs an Email column.', 400);
  const people = [];
  const rejected = [];
  rows.forEach((cells, index) => {
    const value = (field) => (positions[field] >= 0 ? String(cells[positions[field]] || '').trim() : '');
    const email = value('email').toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      rejected.push(index + 2);
      return;
    }
    people.push({
      email,
      name: value('name'),
      employeeId: value('employeeId'),
      managerName: value('managerName'),
      managerEmail: value('managerEmail').toLowerCase(),
      department: value('department'),
    });
  });
  return { people, rejectedRows: rejected };
}

export async function importDirectory(collection, people, now = new Date()) {
  for (const person of people) {
    await collection.updateOne(
      { email: person.email },
      { $set: { ...person, source: 'import', updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  }
  return people.length;
}

// Fictional directory rows for the fictional sample people (example.com).
const SAMPLE_MANAGERS = [
  { managerName: 'Priya Ranasinghe', managerEmail: 'priya.ranasinghe@example.com', department: 'Platform Engineering' },
  { managerName: 'Daniel Mendis', managerEmail: 'daniel.mendis@example.com', department: 'Product Engineering' },
];
function sampleDirectoryRow(email, index) {
  return {
    email,
    name: SAMPLE_NAMES[email] || '',
    employeeId: String(1300100 + index * 37),
    ...SAMPLE_MANAGERS[index % SAMPLE_MANAGERS.length],
    source: 'sample',
  };
}

export async function getBudgets(collection) {
  const rows = await collection.find({}).limit(10000).toArray();
  const defaults = { ...DEFAULT_BUDGETS };
  const perPerson = {};
  for (const row of rows) {
    if (row.email === '*') defaults[row.vendor] = row.monthlyBudget;
    else (perPerson[row.email] ||= {})[row.vendor] = row.monthlyBudget;
  }
  return { defaults, perPerson };
}

// email '*' sets the tool's default; monthlyBudget null removes an override.
export async function setBudget(collection, { vendor, email, monthlyBudget }, now = new Date()) {
  if (!Object.hasOwn(DEFAULT_BUDGETS, vendor)) throw new PeopleError('Unknown tool.', 400);
  const target = email === '*' ? '*' : String(email || '').trim().toLowerCase();
  if (target !== '*' && !EMAIL_PATTERN.test(target)) throw new PeopleError('A valid email is required.', 400);
  if (monthlyBudget === null || monthlyBudget === '') {
    if (target === '*') throw new PeopleError('The default budget cannot be removed.', 400);
    await collection.deleteMany({ vendor, email: target });
    return;
  }
  const amount = Number(monthlyBudget);
  if (!Number.isFinite(amount) || amount < 0) throw new PeopleError('The budget must be zero or more.', 400);
  await collection.updateOne(
    { vendor, email: target },
    { $set: { vendor, email: target, monthlyBudget: amount, updatedAt: now } },
    { upsert: true }
  );
}

// Used / budget: over at 100%+, low under 20% (seat may be worth reclaiming).
function budgetFlag(used) {
  if (used === null) return null;
  if (used >= 1) return 'over';
  if (used >= 0.8) return 'near';
  if (used < 0.2) return 'low';
  return 'ok';
}

export function buildPeopleReport(overview, directoryRows, budgets) {
  const directory = new Map(directoryRows.map((row) => [row.email, row]));
  const people = new Map();
  const person = (email) => {
    if (!people.has(email)) people.set(email, { email, name: '', tools: {} });
    return people.get(email);
  };

  for (const vendor of overview.vendors) {
    for (const member of vendor.members || []) {
      if (!member.email) continue; // Copilot seats without a login-to-email mapping
      const entry = person(member.email);
      if (!entry.name && member.name && member.name !== member.email && member.name !== member.login) entry.name = member.name;
      const override = budgets.perPerson[member.email]?.[vendor.id];
      // Sample data may carry its own per-person budget; a saved override wins.
      const sampleBudget = vendor.mode === 'sample' ? member.sampleBudget : undefined;
      const budget = override ?? sampleBudget ?? budgets.defaults[vendor.id] ?? null;
      const spend = member.mtdSpend ?? 0;
      const used = budget ? spend / budget : null;
      entry.tools[vendor.id] = {
        mode: vendor.mode,
        unit: vendor.spendUnit,
        status: member.status,
        lastActiveAt: member.lastActiveAt,
        budget,
        budgetIsDefault: override === undefined && sampleBudget === undefined,
        spend,
        used,
        flag: budgetFlag(used),
        ...(vendor.id === 'copilot' ? { plan: member.plan, pattern: member.pattern, agenticIndex: member.agenticIndex } : {}),
      };
    }
  }

  let sampleIndex = 0;
  const rows = [...people.values()].map((entry) => {
    const imported = directory.get(entry.email);
    const sample = !imported && entry.email.endsWith('@example.com') ? sampleDirectoryRow(entry.email, sampleIndex++) : null;
    const info = imported || sample || {};
    return {
      ...entry,
      name: info.name || entry.name || entry.email,
      employeeId: info.employeeId || '',
      managerName: info.managerName || '',
      managerEmail: info.managerEmail || '',
      department: info.department || '',
      directorySource: imported ? 'import' : sample ? 'sample' : 'none',
    };
  }).sort((a, b) =>
    // People with a manager first (by manager), then those without one.
    Number(!a.managerName) - Number(!b.managerName) ||
    a.managerName.localeCompare(b.managerName) ||
    a.name.localeCompare(b.name));

  // Manager roll-up: team size and team budget vs spend per tool.
  const managers = new Map();
  for (const row of rows) {
    const key = row.managerName || 'No manager on record';
    const team = managers.get(key) || { managerName: key, managerEmail: row.managerEmail, people: 0, tools: {} };
    team.people += 1;
    for (const [vendorId, tool] of Object.entries(row.tools)) {
      const totals = team.tools[vendorId] || { unit: tool.unit, budget: 0, spend: 0, users: 0, over: 0, low: 0 };
      totals.budget += tool.budget || 0;
      totals.spend += tool.spend || 0;
      totals.users += 1;
      if (tool.flag === 'over') totals.over += 1;
      if (tool.flag === 'low') totals.low += 1;
      team.tools[vendorId] = totals;
    }
    managers.set(key, team);
  }

  return {
    vendors: overview.vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, mode: vendor.mode, unit: vendor.spendUnit })),
    defaults: budgets.defaults,
    people: rows,
    managers: [...managers.values()],
    directoryImported: directoryRows.length > 0,
  };
}
