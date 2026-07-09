import ModalDialog from '../../components/shared/ModalDialog.jsx';
import RemoveAccessConfirm from '../../components/shared/RemoveAccessConfirm.jsx';
import { Mail } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BUSINESS_UNITS } from '../../config/crmConstants.js';

export default function EditUserModal({
  editUser,
  error,
  busy,
  isPlatformOrg,
  readOnly,
  editFirst,
  setEditFirst,
  editLast,
  setEditLast,
  editEmail,
  setEditEmail,
  editRole,
  setEditRole,
  editBusinessUnits,
  onToggleEditBusinessUnit,
  editAssignmentOptions,
  editAssignedClientOrgIds,
  assignmentsLoading,
  onToggleAssignedClientOrg,
  onSelectAllAssignedClientOrgs,
  onClearAssignedClientOrgs,
  editFocusScopeSignal,
  editAvatarFile,
  setEditAvatarFile,
  editRemoveAvatar,
  setEditRemoveAvatar,
  canRemoveAccess,
  removeAccessStep,
  setRemoveAccessStep,
  onClose,
  onSave,
  onResendWelcomeEmail,
  onConfirmRemoveAccess,
}) {
  const scopeSectionRef = useRef(null);

  useEffect(() => {
    if (!editUser || !editFocusScopeSignal) return;
    if (!scopeSectionRef.current) return;
    scopeSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const firstCheckbox = scopeSectionRef.current.querySelector('input[type="checkbox"]');
    if (firstCheckbox) firstCheckbox.focus();
  }, [editUser, editFocusScopeSignal]);

  if (!editUser) return null;

  return (
    <ModalDialog
      open={Boolean(editUser)}
      title={readOnly ? 'View user' : 'Edit user'}
      titleId="edit-user-title"
      onClose={onClose}
    >
      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      <form onSubmit={onSave}>
          <fieldset className="modal-dialog__fieldset" disabled={readOnly}>
            <legend>Name</legend>
            <div className="modal-dialog__name-row">
              <div className="field">
                <label htmlFor="edit-first">First name</label>
                <input
                  id="edit-first"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  autoComplete="given-name"
                  disabled={readOnly}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-last">Last name</label>
                <input
                  id="edit-last"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  autoComplete="family-name"
                  disabled={readOnly}
                />
              </div>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="edit-email">Email</label>
            <input
              id="edit-email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              required
              autoComplete="off"
              disabled={readOnly}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-role">User type</label>
            <select
              id="edit-role"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              disabled={readOnly}
            >
              <option value="admin">Admin</option>
              {isPlatformOrg ? (
                <>
                  <option value="platform">Platform</option>
                  <option value="basic">Basic</option>
                </>
              ) : (
                <option value="employee">Member</option>
              )}
            </select>
          </div>
          {isPlatformOrg ? (
            <div className="field" ref={scopeSectionRef}>
              <label>Business units</label>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                {editRole === 'basic'
                  ? 'Restricts this user to Clients and Prospects tagged with these units.'
                  : 'Badge only — Admin and Platform users see every Client and Prospect regardless.'}
              </p>
              <div className="platform-user-scope-list" role="group" aria-label="Business units">
                {BUSINESS_UNITS.map((bu) => (
                  <label key={bu} className="platform-user-scope-item">
                    <input
                      type="checkbox"
                      checked={editBusinessUnits.includes(bu)}
                      onChange={() => onToggleEditBusinessUnit(bu)}
                      disabled={readOnly}
                    />
                    <span>{bu}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="field" ref={scopeSectionRef}>
              <label>Client access scope</label>
              {editRole === 'admin' ? (
                <p className="muted platform-user-scope-note">
                  Admin users can access every client organization.
                </p>
              ) : assignmentsLoading ? (
                <p className="muted platform-user-scope-note">Loading assignment options…</p>
              ) : editAssignmentOptions.length === 0 ? (
                <p className="muted platform-user-scope-note">
                  No client organizations available yet. This member will not see client workspaces.
                </p>
              ) : (
                <div className="platform-user-scope-controls">
                  <p className="muted platform-user-scope-note" style={{ margin: 0 }}>
                    {editAssignedClientOrgIds.length} of {editAssignmentOptions.length} clients selected
                  </p>
                  <div className="platform-user-scope-actions">
                    <button
                      type="button"
                      className="platform-scope-link"
                      onClick={onSelectAllAssignedClientOrgs}
                      disabled={busy || editAssignedClientOrgIds.length === editAssignmentOptions.length}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="platform-scope-link"
                      onClick={onClearAssignedClientOrgs}
                      disabled={busy || editAssignedClientOrgIds.length === 0}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              {editRole === 'employee' && !assignmentsLoading && editAssignmentOptions.length > 0 ? (
                <div className="platform-user-scope-list" role="group" aria-label="Client organizations">
                  {editAssignmentOptions.map((org) => {
                    const checked = editAssignedClientOrgIds.some((id) => String(id) === String(org.id));
                    return (
                      <label key={org.id} className="platform-user-scope-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleAssignedClientOrg(org.id)}
                          disabled={busy}
                        />
                        <span>{org.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {editRole === 'employee' && !assignmentsLoading ? (
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  Members can only open assigned client organizations.
                </p>
              ) : null}
            </div>
          )}
          {!readOnly && (
            <div className="field">
              <label htmlFor="edit-avatar">Profile image</label>
              <input
                key={editUser.id + (editRemoveAvatar ? '-rm' : '')}
                id="edit-avatar"
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
              {editUser.hasProfileAvatar && !editAvatarFile && (
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
              )}
            </div>
          )}
          {!readOnly && (
            <div className="field" style={{ marginTop: '0.25rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  onResendWelcomeEmail();
                }}
              >
                <Mail size={16} aria-hidden style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
                Resend welcome email
              </button>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                Sends sign-in and create-password links.
              </p>
            </div>
          )}
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button
                type="submit"
                className="btn btn-primary modal-dialog__submit"
                disabled={busy || (editRole === 'employee' && assignmentsLoading)}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
      </form>
      {!readOnly && canRemoveAccess ? (
        <RemoveAccessConfirm
          busy={busy}
          step={removeAccessStep}
          setStep={setRemoveAccessStep}
          onConfirm={onConfirmRemoveAccess}
          introText="Remove this user from the list and block sign-in. Their profile and history stay in the database."
        />
      ) : null}
    </ModalDialog>
  );
}
