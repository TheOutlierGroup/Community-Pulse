export function buildReportGeneratePayload({
  organization,
  stage,
  format,
  dateFrom,
  dateTo,
  programmeName,
  industry,
  changeType,
  programmeTimeline,
  consultantNotes,
}) {
  const payload = {
    org_slug: organization?.slug || null,
    org_id: organization?.id || null,
    stage,
    format,
    context: {
      programme_name: programmeName,
      industry,
      change_type: changeType || null,
      programme_timeline: programmeTimeline,
      consultant_notes: consultantNotes,
    },
  };
  if (dateFrom) payload.date_from = new Date(`${dateFrom}T00:00:00.000Z`).toISOString();
  if (dateTo) payload.date_to = new Date(`${dateTo}T23:59:59.999Z`).toISOString();
  return payload;
}

export function buildReportDownloadFilename({ organization, stage, format }) {
  const extension = format === 'pdf' ? 'pdf' : 'docx';
  return `${organization?.slug || 'report'}-${stage}.${extension}`;
}
