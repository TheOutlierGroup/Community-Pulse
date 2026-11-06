import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import { parseRecipientCsv } from '../utils/pulseInviteCsv.js';
import BusinessLevelsModal from '../components/platform/BusinessLevelsModal.jsx';
import { Download, Layers, Mail, Trash2, Upload, UserPlus } from 'lucide-react';

/** Minimum gap between each send request to stay under typical email API rate limits (e.g. Resend ~2 rps). */
const BULK_SEND_INTERVAL_MS = 700;

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function csvEscape(value) {
  const source = String(value ?? '');
  if (!/[",\n]/.test(source)) return source;
  return `"${source.replace(/"/g, '""')}"`;
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

function formatInviteImportError(entry) {
  const errorCode = entry?.error;
  if (errorCode === 'invalid_role') return 'invalid role value';
  if (errorCode === 'manager_required') return 'staff row missing manager';
  if (errorCode === 'manager_not_found') {
    return entry?.managerId ? `manager "${entry.managerId}" not found` : 'manager not found';
  }
  if (errorCode === 'invalid_manager_invite') return 'invalid manager reference';
  if (errorCode === 'self_manager_not_allowed') return 'user cannot be their own manager';
  if (errorCode === 'duplicate_manager_id') return 'duplicate manager email reference';
  if (errorCode === 'invalid_group_levels') {
    return Number.isInteger(entry?.expected) && Number.isInteger(entry?.actual)
      ? `too many group values (this client is set up for ${entry.expected}, row has ${entry.actual})`
      : 'too many group values';
  }
  if (errorCode === 'missing_during_session') return 'missing during session';
  return String(errorCode || 'unknown error');
}

function summarizeInviteImportErrors(errors, limit = 3) {
  const list = Array.isArray(errors) ? errors : [];
  if (list.length === 0) return '';
  const parts = list.slice(0, limit).map((entry) => {
    const rowLabel =
      Number.isInteger(entry?.index) && entry.index >= 0
        ? `Row ${entry.index + 1}`
        : 'Row ?';
    return `${rowLabel}: ${formatInviteImportError(entry)}`;
  });
  const remaining = Math.max(0, list.length - limit);
  return remaining > 0
    ? `${parts.join('; ')}; +${remaining} more`
    : parts.join('; ');
}

function normalizeInviteTimepoint(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'during') return 'mid';
  if (v === 'completed') return 'post';
  if (v === 'pre' || v === 'mid' || v === 'post') return v;
  return 'pre';
}

function inviteTimepointLabel(timepoint) {
  return timepoint;
}

function previousInviteTimepoint(timepoint) {
  if (timepoint === 'mid') return 'pre';
  if (timepoint === 'post') return 'mid';
  return null;
}

export default function PlatformPulseInviteUsers() {
  const { orgId, org, refreshOrg, pulseTimepoint, pulseDuringSessionId, pulseTimepointOptions } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const [templateDownloadBusy, setTemplateDownloadBusy] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [dueDateSaving, setDueDateSaving] = useState(false);
  const [copyingFromPre, setCopyingFromPre] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState(null);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [sendAllConfirmOpen, setSendAllConfirmOpen] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('staff');
  const [addManagerInviteId, setAddManagerInviteId] = useState('');
  // RED-067 follow-up: recipients added one at a time could not be given a
  // team, so they always showed as "Unassigned". One value per configured
  // group level, the same columns the CSV import takes.
  const [addGroupValues, setAddGroupValues] = useState([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [businessLevelsOpen, setBusinessLevelsOpen] = useState(false);
  const [testDataOpen, setTestDataOpen] = useState(false);
  const [testDataBusy, setTestDataBusy] = useState(false);
  const [testDataError, setTestDataError] = useState('');
  const [testDataStaffCount, setTestDataStaffCount] = useState('0');
  const [testDataManagerCount, setTestDataManagerCount] = useState('0');
  const [testDataGroupCounts, setTestDataGroupCounts] = useState([]);
  const [testDataGroupNames, setTestDataGroupNames] = useState([]);
  const [testDataMode, setTestDataMode] = useState('generate');
  const [testDataDocFile, setTestDataDocFile] = useState(null);

  const configuredGroupLabels = useMemo(() => {
    const labels = Array.isArray(org?.settings?.groupLevelLabels) ? org.settings.groupLevelLabels : [];
    return labels
      .map((label) => String(label ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }, [org?.settings?.groupLevelLabels]);

  const managerOptions = useMemo(
    () =>
      invites
        .filter((row) => row.surveyRole === 'manager')
        .map((row) => ({
          id: row.id,
          label: `${row.displayName?.trim() || row.email} (${row.email})`,
          groupValues: Array.isArray(row.groupValues) ? row.groupValues : [],
        })),
    [invites]
  );

  const sendableInviteIds = useMemo(
    () => invites.filter((r) => r.surveyStatus !== 'completed').map((r) => r.id),
    [invites]
  );
  const deletableInviteIds = useMemo(
    () => invites.filter((r) => r.surveyStatus !== 'completed').map((r) => r.id),
    [invites]
  );
  const completedInviteCount = useMemo(
    () => invites.filter((r) => r.surveyStatus === 'completed').length,
    [invites]
  );

  const inviteTimepoint = useMemo(() => normalizeInviteTimepoint(pulseTimepoint), [pulseTimepoint]);
  const missingDuringSession = inviteTimepoint === 'mid' && !pulseDuringSessionId;
  const inviteRequestParams = useMemo(() => {
    const params = { timepoint: inviteTimepoint };
    if (inviteTimepoint === 'mid' && pulseDuringSessionId) {
      params.duringSessionId = pulseDuringSessionId;
    }
    return params;
  }, [inviteTimepoint, pulseDuringSessionId]);
  const inviteTimepointText = useMemo(() => inviteTimepointLabel(inviteTimepoint), [inviteTimepoint]);
  const copySourceTimepoint = useMemo(() => previousInviteTimepoint(inviteTimepoint), [inviteTimepoint]);
  const fallbackDuringSessionId = useMemo(() => {
    const options = Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : [];
    const firstDuring = options.find((option) => option?.phase === 'during' && option?.id);
    return String(firstDuring?.id || '').trim();
  }, [pulseTimepointOptions]);
  const copySourceDuringSessionId = useMemo(() => {
    const selected = String(pulseDuringSessionId || '').trim();
    return selected || fallbackDuringSessionId;
  }, [fallbackDuringSessionId, pulseDuringSessionId]);
  const copySourceRequestParams = useMemo(() => {
    if (!copySourceTimepoint) return null;
    const params = { timepoint: copySourceTimepoint };
    if (copySourceTimepoint === 'mid' && copySourceDuringSessionId) {
      params.duringSessionId = copySourceDuringSessionId;
    }
    return params;
  }, [copySourceDuringSessionId, copySourceTimepoint]);
  const copySourceTimepointText = useMemo(
    () => (copySourceTimepoint ? inviteTimepointLabel(copySourceTimepoint) : ''),
    [copySourceTimepoint]
  );
  const recipientsTableColumnCount = 7 + configuredGroupLabels.length;

  useEffect(() => {
    if (!testDataOpen) return;
    setTestDataGroupCounts((previous) =>
      configuredGroupLabels.map((_, index) => {
        const existing = Number.parseInt(String(previous[index] ?? ''), 10);
        if (Number.isInteger(existing) && existing >= 0) return String(existing);
        return '3';
      })
    );
    setTestDataGroupNames((previous) =>
      configuredGroupLabels.map((_, index) => {
        const existing = previous[index];
        return Array.isArray(existing) && existing.length > 0 ? existing : ['', '', ''];
      })
    );
  }, [configuredGroupLabels, testDataOpen]);

  const load = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoading(true);
    }
    setError('');
    if (missingDuringSession) {
      setInvites([]);
      setDueDate('');
      setError('Select or create a During checkpoint before managing During recipients.');
      if (!silent) {
        setLoading(false);
      }
      return;
    }
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites`, {
        params: inviteRequestParams,
      });
      setInvites(data.invites || []);
      setDueDate(typeof data?.dueDate === 'string' ? data.dueDate : '');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load invite list.');
      setInvites([]);
      setDueDate('');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [inviteRequestParams, missingDuringSession, orgId]);

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
      const recipients = parseRecipientCsv(text, { groupLabels: configuredGroupLabels });
      if (recipients.length === 0) {
        showToast('No rows found. Use a CSV with columns: name, email, manager (yes/no), and manager email for staff rows.', {
          variant: 'error',
        });
        return;
      }
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/import`,
        { recipients },
        { params: inviteRequestParams }
      );
      showToast(`Parsed ${recipients.length} row(s). Imported ${data.upserted} row(s).`, { variant: 'success' });
      if (data.errorCount > 0) {
        const reasonPreview = summarizeInviteImportErrors(data.errors);
        showToast(
          reasonPreview
            ? `${data.errorCount} row(s) skipped. ${reasonPreview}`
            : `${data.errorCount} row(s) skipped.`,
          { variant: 'error', durationMs: 14000 }
        );
      }
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Import failed.', { variant: 'error' });
    } finally {
      setBusyImport(false);
    }
  }

  function openCsvPicker() {
    if (busyImport || bulkSending || copyingFromPre) return;
    fileInputRef.current?.click();
  }

  // D-009: this used to only be reachable from the client's CRM Settings, one
  // level removed from the Import CSV button it's meant to precede — moved
  // here so download-template-then-import-it is a single-page loop.
  async function downloadUserImportTemplate() {
    if (configuredGroupLabels.length === 0) {
      showToast('Set up this client\'s business levels (Business levels button above) before downloading the template.', {
        variant: 'error',
      });
      return;
    }
    setTemplateDownloadBusy(true);
    try {
      const response = await api.post(
        `/api/platform/organizations/${orgId}/user-import-template`,
        {
          groupLevels: configuredGroupLabels.length,
          groupLevelLabels: configuredGroupLabels,
        },
        { responseType: 'blob' }
      );
      const fallbackName = `client-${orgId}-user-import-template.csv`;
      const disposition = String(response.headers?.['content-disposition'] || '');
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || fallbackName;
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not download template.', { variant: 'error' });
    } finally {
      setTemplateDownloadBusy(false);
    }
  }

  function exportRecipientsCsv() {
    if (loading || invites.length === 0 || busyImport || bulkSending || copyingFromPre) return;
    const headers = ['name', 'email', 'role', 'Manager (yes/no)', 'Manager Email', ...configuredGroupLabels];
    const rows = invites.map((row) => {
      const managerFlag = row.surveyRole === 'manager' ? 'yes' : 'no';
      const managerEmail = row.surveyRole === 'staff' ? row.managerEmail || '' : '';
      const groupValues = configuredGroupLabels.map((_, index) => row.groupValues?.[index] || '');
      return [
        row.displayName || '',
        row.email || '',
        row.surveyRole === 'manager' ? 'manager' : 'staff',
        managerFlag,
        managerEmail,
        ...groupValues,
      ];
    });
    const csv = [headers, ...rows].map((line) => line.map(csvEscape).join(',')).join('\n');
    const safeOrgName = String(org?.name || 'client')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'client';
    const filename = `${safeOrgName}-rhythm-engine-users-${inviteTimepoint}.csv`;
    const blobUrl = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(blobUrl);
  }

  async function copyRecipientsFromPre() {
    if (!copySourceTimepoint) return;
    if (copySourceTimepoint === 'mid' && !copySourceDuringSessionId) {
      showToast('Select a During checkpoint before copying recipients from mid.', { variant: 'error' });
      return;
    }
    setCopyingFromPre(true);
    try {
      const { data: preData } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites`, {
        params: copySourceRequestParams,
      });
      const preInvites = Array.isArray(preData?.invites) ? preData.invites : [];
      if (preInvites.length === 0) {
        showToast(`${copySourceTimepointText} recipients are empty. Upload a CSV list first.`, { variant: 'error' });
        return;
      }
      const recipients = preInvites.map((row) => {
        const fallbackName = String(row?.email || '')
          .split('@')[0]
          .trim();
        const recipient = {
          name: String(row?.displayName || '').trim() || fallbackName || 'Recipient',
          email: String(row?.email || '').trim().toLowerCase(),
          role: row?.surveyRole === 'manager' ? 'manager' : 'staff',
        };
        if (recipient.role === 'manager') {
          recipient.managerId = recipient.email;
        } else {
          const managerEmail = String(row?.managerEmail || '').trim().toLowerCase();
          if (managerEmail) recipient.managerId = managerEmail;
        }
        if (
          configuredGroupLabels.length > 0
          && Array.isArray(row?.groupValues)
          && row.groupValues.length > 0
        ) {
          recipient.groupValues = row.groupValues;
        }
        return recipient;
      });
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/import`,
        { recipients },
        { params: { ...inviteRequestParams, allowUnassignedStaff: true } }
      );
      showToast(`Copied ${data.upserted} recipient(s) from ${copySourceTimepointText}.`, { variant: 'success' });
      if (data.errorCount > 0) {
        showToast(`${data.errorCount} recipient(s) could not be copied.`, { variant: 'error' });
      }
      await load();
    } catch (err) {
      showToast(
        err.response?.data?.error || `Could not copy recipients from ${copySourceTimepointText}.`,
        { variant: 'error' }
      );
    } finally {
      setCopyingFromPre(false);
    }
  }

  function closeAddModal() {
    setAddOpen(false);
    setAddError('');
    setAddName('');
    setAddEmail('');
    setAddRole('staff');
    setAddManagerInviteId('');
    setAddGroupValues([]);
  }

  function openTestDataModal() {
    setTestDataError('');
    setTestDataStaffCount('0');
    setTestDataManagerCount('0');
    setTestDataMode('generate');
    setTestDataDocFile(null);
    setTestDataOpen(true);
  }

  function closeTestDataModal() {
    if (testDataBusy) return;
    setTestDataOpen(false);
    setTestDataError('');
    setTestDataDocFile(null);
  }

  async function runDocxImport({ dryRun }) {
    if (!testDataDocFile) {
      setTestDataError('Select a DOCX file to import.');
      return null;
    }
    const fileName = String(testDataDocFile.name || '').toLowerCase();
    if (!fileName.endsWith('.docx')) {
      setTestDataError('Only .docx files are supported.');
      return null;
    }
    setTestDataBusy(true);
    setTestDataError('');
    try {
      const formData = new FormData();
      formData.append('file', testDataDocFile);
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/test-data/import-docx`,
        formData,
        {
          params: {
            ...inviteRequestParams,
            dryRun: dryRun ? '1' : '0',
          },
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return data;
    } catch (err) {
      const payload = err.response?.data;
      const unmatchedRows = Array.isArray(payload?.unmatchedRows) ? payload.unmatchedRows : [];
      const unmatchedPreview = unmatchedRows
        .slice(0, 5)
        .map((entry) => `${entry.name} (${entry.role})`)
        .join(', ');
      const baseMessage = payload?.error || 'Could not import DOCX test data.';
      setTestDataError(unmatchedPreview ? `${baseMessage} Missing: ${unmatchedPreview}.` : baseMessage);
      return null;
    } finally {
      setTestDataBusy(false);
    }
  }

  async function runDocxPrecheck() {
    const data = await runDocxImport({ dryRun: true });
    if (!data) return;
    const parsedTotal = Number(data?.parsedTotal || 0);
    const matchedRows = Number(data?.matchedRows || 0);
    const unmatchedCount = Number(data?.unmatchedCount || 0);
    if (unmatchedCount > 0) {
      showToast(
        `Pre-check found ${unmatchedCount} missing recipient(s). Matched ${matchedRows}/${parsedTotal}.`,
        { variant: 'error' }
      );
      return;
    }
    showToast(`Pre-check passed. All ${matchedRows}/${parsedTotal} recipients are present.`, {
      variant: 'success',
    });
  }

  async function submitTestData(e) {
    e.preventDefault();
    if (testDataMode === 'import-docx') {
      const confirmed = window.confirm(
        [
          `Import "${testDataDocFile.name}" now?`,
          '',
          'This applies survey answers to existing recipients for this timepoint.',
          'Rows with no matching recipient name will be skipped.',
        ].join('\n')
      );
      if (!confirmed) return;
      const data = await runDocxImport({ dryRun: false });
      if (!data) return;
      const parsedTotal = Number(data?.parsedTotal || 0);
      const completedResponses = Number(data?.completedResponses || 0);
      const unmatchedCount = Number(data?.unmatchedCount || 0);
      const errorCount = Number(data?.completionErrorCount || 0);
      const verifiedCompletedRows = Number(data?.verifiedCompletedRows || 0);
      const verifiedPendingRows = Number(data?.verifiedPendingRows || 0);
      const verificationText =
        Number.isFinite(verifiedCompletedRows) && (verifiedCompletedRows > 0 || verifiedPendingRows > 0)
          ? ` Verified completed: ${verifiedCompletedRows}/${parsedTotal}.`
          : '';
      showToast(
        `Imported ${completedResponses}/${parsedTotal} responses (${unmatchedCount} unmatched, ${errorCount} errors).${verificationText}`,
        { variant: errorCount > 0 ? 'error' : 'success' }
      );
      setTestDataOpen(false);
      setTestDataDocFile(null);
      await load();
      return;
    }

    const staffCount = Number.parseInt(String(testDataStaffCount || '').trim(), 10);
    const managerCount = Number.parseInt(String(testDataManagerCount || '').trim(), 10);
    if (!Number.isInteger(staffCount) || staffCount < 0) {
      setTestDataError('Staff count must be a non-negative whole number.');
      return;
    }
    if (!Number.isInteger(managerCount) || managerCount < 0) {
      setTestDataError('Manager count must be a non-negative whole number.');
      return;
    }
    if (staffCount === 0 && managerCount === 0) {
      setTestDataError('Enter at least one staff or manager user.');
      return;
    }
    if (staffCount > 0 && managerCount === 0) {
      setTestDataError('At least one manager is required when creating staff test users.');
      return;
    }
    const parsedGroupNames = configuredGroupLabels.map((_, index) => {
      const level = Array.isArray(testDataGroupNames[index]) ? testDataGroupNames[index] : [];
      return level.map((n) => String(n ?? '').trim()).filter(Boolean);
    });
    const groupSummary = configuredGroupLabels
      .map((label, index) => {
        const names = parsedGroupNames[index];
        return `${label}: ${names.length > 0 ? names.join(', ') : '(none)'}`;
      })
      .join('\n');
    const confirmed = window.confirm(
      [
        'Create test data now?',
        '',
        `Managers: ${managerCount}`,
        `Staff: ${staffCount}`,
        configuredGroupLabels.length > 0 ? `Group names:\n${groupSummary}` : 'Groups: none configured',
        '',
        'This will create users and completed survey responses for this timepoint.',
      ].join('\n')
    );
    if (!confirmed) return;

    setTestDataBusy(true);
    setTestDataError('');
    try {
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/test-data`,
        {
          staffCount,
          managerCount,
          groupNames: parsedGroupNames,
        },
        { params: inviteRequestParams }
      );
      const importedUsers = Number(data?.importedUsers || 0);
      const completedResponses = Number(data?.completedResponses || 0);
      const expectedTotal = staffCount + managerCount;
      showToast(
        `Created ${importedUsers} test users (${staffCount} staff, ${managerCount} managers; total requested ${expectedTotal}) and ${completedResponses} completed responses.`,
        {
        variant: 'success',
      });
      if (Number(data?.importErrorCount || 0) > 0 || Number(data?.completionErrorCount || 0) > 0) {
        showToast('Some test records could not be imported/completed. Check server response logs.', {
          variant: 'error',
        });
      }
      setTestDataOpen(false);
      await load();
    } catch (err) {
      setTestDataError(err.response?.data?.error || 'Could not create test data.');
    } finally {
      setTestDataBusy(false);
    }
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
    if (addRole === 'staff') {
      if (managerOptions.length === 0) {
        setAddError('Add at least one manager first, then add staff under that manager.');
        return;
      }
      if (!addManagerInviteId) {
        setAddError('Select a manager for this staff recipient.');
        return;
      }
    }
    setAddBusy(true);
    setAddError('');
    try {
      const name = String(addName || '').trim() || email.split('@')[0];
      const recipient = { name, email, role: addRole };
      if (addRole === 'staff') recipient.managerInviteId = addManagerInviteId;
      if (configuredGroupLabels.length > 0) {
        recipient.groupValues = configuredGroupLabels.map(
          (_, index) => String(addGroupValues[index] ?? '').trim() || null
        );
      }
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/import`,
        { recipients: [recipient] },
        { params: inviteRequestParams }
      );
      if (data.errorCount > 0) {
        const first = data.errors?.[0];
        let message = 'Could not add recipient.';
        if (first?.error === 'invalid_role') message = 'Role must be staff or manager.';
        if (first?.error === 'manager_required') message = 'Staff recipients require a manager selection.';
        if (first?.error === 'invalid_manager_invite') message = 'Selected manager is not valid for this organization.';
        if (first?.error === 'manager_not_found') message = 'Manager reference could not be resolved.';
        if (first?.error === 'self_manager_not_allowed') message = 'A recipient cannot be their own manager.';
        if (first?.error === 'invalid_group_levels') message = 'The team details do not match this client\'s business levels.';
        showToast(message, { variant: 'error' });
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
      await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/${id}/send`,
        {},
        { params: inviteRequestParams }
      );
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

  async function saveDueDate(nextDueDate) {
    setDueDateSaving(true);
    try {
      const normalized = String(nextDueDate || '').trim();
      const { data } = await api.put(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/due-date`,
        { dueDate: normalized || null },
        { params: inviteRequestParams }
      );
      setDueDate(typeof data?.dueDate === 'string' ? data.dueDate : '');
      showToast(normalized ? 'Due date saved.' : 'Due date cleared.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not save due date.', { variant: 'error' });
      await load({ silent: true });
    } finally {
      setDueDateSaving(false);
    }
  }

  function closeSendAllConfirm() {
    if (bulkSending) return;
    setSendAllConfirmOpen(false);
  }

  async function confirmBulkSendAll() {
    const snapshot = sendableInviteIds;
    if (snapshot.length === 0) return;
    setSendAllConfirmOpen(false);
    setBulkSending(true);
    let success = 0;
    let failed = 0;
    let lastSendError = null;
    const total = snapshot.length;

    try {
      for (let i = 0; i < snapshot.length; i += 1) {
        setBulkProgress({ current: i + 1, total });
        try {
          await api.post(
            `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/${snapshot[i]}/send`,
            {},
            { params: inviteRequestParams }
          );
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

  function closeDeleteAllConfirm() {
    if (deleteWorking) return;
    setDeleteAllConfirmOpen(false);
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
      await api.delete(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites/${deleteConfirmRow.id}`, {
        params: inviteRequestParams,
      });
      showToast('Recipient removed.', { variant: 'success' });
      setDeleteConfirmRow(null);
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove recipient.', { variant: 'error' });
    } finally {
      setDeleteWorking(false);
    }
  }

  async function confirmDeleteAllRecipients() {
    setDeleteWorking(true);
    try {
      const { data } = await api.delete(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites`, {
        params: inviteRequestParams,
      });
      const deletedCount = Number(data?.deletedCount || 0);
      const skippedCompletedCount = Number(data?.skippedCompletedCount || 0);
      if (deletedCount > 0) {
        showToast(`Removed ${deletedCount} recipient${deletedCount === 1 ? '' : 's'}.`, { variant: 'success' });
      } else {
        showToast('No recipients were removed.', { variant: 'success' });
      }
      if (skippedCompletedCount > 0) {
        showToast(
          `${skippedCompletedCount} completed recipient${skippedCompletedCount === 1 ? '' : 's'} were kept.`,
          { variant: 'error' }
        );
      }
      setDeleteAllConfirmOpen(false);
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove recipients.', { variant: 'error' });
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
          <h1 className="pulse-platform-header__title">Respondents</h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Respondent list for <strong>{inviteTimepointText}</strong> survey.
          </p>
        </div>
        <div className="pulse-platform-header__right" style={{ flexWrap: 'wrap' }}>
          <label
            htmlFor="pulse-invite-due-date"
            className="field"
            style={{
              margin: 0,
              minWidth: '12rem',
              opacity: dueDateSaving ? 0.75 : 1,
              display: 'inline-flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '0.55rem',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Due Date
            </span>
            <input
              id="pulse-invite-due-date"
              type="date"
              value={dueDate}
              disabled={dueDateSaving || busyImport || bulkSending || copyingFromPre}
              onChange={(e) => {
                const nextValue = e.target.value;
                setDueDate(nextValue);
                saveDueDate(nextValue);
              }}
            />
          </label>
          {user.role === 'admin' ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ margin: 0 }}
              onClick={() => setBusinessLevelsOpen(true)}
              disabled={busyImport || bulkSending || copyingFromPre}
            >
              <Layers size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Business levels
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ margin: 0 }}
            onClick={downloadUserImportTemplate}
            disabled={templateDownloadBusy || busyImport || bulkSending || copyingFromPre}
          >
            <Download size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {templateDownloadBusy ? 'Downloading…' : 'Download CSV template'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ margin: 0 }}
            disabled={busyImport || bulkSending || copyingFromPre}
            onClick={openCsvPicker}
          >
            <Upload size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {busyImport ? 'Importing…' : 'Import CSV'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ margin: 0 }}
            onClick={exportRecipientsCsv}
            disabled={loading || invites.length === 0 || busyImport || bulkSending || copyingFromPre}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAddOpen(true)}
            disabled={bulkSending || busyImport || copyingFromPre || testDataBusy}
          >
            <UserPlus size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Add
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openTestDataModal}
            disabled={bulkSending || busyImport || copyingFromPre || testDataBusy}
          >
            {testDataBusy ? 'Creating test data…' : 'Test Data'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        disabled={busyImport || bulkSending || copyingFromPre}
        onChange={onFile}
      />

      <BusinessLevelsModal
        open={businessLevelsOpen}
        onClose={() => setBusinessLevelsOpen(false)}
        orgId={orgId}
        org={org}
        refreshOrg={refreshOrg}
      />

      <ModalDialog
        open={testDataOpen}
        title="Import test users and data"
        titleId="pulse-test-data-title"
        onClose={closeTestDataModal}
      >
        <form onSubmit={submitTestData} style={{ padding: '0 0 0.25rem' }}>
          {testDataError ? <p className="error" style={{ marginBottom: '1rem' }}>{testDataError}</p> : null}
          <div className="field">
            <label htmlFor="pulse-test-data-mode">Import mode</label>
            <select
              id="pulse-test-data-mode"
              value={testDataMode}
              onChange={(e) => {
                setTestDataMode(e.target.value === 'import-docx' ? 'import-docx' : 'generate');
                setTestDataError('');
              }}
              disabled={testDataBusy}
            >
              <option value="generate">Generate synthetic test data</option>
              <option value="import-docx">Import client DOCX answers</option>
            </select>
          </div>
          {testDataMode === 'import-docx' ? (
            <>
              <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.5 }}>
                Upload a client-provided Human Testing DOCX. The import matches names against existing recipients in this
                timepoint and writes completed survey answers.
              </p>
              <div className="field">
                <label htmlFor="pulse-test-data-docx-file">Human testing DOCX</label>
                <input
                  id="pulse-test-data-docx-file"
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={testDataBusy}
                  onChange={(e) => {
                    const nextFile = e.target.files?.[0] || null;
                    setTestDataDocFile(nextFile);
                    setTestDataError('');
                  }}
                />
                <p className="muted" style={{ marginTop: '0.4rem' }}>
                  Existing recipients only. Missing name matches are skipped.
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.5 }}>
                Create a full test dataset for this survey timepoint only ({inviteTimepointText}).
                This will add users and mark survey answers as completed for each generated user. To see Trend
                Analysis or cross-stage divergence flags, switch the timepoint above and repeat this for each stage
                you want data for: generating it once does not carry across Pre, During and Post.
              </p>
              <div className="field">
                <label htmlFor="pulse-test-data-staff-count">Number of staff</label>
                <input
                  id="pulse-test-data-staff-count"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={testDataStaffCount}
                  onChange={(e) => setTestDataStaffCount(e.target.value)}
                  disabled={testDataBusy}
                  required={testDataMode === 'generate'}
                />
              </div>
              <div className="field">
                <label htmlFor="pulse-test-data-manager-count">Number of managers</label>
                <input
                  id="pulse-test-data-manager-count"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={testDataManagerCount}
                  onChange={(e) => setTestDataManagerCount(e.target.value)}
                  disabled={testDataBusy}
                  required={testDataMode === 'generate'}
                />
                <p className="muted" style={{ marginTop: '0.4rem' }}>
                  Total users created = staff + managers.
                </p>
              </div>
              {configuredGroupLabels.map((label, levelIndex) => (
                <div className="field" key={`pulse-test-group-names-${levelIndex}`}>
                  <label>{label} names</label>
                  <p className="muted" style={{ margin: '-0.2rem 0 0.5rem', fontSize: '0.8rem' }}>
                    Enter the actual {label.toLowerCase()} names for this demo — users will be distributed across them.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {(testDataGroupNames[levelIndex] ?? ['']).map((name, nameIndex) => (
                      <div key={nameIndex} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          placeholder={`${label} ${nameIndex + 1}`}
                          value={name}
                          onChange={(e) =>
                            setTestDataGroupNames((prev) => {
                              const next = prev.map((arr) => [...arr]);
                              if (!Array.isArray(next[levelIndex])) next[levelIndex] = [];
                              next[levelIndex][nameIndex] = e.target.value;
                              return next;
                            })}
                          disabled={testDataBusy}
                          style={{ flex: 1 }}
                        />
                        {(testDataGroupNames[levelIndex] ?? []).length > 1 ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            disabled={testDataBusy}
                            onClick={() =>
                              setTestDataGroupNames((prev) => {
                                const next = prev.map((arr) => [...arr]);
                                next[levelIndex] = next[levelIndex].filter((_, i) => i !== nameIndex);
                                return next;
                              })}
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}
                    disabled={testDataBusy}
                    onClick={() =>
                      setTestDataGroupNames((prev) => {
                        const next = prev.map((arr) => [...arr]);
                        if (!Array.isArray(next[levelIndex])) next[levelIndex] = [];
                        next[levelIndex] = [...next[levelIndex], ''];
                        return next;
                      })}
                  >
                    + Add {label}
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={closeTestDataModal} disabled={testDataBusy}>
              Cancel
            </button>
            {testDataMode === 'import-docx' ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={runDocxPrecheck}
                disabled={testDataBusy}
              >
                Run pre-check
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={testDataBusy}>
              {testDataBusy ? 'Working…' : testDataMode === 'import-docx' ? 'Import DOCX' : 'Create test data'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={sendAllConfirmOpen}
        title="Send links to all pending recipients?"
        titleId="pulse-send-all-recipients-title"
        onClose={closeSendAllConfirm}
      >
        <div style={{ padding: '0 0 0.25rem' }}>
          <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.55 }}>
            Each person receives an email with their personal Rhythm Engine link. Sends run one at a
            time with a short pause between each to avoid hitting email API rate limits, so a long
            list may take a few minutes.
          </p>
          <p style={{ margin: '0 0 1.35rem', fontWeight: 700 }}>
            This will send a link to everyone who has not completed the survey —{' '}
            {sendableInviteIds.length} recipient{sendableInviteIds.length === 1 ? '' : 's'}.
          </p>
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={closeSendAllConfirm} disabled={bulkSending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary modal-dialog__submit"
              onClick={confirmBulkSendAll}
              disabled={bulkSending}
            >
              {bulkSending ? 'Sending…' : 'Send all'}
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={deleteAllConfirmOpen}
        title="Remove all recipients?"
        titleId="pulse-delete-all-recipients-title"
        onClose={closeDeleteAllConfirm}
      >
        <div style={{ padding: '0 0 0.25rem' }}>
          <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.55 }}>
            This will remove all recipients who have not completed the survey for this timepoint.
          </p>
          <p style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>
            {deletableInviteIds.length} recipient{deletableInviteIds.length === 1 ? '' : 's'} will be removed.
          </p>
          {completedInviteCount > 0 ? (
            <p className="muted" style={{ margin: '0 0 1rem' }}>
              {completedInviteCount} completed recipient{completedInviteCount === 1 ? '' : 's'} will be kept.
            </p>
          ) : (
            <p className="muted" style={{ margin: '0 0 1rem' }}>
              No completed recipients will be kept.
            </p>
          )}
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
            <button type="button" className="btn btn-ghost" onClick={closeDeleteAllConfirm} disabled={deleteWorking}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger modal-dialog__submit"
              onClick={confirmDeleteAllRecipients}
              disabled={deleteWorking}
            >
              {deleteWorking ? 'Removing…' : 'Delete all'}
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(deleteConfirmRow)}
        title="Remove recipient?"
        titleId="pulse-delete-recipient-title"
        onClose={closeDeleteConfirm}
      >
        {deleteConfirmRow ? (
          <div style={{ padding: '0 0 0.25rem' }}>
            <p className="muted" style={{ margin: '0 0 1rem', lineHeight: 1.55 }}>
              They will be removed from this client’s Rhythm Engine link list and won’t receive new links from here.
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
            <select
              id="pulse-add-role"
              value={addRole}
              onChange={(e) => {
                const nextRole = e.target.value;
                setAddRole(nextRole);
                if (nextRole !== 'staff') setAddManagerInviteId('');
              }}
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          {addRole === 'staff' ? (
            <div className="field">
              <label htmlFor="pulse-add-manager">Manager</label>
              <select
                id="pulse-add-manager"
                value={addManagerInviteId}
                onChange={(e) => {
                  const nextManagerId = e.target.value;
                  setAddManagerInviteId(nextManagerId);
                  // Staff usually sit in their manager's team: start from the
                  // manager's values, without overwriting anything typed.
                  const manager = managerOptions.find((option) => option.id === nextManagerId);
                  if (manager) {
                    setAddGroupValues((previous) =>
                      configuredGroupLabels.map((_, index) => {
                        const typed = String(previous[index] ?? '').trim();
                        return typed || String(manager.groupValues[index] ?? '').trim();
                      })
                    );
                  }
                }}
                required
                disabled={managerOptions.length === 0}
              >
                <option value="">
                  {managerOptions.length === 0 ? 'No managers added yet' : 'Select a manager'}
                </option>
                {managerOptions.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.label}
                  </option>
                ))}
              </select>
              {managerOptions.length === 0 ? (
                <p className="muted" style={{ marginTop: '0.4rem' }}>
                  Add a manager recipient first, then add staff.
                </p>
              ) : null}
            </div>
          ) : null}
          {configuredGroupLabels.length > 0 ? (
            configuredGroupLabels.map((label, index) => (
              <div className="field" key={`add-group-${label}`}>
                <label htmlFor={`pulse-add-group-${index}`}>
                  {label} <span className="muted">(optional)</span>
                </label>
                <input
                  id={`pulse-add-group-${index}`}
                  value={addGroupValues[index] ?? ''}
                  onChange={(e) => {
                    const { value } = e.target;
                    setAddGroupValues((previous) => {
                      const next = configuredGroupLabels.map((_, i) => previous[i] ?? '');
                      next[index] = value;
                      return next;
                    });
                  }}
                  placeholder={`e.g. ${label} name`}
                />
              </div>
            ))
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              To place respondents in teams, set up this client&apos;s business levels first (Business
              levels button on this page). Until then, respondents are grouped as &ldquo;Unassigned&rdquo;.
            </p>
          )}
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
          <span>Respondents</span>
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={
                loading || invites.length === 0 || sendableInviteIds.length === 0 || bulkSending || busyImport
              }
              onClick={() => setSendAllConfirmOpen(true)}
              style={{ fontSize: '0.9rem' }}
            >
              <Mail size={18} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {bulkSending && bulkProgress
                ? `Sending ${bulkProgress.current}/${bulkProgress.total}…`
                : 'Send all'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading || invites.length === 0 || deletableInviteIds.length === 0 || bulkSending || deleteWorking}
              onClick={() => setDeleteAllConfirmOpen(true)}
              style={{ fontSize: '0.9rem', color: 'var(--danger, #b91c1c)' }}
            >
              Delete all
            </button>
          </div>
          {!loading && invites.length > 0 && sendableInviteIds.length === 0 ? (
            <p
              className="muted"
              style={{
                fontSize: '0.82rem',
                fontFamily: 'inherit',
                letterSpacing: 'normal',
                textTransform: 'none',
                margin: '0.5rem 0 0',
              }}
            >
              Send all and Delete all are disabled because every recipient has already completed the survey.
            </p>
          ) : null}
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="admin-table pulse-recipients-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Manager (yes/no)</th>
                  <th scope="col">Manager</th>
                  {configuredGroupLabels.map((label, index) => (
                    <th scope="col" key={`group-col-${index}`}>
                      {label}
                    </th>
                  ))}
                  <th scope="col">Link &amp; survey</th>
                  <th scope="col" style={{ minWidth: '12.5rem', whiteSpace: 'nowrap' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={recipientsTableColumnCount} className="muted" style={{ padding: '1.25rem' }}>
                      {inviteTimepoint === 'pre' ? (
                        'No respondents yet. Use Add or Import CSV.'
                      ) : (
                        <div style={{ display: 'grid', gap: '0.7rem' }}>
                          <span>
                            No recipients yet for {inviteTimepointText}. Copy from {copySourceTimepointText} or upload
                            a new CSV list.
                          </span>
                          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={copyRecipientsFromPre}
                              disabled={copyingFromPre || busyImport || bulkSending}
                            >
                              {copyingFromPre
                                ? `Copying from ${copySourceTimepointText}…`
                                : `Copy from ${copySourceTimepointText}`}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={openCsvPicker}
                              disabled={copyingFromPre || busyImport || bulkSending}
                            >
                              Upload new CSV
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                {invites.map((row) => {
                  const surveyComplete = row.surveyStatus === 'completed';
                  return (
                    <tr key={row.id}>
                      <td className="pulse-prototype-mono">{row.email}</td>
                      <td>{row.displayName || '—'}</td>
                      <td>{row.surveyRole === 'manager' ? 'Manager' : 'Staff'}</td>
                      <td>{row.surveyRole === 'manager' ? 'Yes' : 'No'}</td>
                      <td>{row.surveyRole === 'staff' ? row.managerName || row.managerEmail || '—' : '—'}</td>
                      {configuredGroupLabels.map((label, index) => (
                        <td key={`${row.id}-group-${index}`}>{row.groupValues?.[index] || '—'}</td>
                      ))}
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
