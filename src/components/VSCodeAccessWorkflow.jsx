import RequestRoadmap from './RequestRoadmap';

// The sample VS Code Enterprise request, shown inside an AI assistant reply
// with the same roadmap view as the project-tools workflow.
const VSCODE_ROADMAP = [
  { id: 'raised', title: 'Request raised', owner: 'Ravi Kumar', detail: 'VS Code Enterprise edition, from the AI assistant', status: 'done' },
  { id: 'verify', title: 'Verify existing access & eligibility', owner: 'Licence owners', detail: 'Not held yet', status: 'done' },
  { id: 'owner', title: 'App owner approves', owner: 'App owner', detail: 'Waiting for the app owner', status: 'current' },
  { id: 'seat', title: 'Seat allocated', owner: 'Licence owners', detail: 'Assigned once approved', status: 'pending' },
  { id: 'track', title: 'Track usage', owner: 'Deploy Tracker', detail: 'The tracker on the PC measures VS Code', status: 'pending' },
];

export default function VSCodeAccessWorkflow() {
  return (
    <section aria-label="VS Code Enterprise access workflow" className="assistant-workflow">
      <div className="assistant-workflow-scroll">
        <RequestRoadmap roadmap={VSCODE_ROADMAP} />
      </div>
    </section>
  );
}
