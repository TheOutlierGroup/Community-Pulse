import { Link, useLocation, useParams } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import PlatformNotificationBell from './PlatformNotificationBell.jsx';
import StatusBanner from './StatusBanner.jsx';
import SupportImpersonationBanner from './SupportImpersonationBanner.jsx';
import SupportTicketButton from './SupportTicketButton.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import { sidebarBrandTargetForRoute } from './layoutRouteTarget.js';
import outlierLogo from '../../images/outlier-logo.png';
import { useAuth } from './Auth.jsx';

export default function Layout({ children, user, onLogout, hideHeader = false, navContext = null }) {
  const location = useLocation();
  const params = useParams();
  const { brand } = useAuth();

  // INF-06: white-label chrome when the user is on a licensee workspace
  // or on a downstream client of one. `brand.logoUrl` falls back to the
  // bundled Outlier logo when the licensee hasn't uploaded one yet.
  const brandLogoSrc = brand?.logoUrl || outlierLogo;
  const brandLabel = brand?.displayName || 'Outlier';

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
      <div className="app-shell app-shell--with-sidebar">
        <aside className="app-sidebar" aria-label="Main navigation">
          <div className="app-sidebar__inner">
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
