/**
 * Team progress across checkpoints: each team's Adoption and Sponsorship
 * score at every checkpoint where its result is reported, plus a straight
 * line of best fit (least squares over checkpoint order) to show whether it
 * is rising or falling. Pure, so it runs under `node --test`.
 *
 * Teams below the minimum group size at a checkpoint arrive with null
 * scores from the dashboard API (already withheld for confidentiality), so
 * they simply have no point there.
 */

/** Change per checkpoint (in points) above which a trend counts as moving. */
export const TREND_FLAT_BAND = 0.5;

/** Team rows from one dashboard payload, reported teams only. */
export function teamsFromDashboard(payload) {
  const rows = Array.isArray(payload?.byManager) ? payload.byManager : [];
  return rows
    .filter((row) => row && row.sampleSizeMet !== false)
    .map((row) => ({
      key: String(row.managerEmail || row.managerId || row.teamName || '').trim().toLowerCase(),
      label: String(row.teamName || row.managerName || row.managerEmail || 'Team').trim(),
      adoption: Number.isFinite(row.adoptionScore) ? row.adoptionScore : null,
      sponsorship: Number.isFinite(row.sponsorshipScore) ? row.sponsorshipScore : null,
    }))
    .filter((row) => row.key && (row.adoption != null || row.sponsorship != null));
}

/** Least-squares line through (x, y) points; null with fewer than two x values. */
export function lineOfBestFit(points) {
  const list = (Array.isArray(points) ? points : []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  );
  if (new Set(list.map((p) => p.x)).size < 2) return null;
  const n = list.length;
  const meanX = list.reduce((s, p) => s + p.x, 0) / n;
  const meanY = list.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of list) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, at: (x) => intercept + slope * x };
}

export function trendDirection(slope) {
  if (!Number.isFinite(slope)) return 'none';
  if (slope >= TREND_FLAT_BAND) return 'rising';
  if (slope <= -TREND_FLAT_BAND) return 'falling';
  return 'flat';
}

/**
 * Builds per-team series for one measure ('adoption' or 'sponsorship')
 * across ordered checkpoints.
 *
 * @param {{ key: string, label: string, teams: object[] }[]} stages ordered checkpoints
 * @returns {{ key, label, points: {x, y, stage}[], fit, direction, change }[]}
 */
export function buildTeamSeries(stages, measure) {
  const list = Array.isArray(stages) ? stages : [];
  const byTeam = new Map();
  list.forEach((stage, x) => {
    for (const team of stage?.teams || []) {
      const y = team?.[measure];
      if (!Number.isFinite(y)) continue;
      if (!byTeam.has(team.key)) byTeam.set(team.key, { key: team.key, label: team.label, points: [] });
      const entry = byTeam.get(team.key);
      entry.label = team.label || entry.label;
      entry.points.push({ x, y, stage: stage.label });
    }
  });
  return [...byTeam.values()]
    .map((team) => {
      const fit = lineOfBestFit(team.points);
      return {
        ...team,
        fit,
        direction: fit ? trendDirection(fit.slope) : 'none',
        change: fit ? Math.round(fit.slope * 10) / 10 : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
