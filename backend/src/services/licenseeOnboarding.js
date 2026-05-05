import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import * as AssessmentConsumptionEvent from '../models/AssessmentConsumptionEvent.js';

/**
 * ONB-02 setup checklist for a licensee admin's first 24 hours.
 *
 * Every step is *derived* from existing state — no new tables, no flags
 * to flip. That keeps the checklist honest: if you delete the brand,
 * the step un-completes. The trade-off is that "dismissed" is the only
 * piece we don't have a natural data signal for, so we let the UI store
 * it locally (per-user) rather than persisting another DB row.
 *
 * Step IDs are stable and used by the frontend to render labels and
 * link targets, so renames are a breaking change for any in-flight UI.
 */

export const STEP_IDS = Object.freeze({
  CONFIRM_LICENCE: 'confirm_licence',
  UPLOAD_LOGO: 'upload_logo',
  SET_BRAND_COLOR: 'set_brand_color',
  INVITE_TEAMMATE: 'invite_teammate',
  CREATE_FIRST_CLIENT: 'create_first_client',
  OPEN_FIRST_ASSESSMENT: 'open_first_assessment',
});

const STEP_ORDER = [
  STEP_IDS.CONFIRM_LICENCE,
  STEP_IDS.UPLOAD_LOGO,
  STEP_IDS.SET_BRAND_COLOR,
  STEP_IDS.INVITE_TEAMMATE,
  STEP_IDS.CREATE_FIRST_CLIENT,
  STEP_IDS.OPEN_FIRST_ASSESSMENT,
];

function step(id, label, description, completed, action = null) {
  return { id, label, description, completed, action };
}

/**
 * Pure checklist summariser. Takes already-fetched state and returns
 * the ordered checklist + counts. Split from the data-loading
 * orchestrator below so it can be unit-tested without ESM mocking.
 */
export function summariseLicenseeOnboarding({
  user,
  organization,
  licenceConfig,
  activeUsers,
  downstreamClients,
  assessments,
}) {
  if (!user || !organization || organization.kind !== 'licensee') return null;

  // Confirmed licence = a row exists *and* has either a non-default
  // assessments_included or a contract_end set. A bare default row from
  // org-create alone shouldn't count as "confirmed".
  const licenceConfirmed = Boolean(
    licenceConfig && (licenceConfig.assessments_included || licenceConfig.contract_end)
  );

  const logoUploaded = Boolean(organization.company_logo_filename);
  const brandColorSet = Boolean(licenceConfig?.brand_primary_color);

  const otherAdmins = (activeUsers || []).filter(
    (u) => u.id !== user.id && !u.deactivated_at && u.login_enabled !== false
  );
  const teammateInvited = otherAdmins.length > 0;

  const firstClientCreated = (downstreamClients || []).length > 0;
  const firstAssessmentOpened = (assessments || []).length > 0;

  const steps = [
    step(
      STEP_IDS.CONFIRM_LICENCE,
      'Confirm your licence details',
      'Review the assessment quota, contract end date and licence status that Outlier set up for you.',
      licenceConfirmed,
      { kind: 'platform_settings', href: `/platform/clients/${organization.id}/account` }
    ),
    step(
      STEP_IDS.UPLOAD_LOGO,
      'Upload your logo',
      'Your logo appears in the sidebar, on assessment surveys and on PDF reports for downstream clients.',
      logoUploaded,
      { kind: 'internal', href: `/platform/clients/${organization.id}/account` }
    ),
    step(
      STEP_IDS.SET_BRAND_COLOR,
      'Pick your brand colour',
      'A single hex colour ties branding together across the survey welcome screen and report cover pages.',
      brandColorSet,
      { kind: 'internal', href: `/platform/clients/${organization.id}/account` }
    ),
    step(
      STEP_IDS.INVITE_TEAMMATE,
      'Invite a teammate',
      'Add at least one other admin so you are not the single point of failure for client work.',
      teammateInvited,
      { kind: 'internal', href: '/platform/users' }
    ),
    step(
      STEP_IDS.CREATE_FIRST_CLIENT,
      'Create your first client',
      'Add the first downstream client company and grant them Rhythm Engine access.',
      firstClientCreated,
      { kind: 'internal', href: '/platform/clients' }
    ),
    step(
      STEP_IDS.OPEN_FIRST_ASSESSMENT,
      'Open your first assessment',
      'Run a Pulse session for a client to confirm the metering and reporting flow end-to-end.',
      firstAssessmentOpened,
      { kind: 'internal', href: '/platform/clients' }
    ),
  ];

  // Maintain documented order regardless of the JS map order above.
  const ordered = STEP_ORDER.map((id) => steps.find((s) => s.id === id)).filter(Boolean);
  const completed = ordered.filter((s) => s.completed).length;
  return {
    organizationId: organization.id,
    steps: ordered,
    completed,
    total: ordered.length,
    isComplete: completed === ordered.length,
  };
}

/**
 * Build the checklist for an authenticated licensee admin. Returns null
 * for non-licensee callers; the route layer is responsible for gating.
 *
 * Thin wrapper that loads the four needed slices in parallel and
 * delegates derivation to summariseLicenseeOnboarding.
 */
export async function buildLicenseeOnboardingChecklist({ user, organization }) {
  if (!user || !organization || organization.kind !== 'licensee') return null;

  const [licenceConfig, activeUsers, downstreamClients, assessments] = await Promise.all([
    LicenseConfig.getForOrganization(organization.id),
    User.listUsersForOrg(organization.id, { role: 'admin' }),
    Organization.listClientOrganizationsForParent(organization.id, { limit: 1 }),
    AssessmentConsumptionEvent.listForLicensee(organization.id, { limit: 1 }),
  ]);

  return summariseLicenseeOnboarding({
    user,
    organization,
    licenceConfig,
    activeUsers,
    downstreamClients,
    assessments,
  });
}
