import { READINESS_THRESHOLD } from './pulseEngine.js';

const ALERT_PRIORITY = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function calculateLargestRemainderPercentages(counts) {
  const values = counts.map((count) => Number(count) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const raw = values.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);

  const ranked = raw
    .map((value, idx) => ({ idx, frac: value - Math.floor(value) }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.idx - b.idx;
    });

  for (let i = 0; i < ranked.length && remainder > 0; i += 1) {
    floors[ranked[i].idx] += 1;
    remainder -= 1;
  }

  return floors;
}

function scoreCrossedThreshold(current, previous, threshold) {
  if (current == null || previous == null) return null;
  const isCurrentHigh = current >= threshold;
  const wasPreviousHigh = previous >= threshold;
  if (isCurrentHigh === wasPreviousHigh) return null;
  return isCurrentHigh ? 'up' : 'down';
}

export function buildThresholdCrossingAlerts({
  currentAdoption,
  previousAdoption,
  currentSponsorship,
  previousSponsorship,
  threshold = READINESS_THRESHOLD,
}) {
  const alerts = [];
  const adoptionDirection = scoreCrossedThreshold(currentAdoption, previousAdoption, threshold);
  if (adoptionDirection === 'up') {
    alerts.push({
      level: 'info',
      title: 'Adoption threshold crossed upward',
      body: `Adoption moved from below to above ${threshold} compared with the previous period.`,
    });
  } else if (adoptionDirection === 'down') {
    alerts.push({
      level: 'warning',
      title: 'Adoption threshold crossed downward',
      body: `Adoption moved from above to below ${threshold} compared with the previous period.`,
    });
  }

  const sponsorshipDirection = scoreCrossedThreshold(
    currentSponsorship,
    previousSponsorship,
    threshold
  );
  if (sponsorshipDirection === 'up') {
    alerts.push({
      level: 'info',
      title: 'Sponsorship threshold crossed upward',
      body: `Sponsorship moved from below to above ${threshold} compared with the previous period.`,
    });
  } else if (sponsorshipDirection === 'down') {
    alerts.push({
      level: 'warning',
      title: 'Sponsorship threshold crossed downward',
      body: `Sponsorship moved from above to below ${threshold} compared with the previous period.`,
    });
  }

  return alerts;
}

export function prioritizeAndCapAlerts(alerts, limit = 5) {
  const sorted = [...alerts].sort((a, b) => {
    const aPriority = ALERT_PRIORITY[a.level] ?? 99;
    const bPriority = ALERT_PRIORITY[b.level] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  const capped = sorted.slice(0, Math.max(0, limit));
  return {
    alerts: capped,
    overflowCount: Math.max(0, sorted.length - capped.length),
  };
}

export function verdictForScores(adoption, sponsorship, threshold = READINESS_THRESHOLD) {
  if (adoption == null || sponsorship == null) return 'insufficient_data';
  return adoption >= threshold && sponsorship >= threshold ? 'cleared' : 'not_cleared';
}

export function headlineForVerdict(verdict) {
  if (verdict === 'cleared') return 'Cleared for Launch';
  if (verdict === 'not_cleared') return 'Not Cleared for Launch';
  return 'Insufficient data for launch verdict';
}

export function buildSponsorshipDecliningAlert({
  currentSponsorship,
  previousSponsorship,
  declineThreshold = 1.0,
}) {
  if (currentSponsorship == null || previousSponsorship == null) return [];
  const delta = currentSponsorship - previousSponsorship;
  if (delta < -declineThreshold) {
    return [
      {
        level: 'warning',
        title: 'Sponsorship declining',
        body: `Average sponsorship has dropped ${Math.abs(delta).toFixed(1)} points compared with the previous period.`,
      },
    ];
  }
  return [];
}

export function buildTeamOutlierAlerts({
  byManager,
  orgAdoptionScore,
  orgSponsorshipScore,
  gapThreshold = 8,
  minTeamSize = 5,
}) {
  const alerts = [];
  for (const manager of byManager || []) {
    if ((manager.directReportCompletedCount || 0) < minTeamSize) continue;
    const adoptionGap =
      orgAdoptionScore != null && manager.adoptionScore != null
        ? orgAdoptionScore - manager.adoptionScore
        : null;
    const sponsorshipGap =
      orgSponsorshipScore != null && manager.sponsorshipScore != null
        ? orgSponsorshipScore - manager.sponsorshipScore
        : null;
    const name = manager.managerName || manager.managerEmail || 'Unknown manager';
    if (adoptionGap != null && adoptionGap > gapThreshold) {
      alerts.push({
        level: 'warning',
        title: `Team outlier: ${name}`,
        body: `${name}'s team adoption score is ${adoptionGap.toFixed(1)} points below the org average.`,
      });
    }
    if (sponsorshipGap != null && sponsorshipGap > gapThreshold) {
      alerts.push({
        level: 'warning',
        title: `Team outlier: ${name}`,
        body: `${name}'s team sponsorship score is ${sponsorshipGap.toFixed(1)} points below the org average.`,
      });
    }
  }
  return alerts;
}

export function buildDimensionFloorAlerts({ dimensions, threshold = 2.5 }) {
  const alerts = [];
  for (const dim of dimensions || []) {
    if (dim.energyAvg != null && dim.energyAvg < threshold) {
      alerts.push({
        level: 'warning',
        title: `Dimension floor: ${dim.label}`,
        body: `${dim.label} average is ${dim.energyAvg.toFixed(1)}/5.0 — below the critical threshold of ${threshold}.`,
      });
    }
    if (dim.frictionAvg != null && dim.frictionAvg < threshold) {
      alerts.push({
        level: 'warning',
        title: `Dimension floor: ${dim.managerLabel}`,
        body: `${dim.managerLabel} average is ${dim.frictionAvg.toFixed(1)}/5.0 — below the critical threshold of ${threshold}.`,
      });
    }
  }
  return alerts;
}
