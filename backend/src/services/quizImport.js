// Formidable exports two timestamp shapes across forms: ISO-ish
// "2026-07-20 21:12:24" and "17/07/2026 5:33" (D/M/Y, 24h). Parse both to an
// explicit-UTC ISO string so the stored wall-clock matches the export exactly
// (no server-timezone drift). Returns null when unparseable — the raw value is
// still kept in the entry's `raw` blob.
function iso(y, mo, d, h, mi, s) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${p(y, 4)}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s || '0')}Z`;
}

export function parseSubmittedAt(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return iso(m[1], m[2], m[3], m[4], m[5], m[6]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return iso(m[3], m[2], m[1], m[4], m[5], m[6]);

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(m[3], m[2], m[1], 0, 0, 0);

  return null;
}
