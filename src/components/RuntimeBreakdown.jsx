function formatRuntime(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m${remainingSeconds ? ` ${remainingSeconds}s` : ''}`;
  if (minutes > 0) return `${minutes}m${remainingSeconds ? ` ${remainingSeconds}s` : ''}`;
  return `${remainingSeconds}s`;
}

export default function RuntimeBreakdown({ entry }) {
  const isAgentEntry = entry.appType === 'agent' || entry.type === 'agent';
  const manualWorkedSeconds = Math.max(
    0,
    (entry.workedRuntimeSeconds || 0) - (entry.automationWorkedSeconds || 0)
  );

  return (
    <div className="runtime-breakdown">
      <strong>{formatRuntime(entry.totalRuntimeSeconds)}</strong>
      {!isAgentEntry && <span>Manual Work {formatRuntime(manualWorkedSeconds)}</span>}
      {(isAgentEntry || entry.hasAgentExtension) && (
        <span>Automation Work {formatRuntime(entry.automationWorkedSeconds || 0)}</span>
      )}
      <span>Idle {formatRuntime(entry.idleRuntimeSeconds || 0)}</span>
    </div>
  );
}
