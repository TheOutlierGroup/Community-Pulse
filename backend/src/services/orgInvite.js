import { isResendConfigured, sendOrganizationInviteEmail } from './email.js';

export const ORG_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ORG_INVITE_TTL_DAYS = ORG_INVITE_TTL_MS / (24 * 60 * 60 * 1000);

function firstFrontendOrigin() {
  return String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
}

/** Same resolution order the welcome/reset emails use for their links. */
export function resolveInviteAppBaseUrl() {
  const raw = process.env.CRM_APP_URL || process.env.APP_URL || firstFrontendOrigin();
  return raw ? raw.replace(/\/$/, '') : '';
}

export function orgInviteExpiryDate(now = Date.now()) {
  return new Date(now + ORG_INVITE_TTL_MS);
}

/**
 * Emails the /invite/:token accept link and reports whether it went out.
 *
 * Invites used to be raised and then handed back as a link in a toast, so
 * nothing ever reached the invited person's inbox. A missing base URL or
 * unconfigured Resend is a deployment gap rather than a reason to fail the
 * invite, so this returns false and the caller still hands back the link
 * to share manually.
 */
export async function sendOrganizationInvite({
  email,
  firstName,
  lastName,
  token,
  organizationName,
}) {
  const baseUrl = resolveInviteAppBaseUrl();
  if (!baseUrl || !isResendConfigured()) return false;
  try {
    const displayName = [firstName, lastName]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(' ');
    await sendOrganizationInviteEmail(
      email,
      displayName,
      `${baseUrl}/invite/${token}`,
      organizationName,
      ORG_INVITE_TTL_DAYS
    );
    return true;
  } catch (e) {
    console.error('Organisation invite email failed:', e);
    return false;
  }
}
