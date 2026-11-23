/** Event mode survey helpers (pure, testable under `node --test`). */

export const EVENT_SURVEY_MINUTES = 5;
const QUESTIONS_PER_SECTION = 4;
const SECTIONS = 4;

/** Rough minutes left at the start of a section, never below 1. */
export function minutesLeft(step, totalQuestions = 16) {
  const total = Math.max(1, Number(totalQuestions) || 16);
  const done = Math.max(0, (Number(step) - 1) * QUESTIONS_PER_SECTION);
  const remaining = Math.max(0, total - done);
  return Math.max(1, Math.round((EVENT_SURVEY_MINUTES * remaining) / total));
}

function answeredCount(answers, questions) {
  const given = answers && typeof answers === 'object' ? answers : {};
  if (Array.isArray(questions) && questions.length) return questions.filter((q) => q && given[q.id]).length;
  return Object.values(given).filter(Boolean).length;
}

/** Rough minutes left from the number of statements still unanswered, never below 1. */
export function minutesLeftForAnswers(answers, questions, totalQuestions = 16) {
  const total = Math.max(1, Number(totalQuestions) || 16);
  const remaining = Math.max(0, total - answeredCount(answers, questions));
  return Math.max(1, Math.ceil((EVENT_SURVEY_MINUTES * remaining) / total));
}

/**
 * "**Section 2 of 4** · Questions 5 to 8 of 16 · about 4 minutes left"
 * (bold markers rendered by EmphasisText). With answers given, the time
 * left follows what has actually been answered rather than the section.
 */
export function eventSectionHeading(step, totalQuestions = 16, answers = null, questions = null) {
  const s = Math.min(Math.max(Number(step) || 1, 1), SECTIONS);
  const total = Number(totalQuestions) || 16;
  const first = (s - 1) * QUESTIONS_PER_SECTION + 1;
  const last = Math.min(s * QUESTIONS_PER_SECTION, total);
  const mins = answers ? minutesLeftForAnswers(answers, questions, total) : minutesLeft(s, total);
  return `**Section ${s} of ${SECTIONS}** · Questions ${first} to ${last} of ${total} · about ${mins} minute${mins === 1 ? '' : 's'} left`;
}

/** Progress bar fill at the start of a section (0 to 100). */
export function eventProgressPercent(step) {
  const s = Math.min(Math.max(Number(step) || 1, 1), SECTIONS + 1);
  return Math.round(((s - 1) / SECTIONS) * 100);
}

/** Progress bar fill from statements answered so far (0 to 100). */
export function answeredProgressPercent(answers, questions) {
  const total = Array.isArray(questions) && questions.length ? questions.length : 16;
  return Math.round((answeredCount(answers, questions) / total) * 100);
}

// ── Per-tab answer drafts ────────────────────────────────────────────────
// sessionStorage stays with the tab (it survives a locked phone, a reload
// or a discarded-and-restored tab) and never reaches other tabs, devices
// or the server. Every access is guarded: storage can be unavailable.

export function readAnswerDraft(key, storage = globalThis.sessionStorage) {
  if (!key || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, v]) => /^M?Q\d{1,2}$/.test(id) && Number.isInteger(v) && v >= 1 && v <= 5)
    );
  } catch {
    return {};
  }
}

export function writeAnswerDraft(key, answers, storage = globalThis.sessionStorage) {
  if (!key || !storage) return;
  try {
    storage.setItem(key, JSON.stringify(answers || {}));
  } catch {
    /* storage full or blocked: drafts are a convenience only */
  }
}

export function clearAnswerDraft(key, storage = globalThis.sessionStorage) {
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}
