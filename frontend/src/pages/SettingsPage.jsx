import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import api from '../services/api.js';
import { CircleUser } from 'lucide-react';
import { jsonErrorFromBuffer, sniffImageMime } from '../utils/imageResponseHelpers.js';
import ProfileCard from './settingsPage/ProfileCard.jsx';
import CompanyLogoCard from './settingsPage/CompanyLogoCard.jsx';
import PasswordCard from './settingsPage/PasswordCard.jsx';
import AccountCard from './settingsPage/AccountCard.jsx';
import { CLIENT_SERVICE_OPTIONS, normalizeServices } from '../utils/clientServices.js';

export default function AccountPage() {
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
  const companyLogoInputRef = useRef(null);
  const companyLogoBlobRef = useRef(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState(null);
  const [companyLogoRev, setCompanyLogoRev] = useState(0);
  const [companyLogoLoadError, setCompanyLogoLoadError] = useState('');
  const [companyLogoBusy, setCompanyLogoBusy] = useState(false);
  const [orgServices, setOrgServices] = useState([]);
  const [orgServicesBusy, setOrgServicesBusy] = useState(false);
  const [orgServicesError, setOrgServicesError] = useState('');
  const [orgServicesMessage, setOrgServicesMessage] = useState('');
  const [serviceToAdd, setServiceToAdd] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
  }, [user?.id, user?.firstName, user?.lastName]);

  useEffect(() => {
    if (!user || user.organizationKind !== 'client') {
      setOrgServices([]);
      return;
    }
    setOrgServices(normalizeServices({ services: user.enabledServices }));
  }, [user?.organizationKind, user?.enabledServices]);

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

  useEffect(() => {
    if (user?.organizationKind !== 'client' || !user?.organizationHasCompanyLogo) {
      if (companyLogoBlobRef.current) {
        URL.revokeObjectURL(companyLogoBlobRef.current);
        companyLogoBlobRef.current = null;
      }
      setCompanyLogoPreview(null);
      setCompanyLogoLoadError('');
      return;
    }
    let cancelled = false;
    setCompanyLogoLoadError('');
    api
      .get('/api/auth/me/organization-logo', {
        responseType: 'arraybuffer',
        params: { v: companyLogoRev },
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
        if (companyLogoBlobRef.current) URL.revokeObjectURL(companyLogoBlobRef.current);
        companyLogoBlobRef.current = url;
        setCompanyLogoPreview(url);
        setCompanyLogoLoadError('');
      })
      .catch((err) => {
        if (!cancelled) {
          if (companyLogoBlobRef.current) {
            URL.revokeObjectURL(companyLogoBlobRef.current);
            companyLogoBlobRef.current = null;
          }
          setCompanyLogoPreview(null);
          const status = err.response?.status;
          let msg = 'Could not load company logo.';
          if (status === 404) {
            msg = 'Company logo not found. Upload again if needed.';
          } else if (status === 401 || status === 403) {
            msg = 'Not allowed to load company logo. Sign in again.';
          } else if (
            err.message &&
            !String(err.message).startsWith('Request failed with status code')
          ) {
            msg = err.message;
          }
          setCompanyLogoLoadError(msg);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.organizationKind, user?.organizationHasCompanyLogo, companyLogoRev]);

  useEffect(() => {
    return () => {
      if (companyLogoBlobRef.current) {
        URL.revokeObjectURL(companyLogoBlobRef.current);
        companyLogoBlobRef.current = null;
      }
    };
  }, []);

  if (loading || !user) return null;

  const orgLabel =
    user.organizationKind === 'platform'
      ? 'Outlier (platform)'
      : user.organizationName || 'Client organization';

  const displayPreview = [firstName, lastName].filter(Boolean).join(' ').trim() || user.email;
  const canManageOrgServices = user.organizationKind === 'client' && user.role === 'admin';
  const selectedOrgServices = CLIENT_SERVICE_OPTIONS.filter((service) => orgServices.includes(service.id));
  const addableOrgServices = CLIENT_SERVICE_OPTIONS.filter((service) => !orgServices.includes(service.id));

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

  async function onCompanyLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    setCompanyLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const { data } = await api.post('/api/auth/me/organization-logo', fd);
      setCurrentUser(data.user);
      setCompanyLogoLoadError('');
      setCompanyLogoRev((n) => n + 1);
      setMessage('Company logo updated.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not upload company logo.';
      setError(msg);
    } finally {
      setCompanyLogoBusy(false);
    }
  }

  async function removeCompanyLogo() {
    setError('');
    setMessage('');
    setCompanyLogoBusy(true);
    try {
      const { data } = await api.delete('/api/auth/me/organization-logo');
      setCurrentUser(data.user);
      if (companyLogoBlobRef.current) {
        URL.revokeObjectURL(companyLogoBlobRef.current);
        companyLogoBlobRef.current = null;
      }
      setCompanyLogoPreview(null);
      setCompanyLogoLoadError('');
      setMessage('Company logo removed.');
    } catch {
      setError('Could not remove company logo.');
    } finally {
      setCompanyLogoBusy(false);
    }
  }

  function addOrgService(serviceId) {
    const id = String(serviceId || '').trim().toLowerCase();
    if (!id) return;
    setOrgServices((current) => (current.includes(id) ? current : [...current, id]));
    setServiceToAdd('');
  }

  function removeOrgService(serviceId) {
    setOrgServices((current) => current.filter((id) => id !== serviceId));
  }

  async function saveOrganizationServices(e) {
    e.preventDefault();
    setOrgServicesError('');
    setOrgServicesMessage('');
    setOrgServicesBusy(true);
    try {
      const { data } = await api.patch('/api/auth/me/organization-services', {
        services: orgServices,
      });
      setCurrentUser(data.user);
      setOrgServicesMessage('Organization services saved.');
    } catch (err) {
      setOrgServicesError(err.response?.data?.error || 'Could not save organization services.');
    } finally {
      setOrgServicesBusy(false);
    }
  }

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <CircleUser size={28} strokeWidth={1.75} aria-hidden />
        Account
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Update your name, profile photo, and password. Read-only account details are below.
      </p>
      {(message || error) && (
        <p className={error ? 'error' : 'muted'} style={{ marginBottom: '1rem' }}>
          {error || message}
        </p>
      )}
      <div className="account-cards-grid">
        <ProfileCard
          user={user}
          avatarLoadError={avatarLoadError}
          avatarPreview={avatarPreview}
          fileInputRef={fileInputRef}
          onAvatarFile={onAvatarFile}
          profileBusy={profileBusy}
          removeAvatar={removeAvatar}
          saveNames={saveNames}
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          displayPreview={displayPreview}
          namesBusy={namesBusy}
        />
        <PasswordCard
          passwordMessage={passwordMessage}
          passwordError={passwordError}
          changePassword={changePassword}
          currentPassword={currentPassword}
          setCurrentPassword={setCurrentPassword}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          passwordBusy={passwordBusy}
        />
        <CompanyLogoCard
          user={user}
          companyLogoLoadError={companyLogoLoadError}
          companyLogoPreview={companyLogoPreview}
          companyLogoInputRef={companyLogoInputRef}
          onCompanyLogoFile={onCompanyLogoFile}
          companyLogoBusy={companyLogoBusy}
          removeCompanyLogo={removeCompanyLogo}
        />
        <AccountCard user={user} orgLabel={orgLabel} />
      </div>
      {user.organizationKind === 'client' ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 className="settings-section-title">Organization services</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {canManageOrgServices
              ? 'Manage the services your client is paying for. Only Rhythm Engine changes app behavior.'
              : 'These are the services enabled for your client. Only Rhythm Engine changes app behavior.'}
          </p>
          {canManageOrgServices && orgServicesError ? (
            <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
              {orgServicesError}
            </p>
          ) : null}
          {canManageOrgServices && orgServicesMessage ? (
            <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
              {orgServicesMessage}
            </p>
          ) : null}
          <form onSubmit={saveOrganizationServices}>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              {selectedOrgServices.length ? (
                selectedOrgServices.map((service) => (
                  <div
                    key={service.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.45rem 0.6rem',
                      border: '1px solid var(--line)',
                      borderRadius: '0.5rem',
                    }}
                  >
                    <span>{service.label}</span>
                    {canManageOrgServices ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={orgServicesBusy}
                        onClick={() => removeOrgService(service.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  No services added yet.
                </p>
              )}
            </div>
            {canManageOrgServices ? (
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
                <select
                  value={serviceToAdd}
                  disabled={orgServicesBusy || addableOrgServices.length === 0}
                  onChange={(e) => setServiceToAdd(e.target.value)}
                  style={{ minWidth: '240px' }}
                >
                  <option value="">
                    {addableOrgServices.length ? 'Select a service to add' : 'All services are added'}
                  </option>
                  {addableOrgServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={orgServicesBusy || !serviceToAdd}
                  onClick={() => addOrgService(serviceToAdd)}
                >
                  Add service
                </button>
              </div>
            ) : null}
            {canManageOrgServices ? (
              <button type="submit" className="btn btn-ghost" disabled={orgServicesBusy} style={{ marginTop: '0.9rem' }}>
                Save services
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </Layout>
  );
}
