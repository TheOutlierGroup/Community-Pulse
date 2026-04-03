import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import Step1WorkFeel from '../components/employee/Step1WorkFeel.jsx';
import Step2Priorities from '../components/employee/Step2Priorities.jsx';
import Step3Energy from '../components/employee/Step3Energy.jsx';
import Step4Context from '../components/employee/Step4Context.jsx';
import Step5Reflection from '../components/employee/Step5Reflection.jsx';
import outlierLogo from '../images/outlier-logo.png';

const DEFAULT_ORDER = [
  'alignment',
  'ownership',
  'collaboration',
  'pace',
  'support',
  'customer',
];

export default function PublicPulse() {
  const { token } = useParams();
  const { logout } = useAuth();
  const linkParams = useMemo(() => ({ params: { token: token || '' } }), [token]);
  const [themes, setThemes] = useState([]);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState(1);
  const [ratings, setRatings] = useState({});
  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [energy, setEnergy] = useState({});
  const [nps, setNps] = useState(7);
  const [comment, setComment] = useState('');
  const [reflection, setReflection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [surveyAudience, setSurveyAudience] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    try {
      const [tRes, sRes] = await Promise.all([
        api.get('/api/pulse-link/themes', linkParams),
        api.get('/api/pulse-link/active-session', linkParams),
      ]);
      setThemes(tRes.data.themes || []);
      setSession(sRes.data.session);
      setSurveyAudience(sRes.data.surveyAudience ?? null);
      if (!sRes.data.session) {
        setError('Could not start the questionnaire. Please try again later.');
        return;
      }

      const rRes = await api.get('/api/pulse-link/response', linkParams);
      const r = rRes.data.response;
      if (r.step1?.ratings) setRatings(r.step1.ratings);
      if (r.step2?.priorityOrder?.length) setOrder(r.step2.priorityOrder);
      if (r.step3?.energy) setEnergy(r.step3.energy);
      if (typeof r.step4?.nps === 'number') setNps(r.step4.nps);
      if (r.step4?.comment) setComment(r.step4.comment);
      if (r.completedAt) {
        setStep(5);
        if (r.reflection) setReflection(r.reflection);
      } else {
        setStep(Math.min(Math.max(r.currentStep || 1, 1), 4));
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load Pulse.');
    }
  }, [token, linkParams]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveStep(nextStep) {
    if (!session || !token) return;
    setBusy(true);
    setError('');
    try {
      await api.put(
        `/api/pulse-link/response/step/${nextStep}`,
        {
          step1: { ratings },
          step2: { priorityOrder: order },
          step3: { energy },
          step4: { nps, comment },
        },
        linkParams
      );
      setStep(nextStep);
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        '/api/pulse-link/response/complete',
        {
          step1: { ratings },
          step2: { priorityOrder: order },
          step3: { energy },
          step4: { nps, comment },
        },
        linkParams
      );
      setReflection(data.reflection);
      setStep(5);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not complete.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Layout user={null} onLogout={logout} hideHeader>
        <div className="card login-card" style={{ maxWidth: 480, margin: '2rem auto' }}>
          <p className="error">This link is missing a token.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={null} onLogout={logout} hideHeader>
      <div className="login-hero" style={{ marginBottom: '0.5rem' }}>
        <img src={outlierLogo} alt="Outlier" className="login-logo" width={140} height={42} />
      </div>
      <div className="card login-card" style={{ maxWidth: 640, margin: '0 auto 2rem' }}>
        <div className="step-indicator">
          {[1, 2, 3, 4, 5].map((s) => (
            <span key={s} className={`step-dot ${step === s ? 'active' : ''}`} title={`Step ${s}`} />
          ))}
        </div>
        <h1>Pulse questionnaire</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Complete the steps below. You do not need an account.
        </p>
        {!session && error && <p className="error">{error}</p>}
        {!session && !error && (
          <p className="muted">Loading questionnaire…</p>
        )}
        {session && (
          <>
            {session.sessionPurpose === 'link_invite' ? (
              <p className="muted" style={{ marginBottom: '1.25rem' }}>
                {surveyAudience === 'manager'
                  ? 'You’re completing the manager Pulse questionnaire.'
                  : 'You’re completing the Pulse questionnaire.'}
              </p>
            ) : (
              <p className="muted" style={{ marginBottom: '1.25rem' }}>
                Pulse wave: <strong>{session.name}</strong>
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {step === 1 && (
              <Step1WorkFeel themes={themes} ratings={ratings} onChange={setRatings} />
            )}
            {step === 2 && (
              <Step2Priorities themes={themes} order={order} onReorder={setOrder} />
            )}
            {step === 3 && <Step3Energy themes={themes} energy={energy} onChange={setEnergy} />}
            {step === 4 && (
              <Step4Context nps={nps} comment={comment} onNps={setNps} onComment={setComment} />
            )}
            {step === 5 && <Step5Reflection reflection={reflection} />}

            <div className="btn-row">
              {step > 1 && step < 5 && (
                <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              {step < 4 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => saveStep(step + 1)}
                >
                  Continue
                </button>
              )}
              {step === 4 && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={complete}>
                  {busy ? 'Finishing…' : 'Finish & see reflection'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
