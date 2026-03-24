import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import { ToastProvider } from './components/shared/ToastProvider.jsx';
import Login from './pages/Login.jsx';
import InviteAccept from './pages/InviteAccept.jsx';
import EmployeePulse from './pages/EmployeePulse.jsx';
import AdminHome from './pages/AdminHome.jsx';
import AdminSession from './pages/AdminSession.jsx';
import PlatformHome from './pages/PlatformHome.jsx';
import PlatformClients from './pages/PlatformClients.jsx';
import PlatformClientLayout from './pages/PlatformClientLayout.jsx';
import PlatformClientOverview from './pages/PlatformClientOverview.jsx';
import PlatformClientUsers from './pages/PlatformClientUsers.jsx';
import PlatformClientTasks from './pages/PlatformClientTasks.jsx';
import PlatformClientPulse from './pages/PlatformClientPulse.jsx';
import PlatformClientAccount from './pages/PlatformClientAccount.jsx';
import PlatformUsers from './pages/PlatformUsers.jsx';
import ClientHome from './pages/ClientHome.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
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
      </AuthProvider>
    </ToastProvider>
  );
}
