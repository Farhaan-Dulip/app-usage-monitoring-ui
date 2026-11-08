import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadmap, currentObjective } from '../src/utils/requestRoadmap.js';

const base = {
  requesterName: 'Ava Perera',
  requesterEmail: 'ava@corp.com',
  approvingManagerName: 'Ben Silva',
  requestedApp: 'Copilot',
  source: 'chat',
};
const statuses = (request) => buildRoadmap(request).map((objective) => objective.status);

test('a request waiting for approval is at the manager step, after existing access is verified', () => {
  const request = { ...base, status: 'pending_approval' };
  assert.deepEqual(statuses(request), ['done', 'done', 'current', 'pending', 'pending']);
  assert.equal(currentObjective(buildRoadmap(request)).id, 'approval');
});

test('an approved request moves on to the install step', () => {
  const request = { ...base, status: 'approved', targetDevice: { pcName: 'AT-NB-01' } };
  assert.deepEqual(statuses(request), ['done', 'done', 'done', 'current', 'pending']);
  assert.equal(buildRoadmap(request)[4].owner, 'AT-NB-01');
  assert.equal(currentObjective(buildRoadmap(request)).id, 'seat');
});

test('a declined request stops at approval and shows the reason', () => {
  const request = { ...base, status: 'declined', declineReason: 'Not in budget' };
  const roadmap = buildRoadmap(request);
  assert.deepEqual(statuses(request), ['done', 'done', 'failed', 'pending', 'pending']);
  assert.equal(roadmap[2].detail, 'Declined: Not in budget');
  assert.equal(currentObjective(roadmap), null);
});

test('a request waiting for the requester to pick a PC is at the approval step', () => {
  const roadmap = buildRoadmap({ ...base, status: 'awaiting_device' });
  assert.equal(roadmap[2].status, 'current');
  assert.equal(roadmap[2].detail, 'Waiting for the requester to choose a PC');
});

test('the verify objective is named for existing access and has no sub-roadmap', () => {
  const roadmap = buildRoadmap({ ...base, status: 'pending_approval' });
  assert.equal(roadmap[1].id, 'verify');
  assert.equal(roadmap[1].title, 'Verify existing access & eligibility');
  assert.equal(roadmap[1].subflows, undefined);
});

test('a new request is still checking existing access before approval', () => {
  const roadmap = buildRoadmap({ ...base, status: 'new' });
  assert.equal(currentObjective(roadmap).id, 'verify');
});

test('an email request says where it came from', () => {
  assert.equal(buildRoadmap({ ...base, source: 'email', status: 'pending_approval' })[0].detail, 'Raised by the AI agent from email');
});
