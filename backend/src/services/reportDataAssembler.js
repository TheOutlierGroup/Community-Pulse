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
import { DASHBOARD_MIN_SAMPLE_SIZE } from './pulseDashboardScope.js';

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

/**
 * PT-01: a dimension breakdown for one audience is only reported when
 * that audience cleared the minimum sample size. REPORT_MIN_RESPONSES
 * gates the report as a whole on the org-wide total, which says nothing
 * about the size of the cohort a given breakdown is actually averaging —
 * 12 staff plus 2 managers clears a floor of 10 while the manager
 * dimension table is still two identifiable people.
 */
function summarizeDimensions(scoredRows, audience, minSampleSize) {
  const audienceRows = scoredRows.filter((entry) => entry.audience === audience);
  const sampleSizeMet = audienceRows.length >= minSampleSize;
  return DIMENSIONS.map((dimension) => {
    const values = audienceRows
      .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
      .filter(Boolean)
      .map((d) => d.average);
    const avg =
      sampleSizeMet && values.length > 0
        ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;
    return {
      id: dimension.id,
      label: dimension.employeeLabel,
      managerLabel: dimension.managerLabel,
      avg,
      sampleSizeMet,
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
  // PT-01: same floor the dashboard enforces, imported rather than
  // redeclared so the two surfaces cannot drift apart again.
  minSampleSize = DASHBOARD_MIN_SAMPLE_SIZE,
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

    // PT-01: every breakdown below is an average over one of these two
    // cohorts, not over filteredRows, so each needs its own floor.
    const employeeSampleSizeMet = employeeRows.length >= minSampleSize;
    const managerSampleSizeMet = managerRows.length >= minSampleSize;

    const dimensionsEmployee = summarizeDimensions(scoredRows, 'staff', minSampleSize);
    const dimensionsManager = summarizeDimensions(scoredRows, 'manager', minSampleSize);

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

    // Team identity comes from the deepest group_level_values entry on
    // an invite (the actual team/department label). When no group values
    // are configured we fall back to the lead manager's display name so
    // the team can still be referenced — never the staff member's own
    // name. This mirrors the dashboard's teamNameFromGroupValues.
    const deriveTeamNameForInvite = (invite) => {
      const groupValues = Array.isArray(invite?.group_level_values)
        ? invite.group_level_values
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
        : [];
      if (groupValues.length > 0) return groupValues[groupValues.length - 1];
      const isManager = String(invite?.survey_role || '').trim() === 'manager';
      const managerName = isManager
        ? String(invite?.display_name || '').trim()
        : String(invite?.manager_display_name || '').trim();
      return managerName || null;
    };

    const teams = [...new Set(linkInviteRows
      .map(deriveTeamNameForInvite)
      .filter(Boolean))];

    // Team-level breakdown — only link-invite respondents carry team
    // affiliation. Each invite is mapped to its team name once, then
    // response rows are grouped by looking up that name via the
    // respondent's own invite_id (managers) or their manager_invite_id
    // (staff). Employee-source rows (no invite linkage) are excluded.
    const inviteIdToTeamName = new Map();
    for (const invite of linkInviteRows) {
      const teamName = deriveTeamNameForInvite(invite);
      if (teamName && invite?.id) {
        inviteIdToTeamName.set(invite.id, teamName);
      }
    }

    const teamGroupMap = new Map();
    const ensureTeam = (name) => {
      if (!teamGroupMap.has(name)) {
        teamGroupMap.set(name, { name, responses: [], managerSelf: null });
      }
      return teamGroupMap.get(name);
    };
    for (const entry of scoredRows) {
      const row = entry.row;
      const teamName = entry.audience === 'manager'
        ? inviteIdToTeamName.get(row.invite_id)
        : inviteIdToTeamName.get(row.manager_invite_id);
      if (!teamName) continue;
      const team = ensureTeam(teamName);
      team.responses.push(entry);
      if (entry.audience === 'manager') {
        team.managerSelf = entry;
      }
    }

    // PT-01: the team table was the sharpest edge of this. It published a
    // named team's adoption, sponsorship and quadrant at any size down to
    // a single response, plus manager_load_band — which is the lead
    // manager's OWN answer, so on a suppressed row it would identify one
    // person outright. Below the floor the row now keeps only its name and
    // counts, so the reader can see a team exists and why it is blank.
    const teamBreakdown = [...teamGroupMap.values()]
      .map((team) => {
        const responses = team.responses;
        const sampleSizeMet = responses.length >= minSampleSize;
        const adoption = sampleSizeMet && responses.length
          ? round1(responses.reduce((sum, e) => sum + e.scored.adoption, 0) / responses.length)
          : null;
        const sponsorship = sampleSizeMet && responses.length
          ? round1(responses.reduce((sum, e) => sum + e.scored.sponsorship, 0) / responses.length)
          : null;
        const teamQuadrant = adoption != null && sponsorship != null
          ? classifyQuadrant(adoption, sponsorship)
          : null;
        const managerLoadScore = sampleSizeMet
          ? team.managerSelf?.scored?.sponsorshipLoadScore ?? null
          : null;
        const managerLoadBand = managerLoadScore != null
          ? scoreBandForSponsorshipLoad(managerLoadScore)
          : null;
        return {
          name: team.name,
          response_count: responses.length,
          employee_count: responses.filter((e) => e.audience === 'staff').length,
          manager_count: responses.filter((e) => e.audience === 'manager').length,
          sample_size_met: sampleSizeMet,
          adoption_score: adoption,
          sponsorship_score: sponsorship,
          // Status labels are a readout of the score, so they must not
          // survive its suppression — a bare 'LOW' on a null score still
          // discloses which side of the threshold the team sits.
          adoption_status:
            adoption == null ? null : adoption >= readinessThreshold ? 'HIGH' : 'LOW',
          sponsorship_status:
            sponsorship == null ? null : sponsorship >= readinessThreshold ? 'HIGH' : 'LOW',
          quadrant: teamQuadrant?.code || null,
          quadrant_label: teamQuadrant?.label || null,
          manager_load_band: managerLoadBand,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const adoptionDimFloor = dimensionsEmployee
      .filter((dimension) => dimension.id.startsWith('1') && dimension.avg != null)
      .sort((a, b) => a.avg - b.avg)[0];
    const sponsorshipDimFloor = dimensionsEmployee
      .filter((dimension) => dimension.id.startsWith('2') && dimension.avg != null)
      .sort((a, b) => a.avg - b.avg)[0];

    const alerts = [];
    // PT-01: this percentage is computed over managerRows. With a manager
    // cohort below the floor it is both unreliable and disclosive — one
    // overloaded manager out of two reads as "50% of managers".
    const overloadedPct = managerSampleSizeMet ? loadPercentages[3] || 0 : 0;
    if (managerSampleSizeMet && overloadedPct >= 10) {
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

    // Hierarchy Levels metric — prefer the actual group level labels the
    // client has configured (e.g. ['Division','Department','Team']) so the
    // cover reflects the team structure they set up. Fall back to the
    // configured count, then the legacy free-text column, then null.
    const groupLevelLabelsCfg = Array.isArray(organization.settings?.groupLevelLabels)
      ? organization.settings.groupLevelLabels
          .map((label) => String(label ?? '').trim())
          .filter(Boolean)
      : [];
    const groupLevelsCount = Number.isInteger(organization.settings?.groupLevels)
      ? organization.settings.groupLevels
      : null;
    let hierarchyLevelsDisplay = null;
    if (groupLevelLabelsCfg.length > 0) {
      hierarchyLevelsDisplay = groupLevelLabelsCfg.join(' → ');
    } else if (groupLevelsCount && groupLevelsCount > 0) {
      hierarchyLevelsDisplay = `${groupLevelsCount} level${groupLevelsCount === 1 ? '' : 's'}`;
    } else if (organization.hierarchy_levels) {
      hierarchyLevelsDisplay = organization.hierarchy_levels;
    }

    return {
    org: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      hierarchy_levels: hierarchyLevelsDisplay,
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
      employee_sample_size_met: employeeSampleSizeMet,
      manager_sample_size_met: managerSampleSizeMet,
      // Both floors are derived from dimensionsEmployee, so they fall away
      // on their own once those averages are suppressed.
      adoption_floor: adoptionDimFloor || null,
      sponsorship_floor: sponsorshipDimFloor || null,
    },
    // PT-01: every field here is an aggregate over managerRows alone.
    // Counts are kept (they explain the suppression and are not scores);
    // percentages and averages are withheld below the floor rather than
    // zeroed, so the renderer can say "insufficient data" instead of
    // showing a confident 0%.
    manager: {
      sample_size_met: managerSampleSizeMet,
      manager_count: managerRows.length,
      min_sample_size: minSampleSize,
      load_distribution: managerLoadBands.map((band, idx) => ({
        name: band,
        count: managerSampleSizeMet ? managerLoadCounts[band] : null,
        percent: managerSampleSizeMet ? loadPercentages[idx] || 0 : null,
      })),
      sponsorship_received_avg: managerSampleSizeMet && managerRows.length
        ? round1(
            managerRows.reduce((sum, entry) => sum + entry.scored.sponsorshipReceivedScore, 0)
            / managerRows.length
          )
        : null,
      sponsorship_capacity_avg: managerSampleSizeMet && managerRows.length
        ? round1(
            managerRows.reduce((sum, entry) => sum + entry.scored.sponsorshipCapacityScore, 0)
            / managerRows.length
          )
        : null,
      sponsorship_chain_distribution: chainStateNames.map((name, idx) => ({
        name,
        count: managerSampleSizeMet ? chainCounts[name] : null,
        percent: managerSampleSizeMet ? chainPercentages[idx] || 0 : null,
      })),
      load_chain_matrix: managerSampleSizeMet
        ? loadChainMatrix
        : loadChainMatrix.map((row) => ({
            loadBand: row.loadBand,
            cells: row.cells.map((cell) => ({ chainState: cell.chainState, count: null })),
          })),
    },
    teams: teamBreakdown,
    suppression: {
      min_sample_size: minSampleSize,
      employee_sample_size_met: employeeSampleSizeMet,
      manager_sample_size_met: managerSampleSizeMet,
      suppressed_team_count: teamBreakdown.filter((team) => !team.sample_size_met).length,
    },
    alerts: alerts.slice(0, 5),
    };
  };
}

export const assembleReportData = createAssembleReportData();
