import * as Organization from '../models/Organization.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import { getParentLicenseeForClient } from './assessmentMeter.js';

/**
 * INF-06 brand resolver. Returns the brand to render for a given
 * organization context. Hierarchy:
 *   1. Licensee org → its own brand (logo + display name + colour).
 *   2. Client org with a licensee parent → parent licensee's brand
 *      (only when brand_use_for_downstream is true).
 *   3. Anything else (platform-direct client, platform org, no org) →
 *      null so callers fall back to Outlier's default brand.
 */

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function safeColor(color) {
  if (!color) return null;
  const trimmed = String(color).trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : null;
}

function buildLogoUrl(organizationId, logoFilename) {
  if (!organizationId || !logoFilename) return null;
  // Public branding endpoint (no auth) so respondents on white-labeled
  // surveys can render the licensee logo without a session.
  return `/api/branding/licensees/${encodeURIComponent(organizationId)}/logo`;
}

function pack(licenseeOrg, licenseConfig, { source }) {
  if (!licenseeOrg) return null;
  const displayName = String(licenseConfig?.brand_display_name || '').trim()
    || String(licenseeOrg.name || '').trim()
    || null;
  return {
    source,
    licenseeOrganizationId: licenseeOrg.id,
    displayName,
    primaryColor: safeColor(licenseConfig?.brand_primary_color),
    logoUrl: buildLogoUrl(licenseeOrg.id, licenseeOrg.company_logo_filename),
    useForDownstream: licenseConfig ? licenseConfig.brand_use_for_downstream !== false : true,
    // COM-04 contact info, surfaced through the public brand endpoint.
    supportEmail: licenseConfig?.support_email ? String(licenseConfig.support_email).trim() : null,
    supportUrl: licenseConfig?.support_url ? String(licenseConfig.support_url).trim() : null,
  };
}

export async function resolveBrandForOrganization(orgOrId) {
  const org = typeof orgOrId === 'string'
    ? await Organization.getOrganization(orgOrId)
    : orgOrId;
  if (!org) return null;

  if (org.kind === 'licensee') {
    const config = await LicenseConfig.getForOrganization(org.id);
    return pack(org, config, { source: 'licensee_self' });
  }

  if (org.kind === 'client') {
    const licensee = await getParentLicenseeForClient(org);
    if (!licensee) return null;
    const config = await LicenseConfig.getForOrganization(licensee.id);
    if (config && config.brand_use_for_downstream === false) return null;
    return pack(licensee, config, { source: 'licensee_parent_for_downstream' });
  }

  return null;
}

export function publicBrand(brand) {
  if (!brand) return null;
  return {
    source: brand.source,
    displayName: brand.displayName,
    primaryColor: brand.primaryColor,
    logoUrl: brand.logoUrl,
    supportEmail: brand.supportEmail || null,
    supportUrl: brand.supportUrl || null,
  };
}
