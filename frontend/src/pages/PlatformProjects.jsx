import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, ChevronRight } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_BADGE = {
  planning: 'badge badge-planning',
  active: 'badge badge-active-proj',
  on_hold: 'badge badge-on-hold',
  completed: 'badge badge-completed',
  archived: 'badge badge-archived',
};

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

export default function PlatformProjects() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [projects, setProjects] = useState([]);
  const [bus, setBus] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [buId, setBuId] = useState('');

  useDocumentTitle(!loading && ok ? `Projects | ${DEFAULT_TAB}` : null);

  const loadBus = useCallback(async () => {
    try {
      const { data } = await api.get('/api/platform/business-units');
      setBus(data.businessUnits || []);
    } catch { /* non-critical */ }
  }, []);

  const loadProjects = useCallback(async () => {
    setFetching(true);
    try {
      const params = {};
      if (status) params.status = status;
      if (buId) params.businessUnitId = buId;
      const { data } = await api.get('/api/platform/projects', { params });
      setProjects(data.projects || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load projects.');
    } finally {
      setFetching(false);
    }
  }, [status, buId]);

  useEffect(() => {
    if (!ok) return;
    loadBus();
  }, [ok, loadBus]);

  useEffect(() => {
    if (!ok) return;
    loadProjects();
  }, [ok, loadProjects]);

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Projects</h1>
        </div>

        <div className="crm-filter-bar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {bus.length > 0 && (
            <select value={buId} onChange={(e) => setBuId(e.target.value)}>
              <option value="">All business units</option>
              {bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="table-wrap">
          <table className="platform-users-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Baseline</th>
                <th>Actual</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</td></tr>
              )}
              {!fetching && projects.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                  No projects yet. Convert a won lead to create one.
                </td></tr>
              )}
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="platform-users-table__row--clickable"
                  onClick={() => navigate(`/platform/crm/projects/${p.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/platform/crm/projects/${p.id}`)}
                >
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><span className={STATUS_BADGE[p.status] || 'badge'}>{p.status?.replace('_', ' ')}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{fmt(p.baselineCost)}</td>
                  <td style={{ color: Number(p.actualCost) > Number(p.baselineCost) && Number(p.baselineCost) > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                    {fmt(p.actualCost)}
                  </td>
                  <td><ChevronRight size={16} strokeWidth={2} color="var(--muted)" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
