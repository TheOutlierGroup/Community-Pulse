// Parse a WordPress (Formidable) quiz export and map it to normalised entries
// for ingestion. The tricky bits: the Name and Email columns have *blank*
// headers (the form uses placeholder text), and the free-text "change risk"
// question wording differs per quiz — so we resolve columns by position and by
// header heuristics, then read values from the raw record arrays.

import { parseCsv } from './contactImportCsv.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function norm(h) {
  return String(h || '').trim().toLowerCase();
}

// Resolve every column index we care about from the header row.
function resolveColumns(headers) {
  const idxOf = (pred) => headers.findIndex(pred);
  const cols = {
    persona: idxOf((h) => norm(h) === 'persona'),
    change_state: idxOf((h) => norm(h) === 'change_state'),
    timestamp: idxOf((h) => norm(h) === 'timestamp'),
    external_id: idxOf((h) => norm(h) === 'id'),
    utm_source: idxOf((h) => norm(h) === 'utm_source'),
    utm_campaign: idxOf((h) => norm(h) === 'utm_campaign'),
    utm_medium: idxOf((h) => norm(h) === 'utm_medium'),
    utm_content: idxOf((h) => norm(h) === 'utm_content'),
  };

  // change_risk: the free-text "in one sentence… derail this program?" question.
  // Match by wording; fall back to the question column just before score_adoption.
  let changeRisk = idxOf((h) => /in one sentence|derail this program/.test(norm(h)));
  if (changeRisk < 0) {
    const scoreIdx = idxOf((h) => norm(h) === 'score_adoption');
    changeRisk = scoreIdx > 0 ? scoreIdx - 1 : -1;
  }
  cols.change_risk = changeRisk;

  return cols;
}

// The blank-header columns are Name and Email. Decide which is which by
// sampling values: whichever looks like an email is the email column.
function resolveNameEmail(headers, records) {
  const blanks = headers.map((h, i) => (String(h).trim() === '' ? i : -1)).filter((i) => i >= 0);
  if (blanks.length === 0) return { name: -1, email: -1 };

  const looksEmail = (idx) => records.some((r) => EMAIL_RE.test(String(r[idx] || '').trim()));
  let emailIdx = blanks.find(looksEmail);
  let nameIdx;
  if (emailIdx === undefined) {
    // No obvious email column — take positional order (name, email).
    nameIdx = blanks[0];
    emailIdx = blanks[1] ?? -1;
  } else {
    nameIdx = blanks.find((i) => i !== emailIdx) ?? -1;
  }
  return { name: nameIdx, email: emailIdx };
}

// Does the file look like a Formidable quiz export?
export function looksLikeQuiz(parsed) {
  const present = new Set(parsed.headers.map(norm));
  return present.has('id') && present.has('timestamp') && (present.has('persona') || present.has('change_state'));
}

export function mapQuizRows(parsed) {
  const { headers, records } = parsed;
  const cols = resolveColumns(headers);
  const { name: nameIdx, email: emailIdx } = resolveNameEmail(headers, records);
  const at = (r, i) => (i >= 0 && i < r.length ? String(r[i] ?? '').trim() : '');

  // Stable keys for the raw blob, disambiguating blank/duplicate headers so
  // nothing is lost or overwritten.
  const rawKeys = headers.map((h, i) => {
    const base = String(h).trim();
    return base === '' ? (i === nameIdx ? 'name' : i === emailIdx ? 'email' : `col_${i}`) : base;
  });
  const seen = new Map();
  const uniqueKeys = rawKeys.map((k) => {
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k} (${n})`;
  });

  return records.map((r) => {
    const raw = {};
    uniqueKeys.forEach((k, i) => { raw[k] = r[i] !== undefined ? r[i] : ''; });
    return {
      external_id: at(r, cols.external_id),
      name: at(r, nameIdx),
      email: at(r, emailIdx),
      persona: at(r, cols.persona),
      change_state: at(r, cols.change_state),
      change_risk: at(r, cols.change_risk),
      submitted_at: at(r, cols.timestamp),
      utm_source: at(r, cols.utm_source),
      utm_campaign: at(r, cols.utm_campaign),
      utm_medium: at(r, cols.utm_medium),
      utm_content: at(r, cols.utm_content),
      raw,
    };
  });
}

// ── Display helpers ────────────────────────────────────────────────────────

const PERSONA_LABELS = { 'persona-pop': 'People (POP)', 'persona-pap': 'Operations (PAP)' };
export function personaLabel(v) {
  const s = String(v || '').trim();
  return PERSONA_LABELS[s.toLowerCase()] || s || '—';
}

const CHANGE_STATE_LABELS = {
  'state-high-risk': 'High risk',
  'state-capable-wary': 'Capable but wary',
  'state-motivated-lost': 'Motivated but lost',
  'state-optimal': 'Optimal',
};
export function changeStateLabel(v) {
  const s = String(v || '').trim();
  return CHANGE_STATE_LABELS[s.toLowerCase()] || s || '—';
}
export function changeStateBadgeClass(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'state-high-risk') return 'badge badge-lost';
  if (s === 'state-optimal') return 'badge badge-won';
  if (s === 'state-capable-wary' || s === 'state-motivated-lost') return 'badge badge-on-hold';
  return 'badge';
}
