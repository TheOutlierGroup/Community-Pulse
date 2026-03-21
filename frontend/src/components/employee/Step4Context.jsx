export default function Step4Context({ nps, comment, onNps, onComment }) {
  return (
    <div>
      <p className="pulse-intro">
        How likely are you to recommend this place as somewhere to work? Then add a line of context
        — numbers plus story.
      </p>
      <div className="theme-row">
        <header>
          <span className="label">Likelihood (0–10)</span>
          <span className="value">{nps}</span>
        </header>
        <input
          type="range"
          min={0}
          max={10}
          value={nps}
          onChange={(e) => onNps(parseInt(e.target.value, 10))}
          aria-label="Recommendation score"
        />
      </div>
      <div className="field" style={{ marginTop: '1rem' }}>
        <label htmlFor="comment">What sits behind that score?</label>
        <textarea
          id="comment"
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          placeholder="Optional — honest signals help leaders see patterns."
        />
      </div>
    </div>
  );
}
