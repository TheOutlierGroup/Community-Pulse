import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  LayoutDashboard,
  BarChart3,
  LineChart,
  Gauge,
  SlidersHorizontal,
  Download,
  Building2,
  Activity,
  Users,
  Settings,
  ArrowLeft,
  ClipboardList,
  CircleUser,
} from 'lucide-react';
import {
  CLIENT_SERVICE_PULSE,
  hasService,
  userHasService,
} from '../../utils/clientServices.js';

function sidebarLinkClass({ isActive }) {
  return `sidebar-nav-link${isActive ? ' sidebar-nav-link--active' : ''}`;
}

export default function Navigation({ user, onLogout, variant = 'header', navContext = null }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const platformClientOrgId =
    user?.organizationKind === 'platform' && params.orgId ? params.orgId : null;
  const clientPulseEnabled = userHasService(user, CLIENT_SERVICE_PULSE);
  const platformViewedClientPulseEnabled = hasService(navContext?.clientOrganization?.settings, CLIENT_SERVICE_PULSE);
  const isPlatformPulseRoute =
    Boolean(platformClientOrgId) &&
    location.pathname === `/platform/clients/${platformClientOrgId}/pulse`;
  const activePulseSection = isPlatformPulseRoute
    ? (location.hash || '#organisation-dashboard').replace(/^#/, '')
    : '';

  function pulseSectionLinkClass(sectionId) {
    return `sidebar-nav-link${activePulseSection === sectionId ? ' sidebar-nav-link--active' : ''}`;
  }

  if (!user) {
    return (
      <div className="nav-actions">
        <Link to="/" className="btn btn-ghost nav-link-btn">
          <LogIn size={18} strokeWidth={2} aria-hidden />
          Sign in
        </Link>
      </div>
    );
  }

  if (variant === 'sidebar') {
    return (
      <div className="nav-wrap nav-wrap--sidebar">
        <nav className="sidebar-links" aria-label="Main">
          {user.organizationKind === 'platform' && platformClientOrgId && (
            <>
              {isPlatformPulseRoute ? (
                <>
                  <NavLink to={`/platform/clients/${platformClientOrgId}`} className={sidebarLinkClass} end>
                    <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
                    Back
                  </NavLink>
                  <div className="sidebar-nav-divider" aria-hidden />
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#organisation-dashboard`}
                    className={pulseSectionLinkClass('organisation-dashboard')}
                  >
                    <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                    Organisation Dashboard
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#score-breakdown`}
                    className={pulseSectionLinkClass('score-breakdown')}
                  >
                    <BarChart3 size={20} strokeWidth={1.75} aria-hidden />
                    Score Breakdown
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#trend-analysis`}
                    className={pulseSectionLinkClass('trend-analysis')}
                  >
                    <LineChart size={20} strokeWidth={1.75} aria-hidden />
                    Trend Analysis
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#manager-load-report`}
                    className={pulseSectionLinkClass('manager-load-report')}
                  >
                    <Gauge size={20} strokeWidth={1.75} aria-hidden />
                    Manager Load Report
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#team-level-view`}
                    className={pulseSectionLinkClass('team-level-view')}
                  >
                    <Users size={20} strokeWidth={1.75} aria-hidden />
                    Team-Level View
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#survey-configuration`}
                    className={pulseSectionLinkClass('survey-configuration')}
                  >
                    <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
                    Survey Configuration
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#export-data`}
                    className={pulseSectionLinkClass('export-data')}
                  >
                    <Download size={20} strokeWidth={1.75} aria-hidden />
                    Export Data
                  </Link>
                </>
              ) : (
                <>
                  <NavLink to="/platform/clients" className={sidebarLinkClass}>
                    <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
                    All clients
                  </NavLink>
                  <div className="sidebar-nav-divider" aria-hidden />
                  <NavLink
                    to={`/platform/clients/${platformClientOrgId}`}
                    className={sidebarLinkClass}
                    end
                  >
                    <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                    Dashboard
                  </NavLink>
                  <NavLink to={`/platform/clients/${platformClientOrgId}/users`} className={sidebarLinkClass}>
                    <Users size={20} strokeWidth={1.75} aria-hidden />
                    Users
                  </NavLink>
                  <NavLink to={`/platform/clients/${platformClientOrgId}/tasks`} className={sidebarLinkClass}>
                    <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                    Tasks
                  </NavLink>
                  {platformViewedClientPulseEnabled && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/pulse`} className={sidebarLinkClass}>
                      <Activity size={20} strokeWidth={1.75} aria-hidden />
                      Pulse
                    </NavLink>
                  )}
                  <NavLink to={`/platform/clients/${platformClientOrgId}/account`} className={sidebarLinkClass}>
                    <CircleUser size={20} strokeWidth={1.75} aria-hidden />
                    Account
                  </NavLink>
                </>
              )}
            </>
          )}
          {user.organizationKind === 'platform' && !platformClientOrgId && (
            <>
              <NavLink to="/platform" className={sidebarLinkClass} end>
                <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                Dashboard
              </NavLink>
              <NavLink to="/platform/clients" className={sidebarLinkClass}>
                <Building2 size={20} strokeWidth={1.75} aria-hidden />
                Clients
              </NavLink>
              <NavLink to="/platform/users" className={sidebarLinkClass}>
                <Users size={20} strokeWidth={1.75} aria-hidden />
                Users
              </NavLink>
            </>
          )}
          {user.organizationKind === 'client' && user.role === 'admin' && (
            <>
              <NavLink to="/client" className={sidebarLinkClass} end>
                <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                Dashboard
              </NavLink>
              <NavLink to="/admin#admin-team" className={sidebarLinkClass}>
                <Users size={20} strokeWidth={1.75} aria-hidden />
                Team
              </NavLink>
            </>
          )}
          {user.organizationKind === 'client' && user.role === 'employee' && clientPulseEnabled && (
            <NavLink to="/pulse" className={sidebarLinkClass}>
              <Activity size={20} strokeWidth={1.75} aria-hidden />
              My Pulse
            </NavLink>
          )}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/settings" className={sidebarLinkClass}>
            <Settings size={20} strokeWidth={1.75} aria-hidden />
            Settings
          </NavLink>
          <button
            type="button"
            className="sidebar-nav-link sidebar-nav-link--button sidebar-nav-link--logout"
            onClick={() => {
              onLogout();
              navigate('/');
            }}
          >
            <LogOut size={20} strokeWidth={1.75} aria-hidden />
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="nav-actions">
      {user.organizationKind === 'platform' && (
        <Link to="/platform" className="btn btn-ghost nav-link-btn">
          <LayoutDashboard size={18} strokeWidth={2} aria-hidden />
          Platform
        </Link>
      )}
      {user.organizationKind === 'client' && user.role === 'admin' && (
        <Link to="/client" className="btn btn-ghost nav-link-btn">
          <LayoutDashboard size={18} strokeWidth={2} aria-hidden />
          Dashboard
        </Link>
      )}
      {user.organizationKind === 'client' && user.role === 'admin' && (
        <Link to="/admin#admin-team" className="btn btn-ghost nav-link-btn">
          <Users size={18} strokeWidth={2} aria-hidden />
          Team
        </Link>
      )}
      {user.organizationKind === 'client' && user.role === 'employee' && clientPulseEnabled && (
        <Link to="/pulse" className="btn btn-ghost nav-link-btn">
          <Activity size={18} strokeWidth={2} aria-hidden />
          My Pulse
        </Link>
      )}
      <Link to="/settings" className="btn btn-ghost nav-link-btn">
        <Settings size={18} strokeWidth={2} aria-hidden />
        Settings
      </Link>
      <span className="muted nav-email">{user.email}</span>
      <button
        type="button"
        className="btn btn-ghost nav-link-btn"
        onClick={() => {
          onLogout();
          navigate('/');
        }}
      >
        <LogOut size={18} strokeWidth={2} aria-hidden />
        Log out
      </button>
    </div>
  );
}
