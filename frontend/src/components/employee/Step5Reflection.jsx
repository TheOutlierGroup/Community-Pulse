export default function Step5Reflection({ reflection, surveyCopy = null }) {
  if (!reflection) {
    return <p className="muted">Complete the steps to see your reflection.</p>;
  }
  if (reflection.incomplete) {
    return <p className="error">{reflection.message || 'Please complete all questions first.'}</p>;
  }

  const isManager = reflection.audience === 'manager';

  return (
    <div className="step5-reflection">
      <p className="step5-thank-you">Your survey has been submitted.</p>
      <p className="step5-thank-you-sub muted">
        {surveyCopy?.reflection || 'Scores are calculated instantly from your 16 responses.'}
      </p>
      <div className="reflection-box">
        <h2 style={{ marginTop: 0 }}>{reflection.quadrant}</h2>
        <p>
          <strong>Adoption Readiness:</strong> {reflection.adoptionScore}/40
        </p>
        <p>
          <strong>Sponsorship Credibility:</strong> {reflection.sponsorshipScore}/40
        </p>
        {isManager ? (
          <p>
            <strong>Manager Load:</strong> {reflection.managerLoadScore}/20 ({reflection.managerLoadBand})
          </p>
        ) : null}
        <p className="step5-closing">{reflection.recommendation}</p>
        {Array.isArray(reflection.dimensions) && reflection.dimensions.length ? (
          <div style={{ marginTop: 12 }}>
            {reflection.dimensions.map((dimension) => (
              <p key={dimension.id} className="muted" style={{ margin: '4px 0' }}>
                {dimension.id} · {dimension.label}: {dimension.score}/10
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
