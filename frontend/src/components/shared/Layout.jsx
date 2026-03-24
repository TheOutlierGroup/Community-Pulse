import { Link } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import { getPostLoginPath } from '../../utils/postLogin.js';
import outlierLogo from '../../images/outlier-logo.png';

export default function Layout({ children, user, onLogout }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to={user ? getPostLoginPath(user) : '/'} className="brand brand-with-logo">
          <img src={outlierLogo} alt="" className="brand-logo" width={32} height={32} />
          <span className="brand-text">Outlier</span>
        </Link>
        <Navigation user={user} onLogout={onLogout} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
