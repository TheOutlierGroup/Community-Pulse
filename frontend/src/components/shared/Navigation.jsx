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
  FileText,
  CircleUser,
  Cog,
  UserPlus,
  SlidersHorizontal,
  Briefcase,
  Target,
  Handshake,
  BookUser,
  Megaphone,
} from 'lucide-react';
import {
  CLIENT_SERVICE_PULSE,
  hasService,
  userHasService,
} from '../../utils/clientServices.js';
import api from '../../services/api.js';
import { rhythmEngineAppBaseUrl } from '../../config/appSurface.js';
import { isWorkspaceUser, isLicenseeUser, isEnterpriseClientSelfUser } from '../../hooks/usePlatformAccess.js';
import AuthenticatedBlobImage from '../platform/AuthenticatedBlobImage.jsx';

function sidebarLinkClass({ isActive }) {
  return `sidebar-nav-link${isActive ? ' sidebar-nav-link--active' : ''}`;
}

function formatDateKeyDdMmYy(dateKey) {
  const raw = String(dateKey || '').trim();
  if (!raw) return '';
  const [year, month, day] = raw.split('-');
  if (
    year?.length !== 4
    || month?.length !== 2
    || day?.length !== 2
    || Number.isNaN(Number(year))
    || Number.isNaN(Number(month))
    || Number.isNaN(Number(day))
  ) {
    return raw;
  }
  return `${day}/${month}/${year.slice(-2)}`;
}

function formatTimeHm(createdAt) {
  const raw = String(createdAt || '').trim();
  if (!raw) return '';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Navigation({ user, onLogout, variant = 'header', navContext = null }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const [pulseLaunching, setPulseLaunching] = useState(false);
  const [pulseLaunchError, setPulseLaunchError] = useState('');
  const isWorkspace = isWorkspaceUser(user);
  const isLicensee = isLicenseeUser(user);
  const isEnterpriseClientSelf = isEnterpriseClientSelfUser(user);
  const platformClientOrgId =
    (isWorkspace || isEnterpriseClientSelf) && params.orgId ? params.orgId : null;
  const platformProspectId =
    isWorkspace && params.id && location.pathname.startsWith('/platform/crm/organisations/')
      ? params.id
      : null;
  const myAccountHref = platformClientOrgId ? `/platform/clients/${platformClientOrgId}/my-account` : '/account';
  const myAccountLabel = user?.firstName?.trim() || user?.email || 'Account';
  const myAccountAvatar = user?.hasProfileAvatar ? (
    <AuthenticatedBlobImage path="/api/auth/me/avatar" alt="" className="sidebar-nav-avatar" />
  ) : (
    <CircleUser size={20} strokeWidth={1.75} aria-hidden />
  );
  const clientPulseEnabled = userHasService(user, CLIENT_SERVICE_PULSE);
  const platformViewedClientPulseEnabled = hasService(navContext?.clientOrganization?.settings, CLIENT_SERVICE_PULSE);
  const isPlatformPulseRoute =
    Boolean(platformClientOrgId) &&
    location.pathname.startsWith(`/platform/clients/${platformClientOrgId}/rhythm-engine`);
  const activePulseSection = isPlatformPulseRoute
    ? location.pathname.endsWith('/rhythm-engine/users')
      ? 'pulse-users'
      : location.pathname.endsWith('/rhythm-engine/settings')
        ? 'pulse-settings'
        : (location.hash || '#organisation-dashboard').replace(/^#/, '')
    : '';
  const pulseClientName = String(navContext?.clientOrganization?.name || '').trim();
  const pulseTimepoint = String(navContext?.pulseTimepoint || 'pre');
  const setPulseTimepoint = navContext?.setPulseTimepoint;
  const setPulseDuringDate = navContext?.setPulseDuringDate;
  const pulseDuringSessionId = String(navContext?.pulseDuringSessionId || '');
  const setPulseDuringSessionId = navContext?.setPulseDuringSessionId;
  const pulseTimepointOptions = Array.isArray(navContext?.pulseTimepointOptions)
    ? navContext.pulseTimepointOptions
    : [];
  const pulseTimepointBusy = Boolean(navContext?.pulseTimepointBusy);
  const pulseTimepointError = String(navContext?.pulseTimepointError || '');
  const trendAnalysisVisible = Boolean(navContext?.trendAnalysisVisible);
  const preOption = pulseTimepointOptions.find((row) => row.phase === 'pre');
  const completedOption = pulseTimepointOptions.find((row) => row.phase === 'completed');
  const duringOptions = pulseTimepointOptions.filter((row) => row.phase === 'during');
  const primaryDuringOption = duringOptions.length > 0 ? duringOptions[duringOptions.length - 1] : null;
  const additionalDuringOptions = primaryDuringOption
    ? duringOptions.filter((row) => row.id !== primaryDuringOption.id)
    : [];
  const additionalDuringDateCounts = additionalDuringOptions.reduce((acc, option) => {
    const key = String(option.dateKey || '').trim();
    if (!key) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
  const duringValue = pulseDuringSessionId || primaryDuringOption?.id || duringOptions[0]?.id || '';
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
      if (typeof setPulseDuringSessionId === 'function') setPulseDuringSessionId('');
      return;
    }
    if (nextValue === 'completed') {
      setPulseTimepoint('completed');
      if (typeof setPulseDuringDate === 'function') setPulseDuringDate('');
      if (typeof setPulseDuringSessionId === 'function') setPulseDuringSessionId('');
      return;
    }
    if (nextValue === 'during') {
      setPulseTimepoint('during');
      if (typeof setPulseDuringDate === 'function') setPulseDuringDate('');
      if (typeof setPulseDuringSessionId === 'function') setPulseDuringSessionId('');
      return;
    }
    const dateKey = nextValue.startsWith('during:') ? nextValue.slice('during:'.length) : '';
    const matchingDuring = duringOptions.find((option) => option.id === dateKey);
    setPulseTimepoint('during');
    if (typeof setPulseDuringDate === 'function') setPulseDuringDate(matchingDuring?.dateKey || '');
    if (typeof setPulseDuringSessionId === 'function') setPulseDuringSessionId(dateKey);
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
    } catch (e) {
      popup.close();
      setPulseLaunchError(e.response?.data?.error || 'Could not open Rhythm Engine right now.');
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
          {(isWorkspace || isEnterpriseClientSelf) && platformClientOrgId && (
            <>
              {isPlatformPulseRoute ? (
                <>
                  <div className="sidebar-nav-label" aria-label="Client name">
                    <Building2 size={20} strokeWidth={1.75} aria-hidden />
                    <span className="sidebar-nav-label__text">{pulseClientName || 'Client'}</span>
                  </div>
                  <section className="sidebar-pulse-timepoint" aria-label="Rhythm Engine point in time">
                    <div className="sidebar-pulse-timepoint__head">
                      <span className="sidebar-pulse-timepoint__title">Point in time</span>
                    </div>
                    <select
                      className="sidebar-pulse-timepoint__select"
                      value={timepointSelectValue}
                      onChange={(e) => onPulseTimepointSelect(e.target.value)}
                      disabled={pulseTimepointBusy}
                      aria-label="Select Rhythm Engine point in time"
                    >
                      <option value="pre">Pre{preOption ? ` · ${preOption.label}` : ''}</option>
                      {primaryDuringOption ? (
                        <option key={primaryDuringOption.id} value={`during:${primaryDuringOption.id}`}>
                          {`During · ${formatDateKeyDdMmYy(primaryDuringOption.dateKey)}`}
                        </option>
                      ) : null}
                      {additionalDuringOptions.map((option) => (
                        <option key={option.id} value={`during:${option.id}`}>
                          {`During · ${formatDateKeyDdMmYy(option.dateKey)}${
                            (additionalDuringDateCounts.get(String(option.dateKey || '').trim()) || 0) > 1
                              ? ` ${formatTimeHm(option.createdAt)}`
                              : ''
                          }`}
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
                    Organisation View
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#team-level-view`}
                    className={pulseSectionLinkClass('team-level-view')}
                  >
                    <Users size={20} strokeWidth={1.75} aria-hidden />
                    People View
                  </Link>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#sponsorship-analysis`}
                    className={pulseSectionLinkClass('sponsorship-analysis')}
                  >
                    <Gauge size={20} strokeWidth={1.75} aria-hidden />
                    Manager View
                  </Link>
                  {trendAnalysisVisible ? (
                    <Link
                      to={`/platform/clients/${platformClientOrgId}/rhythm-engine#trend-analysis`}
                      className={pulseSectionLinkClass('trend-analysis')}
                    >
                      <Activity size={20} strokeWidth={1.75} aria-hidden />
                      Trend Analysis
                    </Link>
                  ) : null}
                  <NavLink
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine/users`}
                    className={pulseSectionLinkClass('pulse-users')}
                  >
                    <UserPlus size={20} strokeWidth={1.75} aria-hidden />
                    Users
                  </NavLink>
                  <Link
                    to={`/platform/clients/${platformClientOrgId}/rhythm-engine#reports`}
                    className={pulseSectionLinkClass('reports')}
                  >
                    <FileText size={20} strokeWidth={1.75} aria-hidden />
                    Reports
                  </Link>
                  {user.role === 'admin' ? (
                    <NavLink
                      to={`/platform/clients/${platformClientOrgId}/rhythm-engine/settings`}
                      className={pulseSectionLinkClass('pulse-settings')}
                    >
                      <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
                      Settings
                    </NavLink>
                  ) : null}
                </>
              ) : isEnterpriseClientSelf ? (
                <>
                  <NavLink
                    to={`/platform/clients/${platformClientOrgId}`}
                    className={sidebarLinkClass}
                    end
                  >
                    <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                    Dashboard
                  </NavLink>
                  {user.role === 'admin' && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/users`} className={sidebarLinkClass}>
                      <Users size={20} strokeWidth={1.75} aria-hidden />
                      Users
                    </NavLink>
                  )}
                  <NavLink to={`/platform/clients/${platformClientOrgId}/tasks`} className={sidebarLinkClass}>
                    <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                    Tasks
                  </NavLink>
                  {user.role === 'admin' && (
                    <NavLink
                      to={`/platform/clients/${platformClientOrgId}/rhythm-engine`}
                      className={sidebarLinkClass}
                    >
                      <Activity size={20} strokeWidth={1.75} aria-hidden />
                      Rhythm Engine
                    </NavLink>
                  )}
                  <NavLink to={`/platform/clients/${platformClientOrgId}/account`} className={sidebarLinkClass}>
                    <Cog size={20} strokeWidth={1.75} aria-hidden />
                    Configurations
                  </NavLink>
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
                  {!isLicensee && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/users`} className={sidebarLinkClass}>
                      <Users size={20} strokeWidth={1.75} aria-hidden />
                      Users
                    </NavLink>
                  )}
                  {!isLicensee && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/tasks`} className={sidebarLinkClass}>
                      <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                      Tasks
                    </NavLink>
                  )}
                  {!isLicensee && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/projects`} className={sidebarLinkClass}>
                      <Briefcase size={20} strokeWidth={1.75} aria-hidden />
                      Projects
                    </NavLink>
                  )}
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
                    <Cog size={20} strokeWidth={1.75} aria-hidden />
                    Configurations
                  </NavLink>
                  {!isLicensee && (
                    <NavLink to={`/platform/clients/${platformClientOrgId}/activity`} className={sidebarLinkClass}>
                      <FileText size={20} strokeWidth={1.75} aria-hidden />
                      Recent activity
                    </NavLink>
                  )}
                </>
              )}
            </>
          )}
          {isWorkspace && !platformClientOrgId && !platformProspectId && (
            <>
              <NavLink to="/platform" className={sidebarLinkClass} end>
                <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                Dashboard
              </NavLink>
              <NavLink to="/platform/clients" className={sidebarLinkClass}>
                <Building2 size={20} strokeWidth={1.75} aria-hidden />
                Clients
              </NavLink>
              <NavLink to="/platform/crm/organisations" className={sidebarLinkClass}>
                <Handshake size={20} strokeWidth={1.75} aria-hidden />
                Prospects
              </NavLink>
              {!isLicensee && (
                <NavLink to="/platform/campaigns" className={sidebarLinkClass}>
                  <Megaphone size={20} strokeWidth={1.75} aria-hidden />
                  Campaigns
                </NavLink>
              )}
              {!isLicensee && (
                <NavLink to="/platform/contacts" className={sidebarLinkClass}>
                  <BookUser size={20} strokeWidth={1.75} aria-hidden />
                  Contacts
                </NavLink>
              )}
              {!isLicensee && (
                <NavLink to="/platform/tasks" className={sidebarLinkClass}>
                  <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                  Tasks
                </NavLink>
              )}
              {(isLicensee || user.role !== 'basic') && (
                <NavLink to="/platform/users" className={sidebarLinkClass}>
                  <Users size={20} strokeWidth={1.75} aria-hidden />
                  Users
                </NavLink>
              )}
              {!isLicensee && (user.role === 'admin' || user.role === 'platform') && (
                <NavLink to="/platform/settings" className={sidebarLinkClass}>
                  <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
                  Settings
                </NavLink>
              )}
            </>
          )}
          {isWorkspace && platformProspectId && (
            <>
              <NavLink to="/platform/crm/organisations" className={sidebarLinkClass}>
                <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
                All prospects
              </NavLink>
              <div className="sidebar-nav-divider" aria-hidden />
              <NavLink to={`/platform/crm/organisations/${platformProspectId}`} className={sidebarLinkClass} end>
                <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
                Dashboard
              </NavLink>
              <NavLink to={`/platform/crm/organisations/${platformProspectId}/tasks`} className={sidebarLinkClass}>
                <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
                Tasks
              </NavLink>
              <NavLink to={`/platform/crm/organisations/${platformProspectId}/opportunity`} className={sidebarLinkClass}>
                <Target size={20} strokeWidth={1.75} aria-hidden />
                Opportunity
              </NavLink>
              <NavLink to={`/platform/crm/organisations/${platformProspectId}/configurations`} className={sidebarLinkClass}>
                <Cog size={20} strokeWidth={1.75} aria-hidden />
                Configurations
              </NavLink>
              <NavLink to={`/platform/crm/organisations/${platformProspectId}/activity`} className={sidebarLinkClass}>
                <FileText size={20} strokeWidth={1.75} aria-hidden />
                Recent activity
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
            <NavLink to="/rhythm-engine" className={sidebarLinkClass}>
              <Activity size={20} strokeWidth={1.75} aria-hidden />
              My Rhythm Engine
            </NavLink>
          )}
        </nav>
        {!isPlatformPulseRoute && (
          <div className="sidebar-footer">
            <NavLink to={myAccountHref} className={sidebarLinkClass} title={myAccountLabel}>
              {myAccountAvatar}
              <span className="sidebar-nav-link__label">{myAccountLabel}</span>
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
      {isWorkspace && (
        <Link to="/platform" className="btn btn-ghost nav-link-btn">
          <LayoutDashboard size={18} strokeWidth={2} aria-hidden />
          {isLicensee ? 'Workspace' : 'Platform'}
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
      <Link to={myAccountHref} className="btn btn-ghost nav-link-btn">
        {myAccountAvatar}
        {myAccountLabel}
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
