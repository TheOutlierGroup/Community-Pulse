import ModalDialog from '../../components/shared/ModalDialog.jsx';

export default function CreateUserModal({
  open,
  busy,
  error,
  formFirst,
  setFormFirst,
  formLast,
  setFormLast,
  formEmail,
  setFormEmail,
  formPassword,
  setFormPassword,
  formRole,
  setFormRole,
  setFormAvatar,
  onClose,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <ModalDialog open={open} title="Add user" titleId="add-user-title" onClose={onClose}>
      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      <form onSubmit={onSubmit}>
        <fieldset className="modal-dialog__fieldset">
          <legend>Name</legend>
          <div className="modal-dialog__name-row">
            <div className="field">
              <label htmlFor="add-first">First name</label>
              <input
                id="add-first"
                value={formFirst}
                onChange={(e) => setFormFirst(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="field">
              <label htmlFor="add-last">Last name</label>
              <input
                id="add-last"
                value={formLast}
                onChange={(e) => setFormLast(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="add-email">Email</label>
          <input
            id="add-email"
            type="email"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="add-pw">Initial password (optional)</label>
          <input
            id="add-pw"
            type="password"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
            Leave blank to email them a link to create their password (requires Resend and APP_URL or FRONTEND_ORIGIN).
            Otherwise use at least 8 characters; they still get a welcome email with sign-in and password links when
            email is configured.
          </p>
        </div>
        <div className="field">
          <label htmlFor="add-role">User type</label>
          <select
            id="add-role"
            value={formRole}
            onChange={(e) => setFormRole(e.target.value)}
          >
            <option value="admin">Admin</option>
            <option value="employee">Member</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-avatar">Profile image (optional)</label>
          <input
            id="add-avatar"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => setFormAvatar(e.target.files?.[0] || null)}
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
            JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
          </p>
        </div>
        <div className="modal-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
