import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUDGETS,
  PeopleError,
  buildPeopleReport,
  getBudgets,
  parseCsv,
  parseDirectoryCsv,
  setBudget,
} from '../services/aiTools/people.js';
import { featureGroup, normalizeCopilot } from '../services/aiTools/copilot.js';
import { normalizeClaude } from '../services/aiTools/claude.js';

const now = new Date('2026-10-19T12:00:00Z');

test('CSV parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('directory CSV maps common HR/Entra headers and skips bad emails', () => {
  const csv = "﻿Email,Employee ID,Manager's Name,Department,Display Name\nA@Corp.com,1305525,\"Desai, D\",Platform,Ava\nnot-an-email,1,x,y,z\n";
  const { people, rejectedRows } = parseDirectoryCsv(csv);
  assert.deepEqual(people, [{ email: 'a@corp.com', name: 'Ava', employeeId: '1305525', managerName: 'Desai, D', managerEmail: '', department: 'Platform' }]);
  assert.deepEqual(rejectedRows, [3]);
  assert.throws(() => parseDirectoryCsv('Name\nAva'), PeopleError);
});

function memoryBudgets() {
  const rows = [];
  return {
    rows,
    find: () => ({ limit: () => ({ toArray: async () => rows }) }),
    async updateOne(filter, update) {
      const existing = rows.find((row) => row.vendor === filter.vendor && row.email === filter.email);
      if (existing) Object.assign(existing, update.$set);
      else rows.push({ ...update.$set });
    },
    async deleteMany(filter) {
      const index = rows.findIndex((row) => row.vendor === filter.vendor && row.email === filter.email);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

test('budgets: default per tool, per-person override, removal, validation', async () => {
  const collection = memoryBudgets();
  await setBudget(collection, { vendor: 'claude', email: '*', monthlyBudget: 150 });
  await setBudget(collection, { vendor: 'claude', email: 'A@corp.com', monthlyBudget: '40' });
  let budgets = await getBudgets(collection);
  assert.equal(budgets.defaults.claude, 150);
  assert.equal(budgets.defaults.copilot, DEFAULT_BUDGETS.copilot);
  assert.equal(budgets.perPerson['a@corp.com'].claude, 40);
  await setBudget(collection, { vendor: 'claude', email: 'a@corp.com', monthlyBudget: null });
  budgets = await getBudgets(collection);
  assert.equal(budgets.perPerson['a@corp.com'], undefined);
  await assert.rejects(setBudget(collection, { vendor: 'slack', email: '*', monthlyBudget: 1 }), PeopleError);
  await assert.rejects(setBudget(collection, { vendor: 'claude', email: '*', monthlyBudget: -5 }), PeopleError);
  await assert.rejects(setBudget(collection, { vendor: 'claude', email: '*', monthlyBudget: null }), PeopleError);
});

test('people report: spend vs budget flags, directory data, manager roll-up', () => {
  const overview = {
    vendors: [
      { id: 'claude', name: 'Claude', mode: 'live', spendUnit: 'USD', members: [
        { email: 'a@corp.com', name: 'Ava', mtdSpend: 120, status: 'active' },
        { email: 'b@corp.com', name: 'Ben', mtdSpend: 5, status: 'active' },
      ] },
      { id: 'copilot', name: 'GitHub Copilot', mode: 'live', spendUnit: 'AI credits', members: [
        { email: 'a@corp.com', login: 'ava', name: 'ava', mtdSpend: 50, pattern: 'Inline (60%)', agenticIndex: 30, plan: 'enterprise' },
        { email: null, login: 'unmapped', name: 'unmapped', mtdSpend: 99 },
      ] },
    ],
  };
  const directory = [{ email: 'a@corp.com', employeeId: '1305525', managerName: 'Desai, D', department: 'Platform' }];
  const report = buildPeopleReport(overview, directory, { defaults: { claude: 100, copilot: 100 }, perPerson: { 'b@corp.com': { claude: 10 } } });

  const ava = report.people.find((person) => person.email === 'a@corp.com');
  assert.equal(ava.employeeId, '1305525');
  assert.equal(ava.managerName, 'Desai, D');
  assert.equal(ava.tools.claude.flag, 'over');
  assert.equal(ava.tools.claude.budgetIsDefault, true);
  assert.equal(ava.tools.copilot.pattern, 'Inline (60%)');
  const ben = report.people.find((person) => person.email === 'b@corp.com');
  assert.equal(ben.tools.claude.budget, 10);
  assert.equal(ben.tools.claude.flag, 'ok');
  assert.equal(ben.managerName, '');
  // Copilot seats without an email mapping are not attributed to anyone.
  assert.equal(report.people.length, 2);
  // People with a manager come first.
  assert.deepEqual(report.people.map((person) => person.email), ['a@corp.com', 'b@corp.com']);

  const desai = report.managers.find((team) => team.managerName === 'Desai, D');
  assert.deepEqual([desai.people, desai.tools.claude.spend, desai.tools.claude.over], [1, 120, 1]);
  assert.ok(report.managers.some((team) => team.managerName === 'No manager on record'));
  assert.equal(report.directoryImported, true);
});

test('Copilot: feature groups, consumption pattern, agentic index, month-to-date credits', () => {
  assert.deepEqual(['code_completion', 'chat_inline', 'chat_panel_ask_mode', 'chat_panel_agent_mode', 'agent_edit'].map(featureGroup),
    ['Inline', 'Inline', 'Chat', 'Agent', 'Agent']);
  const raw = {
    billing: {},
    seats: [{ assignee: { login: 'ava' }, last_activity_at: '2026-10-18T00:00:00Z' }],
    report: { records: [{
      user_login: 'ava',
      day_totals: [
        { day: '2026-09-30', ai_credits_used: 9, used_agent: false, code_generation_activity_count: 10,
          totals_by_feature: [{ feature: 'code_completion', code_generation_activity_count: 10 }] },
        { day: '2026-10-02', ai_credits_used: 2.5, used_agent: true, code_generation_activity_count: 10,
          totals_by_feature: [{ feature: 'code_completion', code_generation_activity_count: 6 }, { feature: 'chat_panel_agent_mode', code_generation_activity_count: 4 }] },
      ],
    }] },
  };
  const [ava] = normalizeCopilot(raw, now).members;
  assert.equal(ava.mtdSpend, 2.5);
  assert.equal(ava.pattern, 'Inline (80%)');
  // 50 * (4/20 agent share) + 50 * (1 of 2 active days used an agent) = 10 + 25
  assert.equal(ava.agenticIndex, 35);
});

test('Claude: month-to-date spend counts only this month', () => {
  const raw = {
    users: [{ id: 'u', email: 'a@corp.com', name: 'A' }],
    costBuckets: [],
    claudeCode: [
      { actor: { type: 'user_actor', email_address: 'a@corp.com' }, date: '2026-09-29T00:00:00Z', core_metrics: { num_sessions: 1 }, model_breakdown: [{ estimated_cost: { amount: 500 } }] },
      { actor: { type: 'user_actor', email_address: 'a@corp.com' }, date: '2026-10-03T00:00:00Z', core_metrics: { num_sessions: 1 }, model_breakdown: [{ estimated_cost: { amount: 120 } }] },
    ],
  };
  const [member] = normalizeClaude(raw, now).members;
  assert.equal(member.mtdSpend, 1.2);
  assert.equal(member.costUsd, 6.2);
});
