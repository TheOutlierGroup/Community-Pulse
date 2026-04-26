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
      managerRef: String(r?.managerId ?? r?.manager_id ?? '').trim() || null,
      managerInviteId: String(r?.managerInviteId ?? r?.manager_invite_id ?? '').trim() || null,
      groupValues: normalizeGroupValues(r?.groupValues ?? r?.group_values),
    };
  });
}

export function validateInviteImportRows(normalizedRows, existingInvitesById = new Map(), options = {}) {
  const allowStaffWithoutManagerRef = options?.allowStaffWithoutManagerRef === true;
  const expectedGroupLevelsRaw = Number.parseInt(String(options?.expectedGroupLevels ?? ''), 10);
  const expectedGroupLevels =
    Number.isInteger(expectedGroupLevelsRaw) && expectedGroupLevelsRaw >= 0
      ? Math.min(expectedGroupLevelsRaw, 5)
      : null;
  const errors = [];
  const invalidIndices = new Set();
  const managerRefToRow = new Map();
  const duplicateManagerRefs = new Set();

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

    if (row.surveyRole === 'manager' && row.managerRef) {
      if (managerRefToRow.has(row.managerRef)) {
        duplicateManagerRefs.add(row.managerRef);
        invalidIndices.add(row.index);
        invalidIndices.add(managerRefToRow.get(row.managerRef).index);
      } else {
        managerRefToRow.set(row.managerRef, row);
      }
    }
  }

  for (const ref of duplicateManagerRefs) {
    for (const row of normalizedRows) {
      if (row.surveyRole === 'manager' && row.managerRef === ref) {
        errors.push({ index: row.index, error: 'duplicate_manager_id', managerId: ref });
      }
    }
  }

  for (const row of normalizedRows) {
    if (invalidIndices.has(row.index)) continue;
    if (row.surveyRole !== 'staff') continue;

    if (row.managerInviteId) {
      const manager = existingInvitesById.get(row.managerInviteId);
      if (!manager || manager.survey_role !== 'manager') {
        errors.push({ index: row.index, email: row.email, error: 'invalid_manager_invite' });
        invalidIndices.add(row.index);
      }
      continue;
    }

    if (!row.managerRef) {
      if (allowStaffWithoutManagerRef) continue;
      errors.push({ index: row.index, email: row.email, error: 'manager_required' });
      invalidIndices.add(row.index);
      continue;
    }

    if (!managerRefToRow.has(row.managerRef) || duplicateManagerRefs.has(row.managerRef)) {
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
