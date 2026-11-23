/**
 * Shared survey wording helpers, used by both the public link survey
 * (PublicPulse) and the signed-in employee survey (EmployeePulse).
 *
 * Kept free of React and Vite imports so it runs under `node --test`.
 */

/** Agreement scale shown on every statement. Labels are sentence case. */
export const SURVEY_SCALE = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neither agree nor disagree' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
];

/** Ids of the given questions that have no answer yet, in question order. */
export function missingQuestionIds(questions, answers) {
  const list = Array.isArray(questions) ? questions : [];
  const given = answers && typeof answers === 'object' ? answers : {};
  return list.filter((q) => q && q.id && !given[q.id]).map((q) => q.id);
}

/** "1 statement still needs an answer." / "3 statements still need an answer." */
export function missingAnswersMessage(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return n === 1 ? '1 statement still needs an answer.' : `${n} statements still need an answer.`;
}

/**
 * Splits statement text on `**bold**` markers into plain and bold runs, so
 * the survey can bold the key phrase of each statement without rendering
 * raw HTML. An unmatched `**` is left as literal text.
 *
 * @returns {{ text: string, bold: boolean }[]}
 */
export function parseEmphasis(text) {
  const source = String(text ?? '');
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match.index > last) out.push({ text: source.slice(last, match.index), bold: false });
    out.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push({ text: source.slice(last), bold: false });
  return out;
}

/** Statement text with `**` markers removed (for aria labels and plain contexts). */
export function stripEmphasis(text) {
  return parseEmphasis(text).map((part) => part.text).join('');
}
