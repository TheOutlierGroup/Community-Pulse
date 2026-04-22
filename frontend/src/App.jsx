import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';
import { IS_RHYTHM_ENGINE_SURFACE } from './config/appSurface.js';

const Login = lazy(() => import('./pages/Login.jsx'));
const RhythmEngineLanding = lazy(() => import('./pages/RhythmEngineLanding.jsx'));
const RhythmEngineSsoExchange = lazy(() => import('./pages/RhythmEngineSsoExchange.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const InviteAccept = lazy(() => import('./pages/InviteAccept.jsx'));
const EmployeeRhythmEngine = lazy(() => import('./pages/EmployeeRhythmEngine.jsx'));
const AdminHome = lazy(() => import('./pages/AdminHome.jsx'));
const AdminSession = lazy(() => import('./pages/AdminSession.jsx'));
const PlatformHome = lazy(() => import('./pages/PlatformHome.jsx'));
const PlatformClients = lazy(() => import('./pages/PlatformClients.jsx'));
const PlatformTasks = lazy(() => import('./pages/PlatformTasks.jsx'));
const PlatformClientLayout = lazy(() => import('./pages/PlatformClientLayout.jsx'));
const PlatformClientOverview = lazy(() => import('./pages/PlatformClientOverview.jsx'));
const PlatformClientUsers = lazy(() => import('./pages/PlatformClientUsers.jsx'));
const PlatformClientTasks = lazy(() => import('./pages/PlatformClientTasks.jsx'));
const PlatformClientRhythmEngineShell = lazy(() => import('./pages/PlatformClientRhythmEngineShell.jsx'));
const PlatformClientRhythmEngine = lazy(() => import('./pages/PlatformClientRhythmEngine.jsx'));
const PlatformRhythmEngineInviteUsers = lazy(() => import('./pages/PlatformRhythmEngineInviteUsers.jsx'));
const PublicRhythmEngine = lazy(() => import('./pages/PublicRhythmEngine.jsx'));
const PlatformClientAccount = lazy(() => import('./pages/PlatformClientAccount.jsx'));
const PlatformUsers = lazy(() => import('./pages/PlatformUsers.jsx'));
const PlatformSettings = lazy(() => import('./pages/PlatformSettings.jsx'));
const ClientHome = lazy(() => import('./pages/ClientHome.jsx'));
const AccountPage = lazy(() => import('./pages/SettingsPage.jsx'));

export default function App() {
  const publicEntry = IS_RHYTHM_ENGINE_SURFACE ? <RhythmEngineLanding /> : <Login />;

  return (
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={publicEntry} />
            <Route path="/login" element={publicEntry} />
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/forgot-password" element={<ForgotPassword />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/reset-password/:token" element={<ResetPassword />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/invite" element={<InviteAccept />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/invite/:token" element={<InviteAccept />} />}
            <Route path="/sso/exchange" element={<RhythmEngineSsoExchange />} />
            <Route path="/rhythm-engine" element={<EmployeeRhythmEngine />} />
            <Route path="/rhythm-engine/:stage" element={<EmployeeRhythmEngine />} />
            <Route path="/rhythm-engine/link/:token" element={<PublicRhythmEngine />} />
            <Route path="/rhythm-engine/:stage/link/:token" element={<PublicRhythmEngine />} />
            <Route path="/pulse" element={<Navigate to="/rhythm-engine" replace />} />
            <Route path="/pulse/link/:token" element={<PublicRhythmEngine />} />
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/platform" element={<PlatformHome />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/platform/tasks" element={<PlatformTasks />} />}
            <Route path="/platform/clients/:orgId" element={<PlatformClientLayout />}>
              {!IS_RHYTHM_ENGINE_SURFACE && <Route index element={<PlatformClientOverview />} />}
              {!IS_RHYTHM_ENGINE_SURFACE && <Route path="users" element={<PlatformClientUsers />} />}
              {!IS_RHYTHM_ENGINE_SURFACE && <Route path="tasks" element={<PlatformClientTasks />} />}
              <Route path="rhythm-engine" element={<PlatformClientRhythmEngineShell />}>
                <Route index element={<PlatformClientRhythmEngine />} />
                <Route path="users" element={<PlatformRhythmEngineInviteUsers />} />
              </Route>
              <Route path="pulse/*" element={<Navigate to="rhythm-engine" replace />} />
              {!IS_RHYTHM_ENGINE_SURFACE && <Route path="account" element={<PlatformClientAccount />} />}
            </Route>
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/platform/clients" element={<PlatformClients />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/platform/users" element={<PlatformUsers />} />}
            {!IS_RHYTHM_ENGINE_SURFACE && <Route path="/platform/settings" element={<PlatformSettings />} />}
            <Route path="/account" element={<AccountPage />} />
            <Route path="/settings" element={<Navigate to="/account" replace />} />
            <Route path="/client" element={<ClientHome />} />
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/sessions/:id" element={<AdminSession />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ToastProvider>
  );
}
