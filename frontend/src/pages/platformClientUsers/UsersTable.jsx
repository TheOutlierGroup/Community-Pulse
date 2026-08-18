import { X } from 'lucide-react';
import PlatformUserAvatar from '../../components/platform/PlatformUserAvatar.jsx';
import { formatJoinedDate, roleLabel, userDisplayName } from './helpers.js';

export default function UsersTable({
  orgUsers,
  avatarListRev,
  orgId,
  onOpenEdit,
  onPurgeUser,
}) {
  return (
    <div className="card platform-users-card" style={{ marginTop: '1rem' }}>
      <div className="table-wrap">
        <table className="admin-table platform-users-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">User type</th>
              <th scope="col">Sign-in</th>
              <th scope="col">Joined</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {orgUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: '1.5rem' }}>
                  No users yet. Add one to send an invite.
                </td>
              </tr>
            )}
            {orgUsers.map((u) => {
              const deactivated = Boolean(u.deactivatedAt);
              return (
                <tr
                  key={u.id}
                  className={`platform-users-table__row platform-users-table__row--clickable${
                    deactivated ? ' platform-users-table__row--deactivated' : ''
                  }`}
                  tabIndex={0}
                  role="button"
                  onClick={() => onOpenEdit(u)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenEdit(u);
                    }
                  }}
                >
                  <td>
                    <div className="platform-users-table__name-cell">
                      <div className="platform-users-table__avatar-cell">
                        <PlatformUserAvatar
                          userId={u.id}
                          hasProfileAvatar={u.hasProfileAvatar}
                          rev={avatarListRev}
                          organizationId={orgId}
                        />
                      </div>
                      <span className="platform-users-table__name">{userDisplayName(u)}</span>
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {deactivated ? (
                      <span className="badge badge-archived">Deactivated</span>
                    ) : (
                      <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>
                        {roleLabel(u.role)}
                      </span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {u.loginEnabled === false ? 'Off' : 'On'}
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {formatJoinedDate(u.createdAt)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {deactivated && (
                      <button
                        type="button"
                        className="btn btn-danger-ghost platform-users-table__purge-btn"
                        title="Permanently delete this user"
                        aria-label={`Permanently delete ${u.email}`}
                        onClick={() => onPurgeUser(u)}
                      >
                        <X size={16} strokeWidth={2} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
