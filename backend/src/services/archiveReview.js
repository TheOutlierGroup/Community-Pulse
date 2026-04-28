import * as Organization from '../models/Organization.js';
import { logAuditEvent } from './auditLog.js';

export async function buildArchiveReviewReport() {
  const rows = await Organization.listArchivedOrganizations();
  const now = Date.now();
  return rows.map((row) => {
    const dueMs = row.tier3_disposal_due_at ? new Date(row.tier3_disposal_due_at).getTime() : null;
    const daysToDisposal = Number.isFinite(dueMs)
      ? Math.floor((dueMs - now) / (24 * 60 * 60 * 1000))
      : null;
    return {
      ...row,
      daysToDisposal,
      disposalWindow: daysToDisposal != null && daysToDisposal <= 90 ? 'due_soon' : 'normal',
    };
  });
}

export async function runArchiveReviewReport() {
  const report = await buildArchiveReviewReport();
  await logAuditEvent({
    action: 'archive.review.generated',
    targetType: 'archive_report',
    targetId: String(report.length),
    result: 'ok',
    metadata: { organizationsReviewed: report.length },
  });
  return {
    generatedAt: new Date().toISOString(),
    count: report.length,
    report,
  };
}
