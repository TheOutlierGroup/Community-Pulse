const LABELS = ['Very hard', 'Hard', 'OK', 'Easy', 'Very easy'];

export default function Step1WorkFeel({ themes, ratings, onChange }) {
  return (
    <div>
      <p className="pulse-intro">
        How do these ways of working feel <strong>day to day</strong>? Slide toward what feels true.
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
