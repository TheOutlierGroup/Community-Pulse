import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';
import MfaReverifyProvider from './components/shared/MfaReverifyProvider.jsx';
import { lazyWithReload } from './utils/lazyWithReload.js';

/**
 * BRAND-02: the Rhythm Engine build's own route tree.
 *
 * App.jsx renders every CRM page too, gated behind
 * `{!IS_RHYTHM_ENGINE_SURFACE && <Route ... />}`. That only ever decided
 * what rendered — every one of those pages was still a top-level
 * `lazy(() => import(...))` binding in the same module, so Rollup had a
 * live reference to chunk regardless of which branch runtime code took,
 * and express.static serves whatever ends up in dist/ regardless of
 * which routes a given visitor ever navigates to. A licensee's own
 * branded Rhythm Engine domain was shipping Outlier's full CRM admin
 * bundle to anyone who inspected the served assets.
 *
 * This file exists so the pulse build's module graph never contains an
 * import() of a CRM-only page — not gated, not dead-code-eliminated,
 * genuinely absent. main.jsx picks this file over App.jsx via a literal
 * import.meta.env check, which is what makes that guarantee build-time
 * rather than runtime.
 *
 * The routes below are exactly the ones that already render on the pulse
 * surface today (everything in App.jsx NOT behind an
 * `!IS_RHYTHM_ENGINE_SURFACE` guard, plus the RhythmEngineLanding branch
 * of its publicEntry ternary) — this file changes what gets bundled, not
 * what a pulse visitor can already reach. Keep it that way: a route
 * added here without a matching one in App.jsx (or vice versa) is a
 * behavior difference between the two surfaces, not just a bundling one.
 */

const RhythmEngineLanding = lazy(() => import('./pages/RhythmEngineLanding.jsx'));
const RhythmEngineSsoExchange = lazy(() => import('./pages/RhythmEngineSsoExchange.jsx'));
const EmployeeRhythmEngine = lazy(() => import('./pages/EmployeeRhythmEngine.jsx'));
const PlatformClientLayout = lazy(() => import('./pages/PlatformClientLayout.jsx'));
const PlatformClientRhythmEngineShell = lazy(() => import('./pages/PlatformClientRhythmEngineShell.jsx'));
const PlatformClientRhythmEngine = lazy(() => import('./pages/PlatformClientRhythmEngine.jsx'));
const PlatformRhythmEngineInviteUsers = lazy(() => import('./pages/PlatformRhythmEngineInviteUsers.jsx'));
const PlatformRhythmEngineSettings = lazy(() => import('./pages/PlatformRhythmEngineSettings.jsx'));
const PublicRhythmEngine = lazy(() => import('./pages/PublicRhythmEngine.jsx'));
const PublicStatus = lazy(() => import('./pages/PublicStatus.jsx'));
const ClientHome = lazy(() => import('./pages/ClientHome.jsx'));
const AdminHome = lazy(() => import('./pages/AdminHome.jsx'));
const AdminSession = lazy(() => import('./pages/AdminSession.jsx'));
const AccountPage = lazyWithReload(
  () => import('./pages/SettingsPage.jsx'),
  'settings-page'
);

export default function AppRhythmEngine() {
  return (
    <ToastProvider>
      <AuthProvider>
        <MfaReverifyProvider>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<RhythmEngineLanding />} />
              <Route path="/login" element={<RhythmEngineLanding />} />
              <Route path="/status" element={<PublicStatus />} />
              <Route path="/sso/exchange" element={<RhythmEngineSsoExchange />} />
              <Route path="/rhythm-engine" element={<EmployeeRhythmEngine />} />
              <Route path="/rhythm-engine/:stage" element={<EmployeeRhythmEngine />} />
              <Route path="/rhythm-engine/link/:token" element={<PublicRhythmEngine />} />
              <Route path="/rhythm-engine/:stage/link/:token" element={<PublicRhythmEngine />} />
              <Route path="/pulse" element={<Navigate to="/rhythm-engine" replace />} />
              <Route path="/pulse/link/:token" element={<PublicRhythmEngine />} />
              <Route path="/platform/clients/:orgId" element={<PlatformClientLayout />}>
                <Route path="rhythm-engine" element={<PlatformClientRhythmEngineShell />}>
                  <Route index element={<PlatformClientRhythmEngine />} />
                  <Route path="users" element={<PlatformRhythmEngineInviteUsers />} />
                  <Route path="settings" element={<PlatformRhythmEngineSettings />} />
                </Route>
                <Route path="pulse/*" element={<Navigate to="rhythm-engine" replace />} />
              </Route>
              <Route path="/account" element={<AccountPage />} />
              <Route path="/settings" element={<Navigate to="/account" replace />} />
              <Route path="/client" element={<ClientHome />} />
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/sessions/:id" element={<AdminSession />} />
            </Routes>
          </Suspense>
        </MfaReverifyProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
