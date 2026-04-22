const STAGE_PHASES = new Set(['pre', 'during', 'completed']);

export const PULSE_SECTION_IDS = [
  'organisation-dashboard',
  'organisation-scores',
  'trend-analysis',
  'employee-breakdown',
  'score-breakdown',
  'team-level-view',
  'reports',
];

export function trendAnalysisVisibleFromOptions(pulseTimepointOptions) {
  const options = Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : [];
  const phases = new Set(
    options
      .map((row) => String(row?.phase || '').trim())
      .filter((phase) => STAGE_PHASES.has(phase))
  );
  return phases.size >= 2;
}

export function resolvePulseFocusedSection(rawHash, trendAnalysisVisible) {
  const normalizedHash = String(rawHash || '').replace(/^#/, '').trim();
  const fullOverview = !normalizedHash || normalizedHash === 'organisation-dashboard';
  if (fullOverview) return null;
  if (normalizedHash === 'trend-analysis' && !trendAnalysisVisible) return null;
  if (normalizedHash === 'score-breakdown') return 'employee-breakdown';
  if (PULSE_SECTION_IDS.includes(normalizedHash)) return normalizedHash;
  return null;
}
