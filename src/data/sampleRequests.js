// Sample license requests for Request Approvals, shown only while Sample data
// is on. Fictional people and PCs; each one sits in a different roadmap state.
export function sampleRequests(now = Date.now()) {
  const ago = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const base = (id, fields) => ({
    id: `sample-${id}`,
    sample: true,
    approvingManagerName: 'Maya Fernando',
    approvingManagerEmail: 'maya.fernando@example.com',
    candidateDevices: [],
    declineReason: '',
    source: 'chat',
    targetDevice: null,
    ...fields,
  });
  return [
    // A Claude seat the policy rules flagged for reclaim, waiting for the
    // manager to approve it. The modal shows the rules and the reasons.
    base('claude-reclaim', {
      kind: 'Reclaim',
      requesterName: 'Kasun Perera',
      requesterEmail: 'kasun.perera@example.com',
      requestedApp: 'Claude licence reclaim',
      reason: 'System detected low use of this Claude seat against the Claude usage policy.',
      status: 'pending_approval',
      source: 'system',
      createdAt: ago(2),
      targetDevice: { pcName: 'SAMPLE-ENG-07' },
      roadmap: [
        { id: 'flagged', title: 'Low use detected for Claude licence', owner: 'AllionOne', detail: '1.2h active in 30 days; 2 of 3 policy rules not met', status: 'done' },
        { id: 'justify', title: 'Alert & justification', owner: 'Kasun Perera', detail: '3 alerts sent, no justification given', status: 'done' },
        { id: 'approval', title: 'Manager approves reclaim', owner: 'Maya Fernando', detail: 'Waiting for the manager to decide', status: 'current' },
        { id: 'reclaim', title: 'Seat reclaimed', owner: 'Licence owners', detail: 'Seat freed for reassignment', status: 'pending' },
      ],
      reclaim: {
        policy: 'Claude · Engineering usage policy',
        period: 'Checked over the last 30 days',
        rules: [
          { label: 'Active time on the PC', target: 'at least 8h', actual: '1.2h', met: false },
          { label: 'Used Claude Code within', target: '7 days', actual: 'last used 41 days ago', met: false },
          { label: 'Signed in within', target: '30 days', actual: 'signed in 12 days ago', met: true },
        ],
        reasons: [
          'Active time was 1.2 hours in 30 days, well under the 8-hour minimum.',
          'No Claude Code use for 41 days, so the seat adds nothing to their work.',
          'Three low-use alerts were sent and no business justification came back.',
        ],
        saving: '$25 a month',
      },
    }),
    base('copilot-waiting', {
      requesterName: 'Nimali Silva',
      requesterEmail: 'nimali.silva@example.com',
      requestedApp: 'GitHub Copilot',
      reason: 'I need it for the payments service refactor this sprint.',
      status: 'pending_approval',
      createdAt: ago(3),
      targetDevice: { pcName: 'SAMPLE-ENG-04' },
    }),
    base('figma-approved', {
      requesterName: 'Kasun Perera',
      requesterEmail: 'kasun.perera@example.com',
      requestedApp: 'Figma',
      reason: 'Design reviews for the onboarding flow.',
      status: 'approved',
      createdAt: ago(30),
      targetDevice: { pcName: 'SAMPLE-DESIGN-03' },
    }),
    base('zoom-declined', {
      requesterName: 'Ravi Kumar',
      requesterEmail: 'ravi.kumar@example.com',
      requestedApp: 'Zoom',
      reason: 'Client calls on the second monitor.',
      status: 'declined',
      declineReason: 'Teams already covers client calls for this team.',
      createdAt: ago(52),
      targetDevice: { pcName: 'SAMPLE-SALES-01' },
    }),
    base('codex-choose-pc', {
      requesterName: 'Ayesha Rahman',
      requesterEmail: 'ayesha.rahman@example.com',
      requestedApp: 'Codex',
      reason: 'Trying Codex for the data pipeline tickets.',
      status: 'awaiting_device',
      createdAt: ago(8),
      candidateDevices: [{ pcName: 'SAMPLE-ENG-06' }, { pcName: 'SAMPLE-QA-03' }],
    }),
  ].map((request) => ({ ...request, _id: request.id }));
}

// Sample onboarding and offboarding workflows: the apps and licences a person
// gets from their role and project, and the revocation when they leave. Each
// carries its own roadmap, so the page shows them as they would run.
export function sampleWorkflows(now = Date.now()) {
  const ago = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const step = (id, title, owner, detail, status) => ({ id, title, owner, detail, status });
  return [
    {
      id: 'sample-onboarding-ravi',
      _id: 'sample-onboarding-ravi',
      sample: true,
      kind: 'Onboarding',
      requesterName: 'Ravi Kumar',
      requesterEmail: 'ravi.kumar@example.com',
      requestedApp: 'New joiner: Ravi Kumar',
      reason: 'Backend Engineer · Payments project',
      badge: 'Waiting for manager',
      status: 'workflow',
      createdAt: ago(5),
      roadmap: [
        step('hire', 'HR hire recorded', 'HR system', 'Start date 10 Nov 2026', 'done'),
        step('bundle', 'Role and project resolved', 'Workflow engine', 'Backend Engineer · Payments: 3 apps, 2 licences', 'done'),
        {
          ...step('approve', 'Manager approves each app', 'Maya Fernando', 'Postman approved, Copilot waiting', 'partial'),
          branchSide: 'left',
          subflows: [
            {
              id: 'copilot',
              title: 'GitHub Copilot',
              owner: 'Maya Fernando',
              steps: [
                { id: 'copilot-raise', title: 'Raise request for Copilot', owner: 'Ravi Kumar', detail: 'Licence request raised for the project', status: 'done' },
                { id: 'copilot-approve', title: 'Manager approves Copilot', owner: 'Maya Fernando', detail: 'Waiting for the manager', status: 'current' },
                { id: 'copilot-assign', title: 'Licence assigned', owner: 'Licence owners', detail: 'GitHub Copilot seat', status: 'pending' },
              ],
            },
            {
              id: 'postman',
              title: 'Postman',
              owner: 'Maya Fernando',
              steps: [
                { id: 'postman-raise', title: 'Raise request for Postman', owner: 'Ravi Kumar', detail: 'Licence request raised for the project', status: 'done' },
                { id: 'postman-approve', title: 'Manager approves Postman', owner: 'Maya Fernando', detail: 'Approved', status: 'done' },
                { id: 'postman-assign', title: 'Licence assigned', owner: 'Licence owners', detail: 'Postman seat assigned', status: 'done' },
              ],
            },
          ],
        },
        {
          ...step('licences', 'Licences and tracker', 'Licence owners', 'Licences first, then the tracker goes on the PC', 'current'),
          subflows: [
            {
              id: 'licence-tracker',
              title: 'Postman licence and tracker',
              owner: 'Licence owners',
              steps: [
                { id: 'postman-received', title: 'Postman licence received', owner: 'Licence owners', detail: 'Postman seat received', status: 'done' },
                { id: 'tracker-deploying', title: 'Tracker is deploying', owner: 'Deploy Tracker', detail: 'Installing on the PC', status: 'current' },
              ],
            },
          ],
        },
        { ...step('welcome', 'Welcome and access check', 'IT service desk', 'Placeholder: no ticket yet', 'placeholder'), offset: 56 },
      ],
    },
    {
      id: 'sample-offboarding-dilan',
      _id: 'sample-offboarding-dilan',
      sample: true,
      kind: 'Offboarding',
      requesterName: 'Dilan Jayasinghe',
      requesterEmail: 'dilan.jayasinghe@example.com',
      requestedApp: 'Leaver: Dilan Jayasinghe',
      reason: 'QA Engineer · last day 14 Nov 2026',
      badge: 'Revoking licences',
      status: 'workflow',
      createdAt: ago(20),
      roadmap: [
        step('leaver', 'Leaver recorded', 'HR system', 'Last day 14 Nov 2026', 'done'),
        step('exit', 'Manager confirms exit', 'Ben Silva', 'Confirmed', 'done'),
        {
          ...step('revoke', 'Revoke each licence', 'Licence owners', 'Copilot, Figma and Postman each need revoking', 'current'),
          branchDirection: 'down',
          branchSide: 'left',
          subflows: [
            {
              id: 'copilot',
              title: 'GitHub Copilot',
              owner: 'Licence owners',
              steps: [
                { id: 'copilot-request', title: 'Raise revoke request for Copilot', owner: 'Ben Silva', detail: 'Revoke request raised', status: 'done' },
                { id: 'copilot-revoke', title: 'Manager approves revoking Copilot', owner: 'Ben Silva', detail: 'Waiting for the manager', status: 'current' },
                { id: 'copilot-confirm', title: 'Seat confirmed removed', owner: 'IT service desk', detail: 'Seat gone from the account', status: 'pending' },
              ],
            },
            {
              id: 'figma',
              title: 'Figma',
              owner: 'Licence owners',
              steps: [
                { id: 'figma-request', title: 'Raise revoke request for Figma', owner: 'Ben Silva', detail: 'Not started', status: 'pending' },
                { id: 'figma-revoke', title: 'Manager approves revoking Figma', owner: 'Ben Silva', detail: 'Not started', status: 'pending' },
                { id: 'figma-confirm', title: 'Seat confirmed removed', owner: 'IT service desk', detail: 'Seat gone from the account', status: 'pending' },
              ],
            },
          ],
        },
        step('tracker', 'Tracker removed from PC', 'Deploy Tracker', 'Starts once the licences are revoked', 'pending'),
        step('close', 'Access removed and ticket closed', 'IT service desk', 'Placeholder: no ticket yet', 'placeholder'),
      ],
    },
    {
      id: 'sample-project-access-ravi',
      _id: 'sample-project-access-ravi',
      sample: true,
      kind: 'Project access',
      requesterName: 'Ravi Kumar',
      requesterEmail: 'ravi.kumar@example.com',
      requestedApp: 'Project access: Payments',
      reason: 'Raised in the AI assistant: "I need Copilot and Postman for the Payments project"',
      badge: 'Waiting for manager',
      status: 'workflow',
      createdAt: ago(2),
      roadmap: [
        step('raise', 'Request raised in the AI assistant', 'Ravi Kumar', 'Copilot and Postman for the Payments project', 'done'),
        step('project', 'Project apps resolved', 'Workflow engine', 'Payments project: GitHub Copilot, Postman', 'done'),
        {
          ...step('tracker-check', 'Verify tracker and licences', 'Deploy Tracker', 'Not found on the PC · Postman already held', 'done'),
          branchSide: 'left',
          subflows: [
            {
              id: 'tracker-install',
              title: 'Tracker installation',
              owner: 'Deploy Tracker',
              steps: [
                { id: 'tracker-install-run', title: 'Install tracker on the PC', owner: 'Deploy Tracker', detail: 'Installer assignment for the PC', status: 'current' },
                { id: 'tracker-install-confirm', title: 'Tracker confirmed running', owner: 'Deploy Tracker', detail: 'Reports in to the portal', status: 'pending' },
              ],
            },
            {
              id: 'licences-acquired',
              title: 'Licences already acquired',
              owner: 'Licence owners',
              steps: [
                { id: 'access-verifying', title: 'Verifying existing access', owner: 'Licence owners', detail: 'Postman already held, Copilot not held', status: 'current' },
                { id: 'access-finalized', title: 'Finalized access verification', owner: 'Licence owners', detail: 'Confirmed once licences are in place', status: 'pending' },
              ],
            },
          ],
        },
        {
          ...step('approve', 'Manager approves each app', 'Maya Fernando', 'Postman approved, Copilot waiting', 'partial'),
          branchSide: 'right',
          subflows: [
            {
              id: 'copilot',
              title: 'GitHub Copilot',
              owner: 'Maya Fernando',
              steps: [
                { id: 'copilot-raise', title: 'Raise request for Copilot', owner: 'Ravi Kumar', detail: 'Licence request raised for the project', status: 'done' },
                { id: 'copilot-approve', title: 'Manager approves Copilot', owner: 'Maya Fernando', detail: 'Waiting for the manager', status: 'current' },
                { id: 'copilot-assign', title: 'Seat allocation', owner: 'Licence owners', detail: 'GitHub Copilot seat', status: 'pending' },
              ],
            },
            {
              id: 'postman',
              title: 'Postman',
              owner: 'Maya Fernando',
              steps: [
                { id: 'postman-raise', title: 'Raise request for Postman', owner: 'Ravi Kumar', detail: 'Licence request raised for the project', status: 'done' },
                { id: 'postman-approve', title: 'Manager approves Postman', owner: 'Maya Fernando', detail: 'Approved', status: 'done' },
                { id: 'postman-assign', title: 'Seat allocation', owner: 'Licence owners', detail: 'Postman seat assigned', status: 'done' },
              ],
            },
          ],
        },
        {
          ...step('licences', 'Licences and tracker', 'Licence owners', 'Licences first, then the tracker goes on the PC', 'current'),
          branchSide: 'left', shareRow: true,
          subflows: [
            {
              id: 'licence-tracker',
              title: 'Postman licence and tracker',
              owner: 'Licence owners',
              steps: [
                { id: 'postman-received', title: 'Postman licence received', owner: 'Licence owners', detail: 'Postman seat received', status: 'done' },
                { id: 'tracker-deploying', title: 'Tracker is deploying', owner: 'Deploy Tracker', detail: 'Installing on the PC', status: 'current' },
              ],
            },
          ],
        },
        { ...step('access', 'Access confirmed', 'IT service desk', 'Placeholder: no ticket yet', 'placeholder'), offset: 56 },
      ],
    },
  ];
}
