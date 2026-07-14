import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Navigation from './Navigation.jsx';
import PlatformNotificationBell from './PlatformNotificationBell.jsx';
import StatusBanner from './StatusBanner.jsx';
import SupportImpersonationBanner from './SupportImpersonationBanner.jsx';
import SupportTicketButton from './SupportTicketButton.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import { sidebarBrandTargetForRoute } from './layoutRouteTarget.js';
import outlierLogo from '../../images/outlier-logo.png';
import rhythmEngineLogo from '../../images/rhythm-engine-logo.png';
import { useAuth } from './Auth.jsx';
import { IS_RHYTHM_ENGINE_SURFACE } from '../../config/appSurface.js';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pulse_sidebar_collapsed';

function readStoredSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Layout({ children, user, onLogout, hideHeader = false, navContext = null }) {
  const location = useLocation();
  const params = useParams();
  const { brand } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore storage errors (private browsing, quota, etc.) — the toggle
      // still works for the current page, it just won't persist.
    }
  }, [sidebarCollapsed]);

  // INF-06: white-label chrome when the user is on a licensee workspace
  // or on a downstream client of one. `brand.logoUrl` falls back to the
  // bundled Outlier logo when the licensee hasn't uploaded one yet — or to
  // the Rhythm Engine logo when this is the standalone Rhythm Engine
  // surface (a licensee's own upload still takes priority over both).
  const brandLogoSrc = brand?.logoUrl || (IS_RHYTHM_ENGINE_SURFACE ? rhythmEngineLogo : outlierLogo);
  const brandLabel = brand?.displayName || (IS_RHYTHM_ENGINE_SURFACE ? 'Rhythm Engine' : 'Outlier');

  if (hideHeader) {
    return (
      <div className="app-shell">
        <main className="app-main app-main--flush">{children}</main>
      </div>
    );
  }

  if (user) {
    const sidebarBrandTarget = sidebarBrandTargetForRoute({
      user,
      pathname: location.pathname,
      orgId: params.orgId,
    });

    return (
      <div className={`app-shell app-shell--with-sidebar${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
        <aside className="app-sidebar" aria-label="Main navigation">
          <div className="app-sidebar__inner">
            <div className="sidebar-brand-row">
              <Link
                to={sidebarBrandTarget}
                className="sidebar-brand"
                aria-label={`${brandLabel} home`}
                title={brandLabel}
              >
                <img
                  src={brandLogoSrc}
                  alt=""
                  className="sidebar-brand-logo"
                  decoding="async"
                />
              </Link>
              <button
                type="button"
                className="sidebar-collapse-toggle"
                onClick={() => setSidebarCollapsed((current) => !current)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
                ) : (
                  <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </div>
            <Navigation user={user} onLogout={onLogout} variant="sidebar" navContext={navContext} />
          </div>
        </aside>
        <div className="app-content">
          <SupportImpersonationBanner />
          <StatusBanner />
          <AnnouncementBanner />
          <header className="app-topbar">
            <div className="app-topbar__fill" aria-hidden />
            {user.organizationKind === 'platform' && user.role === 'admin' ? (
              <PlatformNotificationBell />
            ) : null}
          </header>
          <main className="app-main">{children}</main>
        </div>
        {user.organizationKind === 'licensee' ? <SupportTicketButton /> : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <StatusBanner />
      <header className="app-header">
        <Link to="/" className="brand brand-with-logo" aria-label={`${brandLabel} home`} title={brandLabel}>
          <img src={brandLogoSrc} alt="" className="brand-logo" decoding="async" />
        </Link>
        <Navigation user={user} onLogout={onLogout} navContext={navContext} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
