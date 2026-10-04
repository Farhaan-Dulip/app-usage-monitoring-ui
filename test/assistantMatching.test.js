import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appAliasFilter,
  buildAppAliases,
  isExplicitLicenseRequest,
  normalizeAppName,
  recordMatchesAliases,
} from '../services/assistantMatching.js';

const inventory = [
  { appName: 'Postman', processName: 'Postman.exe' },
  { appName: 'VS Code', processName: 'code.exe' },
];

test('normalizes case and .exe suffix', () => {
  assert.equal(normalizeAppName(' Postman.EXE '), 'postman');
  assert.equal(normalizeAppName(undefined), '');
});

test('display name resolves to the process name used in decisions', () => {
  const aliases = buildAppAliases('VS Code', inventory);
  assert.deepEqual(aliases.sort(), ['code', 'vs code']);
  assert.ok(recordMatchesAliases({ app_name: 'code.exe' }, aliases));
});

test('process name resolves to the display name used in inventory', () => {
  const aliases = buildAppAliases('postman.exe', inventory);
  assert.ok(recordMatchesAliases({ appName: 'Postman' }, aliases));
  assert.ok(recordMatchesAliases({ app_name: 'postman.exe' }, aliases));
  assert.ok(!recordMatchesAliases({ app_name: 'code.exe' }, aliases));
});

test('unknown apps only match themselves', () => {
  assert.deepEqual(buildAppAliases('Figma', inventory), ['figma']);
});

test('Mongo alias filter matches with and without .exe and escapes regex characters', () => {
  const filter = appAliasFilter(['postman', 'c++ builder']);
  const patterns = filter.$or[0].appName.$in;
  assert.ok(patterns[0].test('Postman.exe'));
  assert.ok(patterns[0].test('postman'));
  assert.ok(!patterns[0].test('postmanager'));
  assert.ok(patterns[1].test('C++ Builder'));
  assert.equal(filter.$or.length, 4);
});

test('explicit license requests are detected', () => {
  [
    'Submit a request for a Postman license.',
    'Please create a license request for Postman',
    'I want to request a Postman license',
    'Request a Postman seat',
    'Can you submit a request for Postman access?',
  ].forEach((question) => assert.ok(isExplicitLicenseRequest(question), question));
});

test('questions that mention requests do not create requests', () => {
  [
    'Which license requests are pending for Postman?',
    'How many Postman licenses can I request?',
    'Is there any license available for Postman?',
    'Show my Postman license request status',
    'Submit the report for Postman',
    '',
  ].forEach((question) => assert.ok(!isExplicitLicenseRequest(question), question));
});
