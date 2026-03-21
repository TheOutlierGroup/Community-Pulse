function cellColor(val, invert) {
  const v = Math.max(0, Math.min(5, val || 0));
  const t = invert ? (5 - v) / 5 : v / 5;
  const a = 0.15 + t * 0.55;
  return `rgba(61, 214, 198, ${a})`;
}

export default function Heatmap({ rows }) {
  if (!rows?.length) {
    return <p className="muted">Complete responses will populate the heatmap.</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="heatmap-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Theme</th>
            <th>Friction (avg)</th>
            <th>Energy (avg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.theme}>
              <td style={{ textAlign: 'left' }}>{r.theme}</td>
              <td>
                <span
                  className="heatmap-cell"
                  style={{
                    display: 'block',
                    background: cellColor(r.friction, true),
                    color: '#04120f',
                  }}
                >
                  {r.friction?.toFixed(2)}
                </span>
              </td>
              <td>
                <span
                  className="heatmap-cell"
                  style={{
                    display: 'block',
                    background: cellColor(r.energy, false),
                    color: '#04120f',
                  }}
                >
                  {r.energy?.toFixed(2)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
