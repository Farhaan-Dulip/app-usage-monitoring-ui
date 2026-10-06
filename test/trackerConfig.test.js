import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTrackerConfig } from '../src/utils/trackerConfig.js';

const records = [
  { target_pc: 'FARHAN-PC', app_name: 'Postman.exe', type: 'application', parent_app: null,
    reclaim_policy: { evaluation_window_seconds: 3600, worked_threshold_seconds: 60 } },
  { target_pc: 'FARHAN-PC', app_name: 'github-copilot', type: 'agent', parent_app: 'Code.exe',
    subscriptionType: 'GitHub Copilot', license_cost: 19, reclaim_policy: {} },
  { target_pc: 'OTHER-PC', app_name: 'idea64.exe', type: 'application', parent_app: null },
];

test('returns null when nothing is deployed', () => {
  assert.equal(deriveTrackerConfig([], null, 'ANY'), null);
});

test('uses the current PC records with lower-cased app names the Tracker reports', () => {
  const config = deriveTrackerConfig(records, { tracked_urls: ['https://example.com'] }, 'farhan-pc');
  assert.deepEqual(config.licensed_apps, ['postman.exe']);
  assert.equal(config.licensed_app_policies['postman.exe'].evaluation_window_seconds, 3600);
  assert.equal(config.licensed_app_types['postman.exe'], 'application');
  assert.deepEqual(config.extensions.map((e) => [e.name, e.parent_app, e.type]), [['github-copilot', 'code.exe', 'agent']]);
  assert.deepEqual(config.tracked_urls, ['https://example.com']);
});

test('falls back to all records when the reporting PC has none', () => {
  const config = deriveTrackerConfig(records, null, 'AT-NB-FARHAND');
  assert.deepEqual(config.licensed_apps.sort(), ['idea64.exe', 'postman.exe']);
  assert.deepEqual(config.tracked_urls, []);
});
