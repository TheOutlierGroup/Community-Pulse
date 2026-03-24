export function getPostLoginPath(user) {
  if (!user) return '/';
  if (user.organizationKind === 'platform') return '/platform';
  if (user.organizationKind === 'client') {
    if (user.role === 'admin') return '/client';
    return '/pulse';
  }
  if (user.role === 'admin') return '/client';
  return '/pulse';
}
