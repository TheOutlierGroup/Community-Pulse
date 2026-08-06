export default function Step5Reflection({ reflection, surveyCopy = null }) {
  if (!reflection) {
    return <p className="muted">Complete the steps to finish the survey.</p>;
  }
  if (reflection.incomplete) {
    return <p className="error">{reflection.message || 'Please complete all questions first.'}</p>;
  }

  const isManager = reflection.audience === 'manager';
  const completionTitle = isManager ? 'Your survey has been submitted.' : "You're done - thank you!";
  const completionBody = isManager
    ? (surveyCopy?.reflection || 'Thank you for completing the survey.')
    : 'Your responses have been submitted. We really appreciate you taking the time, and your input will make a genuine difference in how staff are supported with change moving forward.';

  return (
    <div className="step5-reflection">
      <p className="step5-thank-you">{completionTitle}</p>
      <p className="step5-thank-you-sub muted">{completionBody}</p>
    </div>
  );
}
