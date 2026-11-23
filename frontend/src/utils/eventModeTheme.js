/**
 * Event mode brand theming. The server sends a theme
 * ({ primaryColor, primaryRgb, onPrimary, primaryText, secondaryColor })
 * and this maps it onto the app's existing colour tokens, so buttons,
 * progress dots and accents pick up the client's colour.
 *
 * Deliberately never touches the status colours (--pulse-green / amber /
 * orange / red): a red brand would otherwise make every score look like an
 * alert.
 *
 * Pure (no React, no Vite) so it runs under `node --test`.
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;

function hexToRgb(hex) {
  if (!HEX_RE.test(String(hex || ''))) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function shade(hex, factor) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const part = (n) => Math.max(0, Math.min(255, Math.round(n * factor))).toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** Inline style object of CSS custom properties; {} when there is no theme. */
export function brandStyleVars(theme) {
  if (!theme || !HEX_RE.test(String(theme.primaryColor || ''))) return {};
  const primary = theme.primaryColor;
  const rgb = hexToRgb(primary);
  const rgbText = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  const onPrimary = theme.onPrimary || '#1c1917';
  const text = theme.primaryText || primary;
  return {
    '--accent': primary,
    '--accent-rgb': rgbText,
    '--accent-dim': text,
    '--accent-contrast': onPrimary,
    '--btn-cta-bg': primary,
    '--btn-cta-bg-hover': shade(primary, 0.9),
    '--btn-cta-text': onPrimary,
    '--btn-cta-rgb': rgbText,
    '--brand-text': text,
    '--brand-secondary': theme.secondaryColor || primary,
    '--brand-secondary-text': theme.secondaryText || text,
  };
}

/** True when the theme's button text is light (used to recolour dark icons). */
export function brandUsesLightText(theme) {
  return String(theme?.onPrimary || '').toLowerCase() === '#ffffff';
}
