import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLegacyTemplatePlaceholders,
  hasLegacyTemplatePlaceholders,
} from './templatePlaceholders.js';

// RED-066: stored templates still carried hand-typed placeholders that no
// token resolved, so "[NAME/EMAIL]" and "<INSERT TEXT>" reached recipients.

test('contact placeholders become the {{contactInfo}} token', () => {
  for (const placeholder of ['[NAME/EMAIL]', '[Name / Email]', '[name or email]', '[EMAIL]', '[CONTACT DETAILS]', '[Contact name/email]']) {
    const out = normalizeLegacyTemplatePlaceholders(`<p>If you have any questions, please contact ${placeholder}.</p>`);
    assert.equal(out, '<p>If you have any questions, please contact {{contactInfo}}.</p>', placeholder);
  }
});

test('a bare [NAME] is left alone, since it means the recipient', () => {
  const html = '<p>Hi [NAME],</p>';
  assert.equal(normalizeLegacyTemplatePlaceholders(html), html);
});

test('insert-text placeholders are removed, and a paragraph left empty is dropped', () => {
  const html = '<p>Welcome {{name}}!</p><p>&lt;INSERT TEXT&gt;</p><p><INSERT TEXT></p><p>[INSERT CLIENT CONTEXT HERE]</p><p>Thanks.</p>';
  assert.equal(normalizeLegacyTemplatePlaceholders(html), '<p>Welcome {{name}}!</p><p>Thanks.</p>');
});

test('insert-text placeholder inside a sentence is removed without dropping the sentence', () => {
  const out = normalizeLegacyTemplatePlaceholders('<p>This program <INSERT TEXT> matters.</p>');
  assert.equal(out, '<p>This program matters.</p>');
});

test('hasLegacyTemplatePlaceholders detects both kinds and is repeatable', () => {
  assert.equal(hasLegacyTemplatePlaceholders('contact [NAME/EMAIL]'), true);
  assert.equal(hasLegacyTemplatePlaceholders('contact [NAME/EMAIL]'), true);
  assert.equal(hasLegacyTemplatePlaceholders('&lt;INSERT TEXT&gt;'), true);
  assert.equal(hasLegacyTemplatePlaceholders('please contact {{contactInfo}}'), false);
});
