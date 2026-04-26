function answerKeysFromStep(stepData) {
  const answers = stepData?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  return Object.keys(answers);
}

export function responseHasManagerAnswerSignature(responseRow) {
  const keys = [
    ...answerKeysFromStep(responseRow?.step1_data),
    ...answerKeysFromStep(responseRow?.step2_data),
    ...answerKeysFromStep(responseRow?.step3_data),
    ...answerKeysFromStep(responseRow?.step4_data),
  ];
  return keys.some((key) => /^MQ\d+$/.test(String(key || '').trim()));
}

export function collectStaffInvitesNeedingManagerRole(rows) {
  const byInviteId = new Map();

  for (const row of rows || []) {
    const inviteId = String(row?.invite_id || '').trim();
    if (!inviteId) continue;
    if (!byInviteId.has(inviteId)) {
      byInviteId.set(inviteId, {
        inviteId,
        email: row?.email || '',
        displayName: row?.display_name || '',
        timepointPhase: row?.timepoint_phase || 'pre',
        responseCount: 0,
        completedResponseCount: 0,
        managerSignalResponseCount: 0,
        lastCompletedAt: null,
      });
    }
    const summary = byInviteId.get(inviteId);
    summary.responseCount += 1;
    if (row?.completed_at) {
      summary.completedResponseCount += 1;
      const completedAtIso = new Date(row.completed_at).toISOString();
      if (!summary.lastCompletedAt || completedAtIso > summary.lastCompletedAt) {
        summary.lastCompletedAt = completedAtIso;
      }
    }
    if (responseHasManagerAnswerSignature(row)) {
      summary.managerSignalResponseCount += 1;
    }
  }

  return [...byInviteId.values()]
    .filter((summary) => summary.managerSignalResponseCount > 0)
    .sort((a, b) => {
      if (b.managerSignalResponseCount !== a.managerSignalResponseCount) {
        return b.managerSignalResponseCount - a.managerSignalResponseCount;
      }
      return a.email.localeCompare(b.email);
    });
}
