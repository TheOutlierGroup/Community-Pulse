function splitCsvLine(line) {
  const parts = [];
  let cur = '';
  let inQ = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur.trim());
  return parts.map((p) => p.replace(/^"|"$/g, ''));
}

export function normalizeCsvHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_-]+/g, ' ');
}

function normalizeManagerRef(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function parseRecipientCsv(text, options = {}) {
  const groupLabels = Array.isArray(options?.groupLabels) ? options.groupLabels : [];
  const ambiguousBlankManagerRole =
    String(options?.ambiguousBlankManagerRole || '').trim().toLowerCase() === 'manager'
      ? 'manager'
      : 'staff';
  const normalizedGroupLabels = groupLabels
    .map((label) => String(label ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headerCells = splitCsvLine(lines[0]);
  const headerLower = headerCells.map(normalizeCsvHeader);
  const hasHeader = headerLower.some((cell) => cell === 'email' || cell === 'email address');
  let start = 0;
  let colEmail = -1;
  let colName = -1;
  let colRole = -1;
  let colManagerId = -1;
  let dynamicGroupIndexes = [];

  if (hasHeader) {
    start = 1;
    colEmail = headerLower.indexOf('email');
    if (colEmail < 0) colEmail = headerLower.indexOf('email address');
    colName = headerLower.indexOf('name');
    if (colName < 0) colName = headerLower.indexOf('display name');
    if (colName < 0) colName = headerLower.indexOf('employee preferred first name');
    if (colName < 0) colName = headerLower.indexOf('preferred first name');
    colRole = headerLower.indexOf('role');
    if (colRole < 0) colRole = headerLower.indexOf('survey_role');
    if (colRole < 0) colRole = headerLower.indexOf('survey role');
    colManagerId = headerLower.indexOf('manager_id');
    if (colManagerId < 0) colManagerId = headerLower.indexOf('manager id');
    if (colManagerId < 0) colManagerId = headerLower.indexOf('manager name');
    dynamicGroupIndexes = normalizedGroupLabels.map((label) => headerLower.indexOf(normalizeCsvHeader(label)));
  }

  const out = [];
  const parsedMeta = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    let name = '';
    let email = '';
    let roleRaw;
    let managerIdRaw;
    const groupValuesRaw = [];

    if (hasHeader) {
      email = colEmail >= 0 ? cells[colEmail] || '' : '';
      name = colName >= 0 ? cells[colName] || '' : '';
      roleRaw = colRole >= 0 ? cells[colRole] : undefined;
      managerIdRaw = colManagerId >= 0 ? cells[colManagerId] : undefined;
      if (dynamicGroupIndexes.length > 0) {
        for (const index of dynamicGroupIndexes) {
          groupValuesRaw.push(index >= 0 ? cells[index] : '');
        }
      }
      if (!email) {
        for (const c of cells) {
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c).toLowerCase())) {
            email = c;
            break;
          }
        }
      }
    } else if (cells.length >= 2) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cells[0].toLowerCase())) {
        email = cells[0];
        name = cells[1] || '';
        roleRaw = cells[2];
        managerIdRaw = cells[3];
      } else {
        name = cells[0];
        email = cells[1] || '';
        roleRaw = cells[2];
        managerIdRaw = cells[3];
      }
    }

    const em = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) continue;

    const rec = { name: String(name || '').trim() || em.split('@')[0], email: em };
    if (roleRaw != null && String(roleRaw).trim() !== '') {
      rec.role = String(roleRaw).trim();
    }
    const managerRef = String(managerIdRaw ?? '').trim();
    if (managerRef !== '') {
      rec.managerId = managerRef;
    }
    if (groupValuesRaw.length > 0) {
      rec.groupValues = groupValuesRaw.map((value) => String(value ?? '').trim() || null);
    }
    out.push(rec);
    parsedMeta.push({
      rec,
      hasExplicitRole: Object.prototype.hasOwnProperty.call(rec, 'role'),
      managerRef,
      normalizedManagerRef: normalizeManagerRef(managerRef),
      normalizedName: normalizeManagerRef(rec.name),
      normalizedEmail: normalizeManagerRef(rec.email),
    });
  }

  if (parsedMeta.length === 0) return out;

  const managerRefs = new Set(
    parsedMeta
      .map((entry) => entry.normalizedManagerRef)
      .filter(Boolean)
  );

  for (const entry of parsedMeta) {
    const roleNorm = String(entry.rec.role ?? '')
      .trim()
      .toLowerCase();
    const explicitManager = roleNorm === 'manager';
    const managerRefMissing = entry.managerRef === '';
    const referencedByOthers =
      managerRefs.has(entry.normalizedName) || managerRefs.has(entry.normalizedEmail);

    if ((explicitManager && managerRefMissing) || (!entry.hasExplicitRole && managerRefMissing && referencedByOthers)) {
      entry.rec.role = 'manager';
      if (!entry.rec.managerId) {
        entry.rec.managerId = entry.rec.name || entry.rec.email;
      }
      continue;
    }

    if (!entry.hasExplicitRole && entry.managerRef) {
      entry.rec.role = 'staff';
      continue;
    }

    if (!entry.hasExplicitRole && managerRefMissing && !referencedByOthers) {
      entry.rec.role = ambiguousBlankManagerRole;
      if (entry.rec.role === 'manager' && !entry.rec.managerId) {
        entry.rec.managerId = entry.rec.name || entry.rec.email;
      }
    }
  }

  return out;
}
