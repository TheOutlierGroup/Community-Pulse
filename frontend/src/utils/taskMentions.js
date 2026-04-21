/**
 * Matches @token or @email in text.
 * Token form powers human-friendly mentions like "@Nick".
 */
const MENTION_TOKEN_RE = /@([a-zA-Z0-9._+-]+(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?)/g;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function emailLocalPart(email) {
  const normalized = normalize(email);
  if (!normalized.includes('@')) return '';
  return normalized.split('@')[0];
}

export function mentionUserHandle(user) {
  const first = String(user?.firstName || '').trim();
  if (first) return first;
  const localPart = emailLocalPart(user?.email);
  if (localPart) return localPart;
  const fullName = [String(user?.firstName || '').trim(), String(user?.lastName || '').trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || '';
}

export function taggedUserIdsFromMentionText(text, assignableUsers) {
  if (!text || !assignableUsers?.length) return [];

  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  const mentionTokens = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    mentionTokens.add(normalize(m[1]));
  }

  if (!mentionTokens.size) return [];

  const users = Array.isArray(assignableUsers) ? assignableUsers : [];
  const usersByEmail = new Map();
  const usersByLocalPart = new Map();
  const usersByHandle = new Map();

  for (const user of users) {
    const email = normalize(user?.email);
    const localPart = emailLocalPart(email);
    const handle = normalize(mentionUserHandle(user));
    if (email) usersByEmail.set(email, user.id);
    if (localPart) {
      const ids = usersByLocalPart.get(localPart) || [];
      ids.push(user.id);
      usersByLocalPart.set(localPart, ids);
    }
    if (handle) {
      const ids = usersByHandle.get(handle) || [];
      ids.push(user.id);
      usersByHandle.set(handle, ids);
    }
  }

  const ids = new Set();

  for (const token of mentionTokens) {
    if (usersByEmail.has(token)) {
      ids.add(usersByEmail.get(token));
      continue;
    }

    const handleMatches = usersByHandle.get(token) || [];
    if (handleMatches.length === 1) {
      ids.add(handleMatches[0]);
      continue;
    }

    const localPartMatches = usersByLocalPart.get(token) || [];
    if (localPartMatches.length === 1) {
      ids.add(localPartMatches[0]);
    }
  }

  return [...ids];
}
