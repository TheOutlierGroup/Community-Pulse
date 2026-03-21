import { Link, useNavigate } from 'react-router-dom';

export default function Navigation({ user, onLogout }) {
  const navigate = useNavigate();
  if (!user) {
    return (
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <Link to="/login" className="btn btn-ghost">
          Log in
        </Link>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {user.role === 'admin' ? (
        <Link to="/admin" className="btn btn-ghost">
          Admin
        </Link>
      ) : (
        <Link to="/pulse" className="btn btn-ghost">
          My Pulse
        </Link>
      )}
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        {user.email}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          onLogout();
          navigate('/login');
        }}
      >
        Log out
      </button>
    </div>
  );
}
