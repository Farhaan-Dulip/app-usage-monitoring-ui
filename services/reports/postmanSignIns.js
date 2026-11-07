// Postman last sign-in per user, from the Enterprise audit log.
//
// GET /audit/logs records account and security events, not work in Postman:
// the sign-in events ("User Logged-In Using Password", "...Using SSO",
// "...Using Google OAuth", "...Using OAuth") are the only per-user "last seen"
// signal Postman's API gives. Their action codes come from GET /audit-actions,
// matched by name, so no code is hard-coded here.
//
// Postman keeps audit logs for 180 days, so a sign-in older than that is
// unknown, not absent.

export const POSTMAN_AUDIT_RETENTION_DAYS = 180;

const SIGN_IN_NAME = /^user logged-in using\b/i;

// Action codes whose display name is a sign-in, from GET /audit-actions.
export function signInActionCodes(auditActions) {
  return new Set(
    (auditActions?.data || [])
      .filter((action) => SIGN_IN_NAME.test(String(action.name || '')))
      .map((action) => action.code)
      .filter(Boolean)
  );
}

// The audit log puts the actor under data.actor.
export function trailActor(trail) {
  return trail?.data?.actor || trail?.actor || null;
}

// Latest sign-in time (ISO) per lower-cased email.
export function lastSignIns(trails, signInCodes) {
  const latest = new Map();
  for (const trail of trails || []) {
    if (!signInCodes.has(trail.action)) continue;
    const email = String(trailActor(trail)?.email || '').toLowerCase();
    if (!email || !trail.timestamp) continue;
    if (!latest.has(email) || trail.timestamp > latest.get(email)) latest.set(email, trail.timestamp);
  }
  return latest;
}

// A policy's "Signed in within N days" for one user: true when they signed in
// within N days, false when they didn't, null when the audit log can't say
// (no email, or N beyond what Postman keeps).
export function signedInWithin(latestByEmail, email, days, now = new Date()) {
  const key = String(email || '').toLowerCase();
  if (!key || !(Number(days) > 0) || Number(days) > POSTMAN_AUDIT_RETENTION_DAYS) return null;
  const last = latestByEmail.get(key);
  if (!last) return false;
  return now.getTime() - Date.parse(last) <= Number(days) * 24 * 60 * 60 * 1000;
}
