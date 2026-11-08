// Objectives of a request, in order, worked out from its status. A request is
// raised, then needs manager approval, then (placeholder) a ServiceNow ticket,
// then the app is installed by the tracker. Each objective is one of:
// done, current (waiting on someone), failed, placeholder or pending.
export const OBJECTIVE_STATUS = {
  done: { label: 'Done', className: 'status-active' },
  current: { label: 'Waiting', className: 'status-observing' },
  failed: { label: 'Stopped', className: 'status-reclaimable' },
  placeholder: { label: 'Placeholder', className: 'status-neutral' },
  partial: { label: 'Partly done', className: 'status-observing' },
  pending: { label: 'Not started', className: 'status-neutral' },
};

export function buildRoadmap(request) {
  const status = request.status;
  const declined = status === 'declined';
  const approved = status === 'approved';
  const choosingDevice = status === 'awaiting_device';
  const waitingApproval = status === 'pending_approval';

  const approval = declined
    ? 'failed'
    : approved
      ? 'done'
      : choosingDevice || waitingApproval
        ? 'current'
        : 'pending';

  // Existing access is checked before the request reaches the manager.
  const verified = declined || approved || choosingDevice || waitingApproval;
  const verifyStatus = verified ? 'done' : 'current';

  return [
    {
      id: 'raised',
      title: 'Request raised',
      owner: request.requesterName,
      detail: request.source === 'email' ? 'Raised by the AI agent from email' : 'Raised in the AI assistant',
      status: 'done',
    },
    {
      id: 'verify',
      title: 'Verify existing access & eligibility',
      owner: 'Licence owners',
      detail: verified ? 'Existing access checked' : 'Checking existing access before approval',
      status: verifyStatus,
    },
    {
      id: 'approval',
      title: 'Manager approval',
      owner: request.approvingManagerName,
      detail: declined
        ? `Declined: ${request.declineReason || 'no reason given'}`
        : choosingDevice
          ? 'Waiting for the requester to choose a PC'
          : waitingApproval
            ? 'Waiting for the manager to decide'
            : approved
              ? 'Approved'
              : 'Not started',
      status: approval,
    },
    {
      id: 'seat',
      title: 'Seat allocation',
      owner: 'Licence owners',
      detail: declined ? 'Not needed' : approved ? 'Assigning the seat to the requester' : 'Starts after approval',
      status: declined ? 'pending' : approved ? 'current' : 'pending',
    },
    {
      id: 'deploy',
      title: 'Update & deploy tracker',
      owner: request.targetDevice?.pcName || 'Deploy Tracker',
      detail: declined ? 'Not needed' : 'Tracker config sent once the seat is assigned',
      status: 'pending',
    },
  ];
}

// The objective the request is waiting on, or null when it has finished.
export function currentObjective(roadmap) {
  return roadmap.find((objective) => objective.status === 'current') || null;
}
