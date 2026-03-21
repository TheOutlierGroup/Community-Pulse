import { Link } from 'react-router-dom';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';

export default function Home() {
  const { user, logout } = useAuth();
  return (
    <Layout user={user} onLogout={logout}>
      <div className="card">
        <h1 style={{ fontSize: 'clamp(1.75rem, 5vw, 2.5rem)' }}>
          See what is helping your organisation move — and what is slowing it down.
        </h1>
        <p className="pulse-intro muted">
          Pulse is a fast, game-like diagnostic for friction, readiness, and execution drag. Employees
          get a guided experience; leaders get hotspots, sentiment, and a path to action.
        </p>
        <div className="btn-row">
          {user ? (
            user.role === 'admin' ? (
              <Link to="/admin" className="btn btn-primary">
                Open admin
              </Link>
            ) : (
              <Link to="/pulse" className="btn btn-primary">
                Start my Pulse
              </Link>
            )
          ) : (
            <>
              <Link to="/login" className="btn btn-primary">
                Log in
              </Link>
              <Link to="/invite" className="btn btn-ghost">
                I have an invite
              </Link>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
