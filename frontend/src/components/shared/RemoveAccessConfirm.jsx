export default function RemoveAccessConfirm({
  busy,
  step,
  setStep,
  onConfirm,
  introText,
  confirmText = 'They will be signed out immediately and will no longer appear here. Continue?',
  actionLabel = 'Remove access',
  busyLabel = 'Removing…',
  confirmLabel = 'Yes, remove access',
  actionButtonClassName = 'btn-danger-ghost',
  confirmButtonClassName = 'btn-danger',
}) {
  return (
    <div
      className="modal-dialog__danger-zone"
      style={{
        marginTop: '1.25rem',
        paddingTop: '1rem',
        borderTop: '1px solid var(--border)',
      }}
    >
      {step === 0 ? (
        <>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.65rem' }}>
            {introText}
          </p>
          <button
            type="button"
            className={`btn ${actionButtonClassName}`}
            onClick={() => setStep(1)}
            disabled={busy}
          >
            {actionLabel}
          </button>
        </>
      ) : (
        <>
          <p className="error" style={{ marginBottom: '0.75rem' }}>
            {confirmText}
          </p>
          <div className="modal-dialog__actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep(0)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${confirmButtonClassName}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
