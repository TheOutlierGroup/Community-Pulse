import * as EmployeeResponse from '../models/EmployeeResponse.js';
import * as PulseLinkResponse from '../models/PulseLinkResponse.js';

export const RESPONSE_MODE_EMPLOYEE_ONLY = 'employee_only';
export const RESPONSE_MODE_MERGED = 'merged';

function normalizeResponseMode(raw) {
  if (raw === RESPONSE_MODE_EMPLOYEE_ONLY) return RESPONSE_MODE_EMPLOYEE_ONLY;
  return RESPONSE_MODE_MERGED;
}

function mapLinkRowToUnifiedResponse(r) {
  return {
    id: r.id,
    invite_id: r.invite_id,
    user_id: null,
    session_id: r.session_id,
    current_step: r.current_step,
    step1_data: r.step1_data,
    step2_data: r.step2_data,
    step3_data: r.step3_data,
    step4_data: r.step4_data,
    contribution_style: r.contribution_style,
    completed_at: r.completed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    email: r.email,
    display_name: r.display_name,
    role: r.survey_role === 'manager' ? 'admin' : 'employee',
    manager_invite_id: r.manager_invite_id || null,
    manager_display_name: r.manager_display_name || null,
    manager_email: r.manager_email || null,
    source_type: 'pulse_link',
  };
}

function addEmployeeSourceType(rows) {
  return rows.map((row) => ({ ...row, source_type: 'employee' }));
}

function buildResponseContract(mode) {
  const isMerged = mode === RESPONSE_MODE_MERGED;
  return {
    mode,
    cohortsIncluded: isMerged ? ['employee', 'pulse_link'] : ['employee'],
    includesLinkInviteRespondents: isMerged,
    semantics: 'completed_and_in_progress_rows_for_selected_cohorts',
  };
}

export async function listSessionResponses(
  sessionId,
  { mode, employeeResponseModel = EmployeeResponse, pulseLinkResponseModel = PulseLinkResponse } = {}
) {
  const resolvedMode = normalizeResponseMode(mode);
  const employeeRows = await employeeResponseModel.listResponsesForSession(sessionId);
  if (resolvedMode === RESPONSE_MODE_EMPLOYEE_ONLY) {
    return {
      rows: addEmployeeSourceType(employeeRows),
      responseContract: buildResponseContract(resolvedMode),
    };
  }
  const linkRows = await pulseLinkResponseModel.listResponsesForSession(sessionId);
  return {
    rows: [...addEmployeeSourceType(employeeRows), ...linkRows.map(mapLinkRowToUnifiedResponse)],
    responseContract: buildResponseContract(resolvedMode),
  };
}
