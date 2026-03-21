export default function Step5Reflection({ reflection }) {
  if (!reflection) {
    return <p className="muted">Complete the steps to see your reflection.</p>;
  }
  return (
    <div>
      <p className="pulse-intro">Here is something useful back — personal, not extractive.</p>
      <div className="reflection-box">
        <h2 style={{ marginTop: 0 }}>{reflection.contributionStyle}</h2>
        <p>
          <strong>What helps you thrive:</strong> {reflection.thrive}
        </p>
        <p>
          <strong>Where you may need more support:</strong> {reflection.needsSupport}
        </p>
        <p className="muted">Advocacy signal: {reflection.advocacy}/10</p>
        <p>{reflection.closingNote}</p>
      </div>
    </div>
  );
}
