// Pure planning logic for CSV contact imports. No DB access — given the set of
// existing contacts and the incoming rows, it decides what to create, what to
// update/enrich, and what to ignore. The executor (contactImport.js) applies
// the plan. Keeping this pure makes the matching/protection rules unit-testable.

export const IMPORT_SOURCES = new Set(['linkedin', 'firmable']);

// Core contact columns an import may write. Enrichment (headline, skills,
// company firmographics, …) lives in the namespaced `enrichment` JSONB instead.
const CORE_FIELDS = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];

const EMPTY_VALUES = new Set(['', '#n/a', 'n/a', 'null', 'undefined']);

function clean(value) {
  if (value == null) return '';
  const s = String(value).trim();
  return EMPTY_VALUES.has(s.toLowerCase()) ? '' : s;
}

export function normalizeLinkedinUrl(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return '';
  return s
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '')
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/pub\//, '')
    .split('?')[0]
    .replace(/\/+$/, '')
    .trim();
}

export function normalizeNameKey(first, last) {
  return `${clean(first)} ${clean(last)}`.trim().toUpperCase().replace(/\s+/g, ' ');
}

// Map a normalised LinkedIn row to core fields + the linkedin enrichment blob.
function linkedinFields(row) {
  const core = {
    contact_firstname: clean(row.first_name),
    contact_lastname: clean(row.last_name),
    contact_email: clean(row.email),
    contact_phone: clean(row.phone),
    contact_role: clean(row.position),
  };
  const enrichment = pruneEmpty({
    company: clean(row.company),
    position: clean(row.position),
    industry: clean(row.industry),
    location: clean(row.location),
    connected_on: clean(row.connected_on),
    skills: clean(row.skills),
    school: clean(row.school),
    url: clean(row.linkedin_url),
  });
  return { core, enrichment };
}

// Firmable enriches: it fills core blanks only, and contributes a rich company/
// role enrichment blob.
function firmableFields(row) {
  const core = {
    contact_firstname: clean(row.first_name),
    contact_lastname: clean(row.last_name),
    contact_role: clean(row.position),
  };
  const enrichment = pruneEmpty({
    headline: clean(row.headline),
    position: clean(row.position),
    department: clean(row.department),
    year_joined: clean(row.year_joined),
    month_joined: clean(row.month_joined),
    skills: clean(row.skills),
    connections: clean(row.connections),
    followers: clean(row.followers),
    dnc_mobile: clean(row.dnc_mobile),
    company_name: clean(row.company_name),
    employee_count_range: clean(row.employee_count_range),
    company_industries: clean(row.company_industries),
    suburb: clean(row.suburb),
    state: clean(row.state),
    country: clean(row.country),
    list: clean(row.list),
    firmable_link: clean(row.firmable_link),
  });
  return { core, enrichment };
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== '') out[k] = v;
  return out;
}

// Build the fast lookup maps once. byName only resolves a match when the name
// is unique among existing contacts — never merge two different people who
// happen to share a name.
function buildIndexes(existing) {
  const byUrl = new Map();
  const byName = new Map();
  for (const c of existing) {
    const url = normalizeLinkedinUrl(c.linkedin_url);
    if (url) byUrl.set(url, c);
    const nameKey = normalizeNameKey(c.contact_firstname, c.contact_lastname);
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(c);
    }
  }
  return { byUrl, byName };
}

function findMatch(indexes, url, nameKey) {
  if (url && indexes.byUrl.has(url)) return indexes.byUrl.get(url);
  if (nameKey && indexes.byName.has(nameKey)) {
    const matches = indexes.byName.get(nameKey);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

/**
 * Plan an import.
 * @param existing array of existing contacts ({ contact_id, contact_*,
 *   linkedin_url, protected_fields[], enrichment{}, enrichment_sources[] })
 * @param source 'linkedin' | 'firmable'
 * @param rows array of normalised import rows
 * @returns { creates, updates, summary }
 */
export function planContactImport(existing, source, rows) {
  if (!IMPORT_SOURCES.has(source)) throw new Error(`Unknown import source: ${source}`);
  const indexes = buildIndexes(Array.isArray(existing) ? existing : []);

  // De-dupe incoming rows so the same person appearing twice in one file
  // collapses to one action (last occurrence wins). Rows with a URL key on it;
  // otherwise on the name key.
  const deduped = new Map();
  let skipped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = normalizeLinkedinUrl(row.linkedin_url);
    const nameKey = normalizeNameKey(row.first_name, row.last_name);
    if (!url && !nameKey) { skipped += 1; continue; }
    deduped.set(url || `name:${nameKey}`, { row, url, nameKey });
  }

  const creates = [];
  const updates = [];
  let ignored = 0;

  for (const { row, url, nameKey } of deduped.values()) {
    const match = findMatch(indexes, url, nameKey);
    const { core, enrichment } = source === 'linkedin' ? linkedinFields(row) : firmableFields(row);

    if (!match) {
      if (source === 'firmable') { ignored += 1; continue; } // enrich-only: never create
      // LinkedIn creates a new contact.
      creates.push({
        core: pruneEmpty(core),
        linkedin_url: url || null,
        source,
        enrichment: { [source]: enrichment },
      });
      continue;
    }

    // Existing match → build an update respecting protected fields.
    const protectedSet = new Set(match.protected_fields || []);
    const corePatch = {};
    for (const field of CORE_FIELDS) {
      const incoming = core[field];
      if (incoming === undefined || incoming === '') continue;
      if (protectedSet.has(field)) continue; // human-set, never clobber
      // Firmable only fills blanks; LinkedIn refreshes any unprotected field.
      const currentEmpty = clean(match[field]) === '';
      if (source === 'firmable' && !currentEmpty) continue;
      if (clean(match[field]) === incoming) continue; // no-op
      corePatch[field] = incoming;
    }

    const setUrl = !clean(match.linkedin_url) && url ? url : null;
    const hasEnrichment = Object.keys(enrichment).length > 0;
    if (Object.keys(corePatch).length === 0 && !setUrl && !hasEnrichment
        && (match.enrichment_sources || []).includes(source)) {
      // Nothing new to write.
      continue;
    }
    updates.push({
      contact_id: match.contact_id,
      core: corePatch,
      linkedin_url: setUrl,
      source,
      enrichment,
    });
  }

  const summary = {
    source,
    totalRows: Array.isArray(rows) ? rows.length : 0,
    created: creates.length,
    updated: updates.length,
    ignored, // unmatched Firmable rows
    skipped, // rows with no usable identity
  };
  return { creates, updates, summary };
}
