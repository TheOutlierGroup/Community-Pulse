import { DASHBOARD_MIN_SAMPLE_SIZE } from './pulseDashboardScope.js';

/**
 * Minimum group size for reporting ("results are only reported for groups
 * of N or more"). Normally 5 (DASHBOARD_MIN_SAMPLE_SIZE).
 *
 * Outlier platform admins can turn on a lower minimum of 3 for a small
 * client organisation (organizations.settings.smallOrgMinimum).
 *
 * Every link response records the minimum that respondent was told
 * (pulse_link_responses.promised_min_group_size). A report or dashboard
 * group then uses the strictest promise among its responses, so:
 *   - responses from before this existed (NULL) count as 5;
 *   - signed-in employee responses (no promise recorded) count as 5;
 *   - a stage that started after the switch, where everyone was told 3,
 *     reports at 3;
 *   - a stage already underway keeps telling new respondents 5, and keeps
 *     reporting at 5.
 * A promise can therefore only ever be kept or exceeded, never broken.
 */

export const STANDARD_MINIMUM = DASHBOARD_MIN_SAMPLE_SIZE;
export const SMALL_ORG_MINIMUM = 3;

/** Normalised view of settings.smallOrgMinimum. */
export function normalizeSmallOrgSetting(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const enabledAtMs = Date.parse(String(source.enabledAt || ''));
  return {
    enabled: source.enabled === true,
    enabledAt: source.enabled === true && Number.isFinite(enabledAtMs) ? new Date(enabledAtMs).toISOString() : null,
  };
}

export function smallOrgMinimumEnabled(settings) {
  return normalizeSmallOrgSetting(settings?.smallOrgMinimum).enabled;
}

function promiseForRow(row) {
  if (row?.source_type === 'employee') return STANDARD_MINIMUM;
  const value = Number(row?.promised_min_group_size);
  return Number.isInteger(value) && value >= SMALL_ORG_MINIMUM ? value : STANDARD_MINIMUM;
}

/**
 * Minimum group size for a reporting group, given every response row in
 * it (completed and in progress).
 */
export function minimumForStageRows(settings, rows) {
  if (!smallOrgMinimumEnabled(settings)) return STANDARD_MINIMUM;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return SMALL_ORG_MINIMUM;
  return Math.max(...list.map(promiseForRow));
}

/**
 * Minimum to tell a respondent opening the survey. `otherRows` are the
 * other responses already in their session (excluding their own).
 */
export function minimumToPromise(settings, otherRows) {
  if (!smallOrgMinimumEnabled(settings)) return STANDARD_MINIMUM;
  const list = Array.isArray(otherRows) ? otherRows : [];
  return list.some((row) => promiseForRow(row) > SMALL_ORG_MINIMUM) ? STANDARD_MINIMUM : SMALL_ORG_MINIMUM;
}

/** Admin payload. */
export function smallOrgMinimumPayload(organization) {
  return {
    ...normalizeSmallOrgSetting(organization?.settings?.smallOrgMinimum),
    standardMinimum: STANDARD_MINIMUM,
    smallOrgMinimum: SMALL_ORG_MINIMUM,
  };
}
