export const PULSE_STAGE_PRE = 'pre';
export const PULSE_STAGE_MID = 'mid';
export const PULSE_STAGE_POST = 'post';

export const PULSE_STAGES = [PULSE_STAGE_PRE, PULSE_STAGE_MID, PULSE_STAGE_POST];

const INTERNAL_STAGE_BY_CANONICAL = {
  [PULSE_STAGE_PRE]: 'pre',
  [PULSE_STAGE_MID]: 'during',
  [PULSE_STAGE_POST]: 'completed',
};

const CANONICAL_STAGE_BY_ALIAS = {
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
  return CANONICAL_STAGE_BY_ALIAS[value] || fallback;
}

export function pulseStageToInternalTimepoint(stage, fallback = 'pre') {
  return (
    INTERNAL_STAGE_BY_CANONICAL[normalizePulseStage(stage, fallback)]
    || INTERNAL_STAGE_BY_CANONICAL[PULSE_STAGE_PRE]
  );
}

export function internalTimepointToPulseStage(value, fallback = PULSE_STAGE_PRE) {
  return normalizePulseStage(value, fallback);
}

export function parsePulseStageFromRequest(req, fallback = PULSE_STAGE_PRE) {
  return normalizePulseStage(req.params?.stage || req.query?.stage || req.body?.stage, fallback);
}

