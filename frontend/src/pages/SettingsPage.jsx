import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import api from '../services/api.js';
import { Settings, UserCircle } from 'lucide-react';

function sniffImageMime(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const n = buf.byteLength;
  if (n < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function jsonErrorFromBuffer(arrayBuffer) {
  const head = new TextDecoder()
    .decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 2048)))
    .trim();
  if (!head.startsWith('{')) return null;
  try {
    const j = JSON.parse(head);
    return typeof j.error === 'string' ? j.error : null;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const { user, logout, loading, setCurrentUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const avatarBlobRef = useRef(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarRev, setAvatarRev] = useState(0);
  const [profileBusy, setProfileBusy] = useState(false);
  const [namesBusy, setNamesBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [avatarLoadError, setAvatarLoadError] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
  }, [user?.id, user?.firstName, user?.lastName]);

  useEffect(() => {
    if (!user?.hasProfileAvatar) {
      if (avatarBlobRef.current) {
        URL.revokeObjectURL(avatarBlobRef.current);
        avatarBlobRef.current = null;
      }
      setAvatarPreview(null);
      setAvatarLoadError('');
      return;
    }
    let cancelled = false;
    setAvatarLoadError('');
    api
      .get('/api/auth/me/avatar', {
        responseType: 'arraybuffer',
        params: { v: avatarRev },
      })
      .then((res) => {
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const ab = res.data;
        if (!(ab instanceof ArrayBuffer) || ab.byteLength === 0) throw new Error('empty');
        const jsonErr = jsonErrorFromBuffer(ab);
        if (jsonErr) throw new Error(jsonErr);
        const mime = sniffImageMime(ab);
        if (!mime) throw new Error('not image data');
        const ct = (res.headers['content-type'] || '').toLowerCase();
        const blobType =
          ct.startsWith('image/') && !ct.includes('json') ? ct.split(';')[0].trim() : mime;
        const blob = new Blob([ab], { type: blobType });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (avatarBlobRef.current) URL.revokeObjectURL(avatarBlobRef.current);
        avatarBlobRef.current = url;
        setAvatarPreview(url);
        setAvatarLoadError('');
      })
      .catch((err) => {
        if (!cancelled) {
          if (avatarBlobRef.current) {
            URL.revokeObjectURL(avatarBlobRef.current);
            avatarBlobRef.current = null;
          }
          setAvatarPreview(null);
          const status = err.response?.status;
          let msg = 'Could not load profile photo. Try removing it and uploading again.';
          if (status === 404) {
            msg = 'Profile photo not found on the server. Upload again (check storage on Render).';
          } else if (status === 401 || status === 403) {
            msg = 'Not allowed to load profile photo. Sign in again.';
          } else if (
            err.message &&
            !String(err.message).startsWith('Request failed with status code')
          ) {
            msg = err.message;
          }
          setAvatarLoadError(msg);
        }
      });
    return () => {
      cancelled = true;
      if (avatarBlobRef.current) {
        URL.revokeObjectURL(avatarBlobRef.current);
        avatarBlobRef.current = null;
      }
      setAvatarPreview(null);
    };
  }, [user?.hasProfileAvatar, avatarRev]);

  if (loading || !user) return null;

  const orgLabel =
    user.organizationKind === 'platform'
      ? 'Outlier (platform)'
      : user.organizationName || 'Client organization';

  const displayPreview = [firstName, lastName].filter(Boolean).join(' ').trim() || user.email;

  async function saveNames(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setNamesBusy(true);
    try {
      const { data } = await api.patch('/api/auth/me', { firstName, lastName });
      setCurrentUser(data);
      setMessage('Profile saved.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not save profile.';
      setError(msg);
    } finally {
      setNamesBusy(false);
    }
  }

  async function onAvatarFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    setProfileBusy(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const { data } = await api.post('/api/auth/me/avatar', fd);
      setCurrentUser(data.user);
      setAvatarLoadError('');
      setAvatarRev((n) => n + 1);
      setMessage('Photo updated.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not upload image.';
      setError(msg);
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post('/api/auth/me/password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated.');
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || 'Could not update password.';
      setPasswordError(status === 401 ? 'Current password is incorrect.' : msg);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function removeAvatar() {
    setError('');
    setMessage('');
    setProfileBusy(true);
    try {
      const { data } = await api.delete('/api/auth/me/avatar');
      setCurrentUser(data.user);
      if (avatarBlobRef.current) {
        URL.revokeObjectURL(avatarBlobRef.current);
        avatarBlobRef.current = null;
      }
      setAvatarPreview(null);
      setAvatarLoadError('');
      setMessage('Photo removed.');
    } catch {
      setError('Could not remove photo.');
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Settings size={28} strokeWidth={1.75} aria-hidden />
        Settings
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Update your name, profile photo, and password. Read-only account details are below.
      </p>
      {(message || error) && (
        <p className={error ? 'error' : 'muted'} style={{ marginBottom: '1rem' }}>
          {error || message}
        </p>
      )}
      <div className="card" style={{ maxWidth: 480, marginBottom: '1.25rem' }}>
        <h2 className="settings-section-title">Your profile</h2>
        {avatarLoadError && (
          <p className="error" style={{ marginBottom: '0.75rem' }}>
            {avatarLoadError}
          </p>
        )}
        <div className="settings-avatar-row">
          <div className="settings-avatar-wrap" aria-hidden>
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="settings-avatar-img" />
            ) : (
              <UserCircle className="settings-avatar-placeholder" strokeWidth={1.25} />
            )}
          </div>
          <div className="settings-avatar-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="visually-hidden"
              onChange={onAvatarFile}
              disabled={profileBusy}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={profileBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {profileBusy ? 'Working…' : user.hasProfileAvatar ? 'Change photo' : 'Upload photo'}
            </button>
            {user.hasProfileAvatar && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={profileBusy}
                onClick={removeAvatar}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
          JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
        </p>
        <form onSubmit={saveNames} style={{ marginTop: '1.25rem' }}>
          <div className="field">
            <label htmlFor="settings-first">First name</label>
            <input
              id="settings-first"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="settings-last">Last name</label>
            <input
              id="settings-last"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
            Display as: <strong style={{ color: 'var(--text)' }}>{displayPreview}</strong>
          </p>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={namesBusy}>
              {namesBusy ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </div>
      <div className="card" style={{ maxWidth: 480, marginBottom: '1.25rem' }}>
        <h2 className="settings-section-title">Password</h2>
        {(passwordMessage || passwordError) && (
          <p className={passwordError ? 'error' : 'muted'} style={{ marginBottom: '1rem' }}>
            {passwordError || passwordMessage}
          </p>
        )}
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
      <div className="card" style={{ maxWidth: 480 }}>
        <h2 className="settings-section-title">Account</h2>
        <dl className="settings-dl">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
          <dt>Organization</dt>
          <dd>{orgLabel}</dd>
          <dt>Account type</dt>
          <dd style={{ textTransform: 'capitalize' }}>{user.organizationKind}</dd>
        </dl>
      </div>
    </Layout>
  );
}
