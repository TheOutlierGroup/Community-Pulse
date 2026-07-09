export function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'platform') return 'Platform';
  if (role === 'basic') return 'Basic';
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
  if (user.role === 'admin' || user.role === 'platform') return 'All clients';
  if (user.role === 'basic') {
    const count = Array.isArray(user.businessUnits) ? user.businessUnits.length : 0;
    if (count === 0) return 'No business units assigned';
    return count === 1 ? '1 business unit' : `${count} business units`;
  }
  const count = Number.isFinite(Number(user.assignmentCount)) ? Number(user.assignmentCount) : 0;
  return count === 1 ? '1 assigned client' : `${count} assigned clients`;
}
