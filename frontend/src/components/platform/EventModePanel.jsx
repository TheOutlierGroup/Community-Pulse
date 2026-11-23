import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Presentation } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import { brandStyleVars, brandUsesLightText, previewThemeFromColors } from '../../utils/eventModeTheme.js';
import '../../styles/eventMode.css';

const STAGES = [
  { id: 'pre', label: 'Pre' },
  { id: 'mid', label: 'During' },
  { id: 'post', label: 'Post' },
];

const FIELDS = [
  {
    id: 'whatIsChanging',
    label: "What's changing",
    max: 400,
    example: 'e.g. From March, rostering moves from spreadsheets to the new Shiftly app.',
  },
  {
    id: 'whyAsking',
    label: "Why we're asking you",
    max: 400,
    example: 'e.g. We want to know how ready teams feel before go-live, and where support is needed.',
  },
  {
    id: 'howUsed',
    label: 'How your feedback will be used',
    max: 400,
    example: 'e.g. The executive team will use the results to decide the rollout order and training plan.',
  },
  {
    id: 'whenHearBack',
    label: "When you'll hear back",
    max: 160,
    example: 'e.g. 15 December, at the all-staff meeting',
  },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

function emptyContext() {
  return Object.fromEntries(STAGES.map((s) => [s.id, Object.fromEntries(FIELDS.map((f) => [f.id, '']))]));
}

/**
 * Event mode settings for one client. Only platform staff see this panel;
 * the server enforces the same rule on save.
 */
export default function EventModePanel({ orgId, clientLogoUrl, hasLogo, onLogoChanged }) {
  const { showToast } = useToast();
  const logoInputRef = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);

  // Same client logo as the CRM Settings page (one logo per client), so
  // Event mode can be fully set up from the Rhythm Engine app too.
  async function onLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Logo must be 2 MB or smaller.', { variant: 'error' });
      return;
    }
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post(`/api/platform/organizations/${orgId}/logo`, fd);
      await onLogoChanged?.();
      showToast('Client logo updated.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not upload logo.', { variant: 'error' });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm('Remove this client’s logo? It is also removed from the client workspace.')) return;
    setLogoBusy(true);
    try {
      await api.delete(`/api/platform/organizations/${orgId}/logo`);
      await onLogoChanged?.();
      showToast('Client logo removed.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove logo.', { variant: 'error' });
    } finally {
      setLogoBusy(false);
    }
  }
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [stage, setStage] = useState('pre');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const applyServer = useCallback((em) => {
    setState(em);
    setForm({
      changeName: em.changeName || '',
      closingNote: em.closingNote || '',
      primaryColor: em.primaryColor || '',
      secondaryColor: em.secondaryColor || '',
      changeContext: { ...emptyContext(), ...(em.changeContext || {}) },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/platform/organizations/${orgId}/event-mode`)
      .then(({ data }) => {
        if (!cancelled) applyServer(data.eventMode);
      })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.error || 'Could not load Event mode settings.');
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, applyServer]);

  const theme = useMemo(
    () => (form ? previewThemeFromColors(form.primaryColor, form.secondaryColor) : null),
    [form]
  );

  async function save(patch, successMessage) {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.put(`/api/platform/organizations/${orgId}/event-mode`, patch);
      applyServer(data.eventMode);
      showToast(successMessage, { variant: 'success' });
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save Event mode settings.');
    } finally {
      setBusy(false);
    }
  }

  function onToggle() {
    const next = !state.enabled;
    const message = next
      ? 'Turn Event mode on? Respondents and dashboards for this client will show the Event mode experience straight away.'
      : 'Turn Event mode off? This client goes back to the standard experience. Your settings are kept.';
    if (!window.confirm(message)) return;
    save({ enabled: next }, next ? 'Event mode is on.' : 'Event mode is off. Settings kept.');
  }

  function onSaveDetails(e) {
    e.preventDefault();
    save(
      {
        changeName: form.changeName,
        closingNote: form.closingNote,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        changeContext: form.changeContext,
      },
      'Event mode settings saved.'
    );
  }

  function setField(stageId, fieldId, value) {
    setForm((current) => ({
      ...current,
      changeContext: {
        ...current.changeContext,
        [stageId]: { ...current.changeContext[stageId], [fieldId]: value },
      },
    }));
  }

  if (error && !state) {
    return (
      <div className="card event-mode-panel">
        <p className="error" style={{ margin: 0 }}>{error}</p>
      </div>
    );
  }
  if (!state || !form) {
    return (
      <div className="card event-mode-panel">
        <p className="muted" style={{ margin: 0 }}>Loading Event mode…</p>
      </div>
    );
  }

  const stageContext = form.changeContext[stage] || {};
  const missing = state.missingByStage || {};

  return (
    <div className="card event-mode-panel">
      <div className="event-mode-panel__head">
        <h2 className="platform-client-dashboard__h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Presentation size={20} strokeWidth={1.75} aria-hidden />
          Event mode
        </h2>
        <span className={`event-mode-badge${state.enabled ? ' event-mode-badge--on' : ''}`}>
          {state.enabled ? 'Event mode on' : 'Off'}
        </span>
        <button
          type="button"
          className={`btn ${state.enabled ? 'btn-ghost' : 'btn-primary platform-inline-primary'}`}
          disabled={busy}
          onClick={onToggle}
        >
          {state.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="muted event-mode-panel__intro">
        A temporary presentation layer for this client: their colours and logo, the change explained at the top of the
        survey, the approved wording, and a shorter dashboard. Turning it off restores the standard experience and keeps
        these settings.
      </p>
      {!state.available ? (
        <p className="event-mode-panel__warn">
          {state.enabled ? 'Event mode is turned on for this client, but' : 'Note:'} the server-wide switch is off, so
          respondents and dashboards still see the standard experience. To use Event mode, set{' '}
          <code>EVENT_MODE_AVAILABLE=true</code> in the server environment (on Render: each web service, Environment
          tab) and redeploy. You can still fill in and save everything below in the meantime.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <form onSubmit={onSaveDetails} className="event-mode-panel__grid">
        <div className="event-mode-panel__fields">
          <div className="event-mode-field">
            <span className="event-mode-field__label">Client logo</span>
            <div className="event-mode-logo-row">
              <div className="event-mode-logo-row__preview">
                {hasLogo && clientLogoUrl ? (
                  <img src={clientLogoUrl} alt="Client logo" />
                ) : (
                  <span className="muted">No logo yet</span>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="visually-hidden"
                onChange={onLogoFile}
                disabled={logoBusy}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={logoBusy}
                onClick={() => logoInputRef.current?.click()}
              >
                {logoBusy ? 'Working…' : hasLogo ? 'Change logo' : 'Upload logo'}
              </button>
              {hasLogo ? (
                <button type="button" className="btn btn-ghost" disabled={logoBusy} onClick={removeLogo}>
                  Remove
                </button>
              ) : null}
            </div>
            <span className="event-mode-field__hint">
              Shown at the top of the survey and on the dashboard. JPG, PNG, GIF or WebP, up to 2 MB. This is the same
              logo used in the client workspace.
            </span>
          </div>

          <label className="event-mode-field">
            <span className="event-mode-field__label">Change name</span>
            <input
              type="text"
              value={form.changeName}
              maxLength={80}
              placeholder="e.g. New rostering system"
              onChange={(e) => setForm({ ...form, changeName: e.target.value })}
            />
            {form.changeName.trim() ? (
              <span className="event-mode-field__hint">Shown as the survey heading. Required before invites go out.</span>
            ) : (
              <span className="event-mode-field__hint event-mode-field__hint--missing">
                Required: invites for every stage are blocked until this is filled in.
              </span>
            )}
          </label>

          <label className="event-mode-field">
            <span className="event-mode-field__label">Thank-you note (optional)</span>
            <input
              type="text"
              value={form.closingNote}
              maxLength={200}
              placeholder="e.g. Head back to your team huddle. The reveal starts once everyone is in."
              onChange={(e) => setForm({ ...form, closingNote: e.target.value })}
            />
            <span className="event-mode-field__hint">
              Shown highlighted on the thank-you screen, after what happens next. Leave blank to hide it.
            </span>
          </label>

          <div className="event-mode-colours">
            {[
              ['primaryColor', 'Primary colour', 'Buttons, progress and highlights'],
              ['secondaryColor', 'Secondary colour (optional)', 'Small accents on the dashboard'],
            ].map(([key, label, hint]) => (
              <label key={key} className="event-mode-field">
                <span className="event-mode-field__label">{label}</span>
                <span className="event-mode-colour-input">
                  <input
                    type="color"
                    aria-label={`${label} picker`}
                    value={HEX_RE.test(form[key]) ? form[key] : '#ffffff'}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                  <input
                    type="text"
                    value={form[key]}
                    placeholder="e.g. #1a73e8"
                    maxLength={7}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value.trim() })}
                  />
                </span>
                <span className="event-mode-field__hint">
                  {HEX_RE.test(form[key]) ? `${hint}.` : `${hint}. Not set yet.`} Text colour on top is picked automatically.
                </span>
              </label>
            ))}
          </div>

          <div className="event-mode-stage-tabs" role="tablist" aria-label="Survey stage">
            {STAGES.map((s) => {
              const stageMissing = (missing[s.id] || []).filter((f) => f !== 'changeName').length;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={stage === s.id}
                  className={`event-mode-stage-tab${stage === s.id ? ' event-mode-stage-tab--active' : ''}`}
                  onClick={() => setStage(s.id)}
                >
                  {s.label}
                  {stageMissing ? <span className="event-mode-stage-tab__missing">{stageMissing} to fill</span> : null}
                </button>
              );
            })}
          </div>
          <p className="event-mode-field__hint" style={{ marginTop: 0 }}>
            Change context appears at the top of the {STAGES.find((s) => s.id === stage)?.label.toLowerCase()} survey.
            While Event mode is on, invites for a stage cannot be sent until all four fields are filled in.
          </p>
          {FIELDS.map((field) => {
            const value = stageContext[field.id] || '';
            return (
              <label key={field.id} className="event-mode-field">
                <span className="event-mode-field__label">{field.label}</span>
                <textarea
                  rows={field.max > 200 ? 2 : 1}
                  value={value}
                  maxLength={field.max}
                  placeholder={field.example}
                  onChange={(e) => setField(stage, field.id, e.target.value)}
                />
                <span className="event-mode-field__hint">
                  {value.length}/{field.max}
                </span>
              </label>
            );
          })}
          <div className="btn-row" style={{ marginTop: '0.5rem' }}>
            <button type="submit" className="btn btn-primary platform-inline-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save Event mode settings'}
            </button>
          </div>
        </div>

        <aside
          className={`event-mode-preview${brandUsesLightText(theme) ? ' brand-light-text' : ''}`}
          style={brandStyleVars(theme)}
          aria-label="Survey preview"
        >
          <p className="event-mode-preview__caption">Survey preview</p>
          <div className="event-mode-preview__card">
            {clientLogoUrl ? <img src={clientLogoUrl} alt="" className="event-mode-preview__logo" /> : null}
            <p className="event-mode-preview__eyebrow">
              <strong>{form.changeName || 'Change name'}</strong> · Your feedback
            </p>
            <dl className="change-context">
              {FIELDS.map((field) => (
                <div key={field.id} className="change-context__row">
                  <dt>{field.label}</dt>
                  <dd>{stageContext[field.id] || <span className="muted">Not filled in yet</span>}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="btn btn-primary" tabIndex={-1} style={{ pointerEvents: 'none' }}>
              Start the survey
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}
