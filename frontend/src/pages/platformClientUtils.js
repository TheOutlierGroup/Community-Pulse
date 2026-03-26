export {
  CLIENT_SERVICE_PULSE,
  normalizeSettings,
  normalizeServices,
  hasService,
} from '../utils/clientServices.js';

export function sessionStatusLabel(s) {
  if (s === 'active') return 'Active';
  if (s === 'closed') return 'Closed';
  return 'Draft';
}
