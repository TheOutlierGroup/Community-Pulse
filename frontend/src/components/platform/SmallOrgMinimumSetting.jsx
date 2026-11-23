import { useEffect, useState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';

/**
 * Outlier-admin-only switch: report results for groups of 3 or more
 * instead of 5, for a small client organisation. The server records the
 * minimum each respondent was told and reports at the strictest promise in
 * each group, so stages already underway stay at 5.
 */
export default function SmallOrgMinimumSetting({ orgId }) {
  const { showToast } = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/platform/organizations/${orgId}/small-org-minimum`)
      .then(({ data }) => {
        if (!cancelled) setState(data.smallOrgMinimum);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!state) return null;

  async function toggle() {
    const next = !state.enabled;
    const message = next
      ? `Report results for groups of ${state.smallOrgMinimum} or more for this client?\n\n` +
        `This only affects survey stages nobody has opened yet. In those stages, respondents and invite emails say ` +
        `"${state.smallOrgMinimum} or more", and results show for groups of ${state.smallOrgMinimum} or more.\n\n` +
        `A stage that is already underway does not change: everyone in it, including people who open it later, is told ` +
        `"${state.standardMinimum} or more", and its results stay at ${state.standardMinimum}.`
      : `Go back to groups of ${state.standardMinimum} or more for this client? Every result will use ${state.standardMinimum} again.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      const { data } = await api.put(`/api/platform/organizations/${orgId}/small-org-minimum`, { enabled: next });
      setState(data.smallOrgMinimum);
      showToast(
        next
          ? `Minimum group size is ${state.smallOrgMinimum} for new survey stages.`
          : `Minimum group size is back to ${state.standardMinimum}.`,
        { variant: 'success' }
      );
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not change the minimum group size.', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const since = state.enabledAt
    ? new Date(state.enabledAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="pulse-settings-row">
      <div className="pulse-settings-row__heading">
        <span className="pulse-settings-row__title">
          Small organisation: report groups of {state.smallOrgMinimum} or more{' '}
          <span className="event-mode-badge">Outlier admins only</span>
        </span>
        <p className="muted" style={{ margin: '0.3rem 0 0', fontWeight: 400 }}>
          Normally results are only shown for groups of {state.standardMinimum} or more. Turn this on for a small client
          so teams of {state.smallOrgMinimum} or 4 get results. It only affects survey stages nobody has opened yet: there,
          the survey and invite emails say &ldquo;{state.smallOrgMinimum} or more&rdquo;. A stage already underway is
          unchanged: everyone in it, including people who open it later, is told &ldquo;{state.standardMinimum} or
          more&rdquo; and its results stay at {state.standardMinimum}.
          {state.enabled && since ? ` On since ${since}.` : ''}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        className="pulse-settings-toggle"
        onClick={toggle}
        disabled={busy}
        aria-pressed={state.enabled}
        aria-checked={state.enabled}
        aria-label={`Report groups of ${state.smallOrgMinimum} or more: ${state.enabled ? 'on' : 'off'}`}
      >
        <span className="pulse-settings-toggle__track" aria-hidden>
          <span className="pulse-settings-toggle__thumb" />
        </span>
      </button>
    </div>
  );
}
