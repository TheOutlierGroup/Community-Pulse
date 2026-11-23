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

/**
 * "**Section 2 of 4** · Questions 5 to 8 of 16 · about 4 minutes left"
 * (bold markers rendered by EmphasisText).
 */
export function eventSectionHeading(step, totalQuestions = 16) {
  const s = Math.min(Math.max(Number(step) || 1, 1), SECTIONS);
  const total = Number(totalQuestions) || 16;
  const first = (s - 1) * QUESTIONS_PER_SECTION + 1;
  const last = Math.min(s * QUESTIONS_PER_SECTION, total);
  const mins = minutesLeft(s, total);
  return `**Section ${s} of ${SECTIONS}** · Questions ${first} to ${last} of ${total} · about ${mins} minute${mins === 1 ? '' : 's'} left`;
}

/** Progress bar fill at the start of a section (0 to 100). */
export function eventProgressPercent(step) {
  const s = Math.min(Math.max(Number(step) || 1, 1), SECTIONS + 1);
  return Math.round(((s - 1) / SECTIONS) * 100);
}
