import { CLIENT_SERVICE_PULSE, userHasService } from './clientServices.js';

export { CLIENT_SERVICE_PULSE, userHasService };

export function getPostLoginPath(user) {
  if (!user) return '/';
  if (user.organizationKind === 'platform') return '/platform';
  if (user.organizationKind === 'client') {
    if (user.role === 'admin') return '/client';
    return userHasService(user, CLIENT_SERVICE_PULSE) ? '/pulse' : '/settings';
  }
  if (user.role === 'admin') return '/client';
  return '/pulse';
}
