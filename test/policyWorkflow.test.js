import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PRIOR_ALERTS, nextWorkflowStep } from '../src/utils/policyWorkflow.js';

test('no violation means no workflow step', () => {
  assert.equal(nextWorkflowStep({ action: 'Reclaim', violated: false }).step, 'none');
});

test('Prior Alert sends alerts 1 to 3 while the seat is still in use', () => {
  assert.equal(nextWorkflowStep({ action: 'Prior Alert', violated: true, alertsSent: 0 }).alertNumber, 1);
  assert.equal(nextWorkflowStep({ action: 'Prior Alert', violated: true, alertsSent: 2 }).alertNumber, 3);
});

test('the third alert with no justification moves on to a reclaim for the licence owner', () => {
  assert.equal(MAX_PRIOR_ALERTS, 3);
  const step = nextWorkflowStep({ action: 'Prior Alert', violated: true, alertsSent: 3 });
  assert.equal(step.step, 'request');
  assert.equal(step.action, 'Reclaim');
  assert.equal(step.approver, 'licence owner');
  assert.equal(step.status, 'pending_approval');
});

test('a business justification stops the alerts and changes nothing', () => {
  const step = nextWorkflowStep({ action: 'Prior Alert', violated: true, justified: true, alertsSent: 2 });
  assert.equal(step.step, 'justified');
});

test('Downsize and Reclaim always wait for the licence owner to approve', () => {
  for (const action of ['Downsize', 'Reclaim']) {
    const step = nextWorkflowStep({ action, violated: true });
    assert.equal(step.step, 'request');
    assert.equal(step.action, action);
    assert.equal(step.approver, 'licence owner');
    assert.equal(step.status, 'pending_approval');
  }
});

test('an unknown action is refused', () => {
  assert.throws(() => nextWorkflowStep({ action: 'Warning & Alerts', violated: true }), /Unknown policy action/);
});
