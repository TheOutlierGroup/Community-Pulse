export default function Step5Reflection({ reflection, surveyCopy = null, eventMode = null }) {
  if (!reflection) {
    return <p className="muted">Complete the steps to finish the survey.</p>;
  }
  if (reflection.incomplete) {
    return <p className="error">{reflection.message || 'Please complete all questions first.'}</p>;
  }

  if (eventMode?.active) {
    const howUsed = eventMode.changeContext?.howUsed;
    const whenHearBack = eventMode.changeContext?.whenHearBack;
    return (
      <div className="step5-reflection">
        <p className="step5-thank-you">
          <strong>Thank you. Your answers are in.</strong>
        </p>
        {howUsed || whenHearBack ? (
          <dl className="change-context event-survey__next">
            {howUsed ? (
              <div className="change-context__row">
                <dt>What happens next</dt>
                <dd>{howUsed}</dd>
              </div>
            ) : null}
            {whenHearBack ? (
              <div className="change-context__row">
                <dt>You&apos;ll hear back</dt>
                <dd>
                  <strong>{whenHearBack}</strong>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="step5-thank-you-sub muted">{surveyCopy?.reflection}</p>
        )}
      </div>
    );
  }

  const isManager = reflection.audience === 'manager';
  const completionTitle = isManager ? 'Your survey has been submitted.' : "You're done - thank you!";
  // Staff and managers both get the stage-specific message (pre, mid or
  // post); staff previously always saw one fixed message whatever the stage.
  const completionBody = surveyCopy?.reflection
    || (isManager
      ? 'Thank you for completing the survey.'
      : 'Your responses have been submitted. We really appreciate you taking the time, and your input will make a genuine difference in how staff are supported with change moving forward.');

  return (
    <div className="step5-reflection">
      <p className="step5-thank-you">{completionTitle}</p>
      <p className="step5-thank-you-sub muted">{completionBody}</p>
    </div>
  );
}
