import * as Organization from '../models/Organization.js';
import * as PlatformUserClientAssignment from '../models/PlatformUserClientAssignment.js';
import { CLIENT_SERVICE_PULSE, organizationHasService } from './clientServices.js';

export function createResolveReportOrganizationForUser({
  organizationModel = Organization,
  assignmentModel = PlatformUserClientAssignment,
} = {}) {
  return async function resolveReportOrganizationForUser({
    user,
    requestedOrgSlug = null,
    requestedOrgId = null,
  }) {
    const callerOrg = await organizationModel.getOrganization(user.organizationId);
    if (!callerOrg) {
      return { ok: false, status: 404, error: 'ORG_NOT_FOUND', message: 'Organization not found' };
    }

    let targetOrg = null;
    if (callerOrg.kind === 'client') {
      if (user.role !== 'admin') {
        return {
          ok: false,
          status: 403,
          error: 'GENERATION_FAILED',
          message: 'Consultant-level access is required',
        };
      }
      targetOrg = callerOrg;
      if (requestedOrgSlug && targetOrg.slug && targetOrg.slug !== requestedOrgSlug) {
        return {
          ok: false,
          status: 403,
          error: 'ORG_NOT_FOUND',
          message: 'You can only generate reports for your organization',
        };
      }
    } else {
      targetOrg = requestedOrgSlug
        ? (await organizationModel.getOrganizationBySlug(requestedOrgSlug))
        : requestedOrgId
          ? (await organizationModel.getOrganization(requestedOrgId))
          : null;
      if (!targetOrg || targetOrg.kind !== 'client') {
        return { ok: false, status: 404, error: 'ORG_NOT_FOUND', message: 'Client organization not found' };
      }
      if (user.role !== 'admin') {
        const assigned = await assignmentModel.userHasClientOrgAssignment(user.id, targetOrg.id);
        if (!assigned) {
          return {
            ok: false,
            status: 403,
            error: 'ORG_NOT_FOUND',
            message: 'You are not assigned to this organization',
          };
        }
      }
    }

    if (!organizationHasService(targetOrg.settings, CLIENT_SERVICE_PULSE)) {
      return {
        ok: false,
        status: 403,
        error: 'GENERATION_FAILED',
        message: 'Rhythm Engine is not enabled for this client',
      };
    }

    return { ok: true, organization: targetOrg };
  };
}

export const resolveReportOrganizationForUser = createResolveReportOrganizationForUser();
