export default function Step5Reflection({ reflection }) {
  if (!reflection) {
    return <p className="muted">Complete the steps to see your reflection.</p>;
  }
  return (
    <div className="step5-reflection">
      <p className="step5-thank-you">Thank you for sharing your thoughts.</p>
      <p className="step5-thank-you-sub muted">
        You’ve just put something real on the record — that kind of honesty helps everyone.
      </p>
      <p className="step5-intro">
        Here’s a little mirror of what you told us: yours to keep, built from your answers — not a generic
        scorecard.
      </p>
      <div className="reflection-box">
        <h2 style={{ marginTop: 0 }}>{reflection.contributionStyle}</h2>
        <p>
          <strong>What helps you thrive:</strong> {reflection.thrive}
        </p>
        <p>
          <strong>Where you may need more support:</strong> {reflection.needsSupport}
        </p>
        <p className="muted">Advocacy signal: {reflection.advocacy}/10</p>
        <p className="step5-closing">{reflection.closingNote}</p>
      </div>
    </div>
  );
}
