import { useEffect, useState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import ModalDialog from '../shared/ModalDialog.jsx';

/**
 * Set up a Rhythm Engine client's business levels (stored as the org's
 * `groupLevels` / `groupLevelLabels` settings). Opened from the Respondents
 * page, because the levels decide which team columns the respondent CSV
 * template, CSV import and "Add respondent" form ask for.
 */

const SUGGESTED_LEVEL_LABELS = ['Business Unit', 'Division', 'Team'];
const MAX_LEVELS = 5;

function readClientSettings(settings) {
  if (settings == null) return null;
  let s = settings;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return s;
}

function readLevels(settings) {
  const parsed = readClientSettings(settings);
  if (!parsed) return '';
  const asNumber = Number.parseInt(String(parsed.groupLevels ?? ''), 10);
  if (!Number.isInteger(asNumber) || asNumber < 1 || asNumber > MAX_LEVELS) return '';
  return String(asNumber);
}

function readLevelLabels(settings) {
  const parsed = readClientSettings(settings);
  if (!parsed || !Array.isArray(parsed.groupLevelLabels)) return [];
  return parsed.groupLevelLabels.slice(0, MAX_LEVELS).map((label) => String(label ?? ''));
}

function resizeLabels(labels, countValue) {
  const count = Number.parseInt(countValue, 10);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LEVELS) return [];
  const next = labels.slice(0, count);
  while (next.length < count) next.push('');
  return next;
}

export default function BusinessLevelsModal({ open, onClose, orgId, org, refreshOrg }) {
  const { showToast } = useToast();
  const [levels, setLevels] = useState('');
  const [labels, setLabels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset the form from the saved settings every time the modal opens, so a
  // cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    const savedLevels = readLevels(org?.settings);
    setLevels(savedLevels);
    setLabels(resizeLabels(readLevelLabels(org?.settings), savedLevels));
    setError('');
  }, [open, org?.settings]);

  function handleClose() {
    if (busy) return;
    onClose();
  }

  async function save(e) {
    e.preventDefault();
    const parsedLevels = Number.parseInt(levels, 10);
    if (!Number.isInteger(parsedLevels)) {
      setError('Select how many business levels this client has.');
      return;
    }
    const normalizedLabels = labels.slice(0, parsedLevels).map((label) => String(label || '').trim());
    if (normalizedLabels.length < parsedLevels || normalizedLabels.some((label) => !label)) {
      setError('Provide a name for each business level.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: { groupLevels: parsedLevels, groupLevelLabels: normalizedLabels },
      });
      await refreshOrg();
      showToast('Business levels saved.', { variant: 'success' });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save business levels.');
    } finally {
      setBusy(false);
    }
  }

  const count = Number.parseInt(levels, 10);

  return (
    <ModalDialog open={open} title="Set up business levels" titleId="re-business-levels-title" onClose={handleClose}>
      <form onSubmit={save} style={{ padding: '0 0 0.25rem' }}>
        <p className="muted" style={{ marginTop: 0 }}>
          How many organisational levels does this client have (e.g. Business Unit, Division, Team)? Each level
          becomes a column in the respondent CSV template and a field when adding a respondent.
        </p>
        {error ? <p className="error">{error}</p> : null}
        <div className="field">
          <label htmlFor="re-business-levels-count">Number of business levels</label>
          <select
            id="re-business-levels-count"
            value={levels}
            onChange={(e) => {
              const next = e.target.value;
              setLevels(next);
              setLabels((current) => resizeLabels(current, next));
            }}
            disabled={busy}
            required
          >
            <option value="">Select business levels</option>
            {Array.from({ length: MAX_LEVELS }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
        {count > 0 ? (
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            {Array.from({ length: count }, (_, index) => (
              <div className="field" key={`re-business-level-${index + 1}`} style={{ margin: 0 }}>
                <label htmlFor={`re-business-level-${index + 1}`}>Level {index + 1} name</label>
                <input
                  id={`re-business-level-${index + 1}`}
                  value={labels[index] ?? ''}
                  onChange={(e) =>
                    setLabels((current) => {
                      const next = [...current];
                      next[index] = e.target.value;
                      return next;
                    })
                  }
                  placeholder={SUGGESTED_LEVEL_LABELS[index] ? `e.g. ${SUGGESTED_LEVEL_LABELS[index]}` : ''}
                  disabled={busy}
                  required
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="modal-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save business levels'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
