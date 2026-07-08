import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Building2 } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import AuthenticatedBlobImage from '../components/platform/AuthenticatedBlobImage.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { LEAD_STATUS_BADGE } from '../config/crmConstants.js';
import '../styles/crm.css';

export default function PlatformProspectLayout() {
  const { id } = useParams();
  const location = useLocation();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [org, setOrg] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [orgLoading, setOrgLoading] = useState(true);
  const [logoRev, setLogoRev] = useState(0);
  const bumpLogoRev = useCallback(() => setLogoRev((v) => v + 1), []);
  const [promotedClientName, setPromotedClientName] = useState('');

  const refreshOrg = useCallback(async () => {
    const { data } = await api.get(`/api/platform/crm/organisations/${id}`);
    setOrg(data.organisation);
    setContacts(data.contacts || []);
    setNotes(data.notes || []);
    setNotFound(false);
  }, [id]);

  useEffect(() => {
    if (!ok || !id) return undefined;
    let cancelled = false;
    (async () => {
      setOrgLoading(true);
      setError('');
      try {
        await refreshOrg();
      } catch (e) {
        if (e.response?.status === 404) {
          setNotFound(true);
          setOrg(null);
        } else if (!cancelled) {
          setError(e.response?.data?.error || 'Failed to load prospect.');
        }
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ok, id, refreshOrg]);

  useEffect(() => {
    if (!org?.promoted_to_org_id) {
      setPromotedClientName('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/platform/organizations/${org.promoted_to_org_id}`);
        if (!cancelled) setPromotedClientName(data.organization?.name || 'this client');
      } catch {
        if (!cancelled) setPromotedClientName('this client');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org?.promoted_to_org_id]);

  useEffect(() => {
    if (!ok || loading || !id) return undefined;
    const previous = document.title;
    if (notFound) {
      document.title = `Prospect not found | ${DEFAULT_TAB}`;
      return () => {
        document.title = previous;
      };
    }
    if (orgLoading || !org) {
      document.title = `Prospect · Loading… | ${DEFAULT_TAB}`;
      return () => {
        document.title = previous;
      };
    }
    const base = `/platform/crm/organisations/${id}`;
    const path = location.pathname;
    const tail = path.startsWith(base) ? path.slice(base.length).replace(/^\/+/, '') : '';
    let section = 'Dashboard';
    if (tail === 'tasks') section = 'Tasks';
    else if (tail === 'configurations') section = 'Configurations';
    else if (tail === 'activity') section = 'Recent activity';
    document.title = `${section} | ${org.organisation_name}`;
    return () => {
      document.title = previous;
    };
  }, [ok, loading, id, notFound, orgLoading, org, location.pathname]);

  if (loading || !ok) return null;

  if (notFound) {
    return (
      <Layout user={user} onLogout={logout}>
        <p className="error">Prospect not found.</p>
        <Link to="/platform/crm/organisations" className="btn btn-ghost platform-back-link" style={{ marginTop: '1rem' }}>
          <ArrowLeft size={18} aria-hidden />
          Back to prospects
        </Link>
      </Layout>
    );
  }

  if (orgLoading || !org) {
    return (
      <Layout user={user} onLogout={logout}>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </Layout>
    );
  }

  return (
    <Layout user={user} onLogout={logout}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {org.logo_filename ? (
          <AuthenticatedBlobImage
            path={`/api/platform/crm/organisations/${id}/logo?v=${logoRev}`}
            alt=""
            className="platform-client-header-logo"
          />
        ) : (
          <Building2 size={28} strokeWidth={1.75} aria-hidden />
        )}
        <h1 style={{ margin: 0, flex: 1 }}>{org.organisation_name}</h1>
        <span className={LEAD_STATUS_BADGE[org.lead_status] || 'badge'}>{org.lead_status}</span>
        <span
          style={{
            fontSize: '0.82rem',
            color: 'var(--muted)',
            background: 'var(--surface2)',
            padding: '0.25rem 0.65rem',
            borderRadius: 999,
            border: '1px solid var(--border)',
          }}
        >
          {org.business_unit}
        </span>
      </div>

      {org.promoted_to_org_id && (
        <div
          className="card"
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1.1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
            background: 'var(--surface2)',
          }}
        >
          <span>
            Promoted to Client{promotedClientName ? ` — ${promotedClientName}` : ''}.
          </span>
          <Link
            to={`/platform/clients/${org.promoted_to_org_id}`}
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            View client
            <ArrowUpRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      )}

      <Outlet context={{ org, orgId: id, contacts, setContacts, notes, setNotes, refreshOrg, bumpLogoRev }} />
    </Layout>
  );
}
