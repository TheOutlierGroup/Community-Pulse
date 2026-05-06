import ModalDialog from '../../components/shared/ModalDialog.jsx';

export default function InviteUserModal({
  open,
  error,
  busy,
  submitLabel = 'Create user',
  inviteEmail,
  inviteFirstName,
  inviteLastName,
  inviteRole,
  setInviteEmail,
  setInviteFirstName,
  setInviteLastName,
  setInviteRole,
  onClose,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <ModalDialog open={open} title="Create Users" titleId="invite-user-title" onClose={onClose}>
      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="client-invite-email">Email</label>
          <input
            id="client-invite-email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <fieldset className="modal-dialog__fieldset">
          <legend>Name (optional)</legend>
          <div className="modal-dialog__name-row">
            <div className="field">
              <label htmlFor="client-invite-first">First name</label>
              <input
                id="client-invite-first"
                value={inviteFirstName}
                onChange={(e) => setInviteFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="field">
              <label htmlFor="client-invite-last">Last name</label>
              <input
                id="client-invite-last"
                value={inviteLastName}
                onChange={(e) => setInviteLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="client-invite-role">User type</label>
          <select
            id="client-invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            <option value="employee">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="modal-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
            {busy ? 'Creating…' : submitLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
