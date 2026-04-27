export function normalizeSurveyRoleFromImport(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === '') return 'staff';
  if (s === 'manager') return 'manager';
  if (s === 'yes' || s === 'y' || s === 'true' || s === '1') return 'manager';
  if (s === 'no' || s === 'n' || s === 'false' || s === '0') return 'staff';
  if (s === 'staff' || s === 'employee') return 'staff';
  return null;
}

function normalizeManagerFlagFromImport(raw) {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === 'yes' || normalized === 'y' || normalized === 'true' || normalized === '1') return 'manager';
  if (
    normalized === 'no'
    || normalized === 'n'
    || normalized === 'false'
    || normalized === 'faulse'
    || normalized === '0'
  ) return 'staff';
  return null;
}

function normalizeGroupValues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((value) => String(value ?? '').trim() || null);
}

function normalizeManagerRef(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeInviteImportRecipients(recipients) {
  return (recipients || []).map((r, index) => {
    const managerFlagRole =
      normalizeManagerFlagFromImport(r?.manager)
      ?? normalizeManagerFlagFromImport(r?.isManager)
      ?? normalizeManagerFlagFromImport(r?.managerFlag);
    const rawRole = managerFlagRole || r?.role || r?.surveyRole;
    const surveyRole = normalizeSurveyRoleFromImport(rawRole);
    return {
      index,
      email: r?.email,
      displayName: r?.name ?? r?.displayName ?? '',
      rawRole,
      surveyRole,
      managerRef: String(r?.managerId ?? r?.manager_id ?? r?.managerEmail ?? r?.manager_email ?? '').trim() || null,
      managerInviteId: String(r?.managerInviteId ?? r?.manager_invite_id ?? '').trim() || null,
      groupValues: normalizeGroupValues(r?.groupValues ?? r?.group_values),
    };
  });
}

export function validateInviteImportRows(normalizedRows, existingInvitesById = new Map(), options = {}) {
  const allowStaffWithoutManagerRef = options?.allowStaffWithoutManagerRef === true;
  const existingManagerRefs = new Set(
    (Array.isArray(options?.existingManagerRefs) ? options.existingManagerRefs : [])
      .map((ref) => normalizeManagerRef(ref))
      .filter(Boolean)
  );
  const expectedGroupLevelsRaw = Number.parseInt(String(options?.expectedGroupLevels ?? ''), 10);
  const expectedGroupLevels =
    Number.isInteger(expectedGroupLevelsRaw) && expectedGroupLevelsRaw >= 0
      ? Math.min(expectedGroupLevelsRaw, 5)
      : null;
  const errors = [];
  const invalidIndices = new Set();
  const managerRefToRow = new Map();

  for (const row of normalizedRows) {
    if (row.rawRole != null && String(row.rawRole).trim() !== '' && row.surveyRole === null) {
      errors.push({ index: row.index, email: row.email, error: 'invalid_role' });
      invalidIndices.add(row.index);
      continue;
    }

    if (expectedGroupLevels != null) {
      const values = normalizeGroupValues(row.groupValues);
      if (values.length > expectedGroupLevels) {
        errors.push({
          index: row.index,
          email: row.email,
          error: 'invalid_group_levels',
          expected: expectedGroupLevels,
          actual: values.length,
        });
        invalidIndices.add(row.index);
        continue;
      }
      row.groupValues = [...values, ...Array.from({ length: expectedGroupLevels - values.length }, () => null)];
    }

    if (row.surveyRole === 'manager') {
      const normalizedManagerEmail = normalizeManagerRef(row.email);
      if (normalizedManagerEmail) {
        managerRefToRow.set(normalizedManagerEmail, row);
      }
    }
  }

  for (const row of normalizedRows) {
    if (invalidIndices.has(row.index)) continue;
    if (row.surveyRole !== 'staff' && row.surveyRole !== 'manager') continue;

    if (row.managerInviteId) {
      const manager = existingInvitesById.get(row.managerInviteId);
      if (!manager || manager.survey_role !== 'manager') {
        errors.push({ index: row.index, email: row.email, error: 'invalid_manager_invite' });
        invalidIndices.add(row.index);
      }
      continue;
    }

    if (!row.managerRef) {
      if (row.surveyRole === 'staff' && !allowStaffWithoutManagerRef) {
        errors.push({ index: row.index, email: row.email, error: 'manager_required' });
        invalidIndices.add(row.index);
      }
      continue;
    }

    const normalizedRef = normalizeManagerRef(row.managerRef);
    if (!normalizedRef) {
      if (row.surveyRole === 'staff' && !allowStaffWithoutManagerRef) {
        errors.push({ index: row.index, email: row.email, error: 'manager_required' });
        invalidIndices.add(row.index);
      }
      continue;
    }

    if (!managerRefToRow.has(normalizedRef) && !existingManagerRefs.has(normalizedRef)) {
      errors.push({
        index: row.index,
        email: row.email,
        error: 'manager_not_found',
        managerId: row.managerRef,
      });
      invalidIndices.add(row.index);
    }
  }

  return { errors, invalidIndices, managerRefToRow };
}
