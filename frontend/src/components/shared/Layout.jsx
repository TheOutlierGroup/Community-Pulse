import { Link } from 'react-router-dom';
import Navigation from './Navigation.jsx';

export default function Layout({ children, user, onLogout }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          The <span>Pulse</span>
        </Link>
        <Navigation user={user} onLogout={onLogout} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
