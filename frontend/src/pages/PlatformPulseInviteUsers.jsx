import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import { Upload } from 'lucide-react';

function splitCsvLine(line) {
  const parts = [];
  let cur = '';
  let inQ = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur.trim());
  return parts.map((p) => p.replace(/^"|"$/g, ''));
}

function parseRecipientCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headerCells = splitCsvLine(lines[0]);
  const headerLower = headerCells.map((c) => c.toLowerCase());
  const hasHeader = headerLower.includes('email');
  let start = 0;
  let colEmail = -1;
  let colName = -1;
  let colRole = -1;

  if (hasHeader) {
    start = 1;
    colEmail = headerLower.indexOf('email');
    colName = headerLower.indexOf('name');
    if (colName < 0) colName = headerLower.indexOf('display name');
    colRole = headerLower.indexOf('role');
    if (colRole < 0) colRole = headerLower.indexOf('survey_role');
    if (colRole < 0) colRole = headerLower.indexOf('survey role');
  }

  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    let name = '';
    let email = '';
    let roleRaw;

    if (hasHeader) {
      email = colEmail >= 0 ? cells[colEmail] || '' : '';
      name = colName >= 0 ? cells[colName] || '' : '';
      roleRaw = colRole >= 0 ? cells[colRole] : undefined;
      if (!email) {
        for (const c of cells) {
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c).toLowerCase())) {
            email = c;
            break;
          }
        }
      }
    } else if (cells.length >= 2) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cells[0].toLowerCase())) {
        email = cells[0];
        name = cells[1] || '';
        roleRaw = cells[2];
      } else {
        name = cells[0];
        email = cells[1] || '';
        roleRaw = cells[2];
      }
    }

    const em = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) continue;

    const rec = { name: String(name || '').trim() || em.split('@')[0], email: em };
    if (roleRaw != null && String(roleRaw).trim() !== '') {
      rec.role = String(roleRaw).trim();
    }
    out.push(rec);
  }
  return out;
}

function formatSentAt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function PlatformPulseInviteUsers() {
  const { orgId } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [sendingId, setSendingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/pulse-link-invites`);
      setInvites(data.invites || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load invite list.');
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusyImport(true);
    try {
      const text = await file.text();
      const recipients = parseRecipientCsv(text);
      if (recipients.length === 0) {
        showToast('No rows found. Use a CSV with columns: name, email, and optional role (staff or manager).', {
          variant: 'error',
        });
        return;
      }
      const { data } = await api.post(`/api/platform/organizations/${orgId}/pulse-link-invites/import`, {
        recipients,
      });
      showToast(`Imported ${data.upserted} row(s).`, { variant: 'success' });
      if (data.errorCount > 0) {
        showToast(`${data.errorCount} row(s) skipped.`, { variant: 'error' });
      }
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Import failed.', { variant: 'error' });
    } finally {
      setBusyImport(false);
    }
  }

  async function sendInvite(id) {
    setSendingId(id);
    try {
      await api.post(`/api/platform/organizations/${orgId}/pulse-link-invites/${id}/send`);
      showToast('Invite sent.', { variant: 'success' });
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not send invite.', { variant: 'error' });
    } finally {
      setSendingId(null);
    }
  }

  if (!user) return null;

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">Pulse link recipients</h1>
          <p className="muted" style={{ marginTop: '0.35rem', maxWidth: '42rem' }}>
            Upload names and email addresses to add people who can complete Pulse without an app login.
            Send each person a personal link; resending generates a new link and invalidates the previous one.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="pulse-prototype-card" style={{ marginBottom: '1.25rem' }}>
        <div className="pulse-prototype-card__label">Upload CSV</div>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          One row per person. Columns: <strong>name</strong>, <strong>email</strong>,{' '}
          <strong>role</strong> (<code>staff</code> or <code>manager</code>). Header row optional; if role is
          omitted it defaults to staff. Manager links open the manager Pulse session; staff links open the staff
          session (same questionnaire flow, separate session for reporting).
        </p>
        <label className="btn btn-primary" style={{ cursor: busyImport ? 'wait' : 'pointer' }}>
          <Upload size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
          {busyImport ? 'Importing…' : 'Choose CSV file'}
          <input type="file" accept=".csv,text/csv" hidden disabled={busyImport} onChange={onFile} />
        </label>
      </div>

      <div className="pulse-prototype-card">
        <div className="pulse-prototype-card__label">Recipients</div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Link status</th>
                  <th scope="col" style={{ width: '8rem' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ padding: '1.25rem' }}>
                      No recipients yet. Upload a CSV to add people.
                    </td>
                  </tr>
                )}
                {invites.map((row) => {
                  const sent = Boolean(row.lastInvitedAt);
                  return (
                    <tr key={row.id}>
                      <td>{row.displayName || '—'}</td>
                      <td className="pulse-prototype-mono">{row.email}</td>
                      <td>{row.surveyRole === 'manager' ? 'Manager' : 'Staff'}</td>
                      <td>
                        {sent ? (
                          <span>
                            Link sent{' '}
                            <span className="muted" style={{ fontSize: '0.9rem' }}>
                              {formatSentAt(row.lastInvitedAt)}
                            </span>
                          </span>
                        ) : (
                          <span className="badge badge-draft">Link not sent</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={sendingId === row.id}
                          onClick={() => sendInvite(row.id)}
                        >
                          {sendingId === row.id ? 'Sending…' : sent ? 'Resend link' : 'Send link'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
