import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/shared/Auth.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import InviteAccept from './pages/InviteAccept.jsx';
import EmployeePulse from './pages/EmployeePulse.jsx';
import AdminHome from './pages/AdminHome.jsx';
import AdminSession from './pages/AdminSession.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/invite" element={<InviteAccept />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/pulse" element={<EmployeePulse />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/sessions/:id" element={<AdminSession />} />
      </Routes>
    </AuthProvider>
  );
}
