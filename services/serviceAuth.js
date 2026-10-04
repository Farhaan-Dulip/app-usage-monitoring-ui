import { createHash, timingSafeEqual } from 'crypto';

export const SERVICE_TOKEN_HEADER = 'X-MCP-Service-Token';

// Constant-time comparison; hashing first makes the lengths equal.
export function serviceTokenMatches(provided, expected) {
  if (!expected || typeof provided !== 'string' || !provided) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
