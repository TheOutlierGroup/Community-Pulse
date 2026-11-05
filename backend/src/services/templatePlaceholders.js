// RED-066: invite and welcome templates are stored per platform (the
// defaults every new client inherits) and per client. The code-level
// defaults use real {{tokens}}, but templates saved before those tokens
// existed still carry hand-typed placeholders such as "[NAME/EMAIL]" and
// "<INSERT TEXT>". Nothing ever resolved them, so they reached every
// recipient of a client that had not edited each template first.
//
// This runs at render time, so it covers templates already stored in the
// database as well as any saved in future, without a data migration.

// Contact-style bracket placeholders only. A bare "[NAME]" is deliberately
// not matched: in a greeting it means the recipient, not a contact.
const CONTACT_PLACEHOLDER_PATTERN =
  /\[\s*(?:contact\s*)?(?:name\s*(?:\/|\bor\b|&amp;|&|\band\b)\s*e-?mail|e-?mail\s*(?:\/|\bor\b)\s*name|e-?mail(?:\s*address)?|contact(?:\s*(?:name|details|info|information|person))?)\s*\]/gi;

// "<INSERT TEXT>", "&lt;INSERT TEXT&gt;", "[INSERT TEXT]" and variants
// such as "<INSERT CLIENT CONTEXT HERE>".
const INSERT_PLACEHOLDER_PATTERN =
  /(?:<|&lt;|\[)\s*INSERT\b[^<>[\]&]{0,80}(?:>|&gt;|\])/gi;

// A paragraph left with nothing in it once a placeholder is removed.
const EMPTY_PARAGRAPH_PATTERN = /<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi;

/**
 * Rewrites hand-typed contact placeholders to the {{contactInfo}} token and
 * removes "insert text here" placeholders, then drops any paragraph left
 * empty. The caller resolves {{contactInfo}} as it already does.
 */
export function normalizeLegacyTemplatePlaceholders(template) {
  return String(template || '')
    .replace(CONTACT_PLACEHOLDER_PATTERN, '{{contactInfo}}')
    .replace(INSERT_PLACEHOLDER_PATTERN, '')
    .replace(EMPTY_PARAGRAPH_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/** True when a template still carries a placeholder nobody will resolve. */
export function hasLegacyTemplatePlaceholders(template) {
  const text = String(template || '');
  CONTACT_PLACEHOLDER_PATTERN.lastIndex = 0;
  INSERT_PLACEHOLDER_PATTERN.lastIndex = 0;
  const found = CONTACT_PLACEHOLDER_PATTERN.test(text) || INSERT_PLACEHOLDER_PATTERN.test(text);
  CONTACT_PLACEHOLDER_PATTERN.lastIndex = 0;
  INSERT_PLACEHOLDER_PATTERN.lastIndex = 0;
  return found;
}

/**
 * Who a survey recipient is told to contact when the client has not set a
 * report contact. Rhythm Engine wording, never the platform owner's name.
 */
export const DEFAULT_SURVEY_CONTACT = 'your project lead';
