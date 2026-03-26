import { KeyRound } from 'lucide-react';
import ModalDialog from '../../components/shared/ModalDialog.jsx';
import RemoveAccessConfirm from '../../components/shared/RemoveAccessConfirm.jsx';

export default function EditUserModal({
  editUser,
  error,
  busy,
  editFirst,
  setEditFirst,
  editLast,
  setEditLast,
  editEmail,
  setEditEmail,
  editRole,
  setEditRole,
  editAvatarFile,
  setEditAvatarFile,
  editRemoveAvatar,
  setEditRemoveAvatar,
  editPassword,
  setEditPassword,
  canRemoveAccess,
  removeAccessStep,
  setRemoveAccessStep,
  onClose,
  onSave,
  onSetPassword,
  onConfirmRemoveAccess,
}) {
  if (!editUser) return null;

  return (
    <ModalDialog open={Boolean(editUser)} title="Edit user" titleId="edit-client-user-title" onClose={onClose}>
      <p className="muted" style={{ marginTop: '0.35rem', marginBottom: '1rem' }}>
        Update profile and role. Optionally set a new password for this account.
      </p>
      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      <form onSubmit={onSave}>
          <fieldset className="modal-dialog__fieldset">
            <legend>Name</legend>
            <div className="modal-dialog__name-row">
              <div className="field">
                <label htmlFor="edit-client-first">First name</label>
                <input
                  id="edit-client-first"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="field">
                <label htmlFor="edit-client-last">Last name</label>
                <input
                  id="edit-client-last"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="edit-client-email">Email</label>
            <input
              id="edit-client-email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="edit-client-role">User type</label>
            <select
              id="edit-client-role"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="employee">Member</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-client-avatar">Profile image</label>
            <input
              key={editUser.id + (editRemoveAvatar ? '-rm' : '')}
              id="edit-client-avatar"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={(e) => {
                setEditAvatarFile(e.target.files?.[0] || null);
                setEditRemoveAvatar(false);
              }}
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
              JPG, PNG, GIF, or WebP, up to 2&nbsp;MB. Leave empty to keep the current photo.
            </p>
            {editUser.hasProfileAvatar && !editAvatarFile ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: '0.5rem' }}
                onClick={() => {
                  setEditRemoveAvatar(true);
                  setEditAvatarFile(null);
                }}
              >
                Remove photo
              </button>
            ) : null}
          </div>
          <fieldset className="modal-dialog__fieldset">
            <legend>New password</legend>
            <div className="platform-users-table__pw" style={{ maxWidth: '100%' }}>
              <input
                id="edit-client-pw"
                type="password"
                autoComplete="new-password"
                placeholder="Min 8 characters (optional)"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                aria-label="New password for user"
              />
              <button
                type="button"
                className="btn btn-ghost platform-users-table__pw-btn"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  onSetPassword();
                }}
              >
                <KeyRound size={16} aria-hidden />
                Set
              </button>
            </div>
          </fieldset>
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
      </form>
      {canRemoveAccess ? (
        <RemoveAccessConfirm
          busy={busy}
          step={removeAccessStep}
          setStep={setRemoveAccessStep}
          onConfirm={onConfirmRemoveAccess}
          introText="Remove this user from the organization and block sign-in. Their profile and history stay in the database."
        />
      ) : null}
    </ModalDialog>
  );
}
