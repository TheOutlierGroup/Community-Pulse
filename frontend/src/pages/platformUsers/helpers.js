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

export function scopeLabel(user) {
  if (!user) return '—';
  if (user.role === 'admin') return 'All clients';
  const count = Number.isFinite(Number(user.assignmentCount)) ? Number(user.assignmentCount) : 0;
  return count === 1 ? '1 assigned client' : `${count} assigned clients`;
}
