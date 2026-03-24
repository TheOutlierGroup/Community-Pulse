import { Link } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import { getPostLoginPath } from '../../utils/postLogin.js';
import outlierLogo from '../../images/outlier-logo.png';

export default function Layout({ children, user, onLogout, hideHeader = false }) {
  return (
    <div className="app-shell">
      {!hideHeader && (
        <header className="app-header">
          <Link
            to={user ? getPostLoginPath(user) : '/'}
            className="brand brand-with-logo"
            aria-label="Outlier home"
          >
            <img src={outlierLogo} alt="" className="brand-logo" decoding="async" />
          </Link>
          <Navigation user={user} onLogout={onLogout} />
        </header>
      )}
      <main className={`app-main${hideHeader ? ' app-main--flush' : ''}`}>{children}</main>
    </div>
  );
}
