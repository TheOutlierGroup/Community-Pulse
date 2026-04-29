export default function MfaCard({
  user,
  mfaSecret,
  mfaQrCodeDataUrl,
  mfaRecoveryCodes,
  mfaCode,
  setMfaCode,
  mfaBusy,
  mfaError,
  mfaMessage,
  startMfaSetup,
  verifyMfaSetup,
  disableMfa,
  cancelMfaSetup,
  downloadMfaRecoveryKeys,
}) {
  const setupInProgress = Boolean(mfaSecret) && !user.mfaEnabled;

  return (
    <div className="card account-card">
      <h2 className="settings-section-title">Multi-factor authentication</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Protect your account with a 6-digit authenticator app code at sign-in.
      </p>
      {mfaMessage || mfaError ? (
        <p className={mfaError ? 'error' : 'muted'} style={{ marginBottom: '1rem' }}>
          {mfaError || mfaMessage}
        </p>
      ) : null}
      <p className="muted" style={{ marginTop: 0, marginBottom: '1rem' }}>
        Status: <strong style={{ color: 'var(--text)' }}>{user.mfaEnabled ? 'Enabled' : 'Disabled'}</strong>
      </p>

      {setupInProgress ? (
        <form onSubmit={verifyMfaSetup}>
          {mfaQrCodeDataUrl ? (
            <div className="field">
              <label>Scan QR code</label>
              <img
                src={mfaQrCodeDataUrl}
                alt="Authenticator app QR code"
                style={{ width: 200, height: 200, borderRadius: 10, border: '1px solid var(--border)' }}
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="settings-mfa-secret">Authenticator secret</label>
            <input id="settings-mfa-secret" value={mfaSecret} readOnly />
          </div>
          {Array.isArray(mfaRecoveryCodes) && mfaRecoveryCodes.length > 0 ? (
            <div className="field">
              <label htmlFor="settings-mfa-recovery-codes">Recovery keys (save now)</label>
              <textarea
                id="settings-mfa-recovery-codes"
                value={mfaRecoveryCodes.join('\n')}
                readOnly
                rows={8}
                style={{ fontFamily: 'var(--font-mono, monospace)' }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={mfaBusy}
                onClick={downloadMfaRecoveryKeys}
                style={{ marginTop: '0.5rem' }}
              >
                Download recovery keys
              </button>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="settings-mfa-verify-code">Authenticator code</label>
            <input
              id="settings-mfa-verify-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Enter 6-digit code"
              required
            />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={mfaBusy}>
              {mfaBusy ? 'Verifying…' : 'Verify and enable MFA'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={mfaBusy} onClick={cancelMfaSetup}>
              Cancel
            </button>
          </div>
        </form>
      ) : user.mfaEnabled ? (
        <form onSubmit={disableMfa}>
          <div className="field">
            <label htmlFor="settings-mfa-disable-code">Authenticator code to disable</label>
            <input
              id="settings-mfa-disable-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Enter 6-digit code"
              required
            />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-ghost" disabled={mfaBusy}>
              {mfaBusy ? 'Disabling…' : 'Disable MFA'}
            </button>
          </div>
        </form>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={mfaBusy} onClick={startMfaSetup}>
            {mfaBusy ? 'Starting…' : 'Set up MFA'}
          </button>
        </div>
      )}
    </div>
  );
}
