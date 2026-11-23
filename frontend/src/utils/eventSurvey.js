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

// ── Answer drafts on this device ─────────────────────────────────────────
// localStorage (not sessionStorage), so tapping the invite link again opens
// a new tab that still has the answers. Keyed by the respondent's own link,
// expires after 14 days, cleared on submit, and never sent anywhere. Every
// access is guarded: storage can be unavailable.

const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function validAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([id, v]) => /^M?Q\d{1,2}$/.test(id) && Number.isInteger(v) && v >= 1 && v <= 5)
  );
}

export function readAnswerDraft(key, storage = defaultStorage(), now = Date.now()) {
  if (!key || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    if (parsed && typeof parsed === 'object' && 'answers' in parsed) {
      if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > DRAFT_TTL_MS) return {};
      return validAnswers(parsed.answers);
    }
    return validAnswers(parsed);
  } catch {
    return {};
  }
}

export function writeAnswerDraft(key, answers, storage = defaultStorage(), now = Date.now()) {
  if (!key || !storage) return;
  try {
    storage.setItem(key, JSON.stringify({ savedAt: now, answers: answers || {} }));
  } catch {
    /* storage full or blocked: drafts are a convenience only */
  }
}

export function clearAnswerDraft(key, storage = defaultStorage()) {
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}
