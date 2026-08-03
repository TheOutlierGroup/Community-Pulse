// Website fields used to be `<input type="url">`, which makes the browser
// reject anything without a scheme. People type "acme.com.au", so the
// native validation bubble blocked the whole form with no in-form error to
// explain it. These fields now take plain text and normalise on save.

/**
 * Adds a scheme to a bare host so "acme.com.au" and "www.acme.com" store as
 * proper URLs. Values that already carry a scheme, and empty values, pass
 * through untouched.
 */
export function normalizeWebsiteValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^(mailto|tel):/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}
