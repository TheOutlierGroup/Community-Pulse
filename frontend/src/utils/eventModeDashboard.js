/**
 * Event mode dashboard wording and list limits (approved 23 Nov 2026, see
 * EVENT_MODE_WORDING.md, Part F). Pure, so it runs under
 * `node --test`.
 */

/** Rows shown before "View all" on any team list in Event mode. */
export const EVENT_LIST_LIMIT = 5;

export const EVENT_QUADRANT_COPY = {
  Optimal: {
    subtitle: 'People feel ready and see senior leaders backing the change.',
    action: 'Proceed, and keep leaders visible.',
  },
  'Motivated but Lost': {
    subtitle: "People feel ready, but don't yet see senior leaders backing the change.",
    action: 'Strengthen leadership support before rollout.',
  },
  'Capable but Wary': {
    subtitle: "People trust senior leaders, but don't feel ready yet.",
    action: 'Build capacity and support before rollout.',
  },
  'High Risk': {
    subtitle: "People don't feel ready, and don't yet trust senior leaders to back the change.",
    action: 'Rethink the plan before going further.',
  },
};

/** Post stage: the change has happened, so actions look to the next one. */
export const EVENT_QUADRANT_POST_ACTIONS = {
  Optimal: 'Lock in what worked, and keep leaders visible.',
  'Motivated but Lost': 'Rebuild leadership follow-through before the next change.',
  'Capable but Wary': 'Address capacity and support before the next change.',
  'High Risk': 'Review what went wrong before the next change.',
};

/** Keyed by the backend chain-state names. */
export const EVENT_CHAIN_COPY = {
  'Chain Functioning': 'Managers are getting support from senior leaders, and have the capacity to pass it on.',
  'Breaking at Manager Level': "Managers are getting support from above, but don't have the capacity to pass it on.",
  'Managers Resilient, Under-Supported': "Managers are coping, but aren't getting enough support from senior leaders.",
  'Sponsorship Failed at Both Levels': "Managers aren't supported from above, and don't have capacity to support their teams.",
};

export const EVENT_LOAD_COPY = {
  Sustainable: 'Managers can absorb this change.',
  Stretched: 'Managers are coping, with little room to spare.',
  'At Capacity': 'Managers have no room left for extra work.',
  Overloaded: 'Managers are taking on more than they can sustain.',
};

export const EVENT_HEADINGS = {
  likelihood: 'How likely is this change to succeed?',
  heatmap: 'Staff and managers compared, by theme',
  teams: 'Results by team',
};

const CHAIN_RISK = {
  'Sponsorship Failed at Both Levels': 0,
  'Breaking at Manager Level': 1,
  'Managers Resilient, Under-Supported': 2,
  'Chain Functioning': 3,
};

const LOAD_RISK = { Overloaded: 0, 'At Capacity': 1, Stretched: 2, Sustainable: 3 };

function num(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Manager-view team rows ordered most at risk first: worst chain state,
 * then heaviest load, then lowest capacity. Rows withheld for
 * confidentiality (no chain state) go last.
 */
export function rankChainRowsByRisk(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  return list.sort((a, b) => {
    const ra = a?.chainState == null ? 99 : CHAIN_RISK[a.chainState] ?? 50;
    const rb = b?.chainState == null ? 99 : CHAIN_RISK[b.chainState] ?? 50;
    if (ra !== rb) return ra - rb;
    const la = LOAD_RISK[a?.loadBand] ?? 50;
    const lb = LOAD_RISK[b?.loadBand] ?? 50;
    if (la !== lb) return la - lb;
    const ca = num(a?.capacityAvg) ?? Infinity;
    const cb = num(b?.capacityAvg) ?? Infinity;
    return ca - cb;
  });
}

/** Lower is riskier: the weaker of a group's adoption and sponsorship scores. */
function groupRiskScore(row) {
  const values = [num(row?.adoption), num(row?.sponsorship)].filter((v) => v != null);
  return values.length ? Math.min(...values) : Infinity;
}

/**
 * Team-level (grouped) rows for Event mode: top-level groups ordered most at
 * risk first and limited to `limit`, each followed by whichever of its
 * descendants are currently expanded (same order as the input).
 *
 * @param {object[]} visibleRows rows already filtered to expanded branches
 * @returns {{ rows: object[], totalGroups: number }}
 */
export function limitGroupedRowsByRisk(visibleRows, { limit = EVENT_LIST_LIMIT, showAll = false } = {}) {
  const list = Array.isArray(visibleRows) ? visibleRows : [];
  const byKey = new Map(list.map((row) => [row.key, row]));
  const rootOf = (row) => {
    let current = row;
    while (current?.parentKey && byKey.has(current.parentKey)) current = byKey.get(current.parentKey);
    return current?.key;
  };
  const roots = list.filter((row) => !row.parentKey || !byKey.has(row.parentKey));
  const rankedRoots = [...roots].sort((a, b) => groupRiskScore(a) - groupRiskScore(b));
  const keptRoots = showAll ? rankedRoots : rankedRoots.slice(0, limit);
  const order = new Map(keptRoots.map((row, index) => [row.key, index]));
  const rows = list
    .filter((row) => order.has(rootOf(row)))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => order.get(rootOf(a.row)) - order.get(rootOf(b.row)) || a.index - b.index)
    .map(({ row }) => row);
  return { rows, totalGroups: roots.length };
}
