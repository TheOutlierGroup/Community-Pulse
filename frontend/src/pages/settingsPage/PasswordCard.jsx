export default function PasswordCard({
  passwordMessage,
  passwordError,
  changePassword,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordBusy,
}) {
  return (
    <div className="card account-card">
      <h2 className="settings-section-title">Password</h2>
      {passwordMessage || passwordError ? (
        <p className={passwordError ? 'error' : 'muted'} style={{ marginBottom: '1rem' }}>
          {passwordError || passwordMessage}
        </p>
      ) : null}
      <form onSubmit={changePassword}>
        <div className="field">
          <label htmlFor="settings-current-pw">Current password</label>
          <input
            id="settings-current-pw"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="settings-new-pw">New password</label>
          <input
            id="settings-new-pw"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-confirm-pw">Confirm new password</label>
          <input
            id="settings-confirm-pw"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
          At least 8 characters.
        </p>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={passwordBusy}>
            {passwordBusy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </div>
  );
}
