import { REPORT_FORMATS } from './reportConfig.js';

function normalizeDate(value) {
  if (value == null || value === '') return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function normalizeReportStage(raw) {
  const stage = String(raw || '')
    .trim()
    .toLowerCase();
  if (stage === 'pre' || stage === 'mid' || stage === 'post') return stage;
  return null;
}

export function validateReportRequest(body = {}) {
  const stage = normalizeReportStage(body.stage);
  if (!stage) return { ok: false, error: 'STAGE_INVALID', message: 'stage must be pre, mid, or post' };

  const format = String(body.format || '')
    .trim()
    .toLowerCase();
  if (!REPORT_FORMATS.has(format)) {
    return { ok: false, error: 'GENERATION_FAILED', message: 'format must be docx or pdf' };
  }

  const dateFrom = normalizeDate(body.date_from);
  const dateTo = normalizeDate(body.date_to);
  if ((body.date_from && !dateFrom) || (body.date_to && !dateTo)) {
    return { ok: false, error: 'GENERATION_FAILED', message: 'date_from/date_to must be valid ISO dates' };
  }
  if (dateFrom && dateTo && new Date(dateFrom).getTime() > new Date(dateTo).getTime()) {
    return { ok: false, error: 'GENERATION_FAILED', message: 'date_from must be before date_to' };
  }

  return {
    ok: true,
    value: {
      stage,
      format,
      dateFrom,
      dateTo,
      orgSlug: String(body.org_slug || '').trim() || null,
      orgId: String(body.org_id || '').trim() || null,
    },
  };
}
