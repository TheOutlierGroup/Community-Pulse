export const COLUMN_IDS = ['todo', 'working', 'review', 'completed'];

export const COLUMN_META = {
  todo: { title: 'To do' },
  working: { title: 'Working on' },
  review: { title: 'Review' },
  completed: { title: 'Completed' },
};

export function emptyColumns() {
  return {
    todo: [],
    working: [],
    review: [],
    completed: [],
  };
}

export function normalizeStatus(s) {
  if (s === 'open') return 'todo';
  if (s === 'done') return 'completed';
  return COLUMN_IDS.includes(s) ? s : 'todo';
}

export function buildColumnItems(tasks) {
  const m = emptyColumns();
  for (const col of COLUMN_IDS) {
    const arr = tasks
      .filter((t) => normalizeStatus(t.status) === col)
      .sort(
        (a, b) =>
          (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id))
      );
    m[col] = arr.map((t) => String(t.id));
  }
  return m;
}

export function findContainer(id, items) {
  const idStr = String(id);
  if (COLUMN_IDS.includes(idStr)) return idStr;
  for (const col of COLUMN_IDS) {
    if (items[col].includes(idStr)) return col;
  }
  return undefined;
}

export function columnItemsToUpdates(items) {
  const updates = [];
  for (const col of COLUMN_IDS) {
    items[col].forEach((taskId, index) => {
      updates.push({ id: taskId, status: col, position: index });
    });
  }
  return updates;
}
