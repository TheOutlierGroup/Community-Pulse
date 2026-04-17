import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';
import { IS_PULSE_SURFACE } from './config/appSurface.js';

const Login = lazy(() => import('./pages/Login.jsx'));
const PulseLanding = lazy(() => import('./pages/PulseLanding.jsx'));
const PulseSsoExchange = lazy(() => import('./pages/PulseSsoExchange.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const InviteAccept = lazy(() => import('./pages/InviteAccept.jsx'));
const EmployeePulse = lazy(() => import('./pages/EmployeePulse.jsx'));
const AdminHome = lazy(() => import('./pages/AdminHome.jsx'));
const AdminSession = lazy(() => import('./pages/AdminSession.jsx'));
const PlatformHome = lazy(() => import('./pages/PlatformHome.jsx'));
const PlatformClients = lazy(() => import('./pages/PlatformClients.jsx'));
const PlatformTasks = lazy(() => import('./pages/PlatformTasks.jsx'));
const PlatformClientLayout = lazy(() => import('./pages/PlatformClientLayout.jsx'));
const PlatformClientOverview = lazy(() => import('./pages/PlatformClientOverview.jsx'));
const PlatformClientUsers = lazy(() => import('./pages/PlatformClientUsers.jsx'));
const PlatformClientTasks = lazy(() => import('./pages/PlatformClientTasks.jsx'));
const PlatformClientPulseShell = lazy(() => import('./pages/PlatformClientPulseShell.jsx'));
const PlatformClientPulse = lazy(() => import('./pages/PlatformClientPulse.jsx'));
const PlatformPulseInviteUsers = lazy(() => import('./pages/PlatformPulseInviteUsers.jsx'));
const PublicPulse = lazy(() => import('./pages/PublicPulse.jsx'));
const PlatformClientAccount = lazy(() => import('./pages/PlatformClientAccount.jsx'));
const PlatformUsers = lazy(() => import('./pages/PlatformUsers.jsx'));
const PlatformSettings = lazy(() => import('./pages/PlatformSettings.jsx'));
const ClientHome = lazy(() => import('./pages/ClientHome.jsx'));
const AccountPage = lazy(() => import('./pages/SettingsPage.jsx'));

export default function App() {
  const publicEntry = IS_PULSE_SURFACE ? <PulseLanding /> : <Login />;

  return (
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={publicEntry} />
            <Route path="/login" element={publicEntry} />
            {!IS_PULSE_SURFACE && <Route path="/forgot-password" element={<ForgotPassword />} />}
            {!IS_PULSE_SURFACE && <Route path="/reset-password/:token" element={<ResetPassword />} />}
            {!IS_PULSE_SURFACE && <Route path="/invite" element={<InviteAccept />} />}
            {!IS_PULSE_SURFACE && <Route path="/invite/:token" element={<InviteAccept />} />}
            <Route path="/sso/exchange" element={<PulseSsoExchange />} />
            <Route path="/pulse" element={<EmployeePulse />} />
            <Route path="/pulse/link/:token" element={<PublicPulse />} />
            {!IS_PULSE_SURFACE && <Route path="/platform" element={<PlatformHome />} />}
            {!IS_PULSE_SURFACE && <Route path="/platform/tasks" element={<PlatformTasks />} />}
            <Route path="/platform/clients/:orgId" element={<PlatformClientLayout />}>
              {!IS_PULSE_SURFACE && <Route index element={<PlatformClientOverview />} />}
              {!IS_PULSE_SURFACE && <Route path="users" element={<PlatformClientUsers />} />}
              {!IS_PULSE_SURFACE && <Route path="tasks" element={<PlatformClientTasks />} />}
              <Route path="pulse" element={<PlatformClientPulseShell />}>
                <Route index element={<PlatformClientPulse />} />
                <Route path="users" element={<PlatformPulseInviteUsers />} />
              </Route>
              {!IS_PULSE_SURFACE && <Route path="account" element={<PlatformClientAccount />} />}
            </Route>
            {!IS_PULSE_SURFACE && <Route path="/platform/clients" element={<PlatformClients />} />}
            {!IS_PULSE_SURFACE && <Route path="/platform/users" element={<PlatformUsers />} />}
            {!IS_PULSE_SURFACE && <Route path="/platform/settings" element={<PlatformSettings />} />}
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
