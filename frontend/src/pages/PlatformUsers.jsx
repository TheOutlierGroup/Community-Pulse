import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import PlatformUserAvatar from '../components/platform/PlatformUserAvatar.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { KeyRound, Plus, Users, X } from 'lucide-react';

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
  const [pwByUser, setPwByUser] = useState({});
  const [avatarListRev, setAvatarListRev] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('admin');
  const [formAvatar, setFormAvatar] = useState(null);

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
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  function closeModal() {
    setModalOpen(false);
    setError('');
    setFormFirst('');
    setFormLast('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('admin');
    setFormAvatar(null);
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
      closeModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create user.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <Users size={28} strokeWidth={1.75} aria-hidden />
            Users
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Platform team: create accounts, photos, and reset passwords.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => {
            setError('');
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Add user
        </button>
      </div>

      {error && !modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

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
                <th scope="col">Password</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: '1.5rem' }}>
                    No users yet. Add one to get started.
                  </td>
                </tr>
              )}
              {staff.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
                return (
                  <tr key={u.id}>
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
                    <td>
                      <div className="platform-users-table__pw">
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder="Min 8 chars"
                          value={pwByUser[`s-${u.id}`] || ''}
                          onChange={(e) =>
                            setPwByUser((prev) => ({ ...prev, [`s-${u.id}`]: e.target.value }))
                          }
                          aria-label={`New password for ${u.email}`}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost platform-users-table__pw-btn"
                          disabled={busy}
                          onClick={() => {
                            const p = pwByUser[`s-${u.id}`];
                            if (!p || p.length < 8) {
                              setError('Password must be at least 8 characters.');
                              return;
                            }
                            setBusy(true);
                            setError('');
                            api
                              .patch(`/api/platform/users/${u.id}/password`, { password: p })
                              .then(() => {
                                setPwByUser((prev) => ({ ...prev, [`s-${u.id}`]: '' }));
                              })
                              .catch((err) => {
                                setError(err.response?.data?.error || 'Password update failed.');
                              })
                              .finally(() => setBusy(false));
                          }}
                        >
                          <KeyRound size={16} aria-hidden />
                          Set
                        </button>
                      </div>
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
          onClick={closeModal}
          onKeyDown={(e) => e.key === 'Escape' && closeModal()}
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
                onClick={closeModal}
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
                <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={busy}>
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
    </Layout>
  );
}
