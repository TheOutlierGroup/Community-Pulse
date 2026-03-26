import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
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
const PlatformClientPulse = lazy(() => import('./pages/PlatformClientPulse.jsx'));
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
            <Route path="/invite" element={<InviteAccept />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/pulse" element={<EmployeePulse />} />
            <Route path="/platform" element={<PlatformHome />} />
            <Route path="/platform/clients/:orgId" element={<PlatformClientLayout />}>
              <Route index element={<PlatformClientOverview />} />
              <Route path="users" element={<PlatformClientUsers />} />
              <Route path="tasks" element={<PlatformClientTasks />} />
              <Route path="pulse" element={<PlatformClientPulse />} />
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
