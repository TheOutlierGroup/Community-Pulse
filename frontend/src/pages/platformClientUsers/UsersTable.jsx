import PlatformUserAvatar from '../../components/platform/PlatformUserAvatar.jsx';
import { formatJoinedDate, roleLabel, userDisplayName } from './helpers.js';

export default function UsersTable({
  orgUsers,
  avatarListRev,
  orgId,
  onOpenEdit,
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
              <th scope="col">Joined</th>
            </tr>
          </thead>
          <tbody>
            {orgUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: '1.5rem' }}>
                  No users yet. Add one to send an invite.
                </td>
              </tr>
            )}
            {orgUsers.map((u) => (
              <tr
                key={u.id}
                className="platform-users-table__row platform-users-table__row--clickable"
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
                  <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>
                    {roleLabel(u.role)}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: '0.9rem' }}>
                  {formatJoinedDate(u.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
