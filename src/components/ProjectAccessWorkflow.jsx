import RequestRoadmap from './RequestRoadmap';
import { sampleWorkflows } from '../data/sampleRequests';

// The main objectives of the sample project-access workflow, shown inside an
// AI assistant reply. The first is completed, the second is being processed
// and the rest are still to come. Sub-roadmaps are left out.
export default function ProjectAccessWorkflow() {
  const request = sampleWorkflows().find((item) => item.kind === 'Project access');
  if (!request) return null;
  const chatRoadmap = request.roadmap.map(({ subflows, branchSide, ...objective }, index) => ({
    ...objective,
    status: index === 0 ? 'done' : index === 1 ? 'current' : 'pending',
  }));
  return (
    <section aria-label="Project access workflow" className="assistant-workflow">
      <div className="assistant-workflow-scroll">
        <RequestRoadmap roadmap={chatRoadmap} />
      </div>
    </section>
  );
}
