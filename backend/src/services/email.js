import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same CID in HTML and attachment so clients don't need to fetch a public URL. */
const OUTLIER_LOGO_CONTENT_ID = 'outlier-logo';

const DEFAULT_FROM = 'Employee Pulse <noreply@employeepulse.app>';

/** Resend `from`: RESEND_FROM_EMAIL (+ optional RESEND_FROM_NAME), else legacy EMAIL_FROM, else default. */
export function getResendFromAddress() {
  const email = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const displayName = String(process.env.RESEND_FROM_NAME || '').trim();
  if (email) {
    return displayName ? `${displayName} <${email}>` : email;
  }
  const legacy = String(process.env.EMAIL_FROM || '').trim();
  if (legacy) return legacy;
  return DEFAULT_FROM;
}

let resendSingleton = null;

function getResend() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  if (!resendSingleton) resendSingleton = new Resend(key);
  return resendSingleton;
}

export function isResendConfigured() {
  return getResend() != null;
}

function requireResend() {
  const client = getResend();
  if (!client) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  return client;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** Public HTTPS URL fallback when the logo file is not on disk (e.g. minimal backend-only deploy). */
function resolvePulseEmailLogoUrl() {
  const custom = String(process.env.PULSE_EMAIL_LOGO_URL || '').trim();
  if (custom) return custom;
  const raw = process.env.APP_URL || String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  if (!raw) return null;
  const base = raw.replace(/\/$/, '');
  return `${base}/brand/outlier-logo.png`;
}

/**
 * Prefer inline CID attachment (reliable in email clients). Fall back to absolute URL only if no file found.
 * @returns {{ logoBlock: string, attachments: object[] | undefined }}
 */
function buildOutlierEmailLogoParts() {
  const distLogo = path.join(__dirname, '../../../frontend/dist/brand/outlier-logo.png');
  const publicLogo = path.join(__dirname, '../../../frontend/public/brand/outlier-logo.png');
  const logoPath = fs.existsSync(distLogo) ? distLogo : fs.existsSync(publicLogo) ? publicLogo : null;

  let imgSrc = null;
  let attachments;

  if (logoPath) {
    // Resend rejects filesystem paths on `path` (requires http/https). Inline via base64 `content`.
    const content = fs.readFileSync(logoPath).toString('base64');
    imgSrc = `cid:${OUTLIER_LOGO_CONTENT_ID}`;
    attachments = [
      {
        filename: 'outlier-logo.png',
        content,
        contentType: 'image/png',
        contentId: OUTLIER_LOGO_CONTENT_ID,
      },
    ];
  } else {
    const url = resolvePulseEmailLogoUrl();
    if (url) imgSrc = url;
  }

  const logoBlock = imgSrc
    ? `<div style="text-align: center; margin: 0 0 1.5rem;">
        <img src="${escapeHtmlAttr(imgSrc)}" alt="Outlier" width="160" height="48" style="display: inline-block; border: 0; outline: none; max-width: 180px; width: 160px; height: auto;" />
      </div>`
    : '';

  return { logoBlock, attachments };
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const resend = requireResend();
  const { logoBlock, attachments } = buildOutlierEmailLogoParts();
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: 'Reset your password',
    ...(attachments ? { attachments } : {}),
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
        ${logoBlock}
        <h2 style="margin: 0 0 1rem;">Reset your password</h2>
        <p style="color: #555; line-height: 1.6;">
          We received a request to reset your password. Click the button below to choose a new one.
          This link expires in 1 hour.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; margin: 1.5rem 0; padding: 0.75rem 1.5rem;
                  background: #ffcc80; color: #1c1917; font-weight: 600;
                  text-decoration: none; border-radius: 8px;">
          Reset password
        </a>
        <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.
          Your password won't change unless you click the link above.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend email error:', error);
    throw new Error('Failed to send password reset email');
  }
}

export async function sendPulseInviteEmail(to, displayName, pulseUrl, organizationName) {
  const resend = requireResend();
  const name = String(displayName || '').trim();
  const greetingHtml = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  const orgPlain = organizationName ? String(organizationName).trim() : 'your organization';
  const orgLabelHtml = escapeHtml(orgPlain);
  const subjectPlain = `Pulse questionnaire — ${orgPlain.replace(/[\r\n]+/g, ' ').slice(0, 200)}`;
  const safePulseUrl = String(pulseUrl || '');
  const { logoBlock, attachments } = buildOutlierEmailLogoParts();
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: subjectPlain,
    ...(attachments ? { attachments } : {}),
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
        ${logoBlock}
        <h2 style="margin: 0 0 1rem;">Your Pulse link</h2>
        <p style="color: #555; line-height: 1.6;">
          ${greetingHtml}
        </p>
        <p style="color: #555; line-height: 1.6;">
          You have been invited to complete a short Pulse questionnaire for <strong>${orgLabelHtml}</strong>.
          Use your personal link below. You do not need to sign in.
        </p>
        <a href="${escapeHtmlAttr(safePulseUrl)}"
           style="display: inline-block; margin: 1.5rem 0; padding: 0.75rem 1.5rem;
                  background: #ffcc80; color: #1c1917; font-weight: 600;
                  text-decoration: none; border-radius: 8px;">
          Open Pulse
        </a>
        <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
          If the button does not work, copy and paste this URL into your browser:<br />
          <span style="word-break: break-all;">${escapeHtml(safePulseUrl)}</span>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend pulse invite error:', error);
    const detail =
      error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    throw new Error(detail || 'Failed to send Pulse invite email');
  }
}

const PLATFORM_WELCOME_TOKEN_DAYS = 7;

/**
 * Welcome email for platform-org users created from the admin UI.
 * @param {string} organizationName — e.g. platform org display name
 */
export async function sendPlatformWelcomeEmail(
  to,
  displayName,
  loginUrl,
  setPasswordUrl,
  organizationName
) {
  const resend = requireResend();
  const name = String(displayName || '').trim();
  const greetingHtml = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  const orgPlain = organizationName ? String(organizationName).trim() : 'Outlier';
  const orgLabelHtml = escapeHtml(orgPlain);
  const { logoBlock, attachments } = buildOutlierEmailLogoParts();
  const safeLogin = String(loginUrl || '');
  const safeSetPw = String(setPasswordUrl || '');
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: `Welcome to ${orgPlain.replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
    ...(attachments ? { attachments } : {}),
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
        ${logoBlock}
        <h2 style="margin: 0 0 1rem;">Your account is ready</h2>
        <p style="color: #555; line-height: 1.6;">
          ${greetingHtml}
        </p>
        <p style="color: #555; line-height: 1.6;">
          You have been added to the <strong>${orgLabelHtml}</strong> team on Outlier.
          Use <strong>Create password</strong> to set or update the password for this account
          (link expires in ${PLATFORM_WELCOME_TOKEN_DAYS} days), then use <strong>Sign in</strong>.
        </p>
        <a href="${escapeHtmlAttr(safeSetPw)}"
           style="display: inline-block; margin: 1.5rem 0.75rem 1.5rem 0; padding: 0.75rem 1.5rem;
                  background: #ffcc80; color: #1c1917; font-weight: 600;
                  text-decoration: none; border-radius: 8px;">
          Create password
        </a>
        <a href="${escapeHtmlAttr(safeLogin)}"
           style="display: inline-block; margin: 1.5rem 0; padding: 0.75rem 1.5rem;
                  background: transparent; color: #1c1917; font-weight: 600;
                  text-decoration: none; border-radius: 8px; border: 2px solid #d6d3d1;">
          Sign in
        </a>
        <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
          The create-password link expires in ${PLATFORM_WELCOME_TOKEN_DAYS} days.
          If a button does not work, copy the URL:<br />
          <span style="word-break: break-all;">${escapeHtml(safeSetPw)}</span>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend platform welcome error:', error);
    const detail =
      error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    throw new Error(detail || 'Failed to send welcome email');
  }
}
