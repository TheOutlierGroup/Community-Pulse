import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/responsive.css';

/**
 * BRAND-02: which route tree gets bundled, decided at build time.
 *
 * This has to be a literal `import.meta.env.VITE_APP_SURFACE` comparison
 * written inline, guarding the import() calls in this same module — that
 * combination is what lets Vite's build-time replacement of
 * import.meta.env plus Rollup's dead-code elimination drop the untaken
 * branch, and everything it imports, before any chunk is emitted.
 * (rhythmEngineBranding.js documents the same sensitivity for the
 * identical pattern.) Reaching this decision through a boolean computed
 * in another module (config/appSurface.js's IS_RHYTHM_ENGINE_SURFACE) or
 * branching deeper inside a shared App.jsx does not get this: Rollup
 * can't fold a value across a module boundary, or see through a JSX
 * `{cond && <Route>}` guard, the way it can a same-file literal
 * comparison — which is exactly how the CRM build ended up shipping its
 * whole page set to the Rhythm Engine domain in the first place.
 */
const appModulePromise = import.meta.env.VITE_APP_SURFACE === 'pulse'
  ? import('./AppRhythmEngine.jsx')
  : import('./App.jsx');

appModulePromise.then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
