import * as Organization from '../models/Organization.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import * as AssessmentConsumptionEvent from '../models/AssessmentConsumptionEvent.js';
import { recordAuditEvent, AUDIT_ACTIONS } from './auditLog.js';

/**
 * Returns the parent licensee organization for a client org, or null if
 * the client has no licensee parent (i.e. it's a platform-managed client
 * and not subject to licensee metering).
 */
export async function getParentLicenseeForClient(clientOrgOrId) {
  const client = typeof clientOrgOrId === 'string'
    ? await Organization.getOrganization(clientOrgOrId)
    : clientOrgOrId;
  if (!client || !client.parent_organization_id) return null;
  const parent = await Organization.getOrganization(client.parent_organization_id);
  if (!parent || parent.kind !== 'licensee') return null;
  return parent;
}

/**
 * A standalone "Enterprise" client — kind === 'client', no licensee
 * parent — can carry its own licence_config directly instead of a
 * Practitioner (licensee) shell provisioning it. Returns the client
 * itself as its own metering target when it has a licence_config row,
 * or null when it's either a downstream client (metered via its parent
 * Practitioner) or a plain client with no Rhythm Engine licence at all.
 */
export async function standaloneLicenceOwnerForClient(clientOrgOrId) {
  const client = typeof clientOrgOrId === 'string'
    ? await Organization.getOrganization(clientOrgOrId)
    : clientOrgOrId;
  if (!client || client.kind !== 'client' || client.parent_organization_id) return null;
  const config = await LicenseConfig.getForOrganization(client.id);
  return config ? client : null;
}

/**
 * Resolves whichever org actually owns this client's licence/quota —
 * a parent Practitioner if one exists, otherwise the client's own
 * standalone Enterprise licence, otherwise null (unmetered, platform-
 * direct client with no Rhythm Engine contract at all).
 */
async function meteringOrgForClient(client) {
  const licensee = await getParentLicenseeForClient(client);
  if (licensee) return licensee;
  return standaloneLicenceOwnerForClient(client);
}

function reasonToHttp(reason) {
  if (reason === 'quota_exceeded') {
    return {
      status: 402,
      error:
        'Assessment quota reached for this Rhythm Engine licence. Contact your account manager to top up.',
    };
  }
  if (reason === 'suspended') {
    return {
      status: 402,
      error: 'This Rhythm Engine licence is suspended. Contact Outlier to reactivate.',
    };
  }
  if (reason === 'expired') {
    return {
      status: 402,
      error: 'This Rhythm Engine licence has expired. Contact Outlier to renew.',
    };
  }
  return {
    status: 402,
    error: 'Unable to open a new assessment under this Rhythm Engine licence.',
  };
}

/**
 * INF-04 entry point. Charges one assessment against whichever org holds
 * this client's licence — a parent Practitioner (licensee) if one exists,
 * or the client's own licence_config if it's a standalone Enterprise
 * client. Plain platform-direct clients with neither are not metered.
 * Returns:
 *   - { metered: false } when the client has no licence owner at all
 *   - { metered: true, ok: true, licensee, licenseConfig } on success
 *   - { metered: true, ok: false, status, error, reason, licensee } on
 *     quota / status failure
 */
export async function consumeAssessmentForClient(clientOrgOrId, options = {}) {
  const {
    source = 'platform_session_create',
    actorUserId = null,
    pulseSessionId = null,
    metadata = {},
  } = options;
  const client = typeof clientOrgOrId === 'string'
    ? await Organization.getOrganization(clientOrgOrId)
    : clientOrgOrId;
  if (!client) {
    return { metered: false };
  }
  const licensee = await meteringOrgForClient(client);
  if (!licensee) {
    return { metered: false };
  }
  const result = await LicenseConfig.tryConsumeAssessment(licensee.id, 1);
  if (!result.ok) {
    const http = reasonToHttp(result.reason);
    return {
      metered: true,
      ok: false,
      status: http.status,
      error: http.error,
      reason: result.reason,
      licensee,
      licenseConfig: result.row || null,
    };
  }
  const event = await AssessmentConsumptionEvent.recordEvent({
    licenseeOrganizationId: licensee.id,
    clientOrganizationId: client.id,
    pulseSessionId,
    source,
    actorUserId,
    metadata,
  });
  // INF-03: mirror the consume into the unified audit feed so platform
  // admins can see "who did what" in one place. The richer per-event
  // detail still lives on assessment_consumption_events.
  recordAuditEvent({
    actor: actorUserId ? { id: actorUserId, organizationId: client.id } : null,
    action: AUDIT_ACTIONS.ASSESSMENT_CONSUME,
    targetType: 'assessment',
    targetId: event?.id || null,
    targetOrganizationId: licensee.id,
    metadata: {
      clientOrganizationId: client.id,
      clientOrganizationName: client.name || null,
      source,
      pulseSessionId,
    },
  });
  return {
    metered: true,
    ok: true,
    licensee,
    licenseConfig: result.row,
    event,
  };
}

/**
 * Refunds an earlier consumption (e.g. when the downstream session insert
 * fails after we charged). Decrements the counter and writes a balancing
 * ledger row. Returns the new licence_config row.
 */
export async function refundAssessmentForLicensee({
  licenseeOrganizationId,
  clientOrganizationId,
  pulseSessionId = null,
  actorUserId = null,
  metadata = {},
}) {
  if (!licenseeOrganizationId) return null;
  const refunded = await LicenseConfig.incrementAssessmentsConsumed(licenseeOrganizationId, -1);
  const refundEvent = await AssessmentConsumptionEvent.recordEvent({
    licenseeOrganizationId,
    clientOrganizationId,
    pulseSessionId,
    source: AssessmentConsumptionEvent.SOURCE_MANUAL_REFUND,
    assessmentsCharged: -1,
    actorUserId,
    metadata,
  });
  const clientOrg = clientOrganizationId ? await Organization.getOrganization(clientOrganizationId) : null;
  recordAuditEvent({
    actor: actorUserId ? { id: actorUserId, organizationId: clientOrganizationId } : null,
    action: AUDIT_ACTIONS.ASSESSMENT_REFUND,
    targetType: 'assessment',
    targetId: refundEvent?.id || null,
    targetOrganizationId: licenseeOrganizationId,
    metadata: {
      clientOrganizationId,
      clientOrganizationName: clientOrg?.name || null,
      pulseSessionId,
      ...(metadata?.reason ? { reason: metadata.reason } : {}),
    },
  });
  return refunded;
}

/**
 * INF-05 effective cap resolver. Per-session override wins when set;
 * otherwise we fall back to the parent licensee's
 * respondent_cap_per_assessment. Returns null when no cap applies (e.g.
 * platform-direct client with no licensee parent and no per-session
 * override, or enterprise_unlimited tier with no licensee cap set).
 */
export async function effectiveRespondentCapForSession(session, options = {}) {
  if (!session) return null;
  if (session.respondent_cap_override != null) {
    return session.respondent_cap_override;
  }
  // `licenseConfig` may be passed explicitly (including null when the caller
  // already knows there is no parent licensee) so tests and hot paths can
  // skip the DB hop. Only look it up when the option key is absent.
  const explicit = Object.prototype.hasOwnProperty.call(options, 'licenseConfig');
  let resolvedLicenseConfig = explicit ? options.licenseConfig : null;
  if (!explicit) {
    const resolvedClient = options.client
      || (session.organization_id ? await Organization.getOrganization(session.organization_id) : null);
    if (!resolvedClient) return null;
    const licensee = await meteringOrgForClient(resolvedClient);
    resolvedLicenseConfig = licensee ? await LicenseConfig.getForOrganization(licensee.id) : null;
  }
  if (resolvedLicenseConfig && resolvedLicenseConfig.respondent_cap_per_assessment != null) {
    return resolvedLicenseConfig.respondent_cap_per_assessment;
  }
  return null;
}
