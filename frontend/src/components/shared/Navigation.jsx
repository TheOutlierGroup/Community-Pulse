import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  LayoutDashboard,
  Gauge,
  Building2,
  Activity,
  Users,
  ArrowLeft,
  ClipboardList,
  CircleUser,
  UserPlus,
  SlidersHorizontal,
  Plus,
} from 'lucide-react';
import {
  CLIENT_SERVICE_PULSE,
  hasService,
  userHasService,
} from '../../utils/clientServices.js';
import api from '../../services/api.js';
import { rhythmEngineAppBaseUrl } from '../../config/appSurface.js';

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
    location.pathname.startsWith(`/platform/clients/${platformClientOrgId}/rhythm-engine`);
  const activePulseSection = isPlatformPulseRoute
    ? location.pathname.endsWith('/rhythm-engine/users')
      ? 'pulse-users'
      : (location.hash || '#organisation-dashboard').replace(/^#/, '')
    : '';
  const pulseClientName = String(navContext?.clientOrganization?.name || '').trim();
  const pulseTimepoint = String(navContext?.pulseTimepoint || 'during');
  const setPulseTimepoint = navContext?.setPulseTimepoint;
  const pulseDuringDate = String(navContext?.pulseDuringDate || '');
  const setPulseDuringDate = navContext?.setPulseDuringDate;
  const pulseTimepointOptions = Array.isArray(navContext?.pulseTimepointOptions)
    ? navContext.pulseTimepointOptions
    : [];
  const pulseTimepointBusy = Boolean(navContext?.pulseTimepointBusy);
  const pulseTimepointError = String(navContext?.pulseTimepointError || '');
  const createPulseDuringTimepoint = navContext?.createPulseDuringTimepoint;
  const preOption = pulseTimepointOptions.find((row) => row.phase === 'pre');
  const completedOption = pulseTimepointOptions.find((row) => row.phase === 'completed');
  const duringOptions = pulseTimepointOptions.filter((row) => row.phase === 'during');
  const duringValue = pulseDuringDate || duringOptions[0]?.dateKey || '';
  const timepointSelectValue =
    pulseTimepoint === 'pre'
      ? 'pre'
      : pulseTimepoint === 'completed'
        ? 'completed'
        : duringValue
          ? `during:${duringValue}`
          : 'during';

  function pulseSectionLinkClass(sectionId) {
    return `sidebar-nav-link${activePulseSection === sectionId ? ' sidebar-nav-link--active' : ''}`;
  }

  function onPulseTimepointSelect(nextValue) {
    if (typeof setPulseTimepoint !== 'function') return;
    if (nextValue === 'pre') {
      setPulseTimepoint('pre');
      if (typeof setPulseDuringDate === 'function') setPulseDuringDate('');
      return;
    }
    if (nextValue === 'completed') {
      setPulseTimepoint('completed');
      if (typeof setPulseDuringDate === 'function') setPulseDuringDate('');
      return;
    }
    const dateKey = nextValue.startsWith('during:') ? nextValue.slice('during:'.length) : '';
    setPulseTimepoint('during');
    if (typeof setPulseDuringDate === 'function') setPulseDuringDate(dateKey);
  }

  async function openPulseTabForPlatformClient() {
    if (!platformClientOrgId || pulseLaunching) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      setPulseLaunchError('Popup blocked. Please allow popups for this site.');
      return;
    }
    popup.document.title = 'Opening Rhythm Engine...';
    popup.document.body.innerHTML = '<p style="font-family:system-ui;padding:16px;">Opening Rhythm Engine...</p>';

    setPulseLaunching(true);
    setPulseLaunchError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${platformClientOrgId}/rhythm-engine-handoff-link`);
      const url = String(data?.url || '');
      if (!url) throw new Error('Missing URL');

      const configuredPulseBase = rhythmEngineAppBaseUrl();
      if (configuredPulseBase) {
        const expectedOrigin = new URL(configuredPulseBase).origin;
        const actualOrigin = new URL(url).origin;
        if (expectedOrigin !== actualOrigin) {
          throw new Error('Rhythm Engine origin mismatch');
        }
      }

      // Ensure the opened tab does not retain access back to this window.
      popup.opener = null;
      popup.location.replace(url);
    } catch (_e) {
      popup.close();
      setPulseLaunchError('Could not open Rhythm Engine right now.');
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
                  <section className="sidebar-pulse-timepoint" aria-label="Rhythm Engine point in time">
                    <div className="sidebar-pulse-timepoint__head">
                      <span className="sidebar-pulse-timepoint__title">Point in time</span>
                      {pulseTimepoint === 'during' ? (
                        <button
                          type="button"
                          className="sidebar-pulse-timepoint__add"
                          onClick={() => {
                            if (typeof createPulseDuringTimepoint === 'function') createPulseDuringTimepoint();
                          }}
                          disabled={pulseTimepointBusy}
                          aria-label="Create new during checkpoint"
                          title="Create new during checkpoint"
                        >
                          <Plus size={14} strokeWidth={2.25} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    <select
                      className="sidebar-pulse-timepoint__select"
                      value={timepointSelectValue}
                      onChange={(e) => onPulseTimepointSelect(e.target.value)}
                      disabled={pulseTimepointBusy}
                      aria-label="Select Rhythm Engine point in time"
                    >
                      <option value="pre">Pre{preOption ? ` · ${preOption.label}` : ''}</option>
                      {duringOptions.map((option) => (
                        <option key={option.id} value={`during:${option.dateKey}`}>
                          During · {option.label}
                        </option>
                      ))}
                      {!duringOptions.length ? <option value="during">During</option> : null}
                      <option value="completed">
                        Post{completedOption ? ` · ${completedOption.label}` : ''}
                      </option>
                    </select>
                    {pulseTimepointError ? (
                      <p className="sidebar-pulse-timepoint__error">{pulseTimepointError}</p>
                    ) : null}
                  </section>
                  <div className="sidebar-nav-divider" aria-hidden />
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#organisation-dashboard`}
                    className={pulseSectionLinkClass('organisation-dashboard')}
                  >
                    <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                    Organisation Dashboard
                  </Link>
                  <NavLink
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine/users`}
                    className={pulseSectionLinkClass('pulse-users')}
                  >
                    <UserPlus size={20} strokeWidth={1.75} aria-hidden />
                    Users
                  </NavLink>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#team-level-view`}
                    className={pulseSectionLinkClass('team-level-view')}
                  >
                    <Users size={20} strokeWidth={1.75} aria-hidden />
                    Team-Level View
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#manager-load-report`}
                    className={pulseSectionLinkClass('manager-load-report')}
                  >
                    <Gauge size={20} strokeWidth={1.75} aria-hidden />
                    Manager Load Report
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
                    <button
                      type="button"
                      className="sidebar-nav-link sidebar-nav-link--button"
                      onClick={openPulseTabForPlatformClient}
                      disabled={pulseLaunching}
                    >
                      <Activity size={20} strokeWidth={1.75} aria-hidden />
                      {pulseLaunching ? 'Opening Rhythm Engine…' : 'Rhythm Engine'}
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
              <NavLink to="/platform/tasks" className={sidebarLinkClass}>
                <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                Tasks
              </NavLink>
              <NavLink to="/platform/users" className={sidebarLinkClass}>
                <Users size={20} strokeWidth={1.75} aria-hidden />
                Users
              </NavLink>
              {user.role === 'admin' && (
                <NavLink to="/platform/settings" className={sidebarLinkClass}>
                  <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
                  Settings
                </NavLink>
              )}
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
            <NavLink to="/rhythm-engine" className={sidebarLinkClass}>
              <Activity size={20} strokeWidth={1.75} aria-hidden />
              My Rhythm Engine
            </NavLink>
          )}
        </nav>
        {!isPlatformPulseRoute && (
          <div className="sidebar-footer">
            <NavLink to="/account" className={sidebarLinkClass}>
              <CircleUser size={20} strokeWidth={1.75} aria-hidden />
              Account
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
        <Link to="/rhythm-engine" className="btn btn-ghost nav-link-btn">
          <Activity size={18} strokeWidth={2} aria-hidden />
          My Rhythm Engine
        </Link>
      )}
      <Link to="/account" className="btn btn-ghost nav-link-btn">
        <CircleUser size={18} strokeWidth={2} aria-hidden />
        Account
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
