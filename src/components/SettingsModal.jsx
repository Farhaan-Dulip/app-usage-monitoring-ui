export default function SettingsModal({
  isOpen,
  sendEvaluationEmailEnabled,
  onClose,
  onEmailSettingChange,
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
            <strong>Send evaluation email</strong>
            <p>Automatically send the evaluation summary when a window completes.</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={sendEvaluationEmailEnabled}
              onChange={(event) => onEmailSettingChange(event.target.checked)}
            />
            <span aria-hidden="true" />
            <span className="sr-only">{sendEvaluationEmailEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        <div className="settings-modal-footer">
          <span>{sendEvaluationEmailEnabled ? 'Email delivery enabled' : 'Email delivery disabled'}</span>
          <button className="dispatch-button" type="button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
