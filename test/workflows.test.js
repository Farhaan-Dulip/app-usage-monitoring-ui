import assert from 'node:assert/strict';
import test from 'node:test';
import { seedWorkflows, slugify, validateWorkflow } from '../services/workflows/index.js';

const base = {
  id: 'figma-request',
  name: 'Figma request',
  trigger: { type: 'request' },
  approver: { role: 'app-owner' },
  steps: [
    { title: 'Request raised', owner: 'requester', type: 'raise' },
    { title: 'App owner approves', owner: 'App owner', type: 'approval', status: 'done' },
  ],
};

test('the sample workflows are valid', () => {
  const ids = seedWorkflows().map((workflow) => workflow.id).sort();
  assert.deepEqual(ids, ['policy-reclaim', 'xyz-tool-request']);
});

test('a valid workflow is cleaned: step ids, not-started statuses, stop on decline', () => {
  const workflow = validateWorkflow(base);
  assert.deepEqual(workflow.steps.map((step) => step.id), ['request-raised', 'app-owner-approves']);
  assert.ok(workflow.steps.every((step) => step.status === 'not-started'));
  assert.equal(workflow.steps[1].onDecline, 'stop');
});

test('duplicate step titles still get unique ids', () => {
  const workflow = validateWorkflow({ ...base, steps: [base.steps[0], base.steps[0]] });
  assert.notEqual(workflow.steps[0].id, workflow.steps[1].id);
});

test('bad input is refused with a reason', () => {
  assert.throws(() => validateWorkflow({ ...base, id: 'Bad Id!' }), /workflow id/);
  assert.throws(() => validateWorkflow({ ...base, name: ' ' }), /name/);
  assert.throws(() => validateWorkflow({ ...base, trigger: { type: 'cron' } }), /trigger/);
  assert.throws(() => validateWorkflow({ ...base, approver: { role: 'ceo' } }), /approver/);
  assert.throws(() => validateWorkflow({ ...base, steps: [] }), /at least one step/);
  assert.throws(() => validateWorkflow({ ...base, steps: [{ title: 'x', type: 'teleport' }] }), /type/);
  assert.throws(() => validateWorkflow({ ...base, steps: [{ title: ' ', type: 'task' }] }), /title/);
});

test('slugify makes an id from a name', () => {
  assert.equal(slugify('XYZ Tool: Request & Approval'), 'xyz-tool-request-approval');
});
