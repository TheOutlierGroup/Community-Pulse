export default function TensionMap({ tensionPairs, priorities }) {
  return (
    <div>
      {tensionPairs?.length > 0 && (
        <div className="tension-map">
          {tensionPairs.map((t) => (
            <div key={t} className="tension-tile">
              Tension signal
              <strong>{t}</strong>
            </div>
          ))}
        </div>
      )}
      {priorities?.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <h3>Priority votes (top choice)</h3>
          <ul className="muted" style={{ paddingLeft: '1.25rem' }}>
            {priorities.map((p) => (
              <li key={p.id}>
                {p.label}: <strong>{p.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!tensionPairs?.length && !priorities?.length && (
        <p className="muted">More completions will surface tension patterns.</p>
      )}
    </div>
  );
}
