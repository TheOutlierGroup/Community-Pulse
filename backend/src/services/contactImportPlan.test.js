import test from 'node:test';
import assert from 'node:assert/strict';
import { planContactImport, normalizeLinkedinUrl, normalizeNameKey } from './contactImportPlan.js';

function existingFixture() {
  return [
    {
      contact_id: 1, contact_firstname: 'Kay', contact_lastname: 'Clancy',
      contact_email: '', contact_phone: '', contact_role: 'Old Title',
      linkedin_url: 'kay-clancy', protected_fields: ['contact_role'],
      enrichment: {}, enrichment_sources: [],
    },
    {
      contact_id: 2, contact_firstname: 'Barry', contact_lastname: 'Bloch',
      contact_email: 'b@x.com', contact_phone: '', contact_role: '',
      linkedin_url: '', protected_fields: [], enrichment: {}, enrichment_sources: [],
    },
  ];
}

test('normalizeLinkedinUrl strips protocol/host/query/trailing slash', () => {
  assert.equal(normalizeLinkedinUrl('https://www.linkedin.com/in/Kay-Clancy/'), 'kay-clancy');
  assert.equal(normalizeLinkedinUrl('http://linkedin.com/in/foo?utm=1'), 'foo');
  assert.equal(normalizeLinkedinUrl('#N/A'), '');
  assert.equal(normalizeLinkedinUrl(''), '');
});

test('normalizeNameKey upper-cases and collapses whitespace', () => {
  assert.equal(normalizeNameKey('  kay ', 'clancy'), 'KAY CLANCY');
});

test('LinkedIn: URL match updates, respecting protected fields', () => {
  const rows = [{
    linkedin_url: 'https://www.linkedin.com/in/kay-clancy',
    first_name: 'Kay', last_name: 'Clancy', position: 'New Title', email: 'kay@wise.com', company: 'WISE',
  }];
  const { creates, updates, summary } = planContactImport(existingFixture(), 'linkedin', rows);
  assert.equal(creates.length, 0);
  assert.equal(updates.length, 1);
  const u = updates[0];
  assert.equal(u.contact_id, 1);
  assert.equal(u.core.contact_email, 'kay@wise.com'); // was empty, unprotected -> set
  assert.equal('contact_role' in u.core, false); // protected -> untouched
  assert.equal(u.enrichment.company, 'WISE');
  assert.equal(summary.updated, 1);
});

test('LinkedIn: no match creates a new contact', () => {
  const rows = [{ linkedin_url: 'https://www.linkedin.com/in/new-person', first_name: 'New', last_name: 'Person', position: 'CTO' }];
  const { creates, summary } = planContactImport(existingFixture(), 'linkedin', rows);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].source, 'linkedin');
  assert.equal(creates[0].core.contact_firstname, 'New');
  assert.equal(creates[0].linkedin_url, 'new-person');
  assert.deepEqual(Object.keys(creates[0].enrichment), ['linkedin']);
  assert.equal(summary.created, 1);
});

test('Firmable: matches existing by unique name, fills blanks only, never creates', () => {
  const rows = [
    { first_name: 'Barry', last_name: 'Bloch', position: 'Chief People Officer', department: 'Human Resources', list: 'PEOPLE' },
    { first_name: 'Nobody', last_name: 'Here', department: 'Ops' }, // no match, no url
  ];
  const { creates, updates, summary } = planContactImport(existingFixture(), 'firmable', rows);
  assert.equal(creates.length, 0); // enrich-only
  assert.equal(updates.length, 1);
  assert.equal(updates[0].contact_id, 2);
  assert.equal(updates[0].core.contact_role, 'Chief People Officer'); // was empty -> filled
  assert.equal(updates[0].enrichment.department, 'Human Resources');
  assert.equal(summary.ignored, 1); // Nobody Here
});

test('Firmable does not overwrite a non-empty core field even when unprotected', () => {
  const existing = existingFixture();
  existing[1].contact_role = 'Existing Role'; // now non-empty, still unprotected
  const rows = [{ first_name: 'Barry', last_name: 'Bloch', position: 'Different Title' }];
  const { updates } = planContactImport(existing, 'firmable', rows);
  // role stays; only enrichment/no-op — since nothing else changes there may be no update at all
  const roleTouched = updates.some((u) => 'contact_role' in u.core);
  assert.equal(roleTouched, false);
});

test('duplicate rows in one file collapse to a single action (last wins)', () => {
  const rows = [
    { linkedin_url: 'https://www.linkedin.com/in/dup', first_name: 'Dup', last_name: 'One', position: 'A' },
    { linkedin_url: 'https://www.linkedin.com/in/dup', first_name: 'Dup', last_name: 'One', position: 'B' },
  ];
  const { creates } = planContactImport([], 'linkedin', rows);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].core.contact_role, 'B');
});

test('rows with neither URL nor name are skipped', () => {
  const rows = [{ position: 'Ghost' }, { first_name: 'Real', last_name: 'One', linkedin_url: 'https://www.linkedin.com/in/real' }];
  const { summary, creates } = planContactImport([], 'linkedin', rows);
  assert.equal(summary.skipped, 1);
  assert.equal(creates.length, 1);
});
