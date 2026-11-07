import assert from 'node:assert/strict';
import test from 'node:test';
import { lastSignIns, signInActionCodes, signedInWithin } from '../services/reports/postmanSignIns.js';
import { samplePostman } from '../services/reports/vendorSamples.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
const actions = {
  data: [
    { code: 'user.login_password', name: 'User Logged-In Using Password' },
    { code: 'user.login_sso', name: 'User Logged-In Using SSO' },
    { code: 'user.logout', name: 'User Logged-out' },
    { code: 'user.login_failed', name: 'User Login Failed' },
  ],
};

test('sign-in codes are the actions named "User Logged-In Using …"', () => {
  assert.deepEqual([...signInActionCodes(actions)], ['user.login_password', 'user.login_sso']);
  assert.equal(signInActionCodes(undefined).size, 0);
});

test('last sign-in per person comes from sign-in events only', () => {
  const trails = [
    { action: 'user.login_sso', timestamp: daysAgo(20), data: { actor: { email: 'Ava@corp.com' } } },
    { action: 'user.login_password', timestamp: daysAgo(5), data: { actor: { email: 'ava@corp.com' } } },
    { action: 'user.logout', timestamp: daysAgo(1), data: { actor: { email: 'ava@corp.com' } } },
    { action: 'user.login_failed', timestamp: daysAgo(1), data: { actor: { email: 'ben@corp.com' } } },
  ];
  const latest = lastSignIns(trails, signInActionCodes(actions));
  assert.deepEqual([...latest], [['ava@corp.com', daysAgo(5)]]);
});

test('the policy’s days decide "signed in within"; beyond 180 days the log can’t say', () => {
  const latest = new Map([['ava@corp.com', daysAgo(10)]]);
  assert.equal(signedInWithin(latest, 'AVA@corp.com', 14, NOW), true);
  assert.equal(signedInWithin(latest, 'ava@corp.com', 7, NOW), false);
  assert.equal(signedInWithin(latest, 'ben@corp.com', 14, NOW), false);
  assert.equal(signedInWithin(latest, 'ava@corp.com', 181, NOW), null);
  assert.equal(signedInWithin(latest, '', 14, NOW), null);
});

test('sample data has the shapes Postman documents, and idle people never sign in', () => {
  const raw = samplePostman(NOW, []);
  const codes = signInActionCodes(raw.auditActions);
  assert.ok(codes.size >= 2);
  for (const trail of raw.auditLogs.trails) {
    assert.ok(trail.data.actor.email && trail.timestamp && trail.action);
    assert.ok(NOW.getTime() - Date.parse(trail.timestamp) <= 181 * 86400000);
  }
  const latest = lastSignIns(raw.auditLogs.trails, codes);
  assert.ok(latest.size > 0 && latest.size < raw.users.data.length, 'some members have no sign-in');
});
