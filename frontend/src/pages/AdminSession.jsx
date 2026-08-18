import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { CLIENT_SERVICE_PULSE, getPostLoginPath, userHasService } from '../utils/postLogin.js';
import { ArrowLeft } from 'lucide-react';

const Heatmap = lazy(() => import('../components/admin/Heatmap.jsx'));
const TensionMap = lazy(() => import('../components/admin/TensionMap.jsx'));
const ActionPlan = lazy(() => import('../components/admin/ActionPlan.jsx'));
const Analytics = lazy(() => import('../components/admin/Analytics.jsx'));

export default function AdminSession() {
  const { id } = useParams();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const { data: d } = await api.get(`/api/analytics/sessions/${id}`);
      setData(d);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load session analytics.');
    }
  };

  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user?.organizationKind === 'platform') navigate('/platform');
    else if (!user || user.role !== 'admin' || user.organizationKind !== 'client') {
      if (user) navigate(getPostLoginPath(user));
    } else if (!userHasService(user, CLIENT_SERVICE_PULSE)) {
      navigate('/client');
    } else if (user.clientPortalTier === 'enterprise') {
      // Enterprise-tier clients analyse sessions through their own
      // /platform/clients/:orgId/rhythm-engine workspace, not this legacy
      // Guided-tier analytics page.
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user?.role === 'admin' && user?.organizationKind === 'client' && user.clientPortalTier !== 'enterprise' && id) load();
  }, [user, id]);

  async function generatePlan() {
    setBusy(true);
    setError('');
    try {
      const { data: d } = await api.post(`/api/analytics/sessions/${id}/action-plan`);
      setData((prev) => ({
        ...prev,
        actionPlan: d.actionPlan,
        analytics: d.analyticsSnapshot || prev?.analytics,
      }));
    } catch (e) {
      setError(e.response?.data?.error || 'Could not generate plan.');
    } finally {
      setBusy(false);
    }
  }

  async function exportData() {
    setBusy(true);
    setError('');
    try {
      const { data: exp } = await api.post(`/api/analytics/sessions/${id}/export`);
      const res = await api.get(exp.downloadPath, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = exp.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.response?.data?.error || 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  if (
    loading ||
    !user ||
    user.role !== 'admin' ||
    user.organizationKind !== 'client' ||
    !userHasService(user, CLIENT_SERVICE_PULSE) ||
    user.clientPortalTier === 'enterprise'
  ) {
    return null;
  }

  const analytics = data?.analytics;

  return (
    <Layout user={user} onLogout={logout}>
      <p>
        <Link to="/admin" className="back-link">
          <ArrowLeft size={18} strokeWidth={2} aria-hidden />
          Back to Rhythm Engine admin
        </Link>
      </p>
      <h1>{data?.session?.name || 'Session'}</h1>
      {data?.session && (
        <p className="muted">
          Status: <span className={`badge badge-${data.session.status}`}>{data.session.status}</span>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {analytics && (
        <Suspense fallback={<p className="muted">Loading analytics…</p>}>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Interpretation</h2>
            <p>{analytics.narrative}</p>
            <p className="muted">
              Completed: {analytics.completed} / {analytics.totalResponses} responses · Advocacy avg:{' '}
              {analytics.avgNps != null ? analytics.avgNps.toFixed(1) : '—'}
            </p>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Friction profile</h2>
            <Analytics frictionAverages={analytics.frictionAverages} />
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Heatmap</h2>
            <Heatmap rows={analytics.heatmap} />
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Tension & priorities</h2>
            <TensionMap
              tensionPairs={analytics.tensionPairs}
              priorities={analytics.priorityCounts}
            />
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Sentiment & story</h2>
            {analytics.sampleComments?.length ? (
              <ul className="muted" style={{ paddingLeft: '1.25rem' }}>
                {analytics.sampleComments.map((c, i) => (
                  <li key={i} style={{ marginBottom: '0.5rem' }}>
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No comments yet.</p>
            )}
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>30 / 60 / 90-day plan</h2>
            <div className="btn-row" style={{ marginBottom: '1rem' }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={generatePlan}>
                {busy ? 'Working…' : 'Generate / refresh plan'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={exportData}>
                Export JSON
              </button>
            </div>
            <ActionPlan plan={data.actionPlan} />
          </div>
        </Suspense>
      )}
    </Layout>
  );
}
