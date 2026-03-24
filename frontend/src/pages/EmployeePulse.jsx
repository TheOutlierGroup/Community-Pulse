import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { getPostLoginPath } from '../utils/postLogin.js';
import Step1WorkFeel from '../components/employee/Step1WorkFeel.jsx';
import Step2Priorities from '../components/employee/Step2Priorities.jsx';
import Step3Energy from '../components/employee/Step3Energy.jsx';
import Step4Context from '../components/employee/Step4Context.jsx';
import Step5Reflection from '../components/employee/Step5Reflection.jsx';

const DEFAULT_ORDER = [
  'alignment',
  'ownership',
  'collaboration',
  'pace',
  'support',
  'customer',
];

export default function EmployeePulse() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
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

  const load = useCallback(async () => {
    setError('');
    try {
      const [tRes, sRes] = await Promise.all([
        api.get('/api/pulse/themes'),
        api.get('/api/pulse/active-session'),
      ]);
      setThemes(tRes.data.themes || []);
      setSession(sRes.data.session);
      if (!sRes.data.session) return;

      const rRes = await api.get('/api/pulse/response');
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
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user && (user.role !== 'employee' || user.organizationKind !== 'client')) {
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user?.role === 'employee') load();
  }, [user, load]);

  async function saveStep(nextStep) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await api.put(`/api/pulse/response/step/${nextStep}`, {
        step1: { ratings },
        step2: { priorityOrder: order },
        step3: { energy },
        step4: { nps, comment },
      });
      setStep(nextStep);
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/api/pulse/response/complete', {
        step1: { ratings },
        step2: { priorityOrder: order },
        step3: { energy },
        step4: { nps, comment },
      });
      setReflection(data.reflection);
      setStep(5);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not complete.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user || user.role !== 'employee' || user.organizationKind !== 'client') {
    return null;
  }

  return (
    <Layout user={user} onLogout={logout}>
      <div className="card">
        <div className="step-indicator">
          {[1, 2, 3, 4, 5].map((s) => (
            <span key={s} className={`step-dot ${step === s ? 'active' : ''}`} title={`Step ${s}`} />
          ))}
        </div>
        <h1>Your Pulse</h1>
        {!session && (
          <p className="muted">
            There is no active diagnostic right now. Check back when your admin opens a session.
          </p>
        )}
        {session && (
          <>
            <p className="muted" style={{ marginBottom: '1.25rem' }}>
              Session: <strong>{session.name}</strong>
            </p>
            {error && <p className="error">{error}</p>}
            {step === 1 && (
              <Step1WorkFeel themes={themes} ratings={ratings} onChange={setRatings} />
            )}
            {step === 2 && (
              <Step2Priorities themes={themes} order={order} onReorder={setOrder} />
            )}
            {step === 3 && (
              <Step3Energy themes={themes} energy={energy} onChange={setEnergy} />
            )}
            {step === 4 && (
              <Step4Context
                nps={nps}
                comment={comment}
                onNps={setNps}
                onComment={setComment}
              />
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
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={complete}
                >
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
