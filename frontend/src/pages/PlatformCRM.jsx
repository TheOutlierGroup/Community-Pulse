import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Users2, FolderKanban, Webhook, TrendingUp, Plus } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

export default function PlatformCRM() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useDocumentTitle(!loading && ok ? `CRM | ${DEFAULT_TAB}` : null);

  const loadStats = useCallback(async () => {
    try {
      const [leadsRes, projectsRes, accountsRes] = await Promise.all([
        api.get('/api/platform/leads', { params: { openOnly: 'true', limit: 1 } }),
        api.get('/api/platform/projects', { params: { limit: 1 } }),
        api.get('/api/platform/accounts', { params: { limit: 1 } }),
      ]);
      setStats({
        openLeads: leadsRes.data.leads?.length ?? 0,
        projects: projectsRes.data.projects?.length ?? 0,
        accounts: accountsRes.data.accounts?.length ?? 0,
      });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load CRM overview.');
    }
  }, []);

  useEffect(() => {
    if (!ok) return;
    loadStats();
  }, [ok, loadStats]);

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>CRM</h1>
        </div>

        {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

        <div className="crm-hub-grid">
          <Link to="/platform/crm/leads" className="crm-stat-card">
            <span className="crm-stat-card__label">
              <Briefcase size={14} strokeWidth={2} aria-hidden /> Leads
            </span>
            <span className="crm-stat-card__value">{stats?.openLeads ?? '—'}</span>
            <span className="crm-stat-card__sub">Open pipeline leads</span>
          </Link>

          <Link to="/platform/crm/accounts" className="crm-stat-card">
            <span className="crm-stat-card__label">
              <Users2 size={14} strokeWidth={2} aria-hidden /> Accounts
            </span>
            <span className="crm-stat-card__value">{stats?.accounts ?? '—'}</span>
            <span className="crm-stat-card__sub">Client companies</span>
          </Link>

          <Link to="/platform/crm/projects" className="crm-stat-card">
            <span className="crm-stat-card__label">
              <FolderKanban size={14} strokeWidth={2} aria-hidden /> Projects
            </span>
            <span className="crm-stat-card__value">{stats?.projects ?? '—'}</span>
            <span className="crm-stat-card__sub">Active delivery projects</span>
          </Link>

          {user?.role === 'admin' && (
            <Link to="/platform/crm/settings" className="crm-stat-card">
              <span className="crm-stat-card__label">
                <Webhook size={14} strokeWidth={2} aria-hidden /> Settings
              </span>
              <span className="crm-stat-card__value" style={{ fontSize: '1rem', fontWeight: 600, paddingTop: '0.25rem' }}>
                Business units · Webhooks
              </span>
              <span className="crm-stat-card__sub">Configure pipeline & integrations</span>
            </Link>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Quick actions</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('/platform/crm/leads')}>
              <Plus size={18} strokeWidth={2} aria-hidden />
              New Lead
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/platform/crm/accounts')}>
              <Plus size={18} strokeWidth={2} aria-hidden />
              New Account
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
