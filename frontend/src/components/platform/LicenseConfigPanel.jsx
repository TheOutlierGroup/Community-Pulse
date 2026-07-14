import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';

function defaultReconciliationMonth() {
  const now = new Date();
  const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

function formatEventDate(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SOURCE_LABELS = {
  platform_during_checkpoint: 'Platform during-checkpoint',
  client_admin_session: 'Client admin session',
  platform_session_create: 'Platform session create',
  manual_override: 'Manual override',
  manual_refund: 'Refund',
};

const LICENSE_TIER_OPTIONS = [
  { id: 'practitioner', label: 'Practitioner' },
  { id: 'enterprise_mid', label: 'Enterprise (Mid)' },
  { id: 'enterprise_large', label: 'Enterprise (Large)' },
  { id: 'enterprise_unlimited', label: 'Enterprise (Unlimited)' },
];

const LICENSE_STATUS_OPTIONS = [
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'expired', label: 'Expired' },
];

function toDateInputValue(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToIso(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return new Date(`${trimmed}T00:00:00.000Z`).toISOString();
}

export default function LicenseConfigPanel({ orgId, licenseConfig, onSaved, isPractitioner = true }) {
  const { showToast } = useToast();
  const [tier, setTier] = useState('practitioner');
  const [status, setStatus] = useState('active');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [adminUserLimit, setAdminUserLimit] = useState('5');
  const [assessmentsIncluded, setAssessmentsIncluded] = useState('0');
  const [assessmentsConsumed, setAssessmentsConsumed] = useState('0');
  const [respondentCap, setRespondentCap] = useState('');
  const [benchmarkAccess, setBenchmarkAccess] = useState(false);
  const [onboardingFeePaid, setOnboardingFeePaid] = useState(false);
  const [notes, setNotes] = useState('');
  const [brandDisplayName, setBrandDisplayName] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('');
  const [brandUseForDownstream, setBrandUseForDownstream] = useState(true);
  const [expirySubject, setExpirySubject] = useState('');
  const [expiryIntro, setExpiryIntro] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportUrl, setSupportUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [reconciliationMonth, setReconciliationMonth] = useState(defaultReconciliationMonth());
  const [reconciliationBusy, setReconciliationBusy] = useState(false);

  const includedNum = Number.parseInt(assessmentsIncluded, 10) || 0;
  const consumedNum = Number.parseInt(assessmentsConsumed, 10) || 0;
  const isUnlimited = includedNum === 0;
  const usagePct = isUnlimited
    ? 0
    : Math.min(100, Math.round((consumedNum / includedNum) * 100));
  const overQuota = !isUnlimited && consumedNum >= includedNum;
  const usageBarColor = overQuota
    ? '#dc2626'
    : usagePct >= 80
      ? '#d97706'
      : '#16a34a';
  const remainingLabel = useMemo(() => {
    if (isUnlimited) return 'Unlimited assessments';
    const remaining = Math.max(includedNum - consumedNum, 0);
    return `${remaining} of ${includedNum} assessments remaining (${consumedNum} consumed)`;
  }, [isUnlimited, includedNum, consumedNum]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setEventsBusy(true);
    api
      .get(`/api/platform/organizations/${orgId}/assessment-consumption`)
      .then(({ data }) => {
        if (!cancelled) setEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .catch(() => {
        // 403/404 is fine — only platform admins viewing licensee orgs see events.
      })
      .finally(() => {
        if (!cancelled) setEventsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, licenseConfig?.assessmentsConsumed]);

  useEffect(() => {
    setTier(licenseConfig?.licenseTier || 'practitioner');
    setStatus(licenseConfig?.status || 'active');
    setContractStart(toDateInputValue(licenseConfig?.contractStart));
    setContractEnd(toDateInputValue(licenseConfig?.contractEnd));
    setAdminUserLimit(String(licenseConfig?.adminUserLimit ?? 5));
    setAssessmentsIncluded(String(licenseConfig?.assessmentsIncluded ?? 0));
    setAssessmentsConsumed(String(licenseConfig?.assessmentsConsumed ?? 0));
    setRespondentCap(
      licenseConfig?.respondentCapPerAssessment == null
        ? ''
        : String(licenseConfig.respondentCapPerAssessment)
    );
    setBenchmarkAccess(Boolean(licenseConfig?.benchmarkAccess));
    setOnboardingFeePaid(Boolean(licenseConfig?.onboardingFeePaid));
    setNotes(licenseConfig?.notes || '');
    setBrandDisplayName(licenseConfig?.brandDisplayName || '');
    setBrandPrimaryColor(licenseConfig?.brandPrimaryColor || '');
    setBrandUseForDownstream(licenseConfig?.brandUseForDownstream !== false);
    const overrides = licenseConfig?.emailTemplateOverrides || {};
    setExpirySubject(overrides?.expiryWarning?.subject || '');
    setExpiryIntro(overrides?.expiryWarning?.intro || '');
    setSupportEmail(licenseConfig?.supportEmail || '');
    setSupportUrl(licenseConfig?.supportUrl || '');
  }, [licenseConfig]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        licenseTier: tier,
        status,
        contractStart: dateInputToIso(contractStart),
        contractEnd: dateInputToIso(contractEnd),
        adminUserLimit: Number.parseInt(adminUserLimit, 10),
        assessmentsIncluded: Number.parseInt(assessmentsIncluded, 10),
        assessmentsConsumed: Number.parseInt(assessmentsConsumed, 10),
        respondentCapPerAssessment: respondentCap === '' ? null : Number.parseInt(respondentCap, 10),
        benchmarkAccess,
        onboardingFeePaid,
        notes,
        brandDisplayName: brandDisplayName.trim() || null,
        brandPrimaryColor: brandPrimaryColor.trim() || null,
        brandUseForDownstream,
        emailTemplateOverrides: {
          ...(licenseConfig?.emailTemplateOverrides || {}),
          expiryWarning: (() => {
            const subject = expirySubject.trim();
            const intro = expiryIntro.trim();
            const next = {};
            if (subject) next.subject = subject;
            if (intro) next.intro = intro;
            return next;
          })(),
        },
        supportEmail: supportEmail.trim() || null,
        supportUrl: supportUrl.trim() || null,
      };
      await api.patch(`/api/platform/organizations/${orgId}/licence-config`, payload);
      showToast('Licence saved.', { variant: 'success' });
      if (typeof onSaved === 'function') await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save licence.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card platform-client-dashboard__card" style={{ marginBottom: '1.5rem' }}>
      <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0 }}>
        Licence
      </h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>
        Commercial guardrails for this {isPractitioner ? 'Rhythm Engine Practitioner' : 'Enterprise Rhythm Engine client'}.
        Only Outlier platform admins can edit these.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <div style={{ marginBottom: '1rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '0.35rem',
            fontSize: '0.875rem',
          }}
        >
          <strong>Assessment usage</strong>
          <span className="muted">{remainingLabel}</span>
        </div>
        <div
          aria-hidden
          style={{
            height: 8,
            borderRadius: 4,
            background: 'rgba(0,0,0,0.06)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: isUnlimited ? '100%' : `${usagePct}%`,
              height: '100%',
              background: isUnlimited ? '#94a3b8' : usageBarColor,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
        {overQuota && (
          <p className="error" style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem' }}>
            Quota reached. New assessment opens are blocked until "Assessments included" is increased.
          </p>
        )}
      </div>
      <form onSubmit={save}>
        <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="field">
            <label htmlFor="lc-tier">Licence tier</label>
            <select id="lc-tier" value={tier} onChange={(e) => setTier(e.target.value)} disabled={busy}>
              {LICENSE_TIER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lc-status">Status</label>
            <select id="lc-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
              {LICENSE_STATUS_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lc-contract-start">Contract start</label>
            <input
              id="lc-contract-start"
              type="date"
              value={contractStart}
              onChange={(e) => setContractStart(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-contract-end">Contract end</label>
            <input
              id="lc-contract-end"
              type="date"
              value={contractEnd}
              onChange={(e) => setContractEnd(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-admin-limit">Admin user limit</label>
            <input
              id="lc-admin-limit"
              type="number"
              min="1"
              value={adminUserLimit}
              onChange={(e) => setAdminUserLimit(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-resp-cap">Respondent cap per assessment</label>
            <input
              id="lc-resp-cap"
              type="number"
              min="1"
              placeholder="No cap"
              value={respondentCap}
              onChange={(e) => setRespondentCap(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-assess-included">Assessments included</label>
            <input
              id="lc-assess-included"
              type="number"
              min="0"
              value={assessmentsIncluded}
              onChange={(e) => setAssessmentsIncluded(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-assess-consumed">Assessments consumed</label>
            <input
              id="lc-assess-consumed"
              type="number"
              min="0"
              value={assessmentsConsumed}
              onChange={(e) => setAssessmentsConsumed(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={benchmarkAccess}
              onChange={(e) => setBenchmarkAccess(e.target.checked)}
              disabled={busy}
            />
            Benchmark access
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={onboardingFeePaid}
              onChange={(e) => setOnboardingFeePaid(e.target.checked)}
              disabled={busy}
            />
            Onboarding fee paid
          </label>
        </div>
        <div className="field" style={{ marginTop: '0.75rem' }}>
          <label htmlFor="lc-notes">Notes (internal)</label>
          <textarea
            id="lc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="platform-textarea"
            disabled={busy}
          />
        </div>
        {isPractitioner && (
        <>
        <fieldset
          style={{
            marginTop: '1.25rem',
            padding: '1rem 1rem 0.75rem',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 8,
          }}
        >
          <legend style={{ padding: '0 0.5rem', fontWeight: 600 }}>Brand (white-label)</legend>
          <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
            Used in the Practitioner’s own workspace, in their downstream client surveys, and in
            licence emails. The logo is the Practitioner organisation’s company logo (uploaded via
            the company logo control elsewhere on this page).
          </p>
          <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className="field">
              <label htmlFor="lc-brand-name">Display name</label>
              <input
                id="lc-brand-name"
                type="text"
                value={brandDisplayName}
                onChange={(e) => setBrandDisplayName(e.target.value)}
                placeholder="(uses organisation name)"
                maxLength={120}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="lc-brand-color">Primary colour</label>
              <input
                id="lc-brand-color"
                type="text"
                value={brandPrimaryColor}
                onChange={(e) => setBrandPrimaryColor(e.target.value)}
                placeholder="#0066cc"
                pattern="^#[0-9A-Fa-f]{6}$"
                disabled={busy}
              />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input
              type="checkbox"
              checked={brandUseForDownstream}
              onChange={(e) => setBrandUseForDownstream(e.target.checked)}
              disabled={busy}
            />
            Apply this brand to the licensee’s downstream client surveys (white-label)
          </label>
        </fieldset>
        <fieldset className="card-fieldset" style={{ marginTop: '0.75rem' }}>
          <legend>Email template overrides</legend>
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
            Customise the licence-expiry warning email that goes to this licensee's admins.
            Use <code>{'{org}'}</code> in the subject as a placeholder for the organisation name.
            Leave blank to use the platform default.
          </p>
          <div className="field">
            <label htmlFor="lc-expiry-subject">Expiry warning subject</label>
            <input
              id="lc-expiry-subject"
              type="text"
              value={expirySubject}
              onChange={(e) => setExpirySubject(e.target.value)}
              maxLength={200}
              placeholder="(default: Your Rhythm Engine licence expires…)"
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-expiry-intro">Expiry warning intro</label>
            <textarea
              id="lc-expiry-intro"
              value={expiryIntro}
              onChange={(e) => setExpiryIntro(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Optional one-paragraph intro placed before the standard body."
              disabled={busy}
            />
          </div>
        </fieldset>
        <fieldset className="card-fieldset" style={{ marginTop: '0.75rem' }}>
          <legend>Downstream-client support contact</legend>
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
            Shown on white-labeled survey pages so respondents reach <em>you</em> instead of Outlier.
          </p>
          <div className="field">
            <label htmlFor="lc-support-email">Support email</label>
            <input
              id="lc-support-email"
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@yourcompany.com"
              maxLength={200}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="lc-support-url">Support URL (optional)</label>
            <input
              id="lc-support-url"
              type="url"
              value={supportUrl}
              onChange={(e) => setSupportUrl(e.target.value)}
              placeholder="https://yourcompany.com/help"
              maxLength={300}
              disabled={busy}
            />
          </div>
        </fieldset>
        </>
        )}
        <div style={{ marginTop: '0.75rem' }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save licence'}
          </button>
        </div>
      </form>

      <div style={{ marginTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Monthly reconciliation</h3>
        <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
          Download the row-level CSV used for billing reconciliation. Defaults to last completed month.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label htmlFor="lc-reconciliation-month">Month</label>
            <input
              id="lc-reconciliation-month"
              type="month"
              value={reconciliationMonth}
              onChange={(e) => setReconciliationMonth(e.target.value)}
              disabled={reconciliationBusy}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={reconciliationBusy || !reconciliationMonth}
            onClick={async () => {
              setReconciliationBusy(true);
              try {
                const res = await api.get(
                  `/api/platform/organizations/${orgId}/reconciliation.csv?month=${encodeURIComponent(reconciliationMonth)}`,
                  { responseType: 'blob' }
                );
                const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = `reconciliation_${orgId}_${reconciliationMonth}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);
              } catch (err) {
                showToast(err?.response?.data?.error || 'Could not download reconciliation', 'error');
              } finally {
                setReconciliationBusy(false);
              }
            }}
          >
            {reconciliationBusy ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Recent assessment opens</h3>
        {eventsBusy && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
        {!eventsBusy && events.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            No assessments have been opened against this licence yet.
          </p>
        )}
        {!eventsBusy && events.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {events.slice(0, 10).map((event) => (
              <li
                key={event.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.4rem 0',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                  fontSize: '0.85rem',
                }}
              >
                <span>
                  <strong>
                    {event.assessmentsCharged > 0
                      ? `+${event.assessmentsCharged}`
                      : event.assessmentsCharged}
                  </strong>{' '}
                  · {event.clientOrganizationName || 'Unknown client'}
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>
                    {SOURCE_LABELS[event.source] || event.source}
                  </span>
                </span>
                <span className="muted">{formatEventDate(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
