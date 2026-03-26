import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const InviteAccept = lazy(() => import('./pages/InviteAccept.jsx'));
const EmployeePulse = lazy(() => import('./pages/EmployeePulse.jsx'));
const AdminHome = lazy(() => import('./pages/AdminHome.jsx'));
const AdminSession = lazy(() => import('./pages/AdminSession.jsx'));
const PlatformHome = lazy(() => import('./pages/PlatformHome.jsx'));
const PlatformClients = lazy(() => import('./pages/PlatformClients.jsx'));
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
const ClientHome = lazy(() => import('./pages/ClientHome.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/invite" element={<InviteAccept />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/pulse" element={<EmployeePulse />} />
            <Route path="/pulse/link/:token" element={<PublicPulse />} />
            <Route path="/platform" element={<PlatformHome />} />
            <Route path="/platform/clients/:orgId" element={<PlatformClientLayout />}>
              <Route index element={<PlatformClientOverview />} />
              <Route path="users" element={<PlatformClientUsers />} />
              <Route path="tasks" element={<PlatformClientTasks />} />
              <Route path="pulse" element={<PlatformClientPulseShell />}>
                <Route index element={<PlatformClientPulse />} />
                <Route path="users" element={<PlatformPulseInviteUsers />} />
              </Route>
              <Route path="account" element={<PlatformClientAccount />} />
            </Route>
            <Route path="/platform/clients" element={<PlatformClients />} />
            <Route path="/platform/users" element={<PlatformUsers />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/client" element={<ClientHome />} />
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/sessions/:id" element={<AdminSession />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ToastProvider>
  );
}
