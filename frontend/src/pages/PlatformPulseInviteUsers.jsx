import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import { Mail, Trash2, Upload, UserPlus } from 'lucide-react';

/** Minimum gap between each send request to stay under typical email API rate limits (e.g. Resend ~2 rps). */
const BULK_SEND_INTERVAL_MS = 700;

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

function InviteLinkSurveyStatus({ row }) {
  if (!row.lastInvitedAt) {
    return <span className="badge badge-draft">Link not sent</span>;
  }
  const sentLine = (
    <span>
      Link sent{' '}
      <span className="muted" style={{ fontSize: '0.9rem' }}>
        {formatSentAt(row.lastInvitedAt)}
      </span>
    </span>
  );
  const status = row.surveyStatus || 'sent';
  if (status === 'completed') {
    return (
      <span>
        {sentLine}
        <br />
        <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
          Completed{' '}
          {row.surveyCompletedAt ? (
            <span className="muted" style={{ fontWeight: 500 }}>
              {formatSentAt(row.surveyCompletedAt)}
            </span>
          ) : null}
        </span>
      </span>
    );
  }
  if (status === 'started' || status === 'in_progress') {
    return (
      <span>
        {sentLine}
        <br />
        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--warn, #b45309)' }}>
          Started
        </span>
      </span>
    );
  }
  if (status === 'opened') {
    return (
      <span>
        {sentLine}
        <br />
        <span className="muted" style={{ fontSize: '0.88rem' }}>
          Opened link · intro not started
        </span>
      </span>
    );
  }
  return (
    <span>
      {sentLine}
      <br />
      <span className="muted" style={{ fontSize: '0.88rem' }}>
        Not opened yet
      </span>
    </span>
  );
}

function apiErrorDetail(err, fallback) {
  const d = err?.response?.data;
  if (!d || typeof d !== 'object') return fallback;
  const msg = typeof d.error === 'string' ? d.error : fallback;
  const det = typeof d.details === 'string' ? d.details.trim() : '';
  if (det) return `${msg}\n\n${det}`;
  return msg;
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
  const [deleteConfirmRow, setDeleteConfirmRow] = useState(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('staff');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');

  const sendableInviteIds = useMemo(
    () => invites.filter((r) => r.surveyStatus !== 'completed').map((r) => r.id),
    [invites]
  );

  const load = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/pulse-link-invites`);
      setInvites(data.invites || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load invite list.');
      setInvites([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
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

  function closeAddModal() {
    setAddOpen(false);
    setAddError('');
    setAddName('');
    setAddEmail('');
    setAddRole('staff');
  }

  async function submitAddRecipient(e) {
    e.preventDefault();
    const email = String(addEmail || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddError('Enter a valid email address.');
      return;
    }
    setAddBusy(true);
    setAddError('');
    try {
      const name = String(addName || '').trim() || email.split('@')[0];
      const { data } = await api.post(`/api/platform/organizations/${orgId}/pulse-link-invites/import`, {
        recipients: [{ name, email, role: addRole }],
      });
      if (data.errorCount > 0) {
        const first = data.errors?.[0];
        showToast(first?.error === 'invalid_role' ? 'Role must be staff or manager.' : 'Could not add recipient.', {
          variant: 'error',
        });
        return;
      }
      showToast(`Added ${data.upserted} recipient.`, { variant: 'success' });
      closeAddModal();
      await load();
    } catch (err) {
      setAddError(err.response?.data?.error || 'Could not add recipient.');
    } finally {
      setAddBusy(false);
    }
  }

  async function sendInvite(id) {
    setSendingId(id);
    try {
      await api.post(`/api/platform/organizations/${orgId}/pulse-link-invites/${id}/send`);
      showToast('Invite sent.', { variant: 'success' });
      await load();
    } catch (err) {
      showToast(apiErrorDetail(err, 'Could not send invite.'), {
        variant: 'error',
        durationMs: 14000,
      });
    } finally {
      setSendingId(null);
    }
  }

  async function bulkSendAll() {
    const snapshot = sendableInviteIds;
    if (snapshot.length === 0) return;
    const ok = window.confirm(
      `Send Pulse links to ${snapshot.length} recipient${snapshot.length === 1 ? '' : 's'} who have not completed the survey?\n\nEach person receives an email. Sends run one at a time with a short pause between each to avoid hitting email API rate limits, so a long list may take a few minutes.`
    );
    if (!ok) return;

    setBulkSending(true);
    let success = 0;
    let failed = 0;
    let lastSendError = null;
    const total = snapshot.length;

    try {
      for (let i = 0; i < snapshot.length; i += 1) {
        setBulkProgress({ current: i + 1, total });
        try {
          await api.post(`/api/platform/organizations/${orgId}/pulse-link-invites/${snapshot[i]}/send`);
          success += 1;
        } catch (e) {
          failed += 1;
          lastSendError = e;
        }
        if (i < snapshot.length - 1) {
          await delay(BULK_SEND_INTERVAL_MS);
        }
      }
    } finally {
      setBulkProgress(null);
      setBulkSending(false);
      await load({ silent: true });
      if (failed === 0) {
        showToast(
          `Sent links to ${success} recipient${success === 1 ? '' : 's'}.`,
          { variant: 'success' }
        );
      } else if (success === 0) {
        showToast(apiErrorDetail(lastSendError, 'Bulk send failed. Check configuration and try again.'), {
          variant: 'error',
          durationMs: 16000,
        });
      } else {
        showToast(`Finished: ${success} sent, ${failed} failed.`, { variant: 'error', durationMs: 10000 });
      }
    }
  }

  function closeDeleteConfirm() {
    if (deleteWorking) return;
    setDeleteConfirmRow(null);
  }

  async function confirmDeleteRecipient() {
    if (!deleteConfirmRow) return;
    if (deleteConfirmRow.surveyStatus === 'completed') {
      showToast('This recipient has completed the survey and cannot be removed.', { variant: 'error' });
      setDeleteConfirmRow(null);
      return;
    }
    setDeleteWorking(true);
    try {
      await api.delete(`/api/platform/organizations/${orgId}/pulse-link-invites/${deleteConfirmRow.id}`);
      showToast('Recipient removed.', { variant: 'success' });
      setDeleteConfirmRow(null);
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove recipient.', { variant: 'error' });
    } finally {
      setDeleteWorking(false);
    }
  }

  if (!user) return null;

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">Pulse link recipients</h1>
        </div>
        <div className="pulse-platform-header__right" style={{ flexWrap: 'wrap' }}>
          <label
            className="btn btn-primary"
            style={{ cursor: busyImport || bulkSending ? 'wait' : 'pointer', margin: 0 }}
          >
            <Upload size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {busyImport ? 'Importing…' : 'Import CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              disabled={busyImport || bulkSending}
              onChange={onFile}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAddOpen(true)}
            disabled={bulkSending}
          >
            <UserPlus size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Add
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <ModalDialog
        open={Boolean(deleteConfirmRow)}
        title="Remove recipient?"
        titleId="pulse-delete-recipient-title"
        onClose={closeDeleteConfirm}
      >
        {deleteConfirmRow ? (
          <div style={{ padding: '0 0 0.25rem' }}>
            <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.55 }}>
              They will be removed from this client’s Pulse link list and won’t receive new links from here.
            </p>
            <div
              style={{
                margin: '0 0 1.25rem',
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'var(--surface-muted, rgba(0,0,0,0.04))',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                {deleteConfirmRow.displayName?.trim() || deleteConfirmRow.email}
              </div>
              <div className="pulse-prototype-mono" style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                {deleteConfirmRow.email}
              </div>
            </div>
            <p
              style={{
                margin: '0 0 1.35rem',
                fontSize: '0.88rem',
                fontWeight: 600,
                color: 'var(--danger)',
              }}
            >
              This cannot be undone.
            </p>
            <div className="modal-dialog__actions">
              <button type="button" className="btn btn-ghost" onClick={closeDeleteConfirm} disabled={deleteWorking}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger modal-dialog__submit"
                onClick={confirmDeleteRecipient}
                disabled={deleteWorking}
              >
                {deleteWorking ? 'Removing…' : 'Remove recipient'}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      <ModalDialog
        open={addOpen}
        title="Add recipient"
        titleId="pulse-add-recipient-title"
        onClose={() => {
          if (addBusy) return;
          closeAddModal();
        }}
      >
        <form onSubmit={submitAddRecipient} style={{ padding: '0 0 0.25rem' }}>
          {addError ? <p className="error" style={{ marginBottom: '1rem' }}>{addError}</p> : null}
          <div className="field">
            <label htmlFor="pulse-add-name">Name</label>
            <input
              id="pulse-add-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              autoComplete="name"
              placeholder="Full name"
            />
          </div>
          <div className="field">
            <label htmlFor="pulse-add-email">Email</label>
            <input
              id="pulse-add-email"
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="pulse-add-role">Role</label>
            <select id="pulse-add-role" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={closeAddModal} disabled={addBusy || bulkSending}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary modal-dialog__submit"
              disabled={addBusy || bulkSending}
            >
              {addBusy ? 'Adding…' : 'Add recipient'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <div className="pulse-prototype-card">
        <div
          className="pulse-prototype-card__label"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.65rem',
          }}
        >
          <span>Recipients</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={
              loading || invites.length === 0 || sendableInviteIds.length === 0 || bulkSending || busyImport
            }
            onClick={bulkSendAll}
            style={{ fontSize: '0.9rem' }}
          >
            <Mail size={18} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {bulkSending && bulkProgress
              ? `Sending ${bulkProgress.current}/${bulkProgress.total}…`
              : 'Send all'}
          </button>
        </div>
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
                  <th scope="col">Link &amp; survey</th>
                  <th scope="col" style={{ minWidth: '12.5rem', whiteSpace: 'nowrap' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ padding: '1.25rem' }}>
                      No recipients yet. Use Add or Import CSV.
                    </td>
                  </tr>
                )}
                {invites.map((row) => {
                  const surveyComplete = row.surveyStatus === 'completed';
                  return (
                    <tr key={row.id}>
                      <td>{row.displayName || '—'}</td>
                      <td className="pulse-prototype-mono">{row.email}</td>
                      <td>{row.surveyRole === 'manager' ? 'Manager' : 'Staff'}</td>
                      <td>
                        <InviteLinkSurveyStatus row={row} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {surveyComplete ? (
                          <span
                            className="muted"
                            style={{ fontSize: '0.9rem' }}
                            aria-label="No actions — survey completed"
                          >
                            —
                          </span>
                        ) : (
                          <div
                            style={{
                              display: 'inline-flex',
                              flexDirection: 'row',
                              flexWrap: 'nowrap',
                              gap: '0.35rem',
                              alignItems: 'center',
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={bulkSending || sendingId === row.id || deleteWorking}
                              onClick={() => sendInvite(row.id)}
                              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                              {sendingId === row.id
                                ? 'Sending…'
                                : row.lastInvitedAt
                                  ? 'Resend link'
                                  : 'Send link'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={
                                bulkSending ||
                                deleteWorking ||
                                Boolean(deleteConfirmRow) ||
                                sendingId === row.id
                              }
                              onClick={() => setDeleteConfirmRow(row)}
                              title="Remove recipient"
                              aria-label={`Remove ${row.email}`}
                              style={{
                                color: 'var(--danger, #b91c1c)',
                                padding: '0.4rem 0.5rem',
                                minWidth: '2.25rem',
                                justifyContent: 'center',
                              }}
                            >
                              <Trash2 size={18} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        )}
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
