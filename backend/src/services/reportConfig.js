import crypto from 'crypto';

export const REPORT_ACCESS_SCOPE = 'consultant_only';
export const REPORT_MIN_RESPONSES = Number.parseInt(process.env.REPORT_MIN_RESPONSES || '10', 10);
export const REPORT_STAGE_MAP = {
  pre: 'pre',
  mid: 'during',
  post: 'completed',
};
export const REPORT_FORMATS = new Set(['docx', 'pdf']);
export const REPORT_AI_TIMEOUT_MS = Number.parseInt(process.env.REPORT_AI_TIMEOUT_MS || '15000', 10);
export const REPORT_AI_MODEL = process.env.REPORT_AI_MODEL || 'claude-sonnet-4-20250514';
export const REPORT_STORAGE_DAYS = Number.parseInt(process.env.REPORT_STORAGE_DAYS || '30', 10);
export const REPORT_DOWNLOAD_TTL_SECONDS = Number.parseInt(
  process.env.REPORT_DOWNLOAD_TTL_SECONDS || String(60 * 60),
  10
);
export const REPORT_PDF_HEADERS_ENABLED = false;
export const REPORT_PDF_PAGE_NUMBERS_ENABLED = false;
export const REPORT_CHAIN_STATE_STRATEGY = 'compute_on_read';

export const NEXT_STEPS_STATIC_BLOCKS = {
  'Sponsorship Architecture Review': [
    'Senior Leadership Sponsorship Diagnostic — half-day facilitated session with programme sponsors.',
    'Sponsorship Behaviour Design — co-create visible sponsorship commitments for the programme lifecycle.',
    'Sponsorship Pulse — run a lightweight sponsorship check every 4 weeks.'
  ],
  'Manager Enablement Programme': [
    'Manager Readiness Bootcamp — targeted practical change-leadership session for manager cohort.',
    'Peer Learning Circles — monthly manager forums for live challenge-solving and safe escalation.',
    'Executive Air Cover Protocol — define manager decision rights and escalation boundaries.'
  ],
  'Change Portfolio Review': [
    'Change Portfolio Mapping — inventory all active initiatives and identify overlap.',
    'Load Reduction Planning — remove or sequence initiatives to reduce delivery conflict.',
    'Launch Sequencing Workshop — agree explicit stop/start criteria pre-launch.'
  ],
  'Mid-Change Assessment': [
    'Mid-Change Survey — redeploy the same instrument 4-8 weeks post-launch.',
    'Delta Analysis Report — compare pre vs mid movements across scores and risk states.',
    'Intervention Re-prioritisation — re-order support actions based on live movement.'
  ],
};

export const NEXT_STEPS_DEFAULT_ORDER = [
  'Sponsorship Architecture Review',
  'Manager Enablement Programme',
  'Change Portfolio Review',
  'Mid-Change Assessment',
];

export const REPORT_DOWNLOAD_SECRET = process.env.REPORT_DOWNLOAD_SECRET || process.env.JWT_SECRET || crypto.randomUUID();
