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

function toHex({ r, g, b }) {
  const part = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black-ish or white text, whichever reads better on the background (matches the server). */
export function readableTextColor(hex) {
  const onWhite = contrastRatio(hex, '#ffffff');
  const onBlack = contrastRatio(hex, '#000000');
  if (onWhite == null || onBlack == null) return '#1c1917';
  return onWhite >= onBlack ? '#ffffff' : '#1c1917';
}

/** Brand colour darkened just enough to read as text on white (4.5:1); matches the server. */
export function textSafeColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  for (let step = 0; step <= 40; step += 1) {
    const f = 1 - step * 0.025;
    const candidate = toHex({ r: rgb.r * f, g: rgb.g * f, b: rgb.b * f });
    if (contrastRatio(candidate, '#ffffff') >= 4.5) return candidate;
  }
  return '#1c1917';
}

/**
 * Hover colour. Darkening a near-black brand (e.g. bottle green #023003)
 * changes nothing visible, so very dark colours lighten instead.
 */
export function hoverColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const lum = relativeLuminance(hex);
  if (lum != null && lum < 0.08) {
    const mix = 0.18;
    return toHex({ r: rgb.r + (255 - rgb.r) * mix, g: rgb.g + (255 - rgb.g) * mix, b: rgb.b + (255 - rgb.b) * mix });
  }
  return toHex({ r: rgb.r * 0.9, g: rgb.g * 0.9, b: rgb.b * 0.9 });
}

/** Theme for the admin preview, computed the same way the server does. */
export function previewThemeFromColors(primary, secondary) {
  if (!HEX_RE.test(String(primary || ''))) return null;
  return {
    primaryColor: primary,
    onPrimary: readableTextColor(primary),
    primaryText: textSafeColor(primary),
    secondaryColor: HEX_RE.test(String(secondary || '')) ? secondary : null,
    secondaryText: HEX_RE.test(String(secondary || '')) ? textSafeColor(secondary) : null,
  };
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
    '--btn-cta-bg-hover': hoverColor(primary),
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
