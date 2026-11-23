import test from 'node:test';
import assert from 'node:assert/strict';
import { brandStyleVars, brandUsesLightText } from './eventModeTheme.js';

test('no theme means no overrides', () => {
  assert.deepEqual(brandStyleVars(null), {});
  assert.deepEqual(brandStyleVars({ primaryColor: 'blue' }), {});
});

test('maps the brand colour onto accent and button tokens', () => {
  const vars = brandStyleVars({ primaryColor: '#0b3d91', onPrimary: '#ffffff', primaryText: '#0b3d91' });
  assert.equal(vars['--accent'], '#0b3d91');
  assert.equal(vars['--accent-rgb'], '11, 61, 145');
  assert.equal(vars['--btn-cta-bg'], '#0b3d91');
  assert.equal(vars['--btn-cta-text'], '#ffffff');
  assert.equal(vars['--brand-text'], '#0b3d91');
});

test('never overrides status colours', () => {
  const vars = brandStyleVars({ primaryColor: '#e52235', onPrimary: '#ffffff' });
  for (const key of Object.keys(vars)) {
    assert.doesNotMatch(key, /--pulse-(green|amber|orange|red)/);
  }
});

test('detects light button text', () => {
  assert.equal(brandUsesLightText({ onPrimary: '#ffffff' }), true);
  assert.equal(brandUsesLightText({ onPrimary: '#1c1917' }), false);
});
