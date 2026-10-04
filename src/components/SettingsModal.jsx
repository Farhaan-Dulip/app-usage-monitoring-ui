export default function SettingsModal({
  isOpen,
  onClose,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div className="settings-modal-header">
          <div>
            <p className="eyebrow">Preferences</p>
            <h2 id="settings-modal-title">Settings</h2>
          </div>
          <button className="settings-close-button" type="button" aria-label="Close settings" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="settings-option">
          <div>
            <strong>Workflow entry point</strong>
            <p>Requests are currently started from the in-app AI Assistant. Email-triggered workflows are paused.</p>
          </div>
        </div>
        <div className="settings-modal-footer">
          <span>Email integration is deferred.</span>
          <button className="dispatch-button" type="button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
