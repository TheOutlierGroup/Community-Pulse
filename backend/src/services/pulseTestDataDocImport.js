import JSZip from 'jszip';

const QUADRANTS = new Set([
  'Optimal',
  'Motivated but Lost',
  'Capable but Wary',
  'High Risk',
]);

const MANAGER_BANDS = new Set(['Sustainable', 'Stretched', 'At Capacity', 'Overloaded']);

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeDocxXmlToText(xml) {
  return decodeXmlEntities(
    String(xml || '')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br(?:\s[^>]*)?\/>/g, '\n')
      .replace(/<w:cr(?:\s[^>]*)?\/>/g, '\n')
      .replace(/<\/w:tc>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<w:p(?:\s[^>]*)?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

function parseDocxLinesFromText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\u000c/g, '').trim())
    .filter(Boolean);
}

function parseLikert(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return null;
  return parsed;
}

function parseScore40(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 40) return null;
  return parsed;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function findLineIndex(lines, pattern, fromIndex = 0) {
  for (let i = Math.max(0, fromIndex); i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

function parseEmployeeRows(lines, startIndex, endIndex) {
  const rows = [];
  let i = Math.max(0, startIndex);
  while (i < endIndex) {
    const name = lines[i];
    const answerValues = [];
    for (let offset = 1; offset <= 16; offset += 1) {
      answerValues.push(parseLikert(lines[i + offset]));
    }
    const adopt = parseScore40(lines[i + 17]);
    const sponsor = parseScore40(lines[i + 18]);
    const quadrant = lines[i + 19];
    const isValidRow =
      name &&
      !name.includes(':') &&
      answerValues.every((value) => value != null) &&
      adopt != null &&
      sponsor != null &&
      QUADRANTS.has(quadrant);
    if (!isValidRow) {
      i += 1;
      continue;
    }
    const answers = {};
    for (let q = 1; q <= 16; q += 1) {
      answers[`Q${q}`] = answerValues[q - 1];
    }
    rows.push({ name, role: 'staff', answers });
    i += 20;
  }
  return rows;
}

function parseManagerRows(lines, startIndex, endIndex) {
  const rows = [];
  let i = Math.max(0, startIndex);
  while (i < endIndex) {
    const name = lines[i];
    const roleLabel = lines[i + 1];
    const answerValues = [];
    for (let offset = 2; offset <= 17; offset += 1) {
      answerValues.push(parseLikert(lines[i + offset]));
    }
    const adopt = parseScore40(lines[i + 18]);
    const sponsor = parseScore40(lines[i + 19]);
    const load = parseInteger(lines[i + 20]);
    const band = lines[i + 21];
    const quadrant = lines[i + 22];
    const chainQuadrant = lines[i + 23];
    const isValidRow =
      name &&
      roleLabel &&
      !name.includes(':') &&
      answerValues.every((value) => value != null) &&
      adopt != null &&
      sponsor != null &&
      load != null &&
      MANAGER_BANDS.has(band) &&
      QUADRANTS.has(quadrant) &&
      Boolean(chainQuadrant);
    if (!isValidRow) {
      i += 1;
      continue;
    }
    const answers = {};
    for (let q = 1; q <= 16; q += 1) {
      answers[`MQ${q}`] = answerValues[q - 1];
    }
    rows.push({ name, role: 'manager', roleLabel, answers });
    i += 24;
  }
  return rows;
}

export function parseHumanTestLines(lines) {
  const employeeSectionStart = findLineIndex(lines, /^2\.\s+Employee Survey Answers/i);
  const managerSectionStart = findLineIndex(lines, /^3\.\s+Manager Survey Answers/i);
  if (employeeSectionStart < 0) {
    throw new Error('Could not find employee survey section in DOCX.');
  }
  if (managerSectionStart < 0) {
    throw new Error('Could not find manager survey section in DOCX.');
  }
  if (managerSectionStart <= employeeSectionStart) {
    throw new Error('Manager survey section appears before employee section.');
  }

  const employeeRows = parseEmployeeRows(lines, employeeSectionStart, managerSectionStart);
  const managerRows = parseManagerRows(lines, managerSectionStart, lines.length);

  if (employeeRows.length === 0 || managerRows.length === 0) {
    throw new Error('Could not parse survey rows from DOCX. Expected both employee and manager answers.');
  }

  return {
    employeeRows,
    managerRows,
    totalRows: employeeRows.length + managerRows.length,
  };
}

export async function parseHumanTestDocx(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file('word/document.xml');
  if (!documentXml) {
    throw new Error('Invalid DOCX: missing document.xml.');
  }
  const xml = await documentXml.async('string');
  const text = normalizeDocxXmlToText(xml);
  const lines = parseDocxLinesFromText(text);
  return parseHumanTestLines(lines);
}
