// Reclaim-policy conversions shared by the portal UI (Deploy screen) and the
// server (approved license requests): portal policies are edited in days,
// hours or minutes; the Tracker and deployment records use seconds.

export const DEFAULT_IDLE_THRESHOLD_SECONDS = 4;

export function getPolicyWindowSeconds(value, policy) {
  if (policy.evaluationWindowUnit === 'Minutes') {
    return value * 60;
  }

  if (policy.evaluationWindowUnit === 'Hours') {
    return value * 60 * 60;
  }

  return value * 24 * 60 * 60;
}

export function getEvaluationWindowSeconds(policy) {
  const value = policy.evaluationWindowValue ?? policy.evaluationWindowDays ?? 30;
  return getPolicyWindowSeconds(value, policy);
}

export function getEvaluationWindowDays(policy) {
  return getEvaluationWindowSeconds(policy) / (24 * 60 * 60);
}

function idleThresholdSeconds(policy) {
  return Number(policy.idleThresholdSeconds ?? policy.idle_threshold_seconds ?? DEFAULT_IDLE_THRESHOLD_SECONDS);
}

// The policy written into the Tracker's monitoring-config.json: the app's
// policy (evaluation window and active-time threshold) and the idle threshold
// the Tracker uses to stop counting time. Same shape as the deployment record.
export function buildReclaimPolicy(policy = {}, options = {}) {
  return buildPortalReclaimPolicy(policy, options);
}

// The policy stored on deployment records (what the dashboard evaluates).
export function buildPortalReclaimPolicy(policy, { includeTokenThreshold = false } = {}) {
  return {
    evaluation_window_seconds: getEvaluationWindowSeconds(policy),
    // App rules give the threshold in seconds; older policies gave it in the window's unit.
    worked_threshold_seconds:
      Number(policy.workedThresholdSeconds) > 0
        ? Number(policy.workedThresholdSeconds)
        : getPolicyWindowSeconds(policy.workedThresholdHours, policy),
    idle_threshold_seconds: idleThresholdSeconds(policy),
    ...(includeTokenThreshold ? { token_threshold: 0 } : {}),
  };
}
