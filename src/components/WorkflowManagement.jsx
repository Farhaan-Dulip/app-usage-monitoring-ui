import { useState } from 'react';
import RequestRoadmap from './RequestRoadmap';
import { sampleRequests, sampleWorkflows } from '../data/sampleRequests';
import { buildRoadmap } from '../utils/requestRoadmap';

// The workflows Request Approvals runs, each with an example request so the
// roadmap shows the same steps, owners and sub-roadmaps as on that page.
function existingWorkflows() {
  const requests = sampleRequests();
  const flows = sampleWorkflows();
  const byKind = (kind) => flows.find((flow) => flow.kind === kind);
  const licenceRequest = requests.find((request) => request.status === 'pending_approval' && !request.roadmap);
  const reclaim = requests.find((request) => request.kind === 'Reclaim');

  return [
    {
      id: 'licence-request',
      name: 'Licence request',
      trigger: 'Access request',
      description: 'An employee asks for one app in the AI assistant or by email. Existing access is verified, the manager approves, then the seat is allocated and the tracker deployed.',
      example: licenceRequest,
      roadmap: buildRoadmap(licenceRequest),
    },
    {
      id: 'project-access',
      name: 'Project access',
      trigger: 'Access request',
      description: 'The apps a project needs, worked out from the request. The tracker and existing licences are checked, then each app is approved and provisioned on its own.',
      example: byKind('Project access'),
    },
    {
      id: 'onboarding',
      name: 'Onboarding',
      trigger: 'New joiner',
      description: 'A new joiner gets the apps and licences for their role and project, each approved and provisioned before their first day.',
      example: byKind('Onboarding'),
    },
    {
      id: 'offboarding',
      name: 'Offboarding',
      trigger: 'Leaver',
      description: 'A leaver’s licences are revoked one by one, each with the manager’s approval, and the seats are freed.',
      example: byKind('Offboarding'),
      offboarding: true,
    },
    {
      id: 'licence-reclaim',
      name: 'Licence reclaim',
      trigger: 'Policy violation',
      description: 'A seat breaks its usage policy. The holder is alerted and asked for a justification, then the licence owner approves the reclaim.',
      example: reclaim,
    },
  ]
    .filter((workflow) => workflow.example)
    .map((workflow) => ({ ...workflow, roadmap: workflow.roadmap || workflow.example.roadmap }));
}

// Workflow Management: the workflows in use, and the roadmap each one runs.
export default function WorkflowManagement() {
  const [workflows] = useState(existingWorkflows);
  const [selectedId, setSelectedId] = useState(workflows[0]?.id || '');
  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];

  return (
    <section className="panel workflow-panel">
      <div className="panel-header">
        <div>
          <h2>Workflow Management</h2>
          <p>The workflows requests and policy violations run through. Choose one to see its roadmap.</p>
        </div>
      </div>

      <div className="workflow-layout">
        <nav className="workflow-list" aria-label="Workflows">
          {workflows.map((workflow) => (
            <button
              aria-current={workflow.id === selected?.id}
              className={workflow.id === selected?.id ? 'workflow-item active' : 'workflow-item'}
              key={workflow.id}
              type="button"
              onClick={() => setSelectedId(workflow.id)}
            >
              <strong>{workflow.name}</strong>
              <small>{workflow.trigger} · {workflow.roadmap.length} steps</small>
            </button>
          ))}
        </nav>

        {selected && (
          <article className={`request-card workflow-card${selected.offboarding ? ' request-card-offboarding' : ''}`}>
            <div className="request-card-head">
              <div>
                <strong>
                  {selected.name}
                  <small className="request-kind-tag">{selected.trigger}</small>
                </strong>
                <small>{selected.description}</small>
                <small className="workflow-example">Example: {selected.example.requestedApp}</small>
              </div>
            </div>
            <RequestRoadmap roadmap={selected.roadmap} />
          </article>
        )}
      </div>
    </section>
  );
}
