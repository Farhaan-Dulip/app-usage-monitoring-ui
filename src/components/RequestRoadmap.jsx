import { OBJECTIVE_STATUS } from '../utils/requestRoadmap';
import PersonAvatar from './PersonAvatar';
import { SAMPLE_PEOPLE } from '../data/samplePeople';

// A step counts as reached once it is done or partly done.
const reached = (step) => step.status === 'done' || step.status === 'partial';

// Where the moving dashes run: from the last reached step to the current one.
const flowRange = (steps) => {
  const current = steps.findIndex((step) => step.status === 'current');
  const lastReached = steps.reduce((last, step, index) => (reached(step) ? index : last), -1);
  return lastReached >= 0 && current > lastReached ? { from: lastReached, to: current } : { from: undefined, to: undefined };
};

// One roadmap: numbered circles joined by lines, each with its title, status,
// owner and detail.
function Steps({ steps, flowingFrom, flowingTo, labels, place, action, actionFor }) {
  const count = steps.length;
  return steps.map((objective, index) => {
    const meta = OBJECTIVE_STATUS[objective.status] || OBJECTIVE_STATUS.pending;
    const flowing = flowingFrom !== undefined && index >= flowingFrom && index < flowingTo;
    return (
      <li
        className={`request-roadmap-step request-roadmap-${objective.status}${objective.subflows?.length ? ' request-roadmap-step-branched' : ''}${objective.offset ? ' request-roadmap-step-shifted' : ''}`}
        key={objective.id}
        style={{
          ...(place ? place(index) : {}),
          ...(objective.offset ? { paddingLeft: objective.offset, '--offset': `${objective.offset}px` } : {}),
        }}
      >
        <div className="request-roadmap-track">
          <span className="request-roadmap-dot" aria-hidden="true">{labels ? labels[index] : index + 1}</span>
          {index < count - 1 && (
            <span className={`request-roadmap-line${flowing ? ' request-roadmap-line-flow' : ''}`} aria-hidden="true" />
          )}
        </div>
        <div className="request-roadmap-text">
          <strong>{objective.title}</strong>
          <span className={`status-badge ${meta.className}`}>{meta.label}</span>
          {objective.owner && (
            <span className="request-roadmap-owner">
              {SAMPLE_PEOPLE.includes(objective.owner) && <PersonAvatar name={objective.owner} />}
              <small>{objective.owner}</small>
            </span>
          )}
          {objective.detail && <small>{objective.detail}</small>}
          {action && objective.id === actionFor && <div className="request-roadmap-action">{action}</div>}
        </div>
      </li>
    );
  });
}

// A request's objectives as a horizontal roadmap. A step can branch into
// sub-roadmaps that alternate: downward ones sit under the main row, upward
// ones above it. A vertical line joins each circle to its sub-roadmaps, and
// each sub-roadmap starts with a short horizontal line from that line. Later
// branches sit nearest the main row, so lines never cross another branch.
// `action` is shown under the objective whose id is `actionFor` (manager approval).
export default function RequestRoadmap({ roadmap, action = null, actionFor = 'approval' }) {
  const count = roadmap.length;
  const { from, to } = flowRange(roadmap);
  const branched = roadmap.map((objective, index) => ({ objective, index })).filter(({ objective }) => objective.subflows?.length);
  // Branches alternate by their order: the first hangs down from its circle, the next rises up
  // above the main row, and so on.
  const directionOf = (index) => {
    if (roadmap[index].branchDirection) return roadmap[index].branchDirection;
    return branched.findIndex((branch) => branch.index === index) % 2 === 0 ? 'down' : 'up';
  };
  const upStages = branched.filter(({ index }) => directionOf(index) === 'up');
  const downStages = branched.filter(({ index }) => directionOf(index) === 'down');
  const upRows = upStages.reduce((total, { objective }) => total + objective.subflows.length, 0);
  const mainRow = upRows + 1;
  // Space between the main row and the sub-roadmaps nearest to it.
  const gapFor = (subRow) => {
    if (subRow === mainRow + 1) return { marginTop: 22 };
    if (subRow === mainRow - 1) return { marginBottom: 22 };
    return {};
  };

  const placed = [];
  const stems = [];
  let row = 1;
  upStages.forEach(({ index, objective }) => {
    const start = row;
    objective.subflows.forEach((sub) => {
      placed.push({ index, sub, row, left: objective.branchSide === 'left' });
      row += 1;
    });
    stems.push({ index, direction: 'up', start, end: row - 1 });
  });
  // A branch with shareRow hangs on the same row as the branch before it.
  let nextRow = mainRow + 1;
  let stageRow = mainRow + 1;
  downStages.forEach(({ index, objective }) => {
    const start = objective.shareRow ? stageRow : nextRow;
    let subRow = start;
    objective.subflows.forEach((sub) => {
      placed.push({ index, sub, row: subRow, left: objective.branchSide === 'left' });
      subRow += 1;
    });
    stems.push({ index, direction: 'down', start: mainRow, end: subRow - 1 });
    if (!objective.shareRow) {
      stageRow = start;
      nextRow = subRow;
    }
  });

  return (
    <ol
      className="request-roadmap"
      aria-label="Request objectives"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(160px, 1fr))` }}
    >
      <Steps
        flowingFrom={from}
        flowingTo={to}
        action={action}
        actionFor={actionFor}
        place={(index) => ({ gridColumn: index + 1, gridRow: mainRow })}
        steps={roadmap}
      />
      {stems.map(({ index, direction, start, end, shortStem }) => (
        <li
          aria-hidden="true"
          className={`request-roadmap-stem${direction === 'up' ? ' request-roadmap-stem-up' : ''}`}
          key={`stem-${index}`}
          style={{
            gridColumn: index + 1,
            gridRow: direction === 'up' ? `${start} / ${mainRow}` : `${mainRow} / ${shortStem ? end : end + 1}`,
            marginBottom: shortStem ? -18 : undefined,
          }}
        />
      ))}
      {placed.map(({ index, sub, row: subRow, left }) => {
        const labels = sub.steps.map((_, step) => `${index + 1}.${step + 1}`);
        if (left) {
          return (
            <li className="request-subflow request-subflow-left" key={`${index}-${sub.id}`} style={{ gridColumn: `1 / ${index + 1}`, gridRow: subRow, ...gapFor(subRow) }}>
              <span className="request-subflow-branch request-subflow-branch-left" aria-hidden="true" />
              <ol
                className="request-subflow-steps request-subflow-steps-left"
                style={{ gridTemplateColumns: `repeat(${sub.steps.length}, 180px)` }}
              >
                <Steps
                  flowingFrom={flowRange(sub.steps).from}
                  flowingTo={flowRange(sub.steps).to}
                  labels={labels}
                  steps={sub.steps}
                />
              </ol>
            </li>
          );
        }
        return (
          <li className="request-subflow" key={`${index}-${sub.id}`} style={{ gridColumn: `${index + 1} / -1`, gridRow: subRow, ...gapFor(subRow) }}>
            <span className="request-subflow-branch" aria-hidden="true" />
            <ol
              className="request-subflow-steps"
              style={{ gridTemplateColumns: `repeat(${sub.steps.length}, minmax(130px, 1fr))` }}
            >
              <Steps
                flowingFrom={flowRange(sub.steps).from}
                flowingTo={flowRange(sub.steps).to}
                labels={labels}
                steps={sub.steps}
              />
            </ol>
          </li>
        );
      })}
    </ol>
  );
}
