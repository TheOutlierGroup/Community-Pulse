import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Plus, Users } from 'lucide-react';
import PlatformUsersTable from './platformUsers/PlatformUsersTable.jsx';
import CreateUserModal from './platformUsers/CreateUserModal.jsx';
import EditUserModal from './platformUsers/EditUserModal.jsx';

export default function PlatformUsers() {
  const { user, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarListRev, setAvatarListRev] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('admin');
  const [formAvatar, setFormAvatar] = useState(null);

  const [editUser, setEditUser] = useState(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editRemoveAvatar, setEditRemoveAvatar] = useState(false);
  const [removeAccessStep, setRemoveAccessStep] = useState(0);

  const loadStaff = useCallback(async () => {
    const { data } = await api.get('/api/platform/staff');
    setStaff(data.users || []);
    setAvatarListRev((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        setError('');
        await loadStaff();
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load team.');
      }
    })();
  }, [ok, loadStaff]);

  useEffect(() => {
    if (!modalOpen && !editUser) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editUser) closeEditModal();
        else closeCreateModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, editUser]);

  function closeCreateModal() {
    setModalOpen(false);
    setError('');
    setFormFirst('');
    setFormLast('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('admin');
    setFormAvatar(null);
  }

  function openEditModal(u) {
    setModalOpen(false);
    setError('');
    setRemoveAccessStep(0);
    setEditUser(u);
    setEditFirst(u.firstName ?? '');
    setEditLast(u.lastName ?? '');
    setEditEmail(u.email ?? '');
    setEditRole(u.role === 'employee' ? 'employee' : 'admin');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
  }

  function closeEditModal() {
    setEditUser(null);
    setError('');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setRemoveAccessStep(0);
  }

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('firstName', formFirst.trim());
      fd.append('lastName', formLast.trim());
      fd.append('email', formEmail.trim());
      fd.append('password', formPassword);
      fd.append('role', formRole);
      if (formAvatar) fd.append('avatar', formAvatar);
      await api.post('/api/platform/users', fd);
      await loadStaff();
      const createdEmail = formEmail.trim();
      const createdName = [formFirst, formLast].map((s) => s.trim()).filter(Boolean).join(' ');
      showToast(
        createdName
          ? `${createdName} was added and can sign in.`
          : `${createdEmail} was added and can sign in.`,
        { variant: 'success' }
      );
      closeCreateModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create user.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEditUser(e) {
    e.preventDefault();
    if (!editUser) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/users/${editUser.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        role: editRole,
      });
      if (editAvatarFile) {
        const fd = new FormData();
        fd.append('avatar', editAvatarFile);
        await api.post(`/api/platform/users/${editUser.id}/avatar`, fd);
      } else if (editRemoveAvatar && editUser.hasProfileAvatar) {
        await api.delete(`/api/platform/users/${editUser.id}/avatar`);
      }
      await loadStaff();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveAccess() {
    if (!editUser) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/users/${editUser.id}`);
      await loadStaff();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove access.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  const canRemoveAccess = editUser && String(editUser.id) !== String(user?.id);

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Users size={28} strokeWidth={1.75} aria-hidden />
            Users
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => {
            setError('');
            closeEditModal();
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Add user
        </button>
      </div>

      {error && !modalOpen && !editUser && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <PlatformUsersTable
        staff={staff}
        avatarListRev={avatarListRev}
        onOpenEdit={openEditModal}
      />

      <CreateUserModal
        open={modalOpen}
        busy={busy}
        error={modalOpen ? error : ''}
        formFirst={formFirst}
        setFormFirst={setFormFirst}
        formLast={formLast}
        setFormLast={setFormLast}
        formEmail={formEmail}
        setFormEmail={setFormEmail}
        formPassword={formPassword}
        setFormPassword={setFormPassword}
        formRole={formRole}
        setFormRole={setFormRole}
        setFormAvatar={setFormAvatar}
        onClose={closeCreateModal}
        onSubmit={createUser}
      />

      <EditUserModal
        editUser={editUser}
        error={editUser ? error : ''}
        busy={busy}
        editFirst={editFirst}
        setEditFirst={setEditFirst}
        editLast={editLast}
        setEditLast={setEditLast}
        editEmail={editEmail}
        setEditEmail={setEditEmail}
        editRole={editRole}
        setEditRole={setEditRole}
        editAvatarFile={editAvatarFile}
        setEditAvatarFile={setEditAvatarFile}
        editRemoveAvatar={editRemoveAvatar}
        setEditRemoveAvatar={setEditRemoveAvatar}
        canRemoveAccess={canRemoveAccess}
        removeAccessStep={removeAccessStep}
        setRemoveAccessStep={setRemoveAccessStep}
        onClose={closeEditModal}
        onSave={saveEditUser}
        onConfirmRemoveAccess={confirmRemoveAccess}
      />
    </Layout>
  );
}
