export function exitSupportSessionUrl(orgId) {
  return orgId ? `/platform/clients/${orgId}` : '/platform';
}
