export function parseQueryBool(v, fallback = false) {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return fallback;
}

export function parseManagerIdsFromQuery(query) {
  const raw = query?.managerIds;
  if (raw == null) return [];
  const chunks = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  for (const chunk of chunks) {
    for (const part of String(chunk || '').split(',')) {
      const id = part.trim();
      if (!id) continue;
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

export function filterRowsForManagerScope(rows, managerIds, includeManagerSelf) {
  if (!managerIds || managerIds.size === 0) return rows;
  return rows.filter((row) => {
    const managerInviteId = row?.manager_invite_id || null;
    if (managerInviteId && managerIds.has(managerInviteId)) return true;
    if (!includeManagerSelf) return false;
    const inviteId = row?.invite_id || null;
    const isLinkManager = !row?.user_id && row?.role === 'admin' && inviteId && managerIds.has(inviteId);
    return Boolean(isLinkManager);
  });
}
