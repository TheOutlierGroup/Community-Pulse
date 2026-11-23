import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import SurveyQuestionStep from '../components/employee/SurveyQuestionStep.jsx';
import Step5Reflection from '../components/employee/Step5Reflection.jsx';
import rhythmEngineLogo from '../images/rhythm-engine-logo.png';
import { normalizePulseStage } from '../utils/pulseStage.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import EmphasisText from '../components/employee/EmphasisText.jsx';
import { missingQuestionIds, missingAnswersMessage } from '../utils/surveyText.js';
import { brandStyleVars, brandUsesLightText } from '../utils/eventModeTheme.js';
import {
  eventSectionHeading,
  answeredProgressPercent,
  EVENT_SURVEY_MINUTES,
  readAnswerDraft,
  writeAnswerDraft,
  clearAnswerDraft,
} from '../utils/eventSurvey.js';
import '../styles/eventMode.css';

const EXPIRED_OR_INVALID_LINK_RE = /invalid or expired link/i;

const PUBLIC_PULSE_LOGO = { width: 176, height: 53 };
const loginHeroBelowLogo = { marginBottom: '2rem' };

function shouldSkipWelcomeIntro(r) {
  if (!r) return true;
  if (r.completedAt) return true;
  if ((r.currentStep || 1) > 1) return true;
  const answers = {
    ...(r.step1?.answers || {}),
    ...(r.step2?.answers || {}),
    ...(r.step3?.answers || {}),
    ...(r.step4?.answers || {}),
  };
  if (Object.keys(answers).length > 0) return true;
  return false;
}

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

export default function PublicPulse() {
  const { stage: stageParam, token } = useParams();
  const stage = stageParam ? normalizePulseStage(stageParam) : null;
  const { logout } = useAuth();
  const linkParams = useMemo(() => {
    const params = { token: token || '' };
    if (stage) params.stage = stage;
    return { params };
  }, [stage, token]);
  const [questions, setQuestions] = useState([]);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({});
  const [reflection, setReflection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [surveyAudience, setSurveyAudience] = useState(null);
  const [surveyCopy, setSurveyCopy] = useState(null);
  const [showWelcomeIntro, setShowWelcomeIntro] = useState(true);
  const [introStartBusy, setIntroStartBusy] = useState(false);
  const [capReached, setCapReached] = useState(false);
  const [brand, setBrand] = useState(null);
  const [eventMode, setEventMode] = useState(null);
  const [missingIds, setMissingIds] = useState([]);
  const [logoFailed, setLogoFailed] = useState(false);
  const cardRef = useRef(null);
  const isEvent = Boolean(eventMode?.active);
  const draftKey = token ? `re-survey-draft:${stage || 'default'}:${token}` : null;
  // RED-069: the survey tab carries the Practitioner's own name where one is
  // configured, otherwise Rhythm Engine; never the platform owner's name.
  // Event mode: the change name (or the client's name) instead.
  useDocumentTitle(
    (isEvent && (eventMode.changeName || eventMode.clientName))
      || String(brand?.displayName || '').trim()
      || 'Rhythm Engine'
  );
  // A client logo that fails to load falls back to the standard mark rather
  // than leaving a broken image and empty space above the card.
  const useClientLogo = isEvent && eventMode.hasLogo && !logoFailed;
  const logoSrc = useClientLogo
    ? `/api/rhythm-engine-link/logo?token=${encodeURIComponent(token || '')}`
    : brand?.logoUrl || rhythmEngineLogo;
  const logoAlt = useClientLogo
    ? `${eventMode.clientName || 'Client'} logo`
    : brand?.displayName || 'Rhythm Engine';
  const themeStyle = isEvent ? brandStyleVars(eventMode.theme) : {};
  const shellClass = isEvent && brandUsesLightText(eventMode.theme) ? 'brand-light-text' : '';

  function handlePossibleCapReached(err) {
    if (err?.response?.data?.capReached) {
      setCapReached(true);
      setError('');
      return true;
    }
    return false;
  }

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    try {
      const [tRes, sRes] = await Promise.all([
        api.get('/api/rhythm-engine-link/themes', linkParams),
        api.get('/api/rhythm-engine-link/active-session', linkParams),
      ]);
      setQuestions(tRes.data.questions || []);
      setSurveyCopy(tRes.data.copy || null);
      setSession(sRes.data.session);
      setSurveyAudience(sRes.data.surveyAudience ?? null);
      setBrand(sRes.data.brand || null);
      setEventMode(sRes.data.eventMode || null);
      if (!sRes.data.session) {
        setError('Could not start the questionnaire. Please try again later.');
        return;
      }

      const rRes = await api.get('/api/rhythm-engine-link/response', linkParams);
      const r = rRes.data.response;
      setSurveyCopy(rRes.data.copy || tRes.data.copy || null);
      const draft = r.completedAt ? {} : readAnswerDraft(draftKey);
      setShowWelcomeIntro(!shouldSkipWelcomeIntro(r) && Object.keys(draft).length === 0);
      // Answers given since the last Continue live only in this tab until
      // the section is saved, so a locked phone or discarded tab used to
      // lose them. Restore them from this tab's draft (server answers win).
      const serverAnswers = extractAnswers(r);
      setAnswers(r.completedAt ? serverAnswers : { ...draft, ...serverAnswers });
      if (r.completedAt) {
        setStep(5);
        if (r.reflection) setReflection(r.reflection);
      } else {
        setStep(Math.min(Math.max(r.currentStep || 1, 1), 4));
      }
    } catch (e) {
      if (handlePossibleCapReached(e)) return;
      setError(e.response?.data?.error || 'Could not load Rhythm Engine.');
    }
  }, [token, linkParams, draftKey]);

  useEffect(() => {
    if (draftKey && Object.keys(answers).length) writeAnswerDraft(draftKey, answers);
  }, [draftKey, answers]);

  function scrollToCardTop() {
    window.setTimeout(() => {
      const el = cardRef.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const top = el.getBoundingClientRect().top + window.scrollY - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 0);
  }

  useEffect(() => {
    load();
  }, [load]);

  function flagMissing(ids, message) {
    setMissingIds(ids);
    setError(message);
    window.setTimeout(() => {
      const el = document.getElementById(`survey-q-${ids[0]}`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  function onAnswer(id, value) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setMissingIds((current) => current.filter((qid) => qid !== id));
  }

  async function saveStep(nextStep) {
    if (!session || !token) return;
    const stepQuestions = questions.slice((step - 1) * 4, step * 4);
    const missing = missingQuestionIds(stepQuestions, answers);
    if (missing.length) {
      flagMissing(missing, `${missingAnswersMessage(missing.length)} They're highlighted below.`);
      return;
    }
    setMissingIds([]);
    setBusy(true);
    setError('');
    try {
      const payload = buildStepPayload(questions, answers);
      await api.put(
        `/api/rhythm-engine-link/response/step/${nextStep}`,
        { ...payload, ...(stage ? { stage } : {}) },
        linkParams
      );
      setStep(nextStep);
      scrollToCardTop();
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!token) return;
    const missing = missingQuestionIds(questions, answers);
    if (missing.length) {
      const firstStep = Math.floor(questions.findIndex((q) => q.id === missing[0]) / 4) + 1;
      if (firstStep >= 1 && firstStep !== step) setStep(firstStep);
      flagMissing(missing, `${missingAnswersMessage(missing.length)} Please answer them before you submit.`);
      return;
    }
    setMissingIds([]);
    setBusy(true);
    setError('');
    try {
      const payload = buildStepPayload(questions, answers);
      const { data } = await api.post(
        '/api/rhythm-engine-link/response/complete',
        { ...payload, ...(stage ? { stage } : {}) },
        linkParams
      );
      setReflection(data.reflection);
      clearAnswerDraft(draftKey);
      scrollToCardTop();
      setStep(5);
    } catch (e) {
      if (handlePossibleCapReached(e)) return;
      setError(e.response?.data?.error || 'Could not complete.');
    } finally {
      setBusy(false);
    }
  }

  async function onWelcomeStart() {
    setIntroStartBusy(true);
    setError('');
    try {
      await api.post('/api/rhythm-engine-link/survey-started', stage ? { stage } : {}, linkParams);
      setShowWelcomeIntro(false);
      scrollToCardTop();
    } catch (e) {
      if (handlePossibleCapReached(e)) return;
      setError(e.response?.data?.error || 'Could not continue.');
    } finally {
      setIntroStartBusy(false);
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

  if (capReached) {
    return (
      <Layout user={null} onLogout={logout} hideHeader>
        <div className="login-hero" style={loginHeroBelowLogo}>
          <img
            src={logoSrc}
            alt={logoAlt}
            className={isEvent ? 'login-logo event-survey__logo' : 'login-logo'}
            onError={useClientLogo ? () => setLogoFailed(true) : undefined}
            width={isEvent ? undefined : PUBLIC_PULSE_LOGO.width}
            height={isEvent ? undefined : PUBLIC_PULSE_LOGO.height}
          />
        </div>
        <div
          className="card login-card"
          style={{ maxWidth: 480, margin: '0 auto 2rem', padding: '2rem 1.75rem', textAlign: 'center' }}
        >
          <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem' }}>Thanks for stopping by</h1>
          <p
            style={{
              margin: 0,
              fontSize: '1.0625rem',
              lineHeight: 1.65,
              color: 'var(--text-primary, #292524)',
            }}
          >
            This Rhythm Engine survey has reached its participant capacity. Please get in touch with
            your project lead if you’d still like to take part.
          </p>
        </div>
      </Layout>
    );
  }

  if (error && EXPIRED_OR_INVALID_LINK_RE.test(error)) {
    return (
      <Layout user={null} onLogout={logout} hideHeader>
        <div className="login-hero" style={loginHeroBelowLogo}>
          <img
            src={logoSrc}
            alt={logoAlt}
            className={isEvent ? 'login-logo event-survey__logo' : 'login-logo'}
            onError={useClientLogo ? () => setLogoFailed(true) : undefined}
            width={isEvent ? undefined : PUBLIC_PULSE_LOGO.width}
            height={isEvent ? undefined : PUBLIC_PULSE_LOGO.height}
          />
        </div>
        <div
          className="card login-card"
          style={{ maxWidth: 440, margin: '0 auto 2rem', padding: '2rem 1.75rem', textAlign: 'center' }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '1.0625rem',
              lineHeight: 1.65,
              color: 'var(--text-primary, #292524)',
            }}
          >
            Sorry, this link has expired. Contact your project lead for a new link.
          </p>
        </div>
      </Layout>
    );
  }

  const eventContextRows = isEvent
    ? [
        ["What's changing", eventMode.changeContext?.whatIsChanging],
        ["Why we're asking you", eventMode.changeContext?.whyAsking],
        ['How your feedback will be used', eventMode.changeContext?.howUsed],
        ["When you'll hear back", eventMode.changeContext?.whenHearBack],
      ].filter(([, value]) => value)
    : [];
  const changeContextBlock = eventContextRows.length ? (
    <dl className="change-context">
      {eventContextRows.map(([label, value]) => (
        <div key={label} className="change-context__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;

  return (
    <Layout user={null} onLogout={logout} hideHeader>
      <div className={shellClass} style={themeStyle}>
      <div className={`login-hero${isEvent ? ' event-survey__hero' : ''}`} style={loginHeroBelowLogo}>
        <img
          src={logoSrc}
          alt={logoAlt}
          className={isEvent ? 'login-logo event-survey__logo' : 'login-logo'}
          onError={useClientLogo ? () => setLogoFailed(true) : undefined}
          width={isEvent ? undefined : PUBLIC_PULSE_LOGO.width}
          height={isEvent ? undefined : PUBLIC_PULSE_LOGO.height}
        />
      </div>
      <div
        ref={cardRef}
        className={`card login-card${isEvent ? ' event-survey' : ''}`}
        style={{ maxWidth: 640, margin: '0 auto 2rem' }}
      >
        {!session && error && <p className="error">{error}</p>}
        {!session && !error && <p className="muted">Loading questionnaire…</p>}

        {session && showWelcomeIntro && isEvent && (
          <div style={{ textAlign: 'center' }}>
            <p className="event-survey__eyebrow">
              <strong>{eventMode.changeName || eventMode.clientName || 'Rhythm Engine'}</strong> · Your feedback
            </p>
            {surveyCopy?.respondentName ? (
              <p className="event-survey__greeting">Welcome, {surveyCopy.respondentName}</p>
            ) : null}
            {surveyCopy?.intro ? <p className="event-survey__intro">{surveyCopy.intro}</p> : null}
            {changeContextBlock}
            {surveyCopy?.welcomeHtml ? (
              <div
                className="event-survey__welcome-extra"
                dangerouslySetInnerHTML={{ __html: surveyCopy.welcomeHtml }}
              />
            ) : null}
            {eventMode.confidentiality ? (
              <p className="event-survey__confidential">
                <EmphasisText text={eventMode.confidentiality} />
              </p>
            ) : null}
            <p className="event-survey__time">
              {questions.length || 16} statements · about {EVENT_SURVEY_MINUTES} minutes
            </p>
            {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
            <div className="btn-row event-survey__start" style={{ justifyContent: 'center', marginTop: '0.25rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={introStartBusy}
                onClick={() => onWelcomeStart()}
              >
                {introStartBusy ? 'Starting…' : 'Start the survey'}
              </button>
            </div>
          </div>
        )}

        {session && showWelcomeIntro && !isEvent && (
          <div style={{ textAlign: 'center' }}>
            <p
              className="muted"
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                margin: '0 0 0.5rem',
              }}
            >
              Rhythm Engine questionnaire
            </p>
            {surveyCopy?.welcomeHtml ? (
              <div
                className="muted"
                style={{ lineHeight: 1.65, margin: '0 0 1.5rem' }}
                dangerouslySetInnerHTML={{ __html: surveyCopy.welcomeHtml }}
              />
            ) : (
              <>
                <p className="muted" style={{ lineHeight: 1.65, margin: '0 0 1rem' }}>
                  {surveyCopy?.intro
                    || 'You’ve been invited to share a short, honest view of how work feels day to day. Most people finish in about five to ten minutes.'}
                </p>
                <p className="muted" style={{ lineHeight: 1.65, margin: '0 0 1.5rem' }}>
                  {surveyAudience === 'manager'
                    ? 'Your perspective as a manager helps leaders see what’s working and what might need attention.'
                    : 'Your answers help leaders understand what’s working and what might need attention.'}
                </p>
              </>
            )}
            {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
            <div className="btn-row" style={{ justifyContent: 'center', marginTop: '0.25rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={introStartBusy}
                onClick={() => onWelcomeStart()}
              >
                {introStartBusy ? 'Starting…' : 'Start'}
              </button>
            </div>
          </div>
        )}

        {session && !showWelcomeIntro && isEvent && (
          <>
            {step <= 4 ? (
              <div
                className="event-survey__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={answeredProgressPercent(answers, questions)}
                aria-label="Survey progress"
              >
                <div
                  className="event-survey__progress-bar"
                  style={{ width: `${answeredProgressPercent(answers, questions)}%` }}
                />
              </div>
            ) : null}
            {step <= 4 && changeContextBlock ? (
              <details className="event-survey__why">
                <summary>Why this survey</summary>
                {changeContextBlock}
              </details>
            ) : null}
            {error && <p className="error">{error}</p>}
            {step >= 1 && step <= 4 && (
              <SurveyQuestionStep
                title={<EmphasisText text={eventSectionHeading(step, questions.length || 16, answers, questions)} />}
                subtitle={surveyCopy?.transition}
                note={step === 3 ? surveyCopy?.halfwayNote : null}
                questions={questions.slice((step - 1) * 4, step * 4)}
                startQuestionNumber={(step - 1) * 4 + 1}
                answers={answers}
                missingIds={missingIds}
                onAnswer={onAnswer}
              />
            )}
            {step === 5 && (
              <Step5Reflection reflection={reflection} surveyCopy={surveyCopy} eventMode={eventMode} />
            )}
            <div className="btn-row">
              {step > 1 && step < 5 && (
                <button type="button" className="btn btn-ghost" onClick={() => {
                    setStep(step - 1);
                    scrollToCardTop();
                  }}>
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
                  {busy ? 'Submitting…' : 'Submit my answers'}
                </button>
              )}
            </div>
          </>
        )}

        {session && !showWelcomeIntro && !isEvent && (
          <>
            <div className="step-indicator">
              {[1, 2, 3, 4, 5].map((s) => (
                <span key={s} className={`step-dot ${step === s ? 'active' : ''}`} title={`Step ${s}`} />
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            {step >= 1 && step <= 4 && (
              <SurveyQuestionStep
                title={`${surveyAudience === 'manager' ? 'Manager' : 'Staff'} survey · Section ${step} of 4`}
                subtitle={surveyCopy?.transition || 'Rate each statement using the 1-5 scale.'}
                questions={questions.slice((step - 1) * 4, step * 4)}
                startQuestionNumber={(step - 1) * 4 + 1}
                answers={answers}
                missingIds={missingIds}
                onAnswer={onAnswer}
              />
            )}
            {step === 5 && <Step5Reflection reflection={reflection} surveyCopy={surveyCopy} />}

            <div className="btn-row">
              {step > 1 && step < 5 && (
                <button type="button" className="btn btn-ghost" onClick={() => {
                    setStep(step - 1);
                    scrollToCardTop();
                  }}>
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
                  {busy ? 'Finishing…' : 'Finished'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {(brand?.supportEmail || brand?.supportUrl) && (
        <footer
          style={{
            maxWidth: 640,
            margin: '0.5rem auto 2rem',
            textAlign: 'center',
            fontSize: '0.85rem',
            color: '#666',
          }}
        >
          Need help with this survey? Contact{' '}
          <strong>{brand?.displayName || 'your provider'}</strong>:{' '}
          {brand?.supportEmail && (
            <a href={`mailto:${brand.supportEmail}`} style={{ color: '#1c1917' }}>
              {brand.supportEmail}
            </a>
          )}
          {brand?.supportEmail && brand?.supportUrl && ' · '}
          {brand?.supportUrl && (
            <a href={brand.supportUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1c1917' }}>
              Help centre
            </a>
          )}
        </footer>
      )}
      {isEvent ? (
        <p className="event-survey__powered">
          Powered by {String(brand?.displayName || '').trim() || 'Rhythm Engine'}
        </p>
      ) : null}
      </div>
    </Layout>
  );
}
