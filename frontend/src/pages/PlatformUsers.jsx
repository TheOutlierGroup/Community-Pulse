import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import PlatformUserAvatar from '../components/platform/PlatformUserAvatar.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Plus, Users, X } from 'lucide-react';

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Member';
  return role;
}

export default function PlatformUsers() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarListRev, setAvatarListRev] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('admin');
  const [formAvatar, setFormAvatar] = useState(null);

  const [editUser, setEditUser] = useState(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editRemoveAvatar, setEditRemoveAvatar] = useState(false);

  const loadStaff = useCallback(async () => {
    const { data } = await api.get('/api/platform/staff');
    setStaff(data.users || []);
    setAvatarListRev((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        setError('');
        await loadStaff();
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load team.');
      }
    })();
  }, [ok, loadStaff]);

  useEffect(() => {
    if (!modalOpen && !editUser) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editUser) closeEditModal();
        else closeCreateModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, editUser]);

  function closeCreateModal() {
    setModalOpen(false);
    setError('');
    setFormFirst('');
    setFormLast('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('admin');
    setFormAvatar(null);
  }

  function openEditModal(u) {
    setModalOpen(false);
    setError('');
    setEditUser(u);
    setEditFirst(u.firstName ?? '');
    setEditLast(u.lastName ?? '');
    setEditEmail(u.email ?? '');
    setEditRole(u.role === 'employee' ? 'employee' : 'admin');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
  }

  function closeEditModal() {
    setEditUser(null);
    setError('');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
  }

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('firstName', formFirst.trim());
      fd.append('lastName', formLast.trim());
      fd.append('email', formEmail.trim());
      fd.append('password', formPassword);
      fd.append('role', formRole);
      if (formAvatar) fd.append('avatar', formAvatar);
      await api.post('/api/platform/users', fd);
      await loadStaff();
      closeCreateModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create user.');
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
      await api.patch(`/api/platform/users/${editUser.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        role: editRole,
      });
      if (editAvatarFile) {
        const fd = new FormData();
        fd.append('avatar', editAvatarFile);
        await api.post(`/api/platform/users/${editUser.id}/avatar`, fd);
      } else if (editRemoveAvatar && editUser.hasProfileAvatar) {
        await api.delete(`/api/platform/users/${editUser.id}/avatar`);
      }
      await loadStaff();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
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

      {error && !modalOpen && !editUser && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div className="card platform-users-card">
        <div className="table-wrap">
          <table className="admin-table platform-users-table">
            <thead>
              <tr>
                <th className="platform-users-table__photo" scope="col">
                  Photo
                </th>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">User type</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: '1.5rem' }}>
                    No users yet. Add one to get started.
                  </td>
                </tr>
              )}
              {staff.map((u) => {
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
                      <div className="platform-users-table__avatar-cell">
                        <PlatformUserAvatar
                          userId={u.id}
                          hasProfileAvatar={u.hasProfileAvatar}
                          rev={avatarListRev}
                        />
                      </div>
                    </td>
                    <td>
                      <span className="platform-users-table__name">{name}</span>
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
          onClick={closeCreateModal}
          onKeyDown={(e) => e.key === 'Escape' && closeCreateModal()}
        >
          <div
            className="modal-dialog card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="add-user-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Add user
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={closeCreateModal}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.35rem', marginBottom: '1rem' }}>
              Creates a platform account with an initial password they can change in Settings.
            </p>
            {error && modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={createUser}>
              <div className="field">
                <label htmlFor="add-first">First name</label>
                <input
                  id="add-first"
                  value={formFirst}
                  onChange={(e) => setFormFirst(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="add-last">Last name</label>
                <input
                  id="add-last"
                  value={formLast}
                  onChange={(e) => setFormLast(e.target.value)}
                  autoComplete="off"
                />
              </div>
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
                <label htmlFor="add-pw">Initial password</label>
                <input
                  id="add-pw"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
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
                <button type="button" className="btn btn-ghost" onClick={closeCreateModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create user'}
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
            className="modal-dialog card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="edit-user-title" style={{ margin: 0, fontSize: '1.15rem' }}>
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
              Update profile and role. Passwords can be changed by each user in Settings.
            </p>
            {error && editUser && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={saveEditUser}>
              <div className="field">
                <label htmlFor="edit-first">First name</label>
                <input
                  id="edit-first"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="edit-last">Last name</label>
                <input
                  id="edit-last"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="edit-email">Email</label>
                <input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="edit-role">User type</label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  <option value="admin">Admin</option>
                  <option value="employee">Member</option>
                </select>
              </div>
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
              <div className="modal-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={closeEditModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
