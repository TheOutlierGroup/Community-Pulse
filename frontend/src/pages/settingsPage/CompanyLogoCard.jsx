import { Building2 } from 'lucide-react';

export default function CompanyLogoCard({
  user,
  companyLogoLoadError,
  companyLogoPreview,
  companyLogoInputRef,
  onCompanyLogoFile,
  companyLogoBusy,
  removeCompanyLogo,
}) {
  if (user.organizationKind !== 'client' || user.role !== 'admin') return null;

  return (
    <div className="card account-card">
      <h2 className="settings-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Building2 size={22} strokeWidth={1.75} aria-hidden />
        Company logo
      </h2>
      <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
        Logo for {user.organizationName || 'your organization'}. Your team and Outlier platform staff can see it in
        the client workspace.
      </p>
      {companyLogoLoadError ? (
        <p className="error" style={{ marginBottom: '0.75rem' }}>
          {companyLogoLoadError}
        </p>
      ) : null}
      <div className="company-logo-preview-wrap">
        {companyLogoPreview ? (
          <img src={companyLogoPreview} alt="" className="company-logo-preview" />
        ) : (
          <span className="muted" style={{ fontSize: '0.9rem' }}>
            No logo uploaded yet.
          </span>
        )}
      </div>
      <input
        ref={companyLogoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="visually-hidden"
        onChange={onCompanyLogoFile}
        disabled={companyLogoBusy}
      />
      <div className="settings-avatar-actions" style={{ marginTop: '0.25rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={companyLogoBusy}
          onClick={() => companyLogoInputRef.current?.click()}
        >
          {companyLogoBusy ? 'Working…' : user.organizationHasCompanyLogo ? 'Change logo' : 'Upload logo'}
        </button>
        {user.organizationHasCompanyLogo ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={companyLogoBusy}
            onClick={removeCompanyLogo}
          >
            Remove logo
          </button>
        ) : null}
      </div>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>
        JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
      </p>
    </div>
  );
}
