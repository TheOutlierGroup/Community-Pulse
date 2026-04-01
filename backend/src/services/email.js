import { Resend } from 'resend';

const FROM_ADDRESS = process.env.EMAIL_FROM || 'Employee Pulse <noreply@employeepulse.app>';

let resendSingleton = null;

function getResend() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  if (!resendSingleton) resendSingleton = new Resend(key);
  return resendSingleton;
}

function requireResend() {
  const client = getResend();
  if (!client) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  return client;
}

/** Public HTTPS URL for the Outlier wordmark (served from frontend `public/brand/outlier-logo.png`). */
function resolvePulseEmailLogoUrl() {
  const custom = String(process.env.PULSE_EMAIL_LOGO_URL || '').trim();
  if (custom) return custom;
  const raw = process.env.APP_URL || String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  if (!raw) return null;
  const base = raw.replace(/\/$/, '');
  return `${base}/brand/outlier-logo.png`;
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const resend = requireResend();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: 'Reset your password',
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
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
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const orgLabel = organizationName ? String(organizationName).trim() : 'your organization';
  const logoUrl = resolvePulseEmailLogoUrl();
  const logoBlock = logoUrl
    ? `<div style="text-align: center; margin: 0 0 1.5rem;">
        <img src="${logoUrl.replace(/&/g, '&amp;')}" alt="Outlier" width="160" height="48" style="display: inline-block; border: 0; outline: none; max-width: 180px; width: 160px; height: auto;" />
      </div>`
    : '';
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Pulse questionnaire — ${orgLabel}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
        ${logoBlock}
        <h2 style="margin: 0 0 1rem;">Your Pulse link</h2>
        <p style="color: #555; line-height: 1.6;">
          ${greeting}
        </p>
        <p style="color: #555; line-height: 1.6;">
          You have been invited to complete a short Pulse questionnaire for <strong>${orgLabel}</strong>.
          Use your personal link below. You do not need to sign in.
        </p>
        <a href="${pulseUrl}"
           style="display: inline-block; margin: 1.5rem 0; padding: 0.75rem 1.5rem;
                  background: #ffcc80; color: #1c1917; font-weight: 600;
                  text-decoration: none; border-radius: 8px;">
          Open Pulse
        </a>
        <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
          If the button does not work, copy and paste this URL into your browser:<br />
          <span style="word-break: break-all;">${pulseUrl}</span>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend pulse invite error:', error);
    throw new Error('Failed to send Pulse invite email');
  }
}
