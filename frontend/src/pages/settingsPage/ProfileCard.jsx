import { UserCircle } from 'lucide-react';

export default function ProfileCard({
  user,
  avatarLoadError,
  avatarPreview,
  fileInputRef,
  onAvatarFile,
  profileBusy,
  removeAvatar,
  saveNames,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  displayPreview,
  namesBusy,
}) {
  return (
    <div className="card" style={{ maxWidth: 480, marginBottom: '1.25rem' }}>
      <h2 className="settings-section-title">Your profile</h2>
      {avatarLoadError ? (
        <p className="error" style={{ marginBottom: '0.75rem' }}>
          {avatarLoadError}
        </p>
      ) : null}
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
          {user.hasProfileAvatar ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={profileBusy}
              onClick={removeAvatar}
            >
              Remove photo
            </button>
          ) : null}
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
  );
}
