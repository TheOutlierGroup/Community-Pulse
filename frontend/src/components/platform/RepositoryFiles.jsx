import { useState } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function uploaderName(file) {
  const name = [file.first_name, file.last_name].filter(Boolean).join(' ').trim();
  return name || file.email || '';
}

/**
 * Simple file repository — upload, list, download, delete — shared by the
 * Client Projects page and the Prospect Opportunity page. `resourcePath` is
 * the API base for the owning record (e.g. `/api/platform/organizations/:id/project`);
 * files live at `${resourcePath}/files`.
 */
export default function RepositoryFiles({ resourcePath, files, onChange }) {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`${resourcePath}/files`, fd);
      await onChange();
      showToast('File uploaded.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not upload file.', { variant: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function downloadFile(file) {
    try {
      const response = await api.get(`${resourcePath}/files/${file.id}/download`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = file.original_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      showToast('Could not download file.', { variant: 'error' });
    }
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.original_name}"?`)) return;
    setBusyId(file.id);
    try {
      await api.delete(`${resourcePath}/files/${file.id}`);
      await onChange();
      showToast('File removed.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not delete file.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="budget-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <div className="budget-panel__title" style={{ marginBottom: 0 }}>Files</div>
        <label
          className="btn btn-ghost"
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <Upload size={14} strokeWidth={2} aria-hidden />
          {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" onChange={onFileSelected} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>
      {(!files || files.length === 0) && (
        <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No files uploaded yet.</p>
      )}
      {files && files.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
          {files.map((file) => (
            <li key={file.id} className="time-log-item">
              <div className="time-log-item__left" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={16} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, color: 'var(--muted)' }} />
                <div>
                  <div className="time-log-item__desc">{file.original_name}</div>
                  <div className="time-log-item__meta">
                    {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
                    {uploaderName(file) ? ` · ${uploaderName(file)}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.3rem' }}
                  onClick={() => downloadFile(file)}
                  aria-label={`Download ${file.original_name}`}
                >
                  <Download size={14} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.3rem' }}
                  onClick={() => deleteFile(file)}
                  disabled={busyId === file.id}
                  aria-label={`Delete ${file.original_name}`}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
