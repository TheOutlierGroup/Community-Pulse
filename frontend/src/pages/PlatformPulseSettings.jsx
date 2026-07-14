import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { CalendarClock, CircleCheck, CirclePause, Plus, TriangleAlert, Trash2 } from 'lucide-react';
import api from '../services/api.js';
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
    orgId,
    org,
    refreshOrg,
    licenseConfig,
    pulseTimepointOptions,
    pulseTimepointBusy,
    pulseTimepointError,
    createPulseDuringTimepoint,
    deletePulseDuringTimepoint,
    toggleDuringCheckpointStatus,
    updatePulseSessionLabelDate,
  } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [dateEditTarget, setDateEditTarget] = useState(null);
  const [dateEditValue, setDateEditValue] = useState('');
  const [activateTarget, setActivateTarget] = useState(null);
  const [carryForwardBusy, setCarryForwardBusy] = useState(false);
  const carryForwardEnabled = org?.settings?.pulseCarryForwardRecipients !== false;

  const preOption = useMemo(
    () => (Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : []).find((row) => row?.phase === 'pre'),
    [pulseTimepointOptions]
  );
  const completedOption = useMemo(
    () => (Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : []).find((row) => row?.phase === 'completed'),
    [pulseTimepointOptions]
  );

  const duringOptions = useMemo(
    () =>
      (Array.isArray(pulseTimepointOptions) ? pulseTimepointOptions : [])
        .filter((row) => row?.phase === 'during' && row?.id)
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [pulseTimepointOptions]
  );

  const assessmentsIncluded = licenseConfig?.assessmentsIncluded;
  const assessmentsUnlimited = assessmentsIncluded == null || assessmentsIncluded === 0;
  const assessmentsConsumed = licenseConfig?.assessmentsConsumed ?? 0;

  if (!user) return null;

  if (user.role !== 'admin') {
    return (
      <div className="pulse-prototype-page">
        <p className="error">Only platform admins can manage Rhythm Engine point-in-time settings.</p>
      </div>
    );
  }

  function openEditDate(option, label) {
    if (!option?.id) return;
    setDateEditValue(option.labelDate || option.dateKey || '');
    setDateEditTarget({ ...option, label });
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

  async function handleDeactivate(option) {
    const result = await toggleDuringCheckpointStatus(option.id, false);
    if (result?.ok) {
      showToast(`During · ${formatCheckpointDate(option.dateKey)} deactivated.`, { variant: 'success' });
    } else {
      showToast(result?.error || 'Could not deactivate the checkpoint.', { variant: 'error' });
    }
  }

  async function handleConfirmActivate() {
    if (!activateTarget) return;
    const label = formatCheckpointDate(activateTarget.dateKey);
    const result = await toggleDuringCheckpointStatus(activateTarget.id, true);
    setActivateTarget(null);
    if (result?.ok) {
      showToast(`During · ${label} activated.`, { variant: 'success' });
    } else {
      showToast(result?.error || 'Could not activate the checkpoint.', { variant: 'error' });
    }
  }

  async function handleToggleCarryForward() {
    setCarryForwardBusy(true);
    try {
      await api.patch(`/api/platform/organizations/${orgId}/rhythm-engine-timepoints/carry-forward-setting`, {
        enabled: !carryForwardEnabled,
      });
      await refreshOrg();
      showToast(
        !carryForwardEnabled
          ? 'New During checkpoints will now carry Pre’s recipients forward automatically.'
          : 'New During checkpoints will start with an empty recipient list.',
        { variant: 'success' }
      );
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update this setting.', { variant: 'error' });
    } finally {
      setCarryForwardBusy(false);
    }
  }

  async function handleConfirmDateEdit() {
    if (!dateEditTarget) return;
    const result = await updatePulseSessionLabelDate(dateEditTarget.id, dateEditValue);
    const label = dateEditTarget.label;
    setDateEditTarget(null);
    if (result?.ok) {
      showToast(`${label} date updated.`, { variant: 'success' });
    } else {
      showToast(result?.error || `Could not update the ${label} date.`, { variant: 'error' });
    }
  }

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">Point in time settings</h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Create, delete, or set the date for During checkpoints. Pre and Post dates come from this
            client&rsquo;s contract in Configurations and can&rsquo;t be edited here. The Point in Time
            selector in the sidebar only switches between existing checkpoints — manage them here.
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

      <h2 className="pulse-settings-section-title">Pre &amp; Post dates</h2>
      <p className="muted" style={{ margin: '0 0 0.6rem' }}>
        Pre and Post are single ongoing checkpoints, set from this client&rsquo;s contract start and end date
        in Configurations — read only here.
      </p>
      <div className="card pulse-settings-list">
        {[
          { option: preOption, label: 'Pre' },
          { option: completedOption, label: 'Post' },
        ].map(({ option, label }) => (
          <div key={label} className="pulse-settings-row">
            <div className="pulse-settings-row__heading">
              <span className="pulse-settings-row__title">
                {label} · {option ? formatCheckpointDate(option.dateKey) : 'Not available yet'}
              </span>
              {option && !option.isContractDate ? (
                <span className="badge badge-draft">Contract date not set</span>
              ) : null}
            </div>
            {option && !option.isContractDate && licenseConfig ? (
              <Link to={`/platform/clients/${licenseConfig.organizationId}/account`} className="btn btn-ghost">
                Set in Configurations
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <h2 className="pulse-settings-section-title">During checkpoints</h2>
      <div className="card pulse-settings-list">
        {duringOptions.length === 0 ? (
          <div className="pulse-settings-empty">
            <p style={{ margin: 0, fontWeight: 600 }}>No During checkpoints yet</p>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Create one whenever you want a fresh mid-engagement read on how the rollout is landing — for
              example partway through a change programme, after a major milestone, or before a go/no-go
              decision. Each new checkpoint opens a clean During session for both staff and managers (closing
              any previous one) and consumes one assessment against this client&rsquo;s licence, so only create
              one when you&rsquo;re ready to invite recipients to it.
            </p>
          </div>
        ) : (
          duringOptions.map((option) => (
            <div key={option.id} className="pulse-settings-row">
              <div className="pulse-settings-row__heading">
                <span className="pulse-settings-row__title">
                  During · {formatCheckpointDate(option.dateKey)}
                </span>
                {option.isActive ? <span className="badge badge-active">Active</span> : null}
                {option.labelDate ? <span className="badge badge-draft">Custom date</span> : null}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => (option.isActive ? handleDeactivate(option) : setActivateTarget(option))}
                  disabled={pulseTimepointBusy}
                >
                  {option.isActive ? (
                    <>
                      <CirclePause size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <CircleCheck size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      Activate
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => openEditDate(option, 'During')}
                  disabled={pulseTimepointBusy}
                >
                  <CalendarClock size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Edit date
                </button>
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
            </div>
          ))
        )}
      </div>

      <h2 className="pulse-settings-section-title">Recipients</h2>
      <div className="card pulse-settings-list">
        <div className="pulse-settings-row">
          <div className="pulse-settings-row__heading">
            <span className="pulse-settings-row__title">Carry recipients forward automatically</span>
            <p className="muted" style={{ margin: '0.3rem 0 0', fontWeight: 400 }}>
              When on, a new During checkpoint starts pre-populated with everyone currently on Pre&rsquo;s
              recipient list (and Post is seeded the same way, the first time it&rsquo;s still empty), so nobody
              has to be re-entered at every stage. Turn this off to start each new checkpoint with an empty list
              instead.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleToggleCarryForward}
            disabled={carryForwardBusy}
            aria-pressed={carryForwardEnabled}
          >
            {carryForwardEnabled ? (
              <>
                <CircleCheck size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                On — turn off
              </>
            ) : (
              <>
                <CirclePause size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Off — turn on
              </>
            )}
          </button>
        </div>
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

      <ModalDialog
        open={Boolean(activateTarget)}
        title="Activate this During checkpoint?"
        titleId="pulse-activate-during-title"
        onClose={() => {
          if (!pulseTimepointBusy) setActivateTarget(null);
        }}
      >
        <div style={{ padding: '0 0 1rem' }}>
          <p style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <TriangleAlert size={20} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: '0.15rem' }} />
            <span>
              {activateTarget ? `During · ${formatCheckpointDate(activateTarget.dateKey)}` : 'This checkpoint'} will
              become the checkpoint staff and managers currently see when they log in, and whichever checkpoint is
              active now will be deactivated. Assessments are only ever consumed when a During checkpoint is first
              created, not on activation — this licence has used{' '}
              {assessmentsUnlimited ? 'an unlimited allowance' : `${assessmentsConsumed} of ${assessmentsIncluded}`}
              {' '}assessments so far. Note: previously sent personal survey links may still work even while a
              checkpoint is inactive.
            </span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setActivateTarget(null)}
              disabled={pulseTimepointBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmActivate}
              disabled={pulseTimepointBusy}
            >
              {pulseTimepointBusy ? 'Activating…' : 'Activate checkpoint'}
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(dateEditTarget)}
        title={`Set the ${dateEditTarget?.label || ''} date`}
        titleId="pulse-edit-label-date-title"
        onClose={() => {
          if (!pulseTimepointBusy) setDateEditTarget(null);
        }}
      >
        <div style={{ padding: '0 0 1rem' }}>
          <p className="muted" style={{ margin: '0 0 0.8rem' }}>
            This only changes the date shown next to {dateEditTarget?.label} in the Point in Time selector and
            this settings screen &mdash; it has no effect on which responses count toward it.
          </p>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Date</span>
            <input
              type="date"
              value={dateEditValue}
              onChange={(e) => setDateEditValue(e.target.value)}
              disabled={pulseTimepointBusy}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDateEditTarget(null)}
              disabled={pulseTimepointBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmDateEdit}
              disabled={pulseTimepointBusy || !dateEditValue}
            >
              {pulseTimepointBusy ? 'Saving…' : 'Save date'}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
