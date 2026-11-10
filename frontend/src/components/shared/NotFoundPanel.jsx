import { Link, useParams } from 'react-router-dom';
import { IS_RHYTHM_ENGINE_SURFACE } from '../../config/appSurface.js';

/**
 * Shown for an unknown path inside a client (e.g. /platform/clients/:id/foo),
 * which used to render an empty page inside the client layout.
 */
export default function NotFoundPanel() {
  const { orgId } = useParams();
  const homeHref = orgId
    ? `/platform/clients/${orgId}${IS_RHYTHM_ENGINE_SURFACE ? '/rhythm-engine' : ''}`
    : '/';
  return (
    <div className="card" role="alert" style={{ maxWidth: 560 }}>
      <h1 style={{ marginTop: 0, fontSize: '1.4rem' }}>Page not found</h1>
      <p className="muted">This page doesn&rsquo;t exist. The link may be out of date or mistyped.</p>
      <Link to={homeHref} className="btn btn-primary">
        {orgId ? 'Back to this client' : 'Go to the home page'}
      </Link>
    </div>
  );
}
