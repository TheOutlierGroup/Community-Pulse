const LABELS = ['Drains me', 'Mostly drains', 'Neutral', 'Energises', 'Really energises'];

export default function Step3Energy({ themes, energy, onChange }) {
  return (
    <div>
      <p className="pulse-intro">
        Same themes — through an <strong>energy</strong> lens. What fuels momentum? What quietly
        drains it?
      </p>
      {themes.map((t) => (
        <div key={t.id} className="theme-row">
          <header>
            <span className="label">{t.label}</span>
            <span className="value">{LABELS[(energy[t.id] ?? 3) - 1]}</span>
          </header>
          <input
            type="range"
            min={1}
            max={5}
            value={energy[t.id] ?? 3}
            onChange={(e) =>
              onChange({ ...energy, [t.id]: parseInt(e.target.value, 10) })
            }
            aria-label={`Energy: ${t.label}`}
          />
        </div>
      ))}
    </div>
  );
}
