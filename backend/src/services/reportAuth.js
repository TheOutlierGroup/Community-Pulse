import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as PlatformUserClientAssignment from '../models/PlatformUserClientAssignment.js';
import {
  CLIENT_SERVICE_PULSE,
  organizationHasService,
  organizationVisibleToBusinessUnits,
} from './clientServices.js';

export function createResolveReportOrganizationForUser({
  organizationModel = Organization,
  assignmentModel = PlatformUserClientAssignment,
  userModel = User,
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
      // D-008: this only ever checked the legacy per-user direct
      // assignment table, which Basic-tier users scoped by Business Unit
      // tag (the mechanism every other Clients/Prospects/Contacts surface
      // in the app now uses -- see resolveBasicTierBusinessUnitScope) are
      // never populated into. A Basic-tier user could see this client
      // everywhere else and still be told they weren't "assigned" to it
      // the moment they tried to generate its report. Platform tier gets
      // the same unrestricted access it has everywhere else; Basic tier
      // is allowed in by either path, so an explicit legacy assignment
      // still works too.
      if (user.role === 'admin' || user.role === 'platform') {
        // unrestricted, same as everywhere else this tier appears
      } else {
        const [assigned, businessUnits] = await Promise.all([
          assignmentModel.userHasClientOrgAssignment(user.id, targetOrg.id),
          userModel.getBusinessUnitsForUser(user.id),
        ]);
        const buVisible = organizationVisibleToBusinessUnits(targetOrg.settings, businessUnits);
        if (!assigned && !buVisible) {
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
