import { useEffect, useMemo, useRef, useState } from 'react';
import EmphasisText from './EmphasisText.jsx';
import { SURVEY_SCALE, missingQuestionIds } from '../../utils/surveyText.js';
import { EVENT_SURVEY_MINUTES } from '../../utils/eventSurvey.js';

const AUTO_ADVANCE_MS = 380;

function sectionLabel(index, audience) {
  if (audience === 'manager') return index < 8 ? 'Leading your team' : 'Senior leadership support';
  return index < 8 ? 'Your readiness' : 'Leadership support';
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

/**
 * Event mode respondent survey, built for phones: one statement per
 * screen, a tap saves and moves on, the header and progress stay in view,
 * and Back / Next sit in a bottom bar.
 */
export default function EventSurveyFlow({
  eventMode,
  surveyCopy,
  surveyAudience,
  questions,
  answers,
  initialScreen,
  onAnswer,
  onSaveProgress,
  onStart,
  startBusy,
  onComplete,
  busy,
  error,
  done,
  logoSrc,
  showLogo,
  onLogoError,
  poweredBy,
}) {
  const total = questions.length || 16;
  const [screen, setScreen] = useState(done ? 'done' : initialScreen);
  const [savedCue, setSavedCue] = useState(false);
  const bodyRef = useRef(null);
  const advanceTimer = useRef(null);

  useEffect(() => {
    if (done) setScreen('done');
  }, [done]);

  // Every new screen starts at its top, with the header and progress in view.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    window.scrollTo({ top: 0 });
    setSavedCue(false);
  }, [screen]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const answeredCount = useMemo(() => questions.filter((q) => answers[q.id]).length, [questions, answers]);
  const progress = screen === 'done' ? 100 : Math.round((answeredCount / total) * 100);
  const changeName = eventMode.changeName || eventMode.clientName || 'Your feedback';
  const context = eventMode.changeContext || {};
  const contextRows = [
    [eventMode.stage === 'post' ? 'What changed' : "What's changing", context.whatIsChanging],
    ["Why we're asking you", context.whyAsking],
    ['How your feedback will be used', context.howUsed],
    ["When you'll hear back", context.whenHearBack],
  ].filter(([, value]) => value);

  async function start() {
    const ok = await onStart();
    if (ok === false) return;
    const missing = missingQuestionIds(questions, answers);
    const firstOpen = missing.length ? questions.findIndex((q) => q.id === missing[0]) : 0;
    setScreen(Math.max(0, firstOpen));
  }

  function choose(index, value) {
    const question = questions[index];
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    onAnswer(question.id, value);
    onSaveProgress(next, Math.floor(index / 4) + 1);
    setSavedCue(true);
    window.clearTimeout(advanceTimer.current);
    if (index < total - 1) {
      advanceTimer.current = window.setTimeout(() => {
        setScreen((current) => (current === index ? index + 1 : current));
      }, AUTO_ADVANCE_MS);
    }
  }

  async function submit() {
    const missing = missingQuestionIds(questions, answers);
    if (missing.length) {
      setScreen(questions.findIndex((q) => q.id === missing[0]));
      return;
    }
    await onComplete();
  }

  const subtitle =
    screen === 'welcome'
      ? `Your feedback · about ${EVENT_SURVEY_MINUTES} minutes`
      : screen === 'done'
        ? 'Submitted'
        : `Statement ${screen + 1} of ${total}`;

  let body;
  let foot = null;

  if (screen === 'welcome') {
    body = (
      <>
        <div className="evs-hero">
          {showLogo ? <img className="evs-hero__logo" src={logoSrc} alt="" onError={onLogoError} /> : null}
          <p className="evs-eyebrow">{changeName} · Your feedback</p>
          <h1 className="evs-hero__title">
            {surveyCopy?.respondentName ? `Welcome, ${surveyCopy.respondentName}` : 'Welcome'}
          </h1>
          {surveyCopy?.intro ? <p className="evs-hero__intro">{surveyCopy.intro}</p> : null}
          {eventMode.teamName ? (
            <span className="evs-team">
              <i aria-hidden="true" />
              {eventMode.teamName}
            </span>
          ) : null}
        </div>
        {eventMode.confidentiality ? (
          <div className="evs-conf">
            <LockIcon />
            <p>
              <EmphasisText text={eventMode.confidentiality} />
            </p>
          </div>
        ) : null}
        <div className="evs-facts">
          <div>
            <b>{total}</b>statements
          </div>
          <div>
            <b>{EVENT_SURVEY_MINUTES} min</b>to finish
          </div>
          <div>
            <b>1 tap</b>per answer
          </div>
        </div>
        {contextRows.map(([label, value], n) => (
          <details key={label} className="evs-ctx" open={n === 0}>
            <summary>{label}</summary>
            <p>{value}</p>
          </details>
        ))}
        {surveyCopy?.welcomeHtml ? (
          <div className="evs-extra" dangerouslySetInnerHTML={{ __html: surveyCopy.welcomeHtml }} />
        ) : null}
        {error ? <p className="evs-error">{error}</p> : null}
      </>
    );
    foot = (
      <button type="button" className="evs-btn evs-btn--primary" disabled={startBusy} onClick={start}>
        {startBusy ? 'Starting…' : 'Start the survey'}
      </button>
    );
  } else if (screen === 'done') {
    body = (
      <>
        <div className="evs-done">
          <div className="evs-done__tick">
            <TickIcon />
          </div>
          <h1 className="evs-done__title">Thank you. Your answers are in.</h1>
          <p className="evs-muted">You can close this page.</p>
        </div>
        {context.howUsed || context.whenHearBack ? (
          <dl className="evs-next">
            {context.howUsed ? (
              <>
                <dt>What happens next</dt>
                <dd>{context.howUsed}</dd>
              </>
            ) : null}
            {context.whenHearBack ? (
              <>
                <dt>You&apos;ll hear back</dt>
                <dd>
                  <b>{context.whenHearBack}</b>
                </dd>
              </>
            ) : null}
          </dl>
        ) : surveyCopy?.reflection ? (
          <p className="evs-muted">{surveyCopy.reflection}</p>
        ) : null}
        {eventMode.closingNote ? <div className="evs-closing">{eventMode.closingNote}</div> : null}
      </>
    );
  } else {
    const index = screen;
    const question = questions[index];
    const selected = question ? answers[question.id] : null;
    const isLast = index === total - 1;
    body = question ? (
      <>
        {index === 8 && surveyCopy?.halfwayNote ? (
          <div className="evs-half">
            <EmphasisText text={surveyCopy.halfwayNote} />
          </div>
        ) : null}
        <p className="evs-qnum">{sectionLabel(index, surveyAudience)}</p>
        <p className="evs-qtext" id={`evs-q-${question.id}`}>
          <EmphasisText text={question.text} />
        </p>
        <div className="evs-scale" role="radiogroup" aria-labelledby={`evs-q-${question.id}`}>
          {SURVEY_SCALE.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected === option.value}
              className="evs-opt"
              onClick={() => choose(index, option.value)}
            >
              <span className="evs-opt__n">{option.value}</span>
              {option.label}
            </button>
          ))}
        </div>
        <p className="evs-saved" aria-live="polite">
          {selected && savedCue ? 'Saved' : ''}
        </p>
        {error ? <p className="evs-error">{error}</p> : null}
      </>
    ) : null;
    foot = (
      <>
        <button
          type="button"
          className="evs-btn evs-btn--ghost"
          onClick={() => setScreen(index === 0 ? 'welcome' : index - 1)}
        >
          Back
        </button>
        <button
          type="button"
          className="evs-btn evs-btn--primary"
          disabled={!selected || busy}
          onClick={() => (isLast ? submit() : setScreen(index + 1))}
        >
          {isLast ? (busy ? 'Submitting…' : 'Submit my answers') : 'Next'}
        </button>
      </>
    );
  }

  // The survey runs edge to edge like an app, so drop the page wrapper's
  // padding while it is on screen.
  useEffect(() => {
    document.body.classList.add('evs-page');
    return () => document.body.classList.remove('evs-page');
  }, []);

  return (
    <div className="evs">
      <header className="evs-top">
        {showLogo ? <img className="evs-top__logo" src={logoSrc} alt="" onError={onLogoError} /> : null}
        <div className="evs-top__text">
          <b>{changeName}</b>
          <span>{subtitle}</span>
        </div>
      </header>
      {screen !== 'welcome' ? (
        <div
          className="evs-prog"
          role="progressbar"
          aria-label="Survey progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <main className="evs-body" ref={bodyRef}>
        {body}
        {screen === 'done' ? <p className="evs-powered">Powered by {poweredBy}</p> : null}
      </main>
      {foot ? <footer className="evs-foot">{foot}</footer> : null}
    </div>
  );
}
