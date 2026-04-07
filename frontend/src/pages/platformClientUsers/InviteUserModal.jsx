import { MailPlus } from 'lucide-react';
import ModalDialog from '../../components/shared/ModalDialog.jsx';

export default function InviteUserModal({
  open,
  error,
  busy,
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
    <ModalDialog open={open} title="Invite user" titleId="invite-user-title" onClose={onClose}>
      <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', marginBottom: '1rem' }}>
        <MailPlus size={18} strokeWidth={1.75} aria-hidden />
        Creates an invite link you can share; they complete signup with a password.
      </p>
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
        <div className="field" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 10rem' }}>
            <label htmlFor="client-invite-first">First name (optional)</label>
            <input
              id="client-invite-first"
              value={inviteFirstName}
              onChange={(e) => setInviteFirstName(e.target.value)}
              autoComplete="given-name"
            />
          </div>
          <div style={{ flex: '1 1 10rem' }}>
            <label htmlFor="client-invite-last">Last name (optional)</label>
            <input
              id="client-invite-last"
              value={inviteLastName}
              onChange={(e) => setInviteLastName(e.target.value)}
              autoComplete="family-name"
            />
          </div>
        </div>
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
            {busy ? 'Creating…' : 'Create invite'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
