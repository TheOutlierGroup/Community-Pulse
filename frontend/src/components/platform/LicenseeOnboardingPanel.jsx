import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles, X } from 'lucide-react';
import api from '../../services/api.js';

const DISMISS_KEY_PREFIX = 'onb-checklist-dismissed:';

function dismissKey(userId) {
  return `${DISMISS_KEY_PREFIX}${userId || 'anon'}`;
}

function readDismissed(userId) {
  try {
    return window.localStorage.getItem(dismissKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(userId, value) {
  try {
    if (value) {
      window.localStorage.setItem(dismissKey(userId), '1');
    } else {
      window.localStorage.removeItem(dismissKey(userId));
    }
  } catch {
    /* localStorage unavailable, just no-op */
  }
}

/**
 * ONB-01 + ONB-04: welcome card + computed setup checklist for new
 * licensee admins. The checklist itself is fully derived on the
 * backend; the only client-side persistence is "dismissed" (per user,
 * via localStorage) so we don't add a DB row for a UX preference.
 *
 * Fully self-contained — renders nothing for non-licensees, nothing
 * once dismissed, and nothing if the API returns no checklist (e.g. a
 * non-admin licensee user, which is allowed today).
 */
export default function LicenseeOnboardingPanel({ user }) {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.id));

  useEffect(() => {
    setDismissed(readDismissed(user?.id));
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!user) return undefined;
    setLoading(true);
    api
      .get('/api/auth/me/onboarding')
      .then(({ data }) => {
        if (!cancelled) setChecklist(data?.checklist || null);
      })
      .catch(() => {
        if (!cancelled) setChecklist(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const progressPct = useMemo(() => {
    if (!checklist || !checklist.total) return 0;
    return Math.round((checklist.completed / checklist.total) * 100);
  }, [checklist]);

  if (loading) return null;
  if (!checklist) return null;
  if (dismissed && checklist.isComplete) return null;
  if (dismissed) return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: '1.5rem',
        background: 'linear-gradient(135deg, #fff7ed 0%, #ffffff 60%)',
        border: '1px solid #fed7aa',
        position: 'relative',
      }}
    >
      <button
        type="button"
        onClick={() => {
          writeDismissed(user?.id, true);
          setDismissed(true);
        }}
        aria-label="Dismiss onboarding checklist"
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          background: 'transparent',
          border: 'none',
          padding: '0.25rem',
          cursor: 'pointer',
          color: '#78716c',
        }}
      >
        <X size={16} aria-hidden />
      </button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Sparkles size={20} strokeWidth={1.75} aria-hidden style={{ color: '#ea580c' }} />
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
          {checklist.isComplete ? 'You are all set up' : 'Welcome — finish setting up'}
        </h2>
      </div>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
        {checklist.isComplete
          ? 'Every checklist item is done. Dismiss this card to clear it from your dashboard.'
          : 'A few quick things to do so your team and clients see the right brand and quota information.'}
      </p>
      <div
        style={{
          height: 6,
          background: '#fde68a',
          borderRadius: 999,
          overflow: 'hidden',
          marginBottom: '0.75rem',
        }}
        aria-label={`Setup ${progressPct}% complete`}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: '100%',
            background: '#ea580c',
            transition: 'width 200ms ease',
          }}
        />
      </div>
      <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
        {checklist.completed} of {checklist.total} complete
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
        {checklist.steps.map((step) => {
          const cta = step.action?.href ? (
            <Link
              to={step.action.href}
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {step.completed ? 'Review' : 'Open'}
            </Link>
          ) : null;
          return (
            <li
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: '#ffffff',
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: step.completed ? '#dcfce7' : '#f5f5f4',
                  color: step.completed ? '#166534' : '#a8a29e',
                  flex: '0 0 20px',
                  marginTop: 2,
                }}
              >
                {step.completed ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block', fontSize: '0.9rem' }}>{step.label}</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{step.description}</span>
              </span>
              {cta}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
