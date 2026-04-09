import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  LayoutDashboard,
  BarChart3,
  LineChart,
  Gauge,
  Building2,
  Activity,
  Users,
  Settings,
  ArrowLeft,
  ClipboardList,
  CircleUser,
  UserPlus,
} from 'lucide-react';
import {
  CLIENT_SERVICE_PULSE,
  hasService,
  userHasService,
} from '../../utils/clientServices.js';
import api from '../../services/api.js';
import { pulseAppBaseUrl } from '../../config/appSurface.js';

function sidebarLinkClass({ isActive }) {
  return `sidebar-nav-link${isActive ? ' sidebar-nav-link--active' : ''}`;
}

export default function Navigation({ user, onLogout, variant = 'header', navContext = null }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const [pulseLaunching, setPulseLaunching] = useState(false);
  const [pulseLaunchError, setPulseLaunchError] = useState('');
  const platformClientOrgId =
    user?.organizationKind === 'platform' && params.orgId ? params.orgId : null;
  const clientPulseEnabled = userHasService(user, CLIENT_SERVICE_PULSE);
  const platformViewedClientPulseEnabled = hasService(navContext?.clientOrganization?.settings, CLIENT_SERVICE_PULSE);
  const isPlatformPulseRoute =
    Boolean(platformClientOrgId) &&
    location.pathname.startsWith(`/platform/clients/${platformClientOrgId}/pulse`);
  const activePulseSection = isPlatformPulseRoute
    ? location.pathname.endsWith('/pulse/users')
      ? 'pulse-users'
      : (location.hash || '#organisation-dashboard').replace(/^#/, '')
    : '';
  const pulseClientName = String(navContext?.clientOrganization?.name || '').trim();
  const pulseSelectedManagerIds = Array.isArray(navContext?.pulseSelectedManagerIds)
    ? navContext.pulseSelectedManagerIds
    : [];
  const setPulseSelectedManagerIds = navContext?.setPulseSelectedManagerIds;
  const pulseIncludeManagerSelf = Boolean(navContext?.pulseIncludeManagerSelf);
  const setPulseIncludeManagerSelf = navContext?.setPulseIncludeManagerSelf;
  const pulseManagerOptions = Array.isArray(navContext?.pulseManagerOptions)
    ? navContext.pulseManagerOptions
    : [];

  function pulseSectionLinkClass(sectionId) {
    return `sidebar-nav-link${activePulseSection === sectionId ? ' sidebar-nav-link--active' : ''}`;
  }

  function togglePulseManager(managerId) {
    if (typeof setPulseSelectedManagerIds !== 'function') return;
    const id = String(managerId || '').trim();
    if (!id) return;
    setPulseSelectedManagerIds((current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.includes(id)) return list.filter((value) => value !== id);
      return [...list, id];
    });
  }

  async function openPulseTabForPlatformClient() {
    if (!platformClientOrgId || pulseLaunching) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      setPulseLaunchError('Popup blocked. Please allow popups for this site.');
      return;
    }
    popup.document.title = 'Opening Pulse...';
    popup.document.body.innerHTML = '<p style="font-family:system-ui;padding:16px;">Opening Pulse...</p>';

    setPulseLaunching(true);
    setPulseLaunchError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${platformClientOrgId}/pulse-handoff-link`);
      const url = String(data?.url || '');
      if (!url) throw new Error('Missing URL');

      const configuredPulseBase = pulseAppBaseUrl();
      if (configuredPulseBase) {
        const expectedOrigin = new URL(configuredPulseBase).origin;
        const actualOrigin = new URL(url).origin;
        if (expectedOrigin !== actualOrigin) {
          throw new Error('Pulse origin mismatch');
        }
      }

      // Ensure the opened tab does not retain access back to this window.
      popup.opener = null;
      popup.location.replace(url);
    } catch (_e) {
      popup.close();
      setPulseLaunchError('Could not open Pulse right now.');
    } finally {
      setPulseLaunching(false);
    }
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
                  <div className="sidebar-nav-label" aria-label="Client name">
                    <Building2 size={20} strokeWidth={1.75} aria-hidden />
                    {pulseClientName || 'Client'}
                  </div>
                  <div className="sidebar-nav-divider" aria-hidden />
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#organisation-dashboard`}
                    className={pulseSectionLinkClass('organisation-dashboard')}
                  >
                    <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                    Organisation Dashboard
                  </Link>
                  <NavLink
                    to={`/platform/clients/${platformClientOrgId}/pulse/users`}
                    className={pulseSectionLinkClass('pulse-users')}
                  >
                    <UserPlus size={20} strokeWidth={1.75} aria-hidden />
                    Users
                  </NavLink>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#organisation-scores`}
                    className={pulseSectionLinkClass('organisation-scores')}
                  >
                    <BarChart3 size={20} strokeWidth={1.75} aria-hidden />
                    Organisation Scores
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#employee-breakdown`}
                    className={pulseSectionLinkClass('employee-breakdown')}
                  >
                    <LineChart size={20} strokeWidth={1.75} aria-hidden />
                    Employee Breakdown
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#team-level-view`}
                    className={pulseSectionLinkClass('team-level-view')}
                  >
                    <Users size={20} strokeWidth={1.75} aria-hidden />
                    Team-Level View
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/pulse#manager-load-report`}
                    className={pulseSectionLinkClass('manager-load-report')}
                  >
                    <Gauge size={20} strokeWidth={1.75} aria-hidden />
                    Manager Load Report
                  </Link>
                  <div className="sidebar-nav-divider" aria-hidden />
                  <section className="sidebar-pulse-filter" aria-label="Manager filter">
                    <div className="sidebar-pulse-filter__head">
                      <span className="sidebar-pulse-filter__title">Managers</span>
                      <span className="sidebar-pulse-filter__meta">
                        {pulseSelectedManagerIds.length
                          ? `${pulseSelectedManagerIds.length} selected`
                          : `${pulseManagerOptions.length} available`}
                      </span>
                    </div>
                    <div className="sidebar-pulse-filter__list" role="group" aria-label="Filter by managers">
                      {pulseManagerOptions.length === 0 ? (
                        <p className="sidebar-pulse-filter__empty">No managers available yet</p>
                      ) : (
                        pulseManagerOptions.map((manager) => {
                          const managerId = String(manager.id || '').trim();
                          const selected = pulseSelectedManagerIds.includes(managerId);
                          return (
                            <label key={managerId} className="sidebar-pulse-filter__row">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => togglePulseManager(managerId)}
                              />
                              <span className="sidebar-pulse-filter__name">
                                {manager.displayName?.trim() || manager.email || 'Unnamed manager'}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <label className="sidebar-pulse-filter__toggle">
                      <input
                        type="checkbox"
                        checked={pulseIncludeManagerSelf}
                        onChange={(e) => {
                          if (typeof setPulseIncludeManagerSelf !== 'function') return;
                          setPulseIncludeManagerSelf(e.target.checked);
                        }}
                        disabled={pulseSelectedManagerIds.length === 0}
                      />
                      Include manager
                    </label>
                    <button
                      type="button"
                      className="sidebar-nav-link sidebar-nav-link--button"
                      onClick={() => {
                        if (typeof setPulseSelectedManagerIds === 'function') {
                          setPulseSelectedManagerIds([]);
                        }
                        if (typeof setPulseIncludeManagerSelf === 'function') {
                          setPulseIncludeManagerSelf(false);
                        }
                      }}
                      disabled={pulseSelectedManagerIds.length === 0 && !pulseIncludeManagerSelf}
                    >
                      Clear manager filter
                    </button>
                  </section>
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
                    <button
                      type="button"
                      className="sidebar-nav-link sidebar-nav-link--button"
                      onClick={openPulseTabForPlatformClient}
                      disabled={pulseLaunching}
                    >
                      <Activity size={20} strokeWidth={1.75} aria-hidden />
                      {pulseLaunching ? 'Opening Pulse…' : 'Pulse'}
                    </button>
                  )}
                  {pulseLaunchError && <p className="muted">{pulseLaunchError}</p>}
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
        {!isPlatformPulseRoute && (
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
        )}
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
