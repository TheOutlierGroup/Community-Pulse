import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { orgLogoFilePath } from '../config/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same CID in HTML and attachment so clients don't need to fetch a public URL. */
const OUTLIER_LOGO_CONTENT_ID = 'outlier-logo';
const CLIENT_LOGO_CONTENT_ID = 'client-logo';

const DEFAULT_FROM = 'Rhythm Engine <noreply@employeepulse.app>';

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

function applyTemplatePlaceholders(template, replacements, { escapeValues = false } = {}) {
  let out = String(template || '');
  const map = replacements && typeof replacements === 'object' ? replacements : {};
  for (const [key, value] of Object.entries(map)) {
    const tokenPattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    const renderedValue = escapeValues ? escapeHtml(value) : String(value);
    out = out.replace(tokenPattern, renderedValue);
  }
  return out;
}

function formatDueDateForEmail(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const iso = `${raw}T00:00:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function getPulseInviteDefaultTemplate(audience, organizationName) {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const orgPlain = organizationName ? String(organizationName).trim() : 'your organization';
  const subject =
    role === 'manager'
      ? `Rhythm Engine manager questionnaire — ${orgPlain}`
      : `Rhythm Engine questionnaire — ${orgPlain}`;
  const bodyHtml =
    role === 'manager'
      ? `
        <p style="color: #555; line-height: 1.6;">Hi {{name}},</p>
        <p style="color: #555; line-height: 1.6;">
          You have been invited to complete the manager Rhythm Engine questionnaire for <strong>${escapeHtml(orgPlain)}</strong>.
          Use your personal link below. You do not need to sign in.
        </p>
        <p style="margin: 1.2rem 0;">
          <a href="{{link}}"
             style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">
            Open Rhythm Engine
          </a>
        </p>
      `
      : `
        <p style="color: #555; line-height: 1.6;">Hi {{name}},</p>
        <p style="color: #555; line-height: 1.6;">
          You have been invited to complete a short Rhythm Engine questionnaire for <strong>${escapeHtml(orgPlain)}</strong>.
          Use your personal link below. You do not need to sign in.
        </p>
        <p style="margin: 1.2rem 0;">
          <a href="{{link}}"
             style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">
            Open Rhythm Engine
          </a>
        </p>
      `;
  return {
    subject,
    bodyHtml: bodyHtml.trim(),
  };
}

function ensureInviteCtaButton(bodyHtml) {
  const source = String(bodyHtml || '');
  const firstAnchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/i;
  const ctaStyle =
    'display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;';
  return source.replace(firstAnchorRe, (match, attrs, text) => {
    if (/\bstyle\s*=/.test(attrs)) return match;
    return `<a${attrs} style="${ctaStyle}">${text}</a>`;
  });
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

function contentTypeForImageFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function buildClientEmailLogoParts(clientLogoFilename, clientLogoAlt) {
  const safeFilename = String(clientLogoFilename || '').trim();
  if (!safeFilename) return buildOutlierEmailLogoParts();
  const logoPath = orgLogoFilePath(safeFilename);
  if (!fs.existsSync(logoPath)) return buildOutlierEmailLogoParts();

  const content = fs.readFileSync(logoPath).toString('base64');
  const alt = String(clientLogoAlt || 'Client')
    .trim()
    .slice(0, 120);
  return {
    logoBlock: `<div style="text-align: center; margin: 0 0 1.5rem;">
        <img src="cid:${CLIENT_LOGO_CONTENT_ID}" alt="${escapeHtmlAttr(alt)} logo" style="display: inline-block; border: 0; outline: none; max-width: 220px; max-height: 56px; width: auto; height: auto;" />
      </div>`,
    attachments: [
      {
        filename: safeFilename,
        content,
        contentType: contentTypeForImageFilename(safeFilename),
        contentId: CLIENT_LOGO_CONTENT_ID,
      },
    ],
  };
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

export async function sendPulseInviteEmail(to, displayName, pulseUrl, organizationName, options = {}) {
  const resend = requireResend();
  const name = String(displayName || '').trim();
  const orgPlain = organizationName ? String(organizationName).trim() : 'your organization';
  const audience = options?.audience === 'manager' ? 'manager' : 'staff';
  const safePulseUrl = String(pulseUrl || '');
  const defaultTemplate = getPulseInviteDefaultTemplate(audience, orgPlain);
  const subjectTemplate =
    typeof options?.subjectTemplate === 'string' && options.subjectTemplate.trim()
      ? options.subjectTemplate
      : defaultTemplate.subject;
  const bodyTemplateHtml =
    typeof options?.bodyTemplateHtml === 'string' && options.bodyTemplateHtml.trim()
      ? options.bodyTemplateHtml
      : defaultTemplate.bodyHtml;
  const dueDateRaw = String(options?.dueDate || '').trim();
  const dueDateFormatted = formatDueDateForEmail(dueDateRaw);
  const clientName = orgPlain;
  const templateReplacements = {
    name: name || 'there',
    link: safePulseUrl,
    clientName,
    clientname: clientName,
    dueDate: dueDateFormatted || dueDateRaw,
    duedate: dueDateFormatted || dueDateRaw,
  };
  const subjectPlain = applyTemplatePlaceholders(
    subjectTemplate,
    templateReplacements,
    { escapeValues: false }
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || defaultTemplate.subject;
  const renderedBodyHtml = applyTemplatePlaceholders(
    bodyTemplateHtml,
    templateReplacements,
    { escapeValues: true }
  );
  const renderedBodyWithButton = ensureInviteCtaButton(renderedBodyHtml);
  const { logoBlock, attachments } = buildClientEmailLogoParts(
    options?.clientLogoFilename,
    options?.clientLogoAlt || orgPlain
  );
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: subjectPlain,
    ...(attachments ? { attachments } : {}),
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
        ${logoBlock}
        ${renderedBodyWithButton}
        <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
          If the button does not work, copy and paste this URL into your browser:<br />
          <span style="word-break: break-all;">${escapeHtml(safePulseUrl)}</span>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend Rhythm Engine invite error:', error);
    const detail =
      error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    throw new Error(detail || 'Failed to send Rhythm Engine invite email');
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

function parseEmailRecipients(raw) {
  return String(raw || '')
    .split(/[,\n;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Strip rich-text HTML to plain text for safe inclusion in email bodies. */
export function commentBodyToEmailPlain(htmlOrText) {
  let s = String(htmlOrText ?? '').trim();
  if (!s) return '';
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n');
  s = s.replace(/<\/div>/gi, '\n');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  s = s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(0, 8000);
}

function resolvePlatformAppBaseUrl() {
  const raw = process.env.APP_URL || String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

/** Deep link to platform client tasks with task drawer (matches in-app notification routes). */
export function buildPlatformClientTaskUrl(organizationId, taskId) {
  const base = resolvePlatformAppBaseUrl();
  if (!base || !organizationId || !taskId) return '';
  return `${base}/platform/clients/${encodeURIComponent(String(organizationId))}/tasks?task=${encodeURIComponent(String(taskId))}`;
}

export async function sendTaskCommentMentionEmail({
  to,
  recipientName,
  authorName,
  taskTitle,
  commentPlain,
  taskUrl,
}) {
  const resend = requireResend();
  const safeTo = String(to || '').trim().toLowerCase();
  if (!safeTo) throw new Error('Missing recipient email');

  const author = String(authorName || 'Someone').trim() || 'Someone';
  const titleRaw = String(taskTitle || 'Task').trim() || 'Task';
  const titleShort = titleRaw.length > 120 ? `${titleRaw.slice(0, 119)}…` : titleRaw;
  const subject = `${author} mentioned you in "${titleShort}"`;

  const greetingName = String(recipientName || '').trim();
  const greetingLine = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hi,';

  const preview = String(commentPlain || '').trim() || '(No text in this comment.)';
  const safeUrl = String(taskUrl || '').trim();
  const { logoBlock, attachments } = buildOutlierEmailLogoParts();

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem 0;">
      ${logoBlock}
      <p style="color: #555; line-height: 1.6; margin: 0 0 1rem;">${greetingLine}</p>
      <p style="color: #555; line-height: 1.6; margin: 0 0 1rem;">
        <strong>${escapeHtml(author)}</strong> mentioned you in <strong>${escapeHtml(titleRaw)}</strong>.
      </p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin: 0 0 1.25rem;">
        <p style="margin: 0; color: #334155; font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(preview)}</p>
      </div>
      ${
        safeUrl
          ? `<p style="margin: 0 0 1rem;">
        <a href="${escapeHtmlAttr(safeUrl)}"
           style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">
          View task
        </a>
      </p>`
          : ''
      }
      <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
        You received this because you were @mentioned in a task comment.
      </p>
    </div>
  `;

  const text = [
    greetingName ? `Hi ${greetingName},` : 'Hi,',
    '',
    `${author} mentioned you in "${titleRaw}".`,
    '',
    preview,
    ...(safeUrl ? ['', `Open task: ${safeUrl}`] : []),
    '',
    'You received this because you were @mentioned in a task comment.',
  ].join('\n');

  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to: safeTo,
    subject,
    ...(attachments ? { attachments } : {}),
    html,
    text,
  });

  if (error) {
    console.error('Resend task comment mention error:', error);
    throw new Error(
      error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Failed to send mention email'
    );
  }
}

export async function sendRetentionAlertEmail({ subject, bodyText, payload }) {
  const resend = requireResend();
  const recipients = parseEmailRecipients(process.env.RETENTION_ALERT_EMAIL);
  if (recipients.length === 0) return false;

  const title = String(subject || 'Retention job alert').trim();
  const detail = String(bodyText || '').trim();
  const payloadJson = payload ? JSON.stringify(payload, null, 2) : '';
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 1.25rem 0;">
      <h2 style="margin: 0 0 1rem;">${escapeHtml(title)}</h2>
      <p style="color: #555; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(detail)}</p>
      ${
        payloadJson
          ? `<pre style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; overflow: auto;">${escapeHtml(payloadJson)}</pre>`
          : ''
      }
    </div>
  `;
  const text = [title, '', detail, payloadJson ? `Payload:\n${payloadJson}` : ''].join('\n');
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to: recipients,
    subject: title,
    html,
    text,
  });

  if (error) {
    console.error('Resend retention alert error:', error);
    return false;
  }
  return true;
}
