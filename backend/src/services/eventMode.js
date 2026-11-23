import { DASHBOARD_MIN_SAMPLE_SIZE } from './pulseDashboardScope.js';

/**
 * Event mode: a temporary, per-client presentation layer for Rhythm Engine
 * (client branding, change context on the survey, reworded statements and
 * a decluttered dashboard). It is layered on top of the normal product and
 * changes nothing while switched off.
 *
 * Two switches must both be on:
 *   1. EVENT_MODE_AVAILABLE=true on the server (off by default, so merging
 *      this code changes nothing in production on its own).
 *   2. organizations.settings.eventMode.enabled for the individual client,
 *      set by platform staff only.
 *
 * Everything else under settings.eventMode (colours, change name, change
 * context) is kept while the toggle is off, so switching it back on
 * restores the full setup.
 */

export const EVENT_MODE_STAGES = ['pre', 'mid', 'post'];
export const CHANGE_CONTEXT_FIELDS = ['whatIsChanging', 'whyAsking', 'howUsed', 'whenHearBack'];
export const CHANGE_CONTEXT_LABELS = {
  whatIsChanging: "What's changing",
  whyAsking: "Why we're asking you",
  howUsed: 'How your feedback will be used',
  whenHearBack: "When you'll hear back",
};
export const CHANGE_CONTEXT_MAX_LENGTH = {
  whatIsChanging: 400,
  whyAsking: 400,
  howUsed: 400,
  whenHearBack: 160,
};
export const CHANGE_NAME_MAX_LENGTH = 80;
export const CLOSING_NOTE_MAX_LENGTH = 200;

/** Wording version saved on each response so mixed results stay readable. */
export const WORDING_VERSION_CURRENT = 'current';
export const WORDING_VERSION_EVENT = 'event-v1';

/** Minimum readable contrast (WCAG AA, normal text). */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function isEventModeAvailable(env = process.env) {
  return String(env?.EVENT_MODE_AVAILABLE || '').trim().toLowerCase() === 'true';
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanColor(value) {
  const trimmed = String(value ?? '').trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function emptyChangeContext() {
  return Object.fromEntries(CHANGE_CONTEXT_FIELDS.map((field) => [field, '']));
}

/** Normalised view of settings.eventMode, tolerant of missing or malformed data. */
export function normalizeEventModeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const contextSource =
    source.changeContext && typeof source.changeContext === 'object' && !Array.isArray(source.changeContext)
      ? source.changeContext
      : {};
  const changeContext = {};
  for (const stage of EVENT_MODE_STAGES) {
    const stageSource =
      contextSource[stage] && typeof contextSource[stage] === 'object' ? contextSource[stage] : {};
    const out = emptyChangeContext();
    for (const field of CHANGE_CONTEXT_FIELDS) {
      out[field] = cleanText(stageSource[field], CHANGE_CONTEXT_MAX_LENGTH[field]);
    }
    changeContext[stage] = out;
  }
  return {
    enabled: source.enabled === true,
    changeName: cleanText(source.changeName, CHANGE_NAME_MAX_LENGTH),
    closingNote: cleanText(source.closingNote, CLOSING_NOTE_MAX_LENGTH),
    primaryColor: cleanColor(source.primaryColor),
    secondaryColor: cleanColor(source.secondaryColor),
    changeContext,
  };
}

/** True when Event mode should render for this organisation right now. */
export function isEventModeActive(organization, env = process.env) {
  if (!isEventModeAvailable(env)) return false;
  if (!organization || organization.kind !== 'client') return false;
  return normalizeEventModeSettings(organization.settings?.eventMode).enabled;
}

function normalizeStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 'mid' || raw === 'during') return 'mid';
  if (raw === 'post' || raw === 'completed') return 'post';
  return 'pre';
}

/** Change context fields still empty for a stage (field ids, in display order). */
export function missingChangeContextFields(eventMode, stage) {
  const normalized = normalizeEventModeSettings(eventMode);
  const context = normalized.changeContext[normalizeStage(stage)];
  const missing = CHANGE_CONTEXT_FIELDS.filter((field) => !context[field]);
  if (!normalized.changeName) missing.unshift('changeName');
  return missing;
}

/**
 * Invites cannot be sent for a stage while Event mode is on and that stage's
 * change context (or the change name) is incomplete. Returns null when
 * sending may go ahead, otherwise a respondent-safe error payload.
 */
export function eventModeInviteBlock(organization, stage, env = process.env) {
  if (!isEventModeActive(organization, env)) return null;
  const missing = missingChangeContextFields(organization.settings?.eventMode, stage);
  if (!missing.length) return null;
  const labels = missing.map((field) => (field === 'changeName' ? 'Change name' : CHANGE_CONTEXT_LABELS[field]));
  return {
    error: `Event mode is on for this client, so the change context must be filled in before invites go out. Missing for the ${normalizeStage(stage)} survey: ${labels.join(', ')}.`,
    eventModeChangeContextMissing: missing,
  };
}

// ── Colour helpers ──────────────────────────────────────────────────────

function channelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex) {
  const clean = cleanColor(hex);
  if (!clean) return null;
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b);
}

export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a == null || b == null) return null;
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Black or white text, whichever reads better on the given background. */
export function readableTextColor(backgroundHex) {
  const onWhite = contrastRatio(backgroundHex, '#ffffff');
  const onBlack = contrastRatio(backgroundHex, '#000000');
  if (onWhite == null || onBlack == null) return '#000000';
  return onWhite >= onBlack ? '#ffffff' : '#1c1917';
}

function rgbToHex({ r, g, b }) {
  const part = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * The brand colour, darkened only as far as needed to read as text or a
 * thin accent on a white page (4.5:1). Every colour already reaches 4.5:1
 * with black or white text on top of it, so buttons never need this; it is
 * for a light brand colour (pale yellow, mint) used for headings and links.
 */
export function textSafeColor(hex, background = '#ffffff') {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  for (let step = 0; step <= 40; step += 1) {
    const factor = 1 - step * 0.025;
    const candidate = rgbToHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
    if (contrastRatio(candidate, background) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return '#1c1917';
}

// ── Validation of admin input ───────────────────────────────────────────

/**
 * Validates a PUT body from the admin panel and returns the settings object
 * to store, or { errors } when something is unusable.
 */
export function validateEventModeInput(body, existing) {
  const current = normalizeEventModeSettings(existing);
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];
  const next = { ...current, changeContext: { ...current.changeContext } };

  if (input.enabled !== undefined) next.enabled = input.enabled === true;

  if (input.changeName !== undefined) {
    const raw = String(input.changeName ?? '');
    if (raw.trim().length > CHANGE_NAME_MAX_LENGTH) {
      errors.push(`Change name must be ${CHANGE_NAME_MAX_LENGTH} characters or fewer.`);
    }
    next.changeName = cleanText(raw, CHANGE_NAME_MAX_LENGTH);
  }

  if (input.closingNote !== undefined) {
    const raw = String(input.closingNote ?? '');
    if (raw.trim().length > CLOSING_NOTE_MAX_LENGTH) {
      errors.push(`Thank-you note must be ${CLOSING_NOTE_MAX_LENGTH} characters or fewer.`);
    }
    next.closingNote = cleanText(raw, CLOSING_NOTE_MAX_LENGTH);
  }

  for (const key of ['primaryColor', 'secondaryColor']) {
    if (input[key] === undefined) continue;
    const raw = String(input[key] ?? '').trim();
    if (!raw) {
      next[key] = null;
      continue;
    }
    const color = cleanColor(raw);
    if (!color) {
      errors.push(`${key === 'primaryColor' ? 'Primary' : 'Secondary'} colour must be a hex value like #1a73e8.`);
      continue;
    }
    next[key] = color;
  }

  if (input.changeContext !== undefined) {
    const contextInput = input.changeContext && typeof input.changeContext === 'object' ? input.changeContext : {};
    for (const stage of EVENT_MODE_STAGES) {
      if (contextInput[stage] === undefined) continue;
      const stageInput = contextInput[stage] && typeof contextInput[stage] === 'object' ? contextInput[stage] : {};
      const merged = { ...next.changeContext[stage] };
      for (const field of CHANGE_CONTEXT_FIELDS) {
        if (stageInput[field] === undefined) continue;
        const raw = String(stageInput[field] ?? '');
        if (raw.trim().length > CHANGE_CONTEXT_MAX_LENGTH[field]) {
          errors.push(
            `${CHANGE_CONTEXT_LABELS[field]} (${stage}) must be ${CHANGE_CONTEXT_MAX_LENGTH[field]} characters or fewer.`
          );
        }
        merged[field] = cleanText(raw, CHANGE_CONTEXT_MAX_LENGTH[field]);
      }
      next.changeContext[stage] = merged;
    }
  }

  if (errors.length) return { errors };
  return { value: next };
}

// ── Payloads ────────────────────────────────────────────────────────────

/** Theme tokens for the frontend; null when no primary colour is set. */
export function brandTheme(eventMode) {
  const normalized = normalizeEventModeSettings(eventMode);
  if (!normalized.primaryColor) return null;
  const rgb = hexToRgb(normalized.primaryColor);
  return {
    primaryColor: normalized.primaryColor,
    primaryRgb: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    onPrimary: readableTextColor(normalized.primaryColor),
    primaryText: textSafeColor(normalized.primaryColor),
    secondaryColor: normalized.secondaryColor,
    secondaryText: normalized.secondaryColor ? textSafeColor(normalized.secondaryColor) : null,
  };
}

/**
 * What a respondent's survey needs to render Event mode. Only called once
 * the link token has been verified, and only exposes the client's own
 * presentation fields (never other settings).
 */
export function respondentEventModePayload(organization, stage, { logoUrl = null, env = process.env } = {}) {
  if (!isEventModeActive(organization, env)) return null;
  const normalized = normalizeEventModeSettings(organization.settings?.eventMode);
  return {
    active: true,
    wordingVersion: WORDING_VERSION_EVENT,
    clientName: String(organization.name || '').trim() || null,
    changeName: normalized.changeName || null,
    closingNote: normalized.closingNote || null,
    changeContext: normalized.changeContext[normalizeStage(stage)],
    theme: brandTheme(normalized),
    logoUrl,
    minGroupSize: DASHBOARD_MIN_SAMPLE_SIZE,
  };
}

/** Admin view of settings.eventMode, including whether the server allows it. */
export function adminEventModePayload(organization, env = process.env) {
  const normalized = normalizeEventModeSettings(organization?.settings?.eventMode);
  return {
    available: isEventModeAvailable(env),
    active: isEventModeActive(organization, env),
    ...normalized,
    theme: brandTheme(normalized),
    hasLogo: Boolean(organization?.company_logo_filename),
    minGroupSize: DASHBOARD_MIN_SAMPLE_SIZE,
    missingByStage: Object.fromEntries(
      EVENT_MODE_STAGES.map((stage) => [stage, missingChangeContextFields(normalized, stage)])
    ),
  };
}
