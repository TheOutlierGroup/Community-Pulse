// Client-side CSV parsing + header mapping for contact imports. The team
// exports MeetAlfred (LinkedIn) and Firmable as separate CSVs; this parses a
// file and maps its columns to the normalised shape the import API expects.
// Matching, enrichment and protection all happen server-side.

// RFC-4180-ish parser: handles quoted fields, embedded commas/newlines, and
// escaped ("") quotes. Returns { headers, rows: [{ header: value }] }.
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, ''); // strip BOM
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\r') {
      // handled by the \n branch
    } else if (ch === '\n') {
      record.push(field); records.push(record); record = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => String(h).trim());
  const dataRecords = records.slice(1).filter((r) => r.some((v) => String(v).trim() !== ''));
  const rows = dataRecords.map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
    return obj;
  });
  // `records` keeps the raw per-row arrays so callers can read columns by
  // position — needed when headers are blank or duplicated (e.g. Formidable's
  // name/email columns), where a header-keyed object would collide.
  return { headers, rows, records: dataRecords };
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// normalised-header -> actual-header, so lookups are case/space tolerant.
function headerIndex(headers) {
  const idx = new Map();
  for (const h of headers) idx.set(normalizeHeader(h), h);
  return idx;
}

const LINKEDIN_KEY_HEADERS = ['first name', 'linkedin public url', 'best linkedin url'];
const FIRMABLE_KEY_HEADERS = ['first name', 'linkedin'];

// Does the file look like the chosen source? Used to warn about a mismatch
// (e.g. a Firmable file uploaded as LinkedIn) before importing.
export function looksLikeSource(parsed, source) {
  const present = new Set(parsed.headers.map(normalizeHeader));
  if (source === 'linkedin') {
    return present.has('first name') && (present.has('linkedin public url') || present.has('best linkedin url'));
  }
  if (source === 'firmable') {
    return present.has('first name') && present.has('linkedin');
  }
  return false;
}

export const IMPORT_KEY_HEADERS = { linkedin: LINKEDIN_KEY_HEADERS, firmable: FIRMABLE_KEY_HEADERS };

// Map parsed rows to the normalised import shape for a given source.
export function mapImportRows(parsed, source) {
  const idx = headerIndex(parsed.headers);
  const get = (row, normHeader) => {
    const actual = idx.get(normHeader);
    return actual ? String(row[actual] ?? '').trim() : '';
  };

  if (source === 'linkedin') {
    return parsed.rows.map((row) => ({
      linkedin_url: get(row, 'linkedin public url') || get(row, 'best linkedin url'),
      first_name: get(row, 'first name'),
      last_name: get(row, 'last name'),
      company: get(row, 'company'),
      position: get(row, 'position'),
      industry: get(row, 'industry'),
      email: get(row, 'email'),
      phone: get(row, 'phone'),
      location: get(row, 'location'),
      connected_on: get(row, 'connected on'),
      skills: get(row, 'skills'),
      school: get(row, 'school'),
    }));
  }

  return parsed.rows.map((row) => ({
    linkedin_url: get(row, 'linkedin'),
    first_name: get(row, 'first name'),
    last_name: get(row, 'last name'),
    firmable_link: get(row, 'firmable person link'),
    position: get(row, 'position'),
    headline: get(row, 'headline'),
    department: get(row, 'department'),
    year_joined: get(row, 'year joined'),
    month_joined: get(row, 'month joined'),
    skills: get(row, 'skills'),
    followers: get(row, 'linkedin followers'),
    connections: get(row, 'linkedin connections'),
    dnc_mobile: get(row, 'primary mobile dnc'),
    company_name: get(row, 'company name'),
    employee_count_range: get(row, 'employee count range (global)'),
    company_industries: get(row, 'company industries'),
    suburb: get(row, 'suburb'),
    state: get(row, 'state'),
    country: get(row, 'country'),
    list: get(row, 'list'),
    source: get(row, 'source'),
  }));
}
