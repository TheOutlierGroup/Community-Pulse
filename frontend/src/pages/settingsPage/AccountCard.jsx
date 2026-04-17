export default function AccountCard({ user, orgLabel }) {
  return (
    <div className="card account-card">
      <h2 className="settings-section-title">Account</h2>
      <dl className="settings-dl">
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
        <dt>Organization</dt>
        <dd>{orgLabel}</dd>
        <dt>Account type</dt>
        <dd style={{ textTransform: 'capitalize' }}>{user.organizationKind}</dd>
      </dl>
    </div>
  );
}
