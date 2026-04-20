import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { CLIENT_SERVICE_PULSE, getPostLoginPath, userHasService } from '../utils/postLogin.js';
import SurveyQuestionStep from '../components/employee/SurveyQuestionStep.jsx';
import Step5Reflection from '../components/employee/Step5Reflection.jsx';

function buildStepPayload(questions, answers) {
  const byStep = [{}, {}, {}, {}];
  questions.forEach((question, idx) => {
    const answer = answers[question.id];
    if (!answer) return;
    const stepIdx = Math.floor(idx / 4);
    byStep[stepIdx][question.id] = answer;
  });
  return {
    step1: { answers: byStep[0] },
    step2: { answers: byStep[1] },
    step3: { answers: byStep[2] },
    step4: { answers: byStep[3] },
  };
}

function extractAnswers(response) {
  return {
    ...(response?.step1?.answers || {}),
    ...(response?.step2?.answers || {}),
    ...(response?.step3?.answers || {}),
    ...(response?.step4?.answers || {}),
  };
}

export default function EmployeePulse() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({});
  const [reflection, setReflection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [tRes, sRes] = await Promise.all([
        api.get('/api/rhythm-engine/themes'),
        api.get('/api/rhythm-engine/active-session'),
      ]);
      setQuestions(tRes.data.questions || []);
      setSession(sRes.data.session);
      if (!sRes.data.session) return;

      const rRes = await api.get('/api/rhythm-engine/response');
      const r = rRes.data.response;
      setAnswers(extractAnswers(r));
      if (r.completedAt) {
        setStep(5);
        if (r.reflection) setReflection(r.reflection);
      } else {
        setStep(Math.min(Math.max(r.currentStep || 1, 1), 4));
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load Rhythm Engine.');
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user && (user.role !== 'employee' || user.organizationKind !== 'client')) {
      navigate(getPostLoginPath(user));
    } else if (user && !userHasService(user, CLIENT_SERVICE_PULSE)) {
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user?.role === 'employee') load();
  }, [user, load]);

  async function saveStep(nextStep) {
    if (!session) return;
    const stepQuestions = questions.slice((step - 1) * 4, step * 4);
    const missing = stepQuestions.some((question) => !answers[question.id]);
    if (missing) {
      setError('Please answer all questions on this page before continuing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = buildStepPayload(questions, answers);
      await api.put(`/api/rhythm-engine/response/step/${nextStep}`, {
        ...payload,
      });
      setStep(nextStep);
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    const missing = questions.some((question) => !answers[question.id]);
    if (missing) {
      setError('Please answer all 16 questions before submitting.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = buildStepPayload(questions, answers);
      const { data } = await api.post('/api/rhythm-engine/response/complete', {
        ...payload,
      });
      setReflection(data.reflection);
      setStep(5);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not complete.');
    } finally {
      setBusy(false);
    }
  }

  if (
    loading ||
    !user ||
    user.role !== 'employee' ||
    user.organizationKind !== 'client' ||
    !userHasService(user, CLIENT_SERVICE_PULSE)
  ) {
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
        <h1>Your Rhythm Engine</h1>
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
            {step >= 1 && step <= 4 && (
              <SurveyQuestionStep
                title={`Section ${step} of 4`}
                subtitle="Rate each statement using the 1-5 scale."
                questions={questions.slice((step - 1) * 4, step * 4)}
                answers={answers}
                onAnswer={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
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
