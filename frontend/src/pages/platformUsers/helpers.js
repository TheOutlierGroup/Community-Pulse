export function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Member';
  return role;
}

export function userDisplayName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '—';
}

export function formatJoinedDate(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
