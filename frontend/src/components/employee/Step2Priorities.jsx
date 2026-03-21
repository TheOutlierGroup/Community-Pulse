export default function Step2Priorities({ themes, order, onReorder }) {
  const labels = Object.fromEntries(themes.map((t) => [t.id, t.label]));

  function move(idx, dir) {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onReorder(next);
  }

  return (
    <div>
      <p className="pulse-intro">
        When pressure is real, what do you most want around you? Use arrows to rank — top matters
        most.
      </p>
      <ul className="priority-list">
        {order.map((id, idx) => (
          <li key={id} className="priority-item">
            <span className="handle">
              {idx + 1}. {labels[id] || id}
            </span>
            <div className="priority-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Move up"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Move down"
                disabled={idx === order.length - 1}
                onClick={() => move(idx, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
