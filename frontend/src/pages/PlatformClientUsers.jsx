import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Plus, Users } from 'lucide-react';
import UsersTable from './platformClientUsers/UsersTable.jsx';
import InviteUserModal from './platformClientUsers/InviteUserModal.jsx';
import EditUserModal from './platformClientUsers/EditUserModal.jsx';

export default function PlatformClientUsers() {
  const { user } = useAuth();
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [orgUsers, setOrgUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avatarListRev, setAvatarListRev] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');

  const [editUser, setEditUser] = useState(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('employee');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editRemoveAvatar, setEditRemoveAvatar] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editLoginEnabled, setEditLoginEnabled] = useState(true);
  const [removeAccessStep, setRemoveAccessStep] = useState(0);

  const loadUsers = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/users`);
    setOrgUsers(data.users || []);
    setAvatarListRev((n) => n + 1);
  }, [orgId]);

  useEffect(() => {
    loadUsers().catch(() => setOrgUsers([]));
  }, [loadUsers]);

  useEffect(() => {
    if (!modalOpen && !editUser) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editUser) closeEditModal();
        else closeInviteModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, editUser]);

  function closeInviteModal() {
    setModalOpen(false);
    setError('');
    setInviteEmail('');
    setInviteFirstName('');
    setInviteLastName('');
    setInviteRole('employee');
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
    setEditLoginEnabled(u.loginEnabled !== false);
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setEditPassword('');
  }

  function closeEditModal() {
    setEditUser(null);
    setError('');
    setEditAvatarFile(null);
    setEditRemoveAvatar(false);
    setEditPassword('');
    setRemoveAccessStep(0);
  }

  async function sendOrgInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const invitedTo = inviteEmail.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/invites`, {
        email: invitedTo,
        invitedRole: inviteRole,
        firstName: inviteFirstName.trim() || undefined,
        lastName: inviteLastName.trim() || undefined,
      });
      const fullInvite = `${window.location.origin}${data.inviteUrl}`;
      showToast(`Invite link for ${invitedTo}:\n\n${fullInvite}`, {
        variant: 'success',
        durationMs: 20000,
      });
      await loadUsers();
      closeInviteModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
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
      await api.patch(`/api/platform/organizations/${orgId}/users/${editUser.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        role: editRole,
        loginEnabled: editLoginEnabled,
      });
      if (editAvatarFile) {
        const fd = new FormData();
        fd.append('avatar', editAvatarFile);
        await api.post(`/api/platform/organizations/${orgId}/users/${editUser.id}/avatar`, fd);
      } else if (editRemoveAvatar && editUser.hasProfileAvatar) {
        await api.delete(`/api/platform/organizations/${orgId}/users/${editUser.id}/avatar`);
      }
      await loadUsers();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }

  async function setPasswordForEditUser() {
    if (!editUser) return;
    if (!editPassword || editPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/users/${editUser.id}/password`, { password: editPassword });
      setEditPassword('');
      showToast('Password updated.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Password update failed.');
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
      await loadUsers();
      closeEditModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove access.');
    } finally {
      setBusy(false);
    }
  }

  const canRemoveAccess = editUser && String(editUser.id) !== String(user?.id);

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && !modalOpen && !editUser && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
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

      <UsersTable
        orgUsers={orgUsers}
        avatarListRev={avatarListRev}
        orgId={orgId}
        onOpenEdit={openEditModal}
      />

      <InviteUserModal
        open={modalOpen}
        error={modalOpen ? error : ''}
        busy={busy}
        inviteEmail={inviteEmail}
        inviteFirstName={inviteFirstName}
        inviteLastName={inviteLastName}
        inviteRole={inviteRole}
        setInviteEmail={setInviteEmail}
        setInviteFirstName={setInviteFirstName}
        setInviteLastName={setInviteLastName}
        setInviteRole={setInviteRole}
        onClose={closeInviteModal}
        onSubmit={sendOrgInvite}
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
        editPassword={editPassword}
        setEditPassword={setEditPassword}
        editLoginEnabled={editLoginEnabled}
        setEditLoginEnabled={setEditLoginEnabled}
        canRemoveAccess={canRemoveAccess}
        removeAccessStep={removeAccessStep}
        setRemoveAccessStep={setRemoveAccessStep}
        onClose={closeEditModal}
        onSave={saveEditUser}
        onSetPassword={setPasswordForEditUser}
        onConfirmRemoveAccess={confirmRemoveAccess}
      />
    </>
  );
}
