import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlatformDashboard,
  cleanContract,
  commitmentPace,
  ContractError,
  deleteContract,
  platformOverview,
  PLATFORMS,
  renewalItem,
  saveContract,
  savedContracts,
} from '../services/platforms/index.js';

const NOW = new Date('2026-10-23T08:00:00Z');

function memoryCollection() {
  const docs = [];
  return {
    docs,
    find: () => ({ limit: () => ({ toArray: async () => docs }) }),
    async updateOne(filter, update) {
      const doc = docs.find((entry) => entry.platformId === filter.platformId);
      if (doc) Object.assign(doc, update.$set);
      else docs.push({ ...update.$set });
    },
    async deleteMany(filter) {
      const index = docs.findIndex((entry) => entry.platformId === filter.platformId);
      if (index >= 0) docs.splice(index, 1);
    },
  };
}

test('every platform has the four phase 1 sections with data', () => {
  for (const { id } of PLATFORMS) {
    const dashboard = buildPlatformDashboard(id, { now: NOW });
    assert.deepEqual(dashboard.sections.map((section) => section.id), ['cost', 'insights', 'contract', 'renewals'], id);
    assert.equal(dashboard.mode, 'sample');
    assert.ok(dashboard.summary.mtdCost > 0, `${id} month-to-date cost`);
    assert.ok(dashboard.sections[0].kpis.length >= 3, `${id} cost KPIs`);
    assert.ok(dashboard.renewals.length >= 1, `${id} renewals`);
    for (const section of dashboard.sections) {
      for (const kpi of section.kpis) assert.ok(kpi.value !== undefined && !Number.isNaN(kpi.value), `${id} ${kpi.label}`);
    }
  }
});

test('overview totals add up and renewals are soonest-notice first', () => {
  const overview = platformOverview({ now: NOW });
  const mtd = overview.platforms.reduce((total, platform) => total + platform.mtdCost, 0);
  assert.equal(Math.round(overview.totals.mtdCost), Math.round(mtd));
  const days = overview.renewals.map((item) => item.daysToNotice);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.ok(overview.renewals.every((item) => item.platform));
});

test('renewal status follows the notice deadline', () => {
  const item = (endInDays, noticeDays, autoRenew = false) => renewalItem({ name: 'x', type: 'Contract', endDate: new Date(NOW.getTime() + endInDays * 86400000).toISOString().slice(0, 10), noticeDays, autoRenew }, NOW).status;
  assert.equal(item(200, 30), 'later');
  assert.equal(item(100, 30), 'soon');
  assert.equal(item(40, 30), 'due');
  assert.equal(item(20, 30, true), 'locked', 'notice passed on an auto-renewing contract');
  assert.equal(item(20, 30, false), 'due', 'notice passed but it will not renew on its own');
  assert.equal(item(-5, 0), 'expired');
});

test('commitment pace projects consumption to term end', () => {
  const contract = { commitmentAmount: 1000, currency: 'USD', startDate: '2026-01-01', endDate: '2027-01-01' };
  const half = new Date('2026-07-02T12:00:00Z');
  assert.equal(commitmentPace(contract, 300, half).status, 'under');
  assert.match(commitmentPace(contract, 300, half).message, /unused/);
  assert.equal(commitmentPace(contract, 500, half).status, 'on-track');
  assert.equal(commitmentPace(contract, 700, half).status, 'over');
  assert.equal(commitmentPace(contract, null, half), null);
});

test('contracts are validated before saving', () => {
  assert.throws(() => cleanContract({ startDate: '2026-01-01' }), ContractError);
  assert.throws(() => cleanContract({ startDate: '2026-05-01', endDate: '2026-01-01' }), /after the start date/);
  assert.throws(() => cleanContract({ startDate: '2026-01-01', endDate: '2027-01-01', commitmentAmount: -5 }), /positive number/);
  const clean = cleanContract({ startDate: '2026-01-01', endDate: '2027-01-01', commitmentAmount: '1200', autoRenew: 'true', currency: 'usd', unknown: 'dropped' });
  assert.equal(clean.commitmentAmount, 1200);
  assert.equal(clean.autoRenew, true);
  assert.equal(clean.currency, 'USD');
  assert.equal(clean.unknown, undefined);
});

test('a saved contract replaces the sample one, including API facts', async () => {
  const collection = memoryCollection();
  const sample = buildPlatformDashboard('snowflake', { now: NOW });
  assert.equal(sample.contract.source, 'sample');
  await saveContract(collection, 'snowflake', { agreement: 'Our capacity contract', startDate: '2026-02-01', endDate: '2027-02-01', commitmentAmount: 250000, noticeDays: 60 }, NOW);
  const saved = await savedContracts(collection);
  const dashboard = buildPlatformDashboard('snowflake', { saved, now: NOW });
  assert.equal(dashboard.contract.source, 'saved');
  const contract = dashboard.sections.find((section) => section.id === 'contract');
  assert.equal(contract.kpis.find((kpi) => kpi.label === 'Commitment').value, 250000);
  assert.equal(dashboard.renewals[0].endDate, '2027-02-01');
  await assert.rejects(() => saveContract(collection, 'oracle', { startDate: '2026-01-01', endDate: '2027-01-01' }), /Unknown platform/);
  await deleteContract(collection, 'snowflake');
  assert.equal(buildPlatformDashboard('snowflake', { saved: await savedContracts(collection), now: NOW }).contract.source, 'sample');
});
