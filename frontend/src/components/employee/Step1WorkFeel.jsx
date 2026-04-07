const LABELS = ['Very hard', 'Hard', 'OK', 'Easy', 'Very easy'];

export default function Step1WorkFeel({ themes, ratings, onChange }) {
  return (
    <div>
      <div className="step1-intro">
        <p className="step1-intro-lead">
          How do these ways of working feel <strong>day to day</strong>?
        </p>
        <p className="step1-intro-hint muted">Slide toward what feels true.</p>
      </div>
      <p className="step1-scale-legend muted">
        <span>Very hard — feels draining or difficult</span>
        <span>Very easy — feels light or sustainable</span>
      </p>
      {themes.map((t) => (
        <div key={t.id} className="theme-row">
          <header>
            <span className="label">{t.label}</span>
            <span className="value">{LABELS[(ratings[t.id] ?? 3) - 1]}</span>
          </header>
          <input
            type="range"
            min={1}
            max={5}
            value={ratings[t.id] ?? 3}
            onChange={(e) =>
              onChange({ ...ratings, [t.id]: parseInt(e.target.value, 10) })
            }
            aria-label={t.label}
          />
        </div>
      ))}
    </div>
  );
}
