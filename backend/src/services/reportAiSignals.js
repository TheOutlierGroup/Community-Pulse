import { REPORT_AI_MODEL, REPORT_AI_TIMEOUT_MS, NEXT_STEPS_DEFAULT_ORDER } from './reportConfig.js';

const FALLBACK = {
  executive:
    'Review the score cards and quadrant classification above for the primary strategic signal. Consult your Outlier Group adviser for a tailored interpretation of these results.',
  adoption:
    'Review the dimension heatmap above to identify the specific Adoption factors requiring attention before programme launch.',
  sponsorship:
    'The dimension breakdown above identifies which aspects of senior sponsorship are most in need of intervention.',
  managerLoad:
    'The load distribution indicates where manager support is required before programme launch.',
  chain:
    'The chain matrix and cross-analysis identify where in the sponsorship architecture intervention is most urgent.',
  teams:
    'Use the team-level breakdown to target enablement at the teams furthest from the readiness threshold rather than treating the org as a single block.',
};

function teamsFallbackText(reportData) {
  const teams = Array.isArray(reportData?.teams) ? reportData.teams : [];
  if (teams.length === 0) return FALLBACK.teams;
  const belowAdoption = teams.filter((t) => t.adoption_status === 'LOW').length;
  const belowSponsorship = teams.filter((t) => t.sponsorship_status === 'LOW').length;
  const belowBoth = teams.filter(
    (t) => t.adoption_status === 'LOW' && t.sponsorship_status === 'LOW',
  );
  if (belowBoth.length === 0 && belowAdoption === 0 && belowSponsorship === 0) {
    return `All ${teams.length} teams sit above the 28/40 readiness threshold on both Adoption and Sponsorship — uniform launch conditions across the org.`;
  }
  const worst = belowBoth[0]
    || teams.slice().sort((a, b) => (a.adoption_score ?? 0) + (a.sponsorship_score ?? 0)
      - ((b.adoption_score ?? 0) + (b.sponsorship_score ?? 0)))[0];
  const worstName = worst?.name ? ` (notably ${worst.name})` : '';
  return `${belowBoth.length} of ${teams.length} teams fall below the readiness threshold on both Adoption and Sponsorship${worstName}; ${belowAdoption} are below on Adoption and ${belowSponsorship} on Sponsorship overall. Sequence enablement against this list rather than treating the org as uniform.`;
}

const SECTION_SYSTEM_PROMPT = `You are a specialist change management analyst writing a signal commentary for a section of a confidential client report.
Your output will be placed in a report delivered to C-suite executives.
Rules:
- Write exactly 2-3 sentences.
- Lead with the most important finding.
- Name specific data points where possible.
- End with one clear implication.
- Respond with prose only.`;

// Dedicated system prompt for the report's "Executive Overview" signal
// box. The section-level prompt above is too short and reads as a sound
// bite; the executive summary needs to do the strategic interpretation
// the rest of the report leaves to the reader.
const EXECUTIVE_SYSTEM_PROMPT = `Generate an executive summary based on the data in this report. Write for a C-suite audience and focus on the 'so what' — the key insights, implications, and strategic meaning behind the data. Your summary must include:
- A clear statement on whether the initiative is 'cleared for launch' or not, based on the evidence.
- A high-level interpretation of the 'messy middle' — summarising the major management, operational, or performance dynamics revealed in the data.
- A concise overview of the 'next steps' section, highlighting only the actions that matter most at an executive level.
The tone should be concise, outcome-focused, and aligned with how an executive summary is typically written.
Respond with prose only.`;

async function callClaude({ apiKey, instruction, payload, systemPrompt = SECTION_SYSTEM_PROMPT, maxTokens = 300 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_AI_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: REPORT_AI_MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `${instruction}\n\nDATA:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Anthropic API failed (${response.status})`);
    }
    const data = await response.json();
    const text = data?.content?.find?.((item) => item.type === 'text')?.text || '';
    return String(text).trim();
  } finally {
    clearTimeout(timeout);
  }
}

function keyFindingsFromData(reportData) {
  const findings = [];
  findings.push(
    `Adoption Readiness is ${reportData.readiness.adoption_score}/40 (${reportData.readiness.adoption_status}).`
  );
  findings.push(
    `Sponsorship Credibility is ${reportData.readiness.sponsorship_score}/40 (${reportData.readiness.sponsorship_status}).`
  );
  const overloaded = reportData.manager.load_distribution.find((band) => band.name === 'Overloaded');
  findings.push(`${overloaded?.percent || 0}% of managers are in the Overloaded load band.`);
  const chainFailed = reportData.manager.sponsorship_chain_distribution.find(
    (state) => state.name === 'Sponsorship Failed at Both Levels'
  );
  findings.push(`${chainFailed?.percent || 0}% of managers are in the failed sponsorship chain state.`);
  findings.push(
    `${reportData.alerts.length} priority alert${reportData.alerts.length === 1 ? '' : 's'} identified for intervention sequencing.`
  );
  return findings.slice(0, 5);
}

function nextStepsOrderFromData(reportData) {
  const order = [...NEXT_STEPS_DEFAULT_ORDER];
  const overloaded = reportData.manager.load_distribution.find((band) => band.name === 'Overloaded')?.percent || 0;
  if (overloaded >= 10) {
    order.splice(order.indexOf('Change Portfolio Review'), 1);
    order.splice(1, 0, 'Change Portfolio Review');
  }
  if (reportData.readiness.sponsorship_score < reportData.readiness.adoption_score) {
    order.splice(order.indexOf('Sponsorship Architecture Review'), 1);
    order.unshift('Sponsorship Architecture Review');
  }
  return order;
}

export async function generateReportSignals(reportData, context = {}) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  const teamsFallback = teamsFallbackText(reportData);
  if (!apiKey) {
    return {
      executive: FALLBACK.executive,
      adoption: FALLBACK.adoption,
      sponsorship: FALLBACK.sponsorship,
      managerLoad: FALLBACK.managerLoad,
      chain: FALLBACK.chain,
      teams: teamsFallback,
      keyFindings: keyFindingsFromData(reportData),
      nextStepsOrder: nextStepsOrderFromData(reportData),
    };
  }

  const nextStepsOrder = nextStepsOrderFromData(reportData);
  const payload = {
    stage: reportData.stage,
    org: reportData.org.name,
    readiness: reportData.readiness,
    dimensions: reportData.dimensions,
    manager: reportData.manager,
    teams: reportData.teams,
    alerts: reportData.alerts.map((alert) => alert.title),
    next_steps_priority_order: nextStepsOrder,
    context,
  };

  const calls = [
    callClaude({
      apiKey,
      systemPrompt: EXECUTIVE_SYSTEM_PROMPT,
      maxTokens: 600,
      instruction:
        'Write the Executive Summary for this Change Readiness Assessment, following the executive-summary system prompt exactly. Use the readiness verdict and quadrant to anchor the launch decision, the manager load, sponsorship chain distribution, and team-level scores to interpret the messy middle, and the next_steps_priority_order to pick the actions that matter most at an executive level.',
      payload,
    }).catch(() => FALLBACK.executive),
    callClaude({
      apiKey,
      instruction:
        'Write an Adoption Readiness signal commentary. Identify the most significant finding and its launch implication.',
      payload,
    }).catch(() => FALLBACK.adoption),
    callClaude({
      apiKey,
      instruction:
        'Write a Sponsorship Credibility signal commentary and identify the leadership intervention needed.',
      payload,
    }).catch(() => FALLBACK.sponsorship),
    callClaude({
      apiKey,
      instruction:
        'Write a Manager Load signal commentary focused on operational risk for launch timing.',
      payload,
    }).catch(() => FALLBACK.managerLoad),
    callClaude({
      apiKey,
      instruction:
        'Write a Sponsorship Chain signal commentary identifying structural pattern and sequence of interventions.',
      payload,
    }).catch(() => FALLBACK.chain),
    callClaude({
      apiKey,
      instruction:
        'Write a Team-Level Breakdown signal commentary. Name the highest-risk teams (lowest combined Adoption + Sponsorship) and recommend the sequencing implication for enablement.',
      payload,
    }).catch(() => teamsFallback),
  ];

  const [executive, adoption, sponsorship, managerLoad, chain, teams] = await Promise.all(calls);

  return {
    executive: executive || FALLBACK.executive,
    adoption: adoption || FALLBACK.adoption,
    sponsorship: sponsorship || FALLBACK.sponsorship,
    managerLoad: managerLoad || FALLBACK.managerLoad,
    chain: chain || FALLBACK.chain,
    teams: teams || teamsFallback,
    keyFindings: keyFindingsFromData(reportData),
    nextStepsOrder,
  };
}
