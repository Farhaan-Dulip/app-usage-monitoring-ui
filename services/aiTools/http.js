// Small JSON-over-HTTPS helper for the AI tool vendor connectors.

export class VendorApiError extends Error {
  constructor(vendor, message, status) {
    super(`${vendor}: ${message}`);
    this.status = status;
  }
}

export async function getJson(fetchImpl, vendor, url, headers = {}, timeoutMs = 20000) {
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new VendorApiError(vendor, `request failed (${error.message})`);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || body?.detail || (typeof body?.error === 'string' ? body.error : '') || text.slice(0, 200) || response.statusText;
    throw new VendorApiError(vendor, `HTTP ${response.status} from ${new URL(url).pathname}: ${detail}`, response.status);
  }
  return body ?? text;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function lastDays(now, days) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => isoDay(today - (days - 1 - index) * DAY_MS));
}

// First day of the current UTC month (YYYY-MM-DD) and days elapsed in it.
export function monthStart(now) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

export function daysIntoMonth(now) {
  return now.getUTCDate();
}

export function daysSince(value, now) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : Math.floor((now.getTime() - time) / DAY_MS);
}

// "active" within idleDays, "idle" beyond it, "never" when no activity is known.
export function activityStatus(lastActiveAt, now, idleDays) {
  const age = daysSince(lastActiveAt, now);
  if (age === null) return 'never';
  return age <= idleDays ? 'active' : 'idle';
}
