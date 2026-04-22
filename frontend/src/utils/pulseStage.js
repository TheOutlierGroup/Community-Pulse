export const PULSE_STAGE_PRE = 'pre';
export const PULSE_STAGE_MID = 'mid';
export const PULSE_STAGE_POST = 'post';

const CANONICAL_BY_ALIAS = {
  pre: PULSE_STAGE_PRE,
  mid: PULSE_STAGE_MID,
  post: PULSE_STAGE_POST,
  during: PULSE_STAGE_MID,
  completed: PULSE_STAGE_POST,
};

export function normalizePulseStage(raw, fallback = PULSE_STAGE_PRE) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  return CANONICAL_BY_ALIAS[value] || fallback;
}

