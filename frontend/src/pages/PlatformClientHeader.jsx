import { Building2 } from 'lucide-react';

export default function PlatformClientHeader({ orgName, subtitle, logoSrc }) {
  return (
    <div className="page-header-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
      <div>
        <h1
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            margin: 0,
            flexWrap: 'wrap',
          }}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt=""
              className="platform-client-header-logo"
              width={48}
              height={48}
            />
          ) : (
            <Building2 size={28} strokeWidth={1.75} aria-hidden />
          )}
          {orgName}
        </h1>
        {subtitle ? (
          <p className="muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
