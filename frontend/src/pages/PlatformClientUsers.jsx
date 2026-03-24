import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import PlatformUserAvatar from '../components/platform/PlatformUserAvatar.jsx';
import { KeyRound, MailPlus, Plus, Users, X } from 'lucide-react';

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Member';
  return role;
}

export default function PlatformClientUsers() {
  const { user } = useAuth();
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [orgUsers, setOrgUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avatarListRev, setAvatarListRev] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');

  const [editUser, setEditUser] = useState(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('employee');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editRemoveAvatar, setEditRemoveAvatar] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [removeAccessStep, setRemoveAccessStep] = useState(0);

  const loadUsers = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/users`);
    setOrgUsers(data.users || []);
    setAvatarListRev((n) => n + 1);
  }, [orgId]);

  useEffect(() => {
    loadUsers().catch(() => setOrgUsers([]));
  }, [loadUsers]);

  useEffect(() => {
    if (!modalOpen && !editUser) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editUser) closeEditModal();
        else closeInviteModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, editUser]);

  function closeInviteModal() {
    setModalOpen(false);
    setError('');
    setInviteEmail('');
    setInviteRole('employee');
  }

  function openEditModal(u) {
    setModalOpen(false);
    setError('');
    setRemoveAccessStep(0);
    setEditUser(u);
    setEditFirst(u.firstName ?? '');
    setEditLast(u.lastName ?? '');
    setEditEmail(u.email ?? '');
    setEditRole(u.role === 'employee' ? 'employee' : 'admin');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setEditPassword('');
  }

  function closeEditModal() {
    setEditUser(null);
    setError('');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setEditPassword('');
    setRemoveAccessStep(0);
  }

  async function sendOrgInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const invitedTo = inviteEmail.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/invites`, {
        email: invitedTo,
        invitedRole: inviteRole,
      });
      const fullInvite = `${window.location.origin}${data.inviteUrl}`;
      showToast(`Invite link for ${invitedTo}:\n\n${fullInvite}`, {
        variant: 'success',
        durationMs: 20000,
      });
      await loadUsers();
      closeInviteModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEditUser(e) {
    e.preventDefault();
    if (!editUser) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}/users/${editUser.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        role: editRole,
      });
      if (editAvatarFile) {
        const fd = new FormData();
        fd.append('avatar', editAvatarFile);
        await api.post(`/api/platform/organizations/${orgId}/users/${editUser.id}/avatar`, fd);
      } else if (editRemoveAvatar && editUser.hasProfileAvatar) {
        await api.delete(`/api/platform/organizations/${orgId}/users/${editUser.id}/avatar`);
      }
      await loadUsers();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }

  async function setPasswordForEditUser() {
    if (!editUser) return;
    if (!editPassword || editPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/users/${editUser.id}/password`, { password: editPassword });
      setEditPassword('');
      showToast('Password updated.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Password update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveAccess() {
    if (!editUser) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/users/${editUser.id}`);
      await loadUsers();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove access.');
    } finally {
      setBusy(false);
    }
  }

  const canRemoveAccess = editUser && String(editUser.id) !== String(user?.id);

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && !modalOpen && !editUser && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Users size={28} strokeWidth={1.75} aria-hidden />
            Users
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => {
            setError('');
            closeEditModal();
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Add user
        </button>
      </div>

      <div className="card platform-users-card" style={{ marginTop: '1rem' }}>
        <div className="table-wrap">
          <table className="admin-table platform-users-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">User type</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {orgUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ padding: '1.5rem' }}>
                    No users yet. Add one to send an invite.
                  </td>
                </tr>
              )}
              {orgUsers.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
                return (
                  <tr
                    key={u.id}
                    className="platform-users-table__row platform-users-table__row--clickable"
                    tabIndex={0}
                    role="button"
                    onClick={() => openEditModal(u)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEditModal(u);
                      }
                    }}
                  >
                    <td>
                      <div className="platform-users-table__name-cell">
                        <div className="platform-users-table__avatar-cell">
                          <PlatformUserAvatar
                            userId={u.id}
                            hasProfileAvatar={u.hasProfileAvatar}
                            rev={avatarListRev}
                            organizationId={orgId}
                          />
                        </div>
                        <span className="platform-users-table__name">{name}</span>
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="muted" style={{ fontSize: '0.9rem' }}>
                      {u.createdAt
                        ? new Date(u.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeInviteModal}
          onKeyDown={(e) => e.key === 'Escape' && closeInviteModal()}
        >
          <div
            className="modal-dialog modal-dialog--wide card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-user-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="invite-user-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Invite user
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={closeInviteModal}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', marginBottom: '1rem' }}>
              <MailPlus size={18} strokeWidth={1.75} aria-hidden />
              Creates an invite link you can share; they complete signup with a password.
            </p>
            {error && modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={sendOrgInvite}>
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
                <button type="button" className="btn btn-ghost" onClick={closeInviteModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editUser && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeEditModal}
          onKeyDown={(e) => e.key === 'Escape' && closeEditModal()}
        >
          <div
            className="modal-dialog modal-dialog--wide card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-client-user-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="edit-client-user-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Edit user
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={closeEditModal}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.35rem', marginBottom: '1rem' }}>
              Update profile and role. Optionally set a new password for this account.
            </p>
            {error && editUser && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={saveEditUser}>
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
                      setPasswordForEditUser();
                    }}
                  >
                    <KeyRound size={16} aria-hidden />
                    Set
                  </button>
                </div>
              </fieldset>
              <div className="modal-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={closeEditModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
            {canRemoveAccess && (
              <div
                className="modal-dialog__danger-zone"
                style={{
                  marginTop: '1.25rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                {removeAccessStep === 0 ? (
                  <>
                    <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.65rem' }}>
                      Remove this user from the organization and block sign-in. Their profile and history stay in
                      the database.
                    </p>
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      onClick={() => setRemoveAccessStep(1)}
                      disabled={busy}
                    >
                      Remove access
                    </button>
                  </>
                ) : (
                  <>
                    <p className="error" style={{ marginBottom: '0.75rem' }}>
                      They will be signed out immediately and will no longer appear here. Continue?
                    </p>
                    <div className="modal-dialog__actions" style={{ marginTop: 0 }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setRemoveAccessStep(0)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={confirmRemoveAccess}
                        disabled={busy}
                      >
                        {busy ? 'Removing…' : 'Yes, remove access'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
