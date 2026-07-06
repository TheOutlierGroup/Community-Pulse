import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, TriangleAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';

function formatCheckpointDate(dateKey) {
  const raw = String(dateKey || '').trim();
  if (!raw) return 'Unknown date';
  const dt = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PlatformPulseSettings() {
  const {
    pulseTimepointOptions,
    pulseTimepointBusy,
    pulseTimepointError,
    createPulseDuringTimepoint,
    deletePulseDuringTimepoint,
  } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const duringOptions = useMemo(
    () =>
      (Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : [])
        .filter((row) => row?.phase === 'during' && row?.id)
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [pulseTimepointOptions]
  );

  if (!user) return null;

  if (user.role !== 'admin') {
    return (
      <div className="pulse-prototype-page">
        <p className="error">Only platform admins can manage Rhythm Engine point-in-time settings.</p>
      </div>
    );
  }

  async function handleConfirmCreate() {
    const result = await createPulseDuringTimepoint();
    setCreateConfirmOpen(false);
    if (result?.ok) {
      showToast('New During checkpoint created.', { variant: 'success' });
    } else {
      showToast(result?.error || 'Could not create a new During checkpoint.', { variant: 'error' });
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const result = await deletePulseDuringTimepoint(deleteTarget.id);
    setDeleteTarget(null);
    if (result?.ok) {
      showToast('During checkpoint deleted.', { variant: 'success' });
    } else {
      showToast(result?.error || 'Could not delete the During checkpoint.', { variant: 'error' });
    }
  }

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">Point in time settings</h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Create or delete During checkpoints. The Point in Time selector in the sidebar only switches
            between existing checkpoints — manage them here.
          </p>
        </div>
        <div className="pulse-platform-header__right">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateConfirmOpen(true)}
            disabled={pulseTimepointBusy}
          >
            <Plus size={18} strokeWidth={2} aria-hidden style={{ marginRight: 8, verticalAlign: 'middle' }} />
            New During checkpoint
          </button>
        </div>
      </div>

      {pulseTimepointError ? <p className="error">{pulseTimepointError}</p> : null}

      <div className="card pulse-settings-list">
        {duringOptions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No During checkpoints yet. Create one to start collecting During responses.
          </p>
        ) : (
          duringOptions.map((option) => (
            <div key={option.id} className="pulse-settings-row">
              <div>
                <div className="pulse-settings-row__title">
                  During · {formatCheckpointDate(option.dateKey)}
                </div>
                {option.isActive ? <span className="badge badge-active">Active</span> : null}
              </div>
              <button
                type="button"
                className="btn btn-ghost pulse-settings-row__delete"
                onClick={() => setDeleteTarget(option)}
                disabled={pulseTimepointBusy}
                aria-label={`Delete during checkpoint ${formatCheckpointDate(option.dateKey)}`}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden />
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <ModalDialog
        open={createConfirmOpen}
        title="Create a new During checkpoint?"
        titleId="pulse-create-during-title"
        onClose={() => {
          if (!pulseTimepointBusy) setCreateConfirmOpen(false);
        }}
      >
        <div style={{ padding: '0 0 1rem' }}>
          <p style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <TriangleAlert size={20} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: '0.15rem' }} />
            <span>
              This opens a fresh During checkpoint and consumes one assessment against this client&rsquo;s licence.
              Existing checkpoints and their responses are kept. Recipients for this new checkpoint will need to be
              invited separately under Users.
            </span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCreateConfirmOpen(false)}
              disabled={pulseTimepointBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmCreate}
              disabled={pulseTimepointBusy}
            >
              {pulseTimepointBusy ? 'Creating…' : 'Create checkpoint'}
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(deleteTarget)}
        title="Delete this During checkpoint?"
        titleId="pulse-delete-during-title"
        onClose={() => {
          if (!pulseTimepointBusy) setDeleteTarget(null);
        }}
      >
        <div style={{ padding: '0 0 1rem' }}>
          <p style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <TriangleAlert size={20} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: '0.15rem' }} />
            <span>
              {deleteTarget ? `During · ${formatCheckpointDate(deleteTarget.dateKey)}` : 'This checkpoint'} will be
              removed from the Point in Time selector, dashboards, and invites for both staff and managers. Its
              underlying data is kept for audit purposes but this action cannot be undone from this screen.
            </span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={pulseTimepointBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleConfirmDelete}
              disabled={pulseTimepointBusy}
            >
              {pulseTimepointBusy ? 'Deleting…' : 'Delete checkpoint'}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
