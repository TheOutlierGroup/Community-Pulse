import * as PulseSession from '../models/PulseSession.js';
import * as User from '../models/User.js';
import * as PulseLinkInvite from '../models/PulseLinkInvite.js';
import { listSessionResponses } from './pulseDataContract.js';
import {
  READINESS_THRESHOLD,
  DIMENSIONS,
  classifyQuadrant,
  classifySponsorshipChainState,
  scoreBandForSponsorshipLoad,
  scoreResponseFromSteps,
} from './pulseEngine.js';
import { calculateLargestRemainderPercentages } from './pulseDashboardMetrics.js';
import { REPORT_MIN_RESPONSES, REPORT_STAGE_MAP } from './reportConfig.js';

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function pct(part, total) {
  if (!total) return 0;
  return round1((part / total) * 100);
}

function sessionMatchesStage(session, stagePhase) {
  const purpose = String(session?.session_purpose || '').trim().toLowerCase();
  if (stagePhase === 'pre') return purpose === 'pre_project';
  if (stagePhase === 'completed') return purpose === 'completed_project';
  return purpose === 'during_project' || purpose === 'standard' || purpose === 'link_invite';
}

function rowDateMs(row) {
  const raw = row?.completed_at || row?.updated_at || row?.created_at;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

function rowAudience(row) {
  return row?.role === 'admin' || row?.survey_role === 'manager' ? 'manager' : 'staff';
}

function summarizeDimensions(scoredRows, audience) {
  return DIMENSIONS.map((dimension) => {
    const values = scoredRows
      .filter((entry) => entry.audience === audience)
      .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
      .filter(Boolean)
      .map((d) => d.average);
    const avg = values.length > 0 ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    return {
      id: dimension.id,
      label: dimension.employeeLabel,
      managerLabel: dimension.managerLabel,
      avg,
    };
  });
}

export function createAssembleReportData({
  pulseSessionModel = PulseSession,
  userModel = User,
  pulseLinkInviteModel = PulseLinkInvite,
  listSessionResponsesFn = listSessionResponses,
  reportMinResponses = REPORT_MIN_RESPONSES,
  reportStageMap = REPORT_STAGE_MAP,
  readinessThreshold = READINESS_THRESHOLD,
} = {}) {
  return async function assembleReportData({
    organization,
    stage,
    dateFrom = null,
    dateTo = null,
  }) {
    const stagePhase = reportStageMap[stage];
    const sessions = await pulseSessionModel.listSessionsForOrg(organization.id);
    const stageSessions = sessions.filter((session) => sessionMatchesStage(session, stagePhase));

    const rows = (
      await Promise.all(stageSessions.map((session) => listSessionResponsesFn(session.id)))
    ).flatMap((result) => result.rows || []);

    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() : null;
    const filteredRows = rows.filter((row) => {
      if (!row.completed_at) return false;
      const ts = rowDateMs(row);
      if (ts == null) return false;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });

    if (filteredRows.length < reportMinResponses) {
      const error = new Error(`Minimum ${reportMinResponses} completed responses required`);
      error.code = 'INSUFFICIENT_DATA';
      throw error;
    }

    const scoredRows = filteredRows
      .map((row) => {
        const audience = rowAudience(row);
        const scored = scoreResponseFromSteps(
          row?.step1_data,
          row?.step2_data,
          row?.step3_data,
          row?.step4_data,
          audience
        );
        return { row, audience, scored };
      })
      .filter((entry) => entry.scored.valid);

    const adoptionScore = round1(
      scoredRows.reduce((sum, entry) => sum + entry.scored.adoption, 0) / scoredRows.length
    );
    const sponsorshipScore = round1(
      scoredRows.reduce((sum, entry) => sum + entry.scored.sponsorship, 0) / scoredRows.length
    );
    const quadrant = classifyQuadrant(adoptionScore, sponsorshipScore);

    const employeeRows = scoredRows.filter((entry) => entry.audience === 'staff');
    const managerRows = scoredRows.filter((entry) => entry.audience === 'manager');

    const dimensionsEmployee = summarizeDimensions(scoredRows, 'staff');
    const dimensionsManager = summarizeDimensions(scoredRows, 'manager');

    const managerLoadBands = ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
    const managerLoadCounts = Object.fromEntries(managerLoadBands.map((band) => [band, 0]));
    const chainStateNames = [
      'Chain Functioning',
      'Breaking at Manager Level',
      'Managers Resilient, Under-Supported',
      'Sponsorship Failed at Both Levels',
    ];
    const chainCounts = Object.fromEntries(chainStateNames.map((state) => [state, 0]));
    const matrixCounts = new Map();

    for (const entry of managerRows) {
    const received = entry.scored.sponsorshipReceivedScore;
    const capacity = entry.scored.sponsorshipCapacityScore;
    const load = entry.scored.sponsorshipLoadScore;
    const loadBand = scoreBandForSponsorshipLoad(load);
    const chainState = classifySponsorshipChainState(received, capacity);
    managerLoadCounts[loadBand] += 1;
    chainCounts[chainState] += 1;
    const key = `${loadBand}::${chainState}`;
    matrixCounts.set(key, (matrixCounts.get(key) || 0) + 1);
    }

    const loadPercentages = calculateLargestRemainderPercentages(
      managerLoadBands.map((band) => managerLoadCounts[band])
    );
    const chainPercentages = calculateLargestRemainderPercentages(
      chainStateNames.map((state) => chainCounts[state])
    );

    const loadChainMatrix = managerLoadBands.map((loadBand) => ({
      loadBand,
      cells: chainStateNames.map((chainState) => ({
        chainState,
        count: matrixCounts.get(`${loadBand}::${chainState}`) || 0,
      })),
    }));

    const inviteCounts = await userModel.countActiveUsersByRoleForOrg(organization.id);
    const linkInviteRows = await pulseLinkInviteModel.listInviteRowsForOrg(organization.id, {
      timepointPhase: stagePhase,
    });
    const linkStaffInvites = linkInviteRows.filter((row) => row.survey_role !== 'manager').length;
    const linkManagerInvites = linkInviteRows.filter((row) => row.survey_role === 'manager').length;
    const invitedEmployees = inviteCounts.employee + linkStaffInvites;
    const invitedManagers = inviteCounts.admin + linkManagerInvites;
    const invitedTotal = invitedEmployees + invitedManagers;
    const responseRate = invitedTotal > 0 ? pct(filteredRows.length, invitedTotal) : null;

    const teams = [...new Set(linkInviteRows
      .map((row) => String(row.manager_display_name || '').trim())
      .filter(Boolean))];

    const adoptionDimFloor = dimensionsEmployee
      .filter((dimension) => dimension.id.startsWith('1') && dimension.avg != null)
      .sort((a, b) => a.avg - b.avg)[0];
    const sponsorshipDimFloor = dimensionsEmployee
      .filter((dimension) => dimension.id.startsWith('2') && dimension.avg != null)
      .sort((a, b) => a.avg - b.avg)[0];

    const alerts = [];
    const overloadedPct = loadPercentages[3] || 0;
    if (overloadedPct >= 10) {
      alerts.push({
        severity: 'CRITICAL',
        title: 'Manager Overload',
        description: `${overloadedPct}% of managers are in the Overloaded band.`,
      });
    }
    if (sponsorshipDimFloor && sponsorshipDimFloor.avg < 3) {
      alerts.push({
        severity: 'WARNING',
        title: `Dimension Floor: ${sponsorshipDimFloor.label}`,
        description: `${sponsorshipDimFloor.label} is at ${sponsorshipDimFloor.avg}/5.0 and requires intervention.`,
      });
    }
    if (sponsorshipScore < readinessThreshold) {
      alerts.push({
        severity: 'THRESHOLD',
        title: 'Sponsorship Below Readiness Threshold',
        description: `Sponsorship is ${sponsorshipScore}/40 (threshold ${readinessThreshold}).`,
      });
    }
    if (adoptionScore >= readinessThreshold) {
      alerts.push({
        severity: 'POSITIVE',
        title: 'Adoption Readiness Above Threshold',
        description: `Adoption is ${adoptionScore}/40 and can support change momentum.`,
      });
    }

    return {
    org: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      hierarchy_levels: organization.hierarchy_levels || null,
      report_contact: organization.report_contact || null,
    },
    stage,
    generated_at: new Date().toISOString(),
    totals: {
      responses: filteredRows.length,
      invited: invitedTotal,
      response_rate: responseRate,
      employee_count: employeeRows.length,
      employee_pct: pct(employeeRows.length, filteredRows.length),
      manager_count: managerRows.length,
      manager_pct: pct(managerRows.length, filteredRows.length),
      teams_in_scope: teams.length ? teams.join(', ') : 'Not available',
    },
    readiness: {
      adoption_score: adoptionScore,
      sponsorship_score: sponsorshipScore,
      adoption_status: adoptionScore >= readinessThreshold ? 'HIGH' : 'LOW',
      sponsorship_status: sponsorshipScore >= readinessThreshold ? 'HIGH' : 'LOW',
      quadrant: quadrant.code,
      quadrant_label: quadrant.label,
      verdict: adoptionScore >= readinessThreshold && sponsorshipScore >= readinessThreshold
        ? 'CLEARED FOR LAUNCH'
        : 'NOT CLEARED FOR LAUNCH',
    },
    dimensions: {
      employee: dimensionsEmployee,
      manager: dimensionsManager,
      adoption_floor: adoptionDimFloor || null,
      sponsorship_floor: sponsorshipDimFloor || null,
    },
    manager: {
      load_distribution: managerLoadBands.map((band, idx) => ({
        name: band,
        count: managerLoadCounts[band],
        percent: loadPercentages[idx] || 0,
      })),
      sponsorship_received_avg: managerRows.length
        ? round1(
            managerRows.reduce((sum, entry) => sum + entry.scored.sponsorshipReceivedScore, 0)
            / managerRows.length
          )
        : null,
      sponsorship_capacity_avg: managerRows.length
        ? round1(
            managerRows.reduce((sum, entry) => sum + entry.scored.sponsorshipCapacityScore, 0)
            / managerRows.length
          )
        : null,
      sponsorship_chain_distribution: chainStateNames.map((name, idx) => ({
        name,
        count: chainCounts[name],
        percent: chainPercentages[idx] || 0,
      })),
      load_chain_matrix: loadChainMatrix,
    },
    alerts: alerts.slice(0, 5),
    };
  };
}

export const assembleReportData = createAssembleReportData();
