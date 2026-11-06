import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import api from '../../services/api.js';
import { crmAppBaseUrl } from '../../config/appSurface.js';
import {
  buildReportDownloadFilename,
  buildReportGeneratePayload,
  formatReportAsAtDate,
  readDownloadErrorMessage,
  REPORT_STAGE_LABELS,
} from './reportGeneratorHelpers.js';

const FORMATS = [
  { value: 'docx', label: '.docx' },
  { value: 'pdf', label: '.pdf' },
];

/**
 * Lists only the reports that can be produced right now, one line per stage
 * ("Pre-Change Report as at 06/11/2026") with a download button per format.
 * A click generates the report from all completed responses to date and
 * downloads it straight away; it also appears under Past Reports.
 *
 * Replaces the old Generate Report modal, whose stage/format pickers and
 * free-text fields (program name, industry, change type, timeline, notes)
 * added nothing the data didn't already say.
 */
export default function ReportDownloads({ organization, lockedStages = [], onGenerated }) {
  const orgId = organization?.id;
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const loadAvailability = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`${crmAppBaseUrl()}/api/reports/availability`, { params: { org_id: orgId } });
      setAvailability(data || null);
    } catch (requestError) {
      setAvailability(null);
      setError(requestError?.response?.data?.error || 'Could not check which reports are available.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  async function generateAndDownload(stage, format) {
    const key = `${stage}:${format}`;
    setBusyKey(key);
    setError('');
    try {
      const base = crmAppBaseUrl();
      const { data } = await api.post(
        `${base}/api/reports/generate`,
        buildReportGeneratePayload({ organization, stage, format })
      );
      let downloadUrl = data?.download_url || '';
      if (data?.report_id) {
        const link = await api.get(`${base}/api/reports/${data.report_id}/download-link`);
        downloadUrl = link?.data?.download_url || downloadUrl;
      }
      if (!downloadUrl) throw new Error('Missing download URL');
      const response = await api.get(`${base}${downloadUrl}`, { responseType: 'blob' });
      const blob = new Blob([response.data], {
        type: response?.headers?.['content-type'] || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildReportDownloadFilename({ organization, stage, format });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      if (typeof onGenerated === 'function') onGenerated();
    } catch (requestError) {
      setError(await readDownloadErrorMessage(requestError, 'Could not generate the report.'));
    } finally {
      setBusyKey('');
    }
  }

  const stages = (Array.isArray(availability?.stages) ? availability.stages : []).filter(
    (row) => !lockedStages.includes(row.stage)
  );
  const available = stages.filter((row) => row.available);
  const waiting = stages.filter((row) => !row.available);
  const asAt = formatReportAsAtDate(availability?.as_at);
  const minResponses = Number(availability?.min_responses || 0);

  return (
    <div className="report-downloads">
      {error ? <p className="error" style={{ margin: '0 0 0.75rem' }}>{error}</p> : null}
      {loading ? <p className="muted" style={{ margin: 0 }}>Checking available reports…</p> : null}
      {!loading && availability && available.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No reports are available yet. A report needs at least {minResponses} completed responses for its stage.
        </p>
      ) : null}
      {!loading && available.length > 0 ? (
        <ul className="report-downloads__list">
          {available.map((row) => (
            <li key={row.stage} className="report-downloads__row">
              <div>
                <span className="report-downloads__title">
                  {REPORT_STAGE_LABELS[row.stage]} Report as at {asAt}
                </span>
                <span className="muted report-downloads__meta">
                  {row.response_count} completed response{row.response_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="report-downloads__actions">
                {FORMATS.map((format) => {
                  const key = `${row.stage}:${format.value}`;
                  return (
                    <button
                      key={format.value}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => generateAndDownload(row.stage, format.value)}
                      disabled={Boolean(busyKey)}
                      aria-label={`Download ${REPORT_STAGE_LABELS[row.stage]} report as ${format.label}`}
                    >
                      <Download size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      {busyKey === key ? 'Preparing…' : format.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!loading && waiting.length > 0 ? (
        <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.88rem' }}>
          Not yet available:{' '}
          {waiting
            .map((row) => `${REPORT_STAGE_LABELS[row.stage]} (${row.response_count} of ${minResponses} responses)`)
            .join(', ')}
          .
        </p>
      ) : null}
    </div>
  );
}
