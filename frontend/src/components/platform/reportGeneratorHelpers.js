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
  const stagePart = String(stage || '').trim() || 'report';
  return `${organization?.slug || 'report'}-${stagePart}.${extension}`;
}

// RED-055: downloads are requested as blobs, so when the server refuses
// one (for example a PDF that failed its completeness check) the JSON
// error arrives as a Blob and `error.response.data.error` is undefined.
// The user only ever saw "Could not download report." This reads the
// server's own message out of the blob.
export async function readDownloadErrorMessage(error, fallback = 'Could not download report.') {
  const data = error?.response?.data;
  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (data && typeof data.text === 'function') {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // Not JSON: fall through to the generic message.
    }
  }
  return fallback;
}
