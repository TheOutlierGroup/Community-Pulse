const STAGE_PHASES = new Set(['pre', 'during', 'completed']);

export const PULSE_SECTION_IDS = [
  'organisation-dashboard',
  'organisation-scores',
  'trend-analysis',
  'sponsorship-analysis',
  'employee-breakdown',
  'score-breakdown',
  'team-level-view',
  'reports',
];

export function trendAnalysisVisibleFromOptions(pulseTimepointOptions) {
  const options = Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : [];
  const timepoints = new Set(
    options
      .filter((row) => STAGE_PHASES.has(String(row?.phase || '').trim()))
      .map((row) =>
        [
          String(row?.phase || '').trim(),
          String(row?.id || '').trim(),
          String(row?.dateKey || '').trim(),
        ].join(':')
      )
  );
  return timepoints.size >= 2;
}

export function resolvePulseFocusedSection(rawHash, trendAnalysisVisible) {
  const normalizedHash = String(rawHash || '').replace(/^#/, '').trim();
  const fullOverview = !normalizedHash || normalizedHash === 'organisation-dashboard';
  if (fullOverview) return null;
  if (normalizedHash === 'trend-analysis' && !trendAnalysisVisible) return null;
  if (normalizedHash === 'score-breakdown') return 'employee-breakdown';
  if (normalizedHash === 'manager-load-report') return 'sponsorship-analysis';
  if (PULSE_SECTION_IDS.includes(normalizedHash)) return normalizedHash;
  return null;
}
