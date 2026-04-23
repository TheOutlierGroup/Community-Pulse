import { useMemo, useState } from 'react';
import api from '../../services/api.js';
import {
  buildReportDownloadFilename,
  buildReportGeneratePayload,
} from './reportGeneratorHelpers.js';

const STAGE_OPTIONS = [
  { value: 'pre', label: 'Pre-Change' },
  { value: 'mid', label: 'Mid-Change' },
  { value: 'post', label: 'Post-Change' },
];

const CHANGE_TYPE_OPTIONS = ['Technology', 'Restructure', 'Culture', 'Process', 'M&A', 'Other'];

export default function ReportGeneratorModal({ open, onClose, organization }) {
  const [stage, setStage] = useState('pre');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [format, setFormat] = useState('docx');
  const [programmeName, setProgrammeName] = useState('');
  const [industry, setIndustry] = useState('');
  const [changeType, setChangeType] = useState('');
  const [programmeTimeline, setProgrammeTimeline] = useState('');
  const [consultantNotes, setConsultantNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const responseCountLabel = useMemo(() => {
    if (!result?.response_count) return null;
    return `${result.response_count} responses in selected range`;
  }, [result]);

  if (!open) return null;

  async function handleGenerate(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const payload = buildReportGeneratePayload({
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
      });
      const { data } = await api.post('/api/reports/generate', payload);
      setResult(data);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Could not generate report.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    if (!result?.report_id && !result?.download_url) return;
    setDownloading(true);
    setError('');
    try {
      let downloadUrl = result?.download_url || '';
      if (result?.report_id) {
        const { data } = await api.get(`/api/reports/${result.report_id}/download-link`);
        downloadUrl = data?.download_url || downloadUrl;
      }
      if (!downloadUrl) throw new Error('Missing download URL');

      const response = await api.get(downloadUrl, { responseType: 'blob' });
      const contentType = response?.headers?.['content-type'] || 'application/octet-stream';
      const blob = new Blob([response.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildReportDownloadFilename({ organization, stage, format });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError?.response?.data?.error || 'Could not download report.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="report-modal__backdrop" role="presentation">
      <div className="report-modal" role="dialog" aria-modal="true" aria-label="Generate client report">
        <div className="report-modal__header">
          <h3>Generate Report</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <form className="report-modal__form" onSubmit={handleGenerate}>
          <label>
            Assessment Stage
            <select value={stage} onChange={(event) => setStage(event.target.value)}>
              {STAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="report-modal__grid">
            <label>
              Date from
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              Date to
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
          </div>
          <label>
            Export format
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              <option value="docx">Word (.docx)</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <label>
            Programme name
            <input value={programmeName} onChange={(event) => setProgrammeName(event.target.value)} maxLength={120} />
          </label>
          <label>
            Industry / sector
            <input value={industry} onChange={(event) => setIndustry(event.target.value)} maxLength={120} />
          </label>
          <label>
            Change type
            <select value={changeType} onChange={(event) => setChangeType(event.target.value)}>
              <option value="">Select…</option>
              {CHANGE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Programme timeline
            <input
              value={programmeTimeline}
              onChange={(event) => setProgrammeTimeline(event.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            Consultant notes
            <textarea
              value={consultantNotes}
              onChange={(event) => setConsultantNotes(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          {result ? (
            <div className="report-modal__result">
              <p>Report generated successfully.</p>
              <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
                {downloading ? 'Downloading…' : 'Download report'}
              </button>
              {responseCountLabel ? <p className="muted">{responseCountLabel}</p> : null}
            </div>
          ) : null}
          <div className="report-modal__footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Generating…' : 'Generate report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
