import { Link, useNavigate } from 'react-router-dom';
import { LogIn, LogOut, LayoutDashboard, Building2, Activity } from 'lucide-react';

export default function Navigation({ user, onLogout }) {
  const navigate = useNavigate();
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
  return (
    <div className="nav-actions">
      {user.organizationKind === 'platform' && (
        <Link to="/platform" className="btn btn-ghost nav-link-btn">
          <Building2 size={18} strokeWidth={2} aria-hidden />
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
        <Link to="/admin" className="btn btn-ghost nav-link-btn">
          <Activity size={18} strokeWidth={2} aria-hidden />
          Pulse
        </Link>
      )}
      {user.organizationKind === 'client' && user.role === 'employee' && (
        <Link to="/pulse" className="btn btn-ghost nav-link-btn">
          <Activity size={18} strokeWidth={2} aria-hidden />
          My Pulse
        </Link>
      )}
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
