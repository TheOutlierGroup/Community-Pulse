import * as AssessmentConsumptionEvent from '../models/AssessmentConsumptionEvent.js';
import * as Organization from '../models/Organization.js';
import * as LicenseConfig from '../models/LicenseConfig.js';

/**
 * Phase 2 reconciliation: month-end CSV builder for a single licensee.
 * Window semantics are half-open `[from, to)` so adjacent months never
 * double-count the same row. `monthIso` (`YYYY-MM`) is the convenience
 * form used by the cron and the manual download UI.
 */

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsvLine(values) {
  return values.map(escapeCsvField).join(',');
}

export function monthBoundsUtc(monthIso) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthIso || '').trim());
  if (!m) throw new Error('month must be YYYY-MM');
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  if (month < 1 || month > 12) throw new Error('month out of range');
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { from, to };
}

export function previousCompletedMonthIso(now = new Date()) {
  // Always reconcile the last completed month — running on the 1st of
  // any month should produce the previous month's report.
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; current month
  const prevMonth = month === 0 ? 12 : month;
  const prevYear = month === 0 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

export async function buildMonthlyReconciliation(licenseeOrganizationId, monthIso) {
  if (!licenseeOrganizationId) throw new Error('licenseeOrganizationId is required');
  const licensee = await Organization.getOrganization(licenseeOrganizationId);
  const isStandaloneEnterpriseClient = licensee && licensee.kind === 'client' && !licensee.parent_organization_id;
  if (!licensee || (licensee.kind !== 'licensee' && !isStandaloneEnterpriseClient)) {
    throw new Error('Not a licensee organization');
  }

  const { from, to } = monthBoundsUtc(monthIso);
  const [events, summary, licenceConfig] = await Promise.all([
    AssessmentConsumptionEvent.listForLicenseeBetween(licensee.id, from.toISOString(), to.toISOString()),
    AssessmentConsumptionEvent.summariseForLicenseeBetween(licensee.id, from.toISOString(), to.toISOString()),
    LicenseConfig.getForOrganization(licensee.id),
  ]);

  const header = [
    'event_id',
    'occurred_at',
    'client_organization_id',
    'client_organization_name',
    'pulse_session_id',
    'source',
    'assessments_charged',
    'actor_user_id',
  ];
  const lines = [toCsvLine(header)];
  for (const row of events) {
    lines.push(
      toCsvLine([
        row.id,
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        row.client_organization_id,
        row.client_organization_name || '',
        row.pulse_session_id || '',
        row.source,
        row.assessments_charged,
        row.actor_user_id || '',
      ])
    );
  }
  const csv = lines.join('\n') + '\n';

  return {
    licenseeOrganizationId: licensee.id,
    licenseeName: licensee.name,
    monthIso,
    from: from.toISOString(),
    to: to.toISOString(),
    summary,
    licenceConfig: LicenseConfig.publicLicenseConfig(licenceConfig),
    csv,
    filename: `reconciliation_${licensee.id}_${monthIso}.csv`,
  };
}

export async function listLicenseesForReconciliation() {
  // Lightweight reuse of the existing listing path; avoids a dedicated SQL
  // query and keeps "what counts as a licensee" centralised in the model.
  const rows = await Organization.listOrganizationsByKind('licensee');
  return rows;
}
