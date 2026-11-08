// What happens when a seat violates its policy, decided by the policy's action.
//
// - Prior Alert: send an alert asking for a business justification. After
//   three alerts with no justification, the workflow moves on to a reclaim.
// - Downsize and Reclaim: never act on their own. Each becomes a request that
//   waits for the licence owner to approve it.
//
// Nothing is changed here. This decides the next step; the caller records it.

export const POLICY_ACTIONS = ['Prior Alert', 'Downsize', 'Reclaim'];
export const MAX_PRIOR_ALERTS = 3;
export const APPROVER = 'licence owner';

// `violated`: the latest check broke the policy. `justified`: the user gave a
// business justification, so the alerts stop. `alertsSent`: alerts already sent.
export function nextWorkflowStep({ action, violated, justified = false, alertsSent = 0 }) {
  if (!POLICY_ACTIONS.includes(action)) {
    throw new Error(`Unknown policy action: ${action}`);
  }
  if (!violated) return { step: 'none' };
  if (justified) {
    return { step: 'justified', message: 'Business justification received; no change is made.' };
  }

  if (action === 'Prior Alert') {
    if (alertsSent < MAX_PRIOR_ALERTS) {
      const alertNumber = alertsSent + 1;
      return {
        step: 'alert',
        alertNumber,
        message: `Alert ${alertNumber} of ${MAX_PRIOR_ALERTS} sent, asking for a business justification.`,
      };
    }
    return {
      step: 'request',
      action: 'Reclaim',
      approver: APPROVER,
      status: 'pending_approval',
      message: `No justification after ${MAX_PRIOR_ALERTS} alerts. A reclaim request goes to the ${APPROVER} for approval.`,
    };
  }

  return {
    step: 'request',
    action,
    approver: APPROVER,
    status: 'pending_approval',
    message: `A ${action} request goes to the ${APPROVER} for approval.`,
  };
}
