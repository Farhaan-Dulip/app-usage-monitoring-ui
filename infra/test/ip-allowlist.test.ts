import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipAllowListCode, parseIpv4Cidr } from '../lib/ip-allowlist';

function compile(cidrs: string[]) {
  const code = ipAllowListCode(cidrs.map(parseIpv4Cidr));
  return new Function(`${code}; return handler;`)() as (event: unknown) => unknown;
}

test('allows only listed IPv4 ranges', () => {
  const handler = compile(['175.157.62.175', '10.20.0.0/16']);
  const request = { uri: '/' };
  const allowed = (ip: string) => handler({ viewer: { ip }, request }) === request;
  assert.ok(allowed('175.157.62.175'));
  assert.ok(allowed('10.20.255.1'));
  assert.ok(!allowed('175.157.62.176'));
  assert.ok(!allowed('10.21.0.1'));
  assert.ok(!allowed('2001:db8::1'));
  assert.ok(!allowed('garbage'));
});

test('denied requests get a 403 response', () => {
  const response = compile(['192.0.2.1'])({ viewer: { ip: '198.51.100.7' }, request: {} }) as { statusCode: number };
  assert.equal(response.statusCode, 403);
});

test('normalizes non-aligned CIDRs and rejects bad input', () => {
  assert.deepEqual(parseIpv4Cidr('10.20.30.40/16'), { cidr: '10.20.30.40/16', start: 10 * 2 ** 24 + 20 * 2 ** 16, size: 65536 });
  assert.throws(() => parseIpv4Cidr('300.1.1.1'));
  assert.throws(() => parseIpv4Cidr('10.0.0.0/33'));
  assert.throws(() => parseIpv4Cidr('::1'));
});
