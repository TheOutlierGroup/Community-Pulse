import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  const orgLabel =
    user.organizationKind === 'platform'
      ? 'Outlier (platform)'
      : user.organizationName || 'Client organization';

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Settings size={28} strokeWidth={1.75} aria-hidden />
        Settings
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Your account details (read-only).
      </p>
      <div className="card" style={{ maxWidth: 480 }}>
        <dl className="settings-dl">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
          <dt>Organization</dt>
          <dd>{orgLabel}</dd>
          <dt>Account type</dt>
          <dd style={{ textTransform: 'capitalize' }}>{user.organizationKind}</dd>
        </dl>
      </div>
    </Layout>
  );
}
