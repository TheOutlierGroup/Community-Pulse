import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
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
  const [editAssignmentOptions, setEditAssignmentOptions] = useState([]);
  const [editAssignedClientOrgIds, setEditAssignedClientOrgIds] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [editFocusScopeSignal, setEditFocusScopeSignal] = useState(0);
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

  useEffect(() => {
    if (!editUser) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setAssignmentsLoading(true);
        const [assignmentsRes, orgsRes] = await Promise.all([
          api.get(`/api/platform/staff/${editUser.id}/client-assignments`),
          api.get('/api/platform/organizations', { params: { limit: 500, offset: 0 } }),
        ]);
        if (cancelled) return;
        const assigned = assignmentsRes.data?.clientOrganizationIds || [];
        const organizations = orgsRes.data?.organizations || [];
        setEditAssignedClientOrgIds(assigned);
        setEditAssignmentOptions(organizations.map((row) => ({ id: row.id, name: row.name })));
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Could not load client assignment scope.');
          setEditAssignedClientOrgIds([]);
          setEditAssignmentOptions([]);
        }
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editUser]);

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

  function openEditModal(u, options = {}) {
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
    if (options.focusScope) {
      setEditFocusScopeSignal((n) => n + 1);
    }
  }

  function closeEditModal() {
    setEditUser(null);
    setError('');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setEditAssignmentOptions([]);
    setEditAssignedClientOrgIds([]);
    setAssignmentsLoading(false);
    setRemoveAccessStep(0);
  }

  function toggleAssignedClientOrg(clientOrgId) {
    setEditAssignedClientOrgIds((prev) => {
      const exists = prev.some((id) => String(id) === String(clientOrgId));
      if (exists) return prev.filter((id) => String(id) !== String(clientOrgId));
      return [...prev, clientOrgId];
    });
  }

  function selectAllAssignedClientOrgs() {
    setEditAssignedClientOrgIds(editAssignmentOptions.map((org) => org.id));
  }

  function clearAssignedClientOrgs() {
    setEditAssignedClientOrgIds([]);
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
      const { data } = await api.post('/api/platform/users', fd);
      await loadStaff();
      const createdEmail = formEmail.trim();
      const createdName = [formFirst, formLast].map((s) => s.trim()).filter(Boolean).join(' ');
      const sent = Boolean(data?.welcomeEmailSent);
      const reactivated = Boolean(data?.reactivated);
      const baseMsg = reactivated
        ? `${createdName || createdEmail} was re-added.`
        : createdName
          ? `${createdName} was added.`
          : `${createdEmail} was added.`;
      showToast(
        sent
          ? `${baseMsg} A welcome email with sign-in and create-password links was sent.`
          : `${baseMsg} Welcome email was not sent — check RESEND_API_KEY and APP_URL, or share credentials manually.`,
        { variant: 'success' }
      );
      closeCreateModal();
    } catch (err) {
      const d = err.response?.data;
      const detail = d?.details ? ` ${d.details}` : '';
      setError((d?.error || 'Could not create user.') + detail);
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
      await api.put(`/api/platform/staff/${editUser.id}/client-assignments`, {
        clientOrganizationIds: editRole === 'employee' ? editAssignedClientOrgIds : [],
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

  async function resendWelcomeEmailForEditUser() {
    if (!editUser) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/api/platform/users/${editUser.id}/resend-welcome-email`);
      const sent = Boolean(data?.welcomeEmailSent);
      showToast(
        sent
          ? 'Welcome email sent with sign-in and create-password links.'
          : 'Email could not be sent — check RESEND_API_KEY and CRM_APP_URL.',
        { variant: sent ? 'success' : 'warning' }
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send email.');
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

  useDocumentTitle(!loading && ok ? `Users | ${DEFAULT_TAB}` : null);

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
        onOpenScope={(u) => openEditModal(u, { focusScope: true })}
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
        editAssignmentOptions={editAssignmentOptions}
        editAssignedClientOrgIds={editAssignedClientOrgIds}
        assignmentsLoading={assignmentsLoading}
        onToggleAssignedClientOrg={toggleAssignedClientOrg}
        onSelectAllAssignedClientOrgs={selectAllAssignedClientOrgs}
        onClearAssignedClientOrgs={clearAssignedClientOrgs}
        editFocusScopeSignal={editFocusScopeSignal}
        editAvatarFile={editAvatarFile}
        setEditAvatarFile={setEditAvatarFile}
        editRemoveAvatar={editRemoveAvatar}
        setEditRemoveAvatar={setEditRemoveAvatar}
        canRemoveAccess={canRemoveAccess}
        removeAccessStep={removeAccessStep}
        setRemoveAccessStep={setRemoveAccessStep}
        onClose={closeEditModal}
        onSave={saveEditUser}
        onResendWelcomeEmail={resendWelcomeEmailForEditUser}
        onConfirmRemoveAccess={confirmRemoveAccess}
      />
    </Layout>
  );
}
