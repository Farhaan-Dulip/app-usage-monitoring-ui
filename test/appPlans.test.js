import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPlan, loadPlan, normalizePlan, planError, planSummary, plansMonthlyCost, webUrlError } from '../src/utils/appPlans.js';

const valid = { ...emptyPlan(), planName: 'Team', seats: '50', monthlyCost: '1250' };

test('a named plan with seats can be saved', () => {
  assert.equal(planError(valid), '');
});

test('plan name and whole seats are required', () => {
  assert.equal(planError({ ...valid, planName: '  ' }), 'Enter a plan name.');
  assert.equal(planError({ ...valid, seats: '' }), 'Enter a whole number of seats.');
  assert.equal(planError({ ...valid, seats: '2.5' }), 'Enter a whole number of seats.');
  assert.equal(planError({ ...valid, seats: '0' }), 'Enter a whole number of seats.');
});

test('monthly cost is required; dates and notice are checked when entered', () => {
  assert.equal(planError({ ...valid, monthlyCost: '' }), 'Enter the monthly cost.');
  assert.equal(planError({ ...valid, monthlyCost: '-1' }), 'Enter the monthly cost.');
  assert.equal(
    planError({ ...valid, startDate: '2026-11-07', renewalDate: '2026-11-07' }),
    'Renewal date must be after the start date.'
  );
  assert.equal(planError({ ...valid, noticeDays: '1.5' }), 'Enter notice as a whole number of days.');
  assert.equal(planError({ ...valid, startDate: '2026-01-01', renewalDate: '2027-01-01', noticeDays: '30' }), '');
});

test('saved plans hold numbers and keep blank notice blank', () => {
  const plan = normalizePlan({ ...valid, planName: ' Team ', noticeDays: '30' });
  assert.equal(plan.planName, 'Team');
  assert.equal(plan.seats, 50);
  assert.equal(plan.monthlyCost, 1250);
  assert.equal(plan.noticeDays, 30);
  assert.equal(normalizePlan(valid).noticeDays, '');
});

test('the list shows missing, free, single and multiple plans', () => {
  assert.deepEqual(planSummary({}), { label: 'Plans missing', missing: true });
  assert.deepEqual(planSummary({ noPlanNeeded: true }), { label: 'Free', missing: false });
  assert.equal(planSummary({ plans: [{ planName: 'Team', seats: 1 }] }).label, 'Team · 1 seat');
  assert.equal(
    planSummary({ plans: [{ planName: 'Team', seats: 50 }, { planName: 'Enterprise', seats: 10 }] }).label,
    '2 plans · 60 seats'
  );
});

test('an app costs the sum of its plans', () => {
  assert.equal(plansMonthlyCost([{ monthlyCost: 1250 }, { monthlyCost: 300.5 }]), 1550.5);
  assert.equal(plansMonthlyCost([]), 0);
});

test('plans saved with a price per seat load with a monthly cost', () => {
  const plan = loadPlan({ id: 'a', planName: 'Team', seats: 50, pricePerSeat: 25 });
  assert.equal(plan.monthlyCost, 1250);
  assert.equal('pricePerSeat' in plan, false);
  assert.equal(loadPlan({ planName: 'Team', seats: 5, pricePerSeat: '' }).monthlyCost, '');
  assert.equal(loadPlan({ planName: 'Team', seats: 5, monthlyCost: 90 }).monthlyCost, 90);
});

test('a web URL is optional and must look like an address', () => {
  for (const url of ['', 'claude.ai', 'https://claude.ai', 'https://app.example.co.uk/chat']) {
    assert.equal(webUrlError(url), '', url);
  }
  for (const url of ['claude', 'not a url', 'https://', 'claude .ai']) {
    assert.equal(webUrlError(url), 'Enter a valid web URL, such as claude.ai.', url);
  }
});
