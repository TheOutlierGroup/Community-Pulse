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
};

const SYSTEM_PROMPT = `You are a specialist change management analyst writing a signal commentary for a section of a confidential client report.
Your output will be placed in a report delivered to C-suite executives.
Rules:
- Write exactly 2-3 sentences.
- Lead with the most important finding.
- Name specific data points where possible.
- End with one clear implication.
- Respond with prose only.`;

async function callClaude({ apiKey, instruction, payload }) {
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
        max_tokens: 300,
        temperature: 0.4,
        system: SYSTEM_PROMPT,
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
  if (!apiKey) {
    return {
      executive: FALLBACK.executive,
      adoption: FALLBACK.adoption,
      sponsorship: FALLBACK.sponsorship,
      managerLoad: FALLBACK.managerLoad,
      chain: FALLBACK.chain,
      keyFindings: keyFindingsFromData(reportData),
      nextStepsOrder: nextStepsOrderFromData(reportData),
    };
  }

  const payload = {
    stage: reportData.stage,
    org: reportData.org.name,
    readiness: reportData.readiness,
    dimensions: reportData.dimensions,
    manager: reportData.manager,
    alerts: reportData.alerts.map((alert) => alert.title),
    context,
  };

  const calls = [
    callClaude({
      apiKey,
      instruction:
        'Write an executive signal commentary for the overall Change Readiness result. Focus on the single most important strategic implication.',
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
  ];

  const [executive, adoption, sponsorship, managerLoad, chain] = await Promise.all(calls);

  return {
    executive: executive || FALLBACK.executive,
    adoption: adoption || FALLBACK.adoption,
    sponsorship: sponsorship || FALLBACK.sponsorship,
    managerLoad: managerLoad || FALLBACK.managerLoad,
    chain: chain || FALLBACK.chain,
    keyFindings: keyFindingsFromData(reportData),
    nextStepsOrder: nextStepsOrderFromData(reportData),
  };
}
