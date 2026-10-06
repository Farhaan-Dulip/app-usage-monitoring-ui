// IPv4 allow-list for the portal, enforced by a CloudFront viewer-request function.

export interface Ipv4Range {
  cidr: string;
  start: number;
  size: number;
}

export function parseIpv4Cidr(cidr: string): Ipv4Range {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(cidr.trim());
  if (!match) throw new Error(`allowedCidrs: "${cidr}" is not an IPv4 address or CIDR`);
  const octets = match.slice(1, 5).map(Number);
  const prefix = match[5] === undefined ? 32 : Number(match[5]);
  if (octets.some((octet) => octet > 255) || prefix > 32) throw new Error(`allowedCidrs: "${cidr}" is out of range`);
  const address = octets.reduce((value, octet) => value * 256 + octet, 0);
  const size = 2 ** (32 - prefix);
  return { cidr, start: address - (address % size), size };
}

// CloudFront Functions (cloudfront-js-2.0) viewer-request handler. Paths under
// deniedPathPrefixes are refused for everyone (internal-only endpoints on an
// origin that has no private network path to keep them off the internet).
export function ipAllowListCode(ranges: Ipv4Range[], deniedPathPrefixes: string[] = []): string {
  const allowed = JSON.stringify(ranges.map(({ start, size }) => [start, size]));
  const denied = JSON.stringify(deniedPathPrefixes.map((prefix) => prefix.toLowerCase()));
  return `
var ALLOWED = ${allowed};
var DENIED_PATHS = ${denied};
function toNumber(ip) {
  var parts = String(ip).split('.');
  if (parts.length !== 4) return -1;
  var value = 0;
  for (var i = 0; i < 4; i++) {
    var octet = parseInt(parts[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return -1;
    value = value * 256 + octet;
  }
  return value;
}
function deny(message) {
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: { 'content-type': { value: 'text/plain' } },
    body: { encoding: 'text', data: message }
  };
}
function handler(event) {
  var uri = String(event.request.uri || '').toLowerCase();
  for (var d = 0; d < DENIED_PATHS.length; d++) {
    if (uri.indexOf(DENIED_PATHS[d]) === 0) return deny('Not available through the public endpoint.');
  }
  var ip = toNumber(event.viewer.ip);
  for (var i = 0; i < ALLOWED.length; i++) {
    if (ip >= ALLOWED[i][0] && ip < ALLOWED[i][0] + ALLOWED[i][1]) return event.request;
  }
  return deny('This POC portal is restricted to approved networks.');
}`;
}
