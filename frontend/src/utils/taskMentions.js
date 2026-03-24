/** Matches @local@domain.tld in text; maps to assignable user ids by email (case-insensitive). */
const MENTION_EMAIL_RE = /@([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function taggedUserIdsFromMentionText(text, assignableUsers) {
  if (!text || !assignableUsers?.length) return [];
  const re = new RegExp(MENTION_EMAIL_RE.source, 'g');
  const emails = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    emails.add(m[1].toLowerCase().trim());
  }
  const ids = new Set();
  for (const u of assignableUsers) {
    if (emails.has(String(u.email).toLowerCase())) {
      ids.add(u.id);
    }
  }
  return [...ids];
}
