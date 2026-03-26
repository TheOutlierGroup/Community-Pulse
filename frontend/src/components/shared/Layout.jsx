import { Link, useLocation, useParams } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import PlatformNotificationBell from './PlatformNotificationBell.jsx';
import { getPostLoginPath } from '../../utils/postLogin.js';
import outlierLogo from '../../images/outlier-logo.png';

export default function Layout({ children, user, onLogout, hideHeader = false, navContext = null }) {
  const location = useLocation();
  const params = useParams();

  if (hideHeader) {
    return (
      <div className="app-shell">
        <main className="app-main app-main--flush">{children}</main>
      </div>
    );
  }

  if (user) {
    const platformClientOrgId =
      user.organizationKind === 'platform' && params.orgId ? params.orgId : null;
    const isPlatformPulseRoute =
      Boolean(platformClientOrgId) &&
      location.pathname === `/platform/clients/${platformClientOrgId}/pulse`;
    const sidebarBrandTarget = isPlatformPulseRoute
      ? `/platform/clients/${platformClientOrgId}`
      : getPostLoginPath(user);

    return (
      <div className="app-shell app-shell--with-sidebar">
        <aside className="app-sidebar" aria-label="Main navigation">
          <div className="app-sidebar__inner">
            <Link
              to={sidebarBrandTarget}
              className="sidebar-brand"
              aria-label="Outlier home"
            >
              <img
                src={outlierLogo}
                alt=""
                className="sidebar-brand-logo"
                decoding="async"
              />
            </Link>
            <Navigation user={user} onLogout={onLogout} variant="sidebar" navContext={navContext} />
          </div>
        </aside>
        <div className="app-content">
          <header className="app-topbar">
            <div className="app-topbar__fill" aria-hidden />
            {user.organizationKind === 'platform' && user.role === 'admin' ? (
              <PlatformNotificationBell />
            ) : null}
          </header>
          <main className="app-main">{children}</main>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand brand-with-logo" aria-label="Outlier home">
          <img src={outlierLogo} alt="" className="brand-logo" decoding="async" />
        </Link>
        <Navigation user={user} onLogout={onLogout} navContext={navContext} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
