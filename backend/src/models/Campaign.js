import { query } from '../config/database.js';

// Campaigns + their ordered stages. A campaign is one swimlane; stages are the
// flow boxes within it. See migration 077. Vocabularies are whitelisted here so
// only known channel/status/atl-btl values ever land in the DB.

export const CAMPAIGN_CHANNELS = new Set([
  'linkedin', 'email', 'phone', 'paid-ads', 'organic-social', 'pr', 'podcast', 'web', 'quiz', 'other',
]);
const CAMPAIGN_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
const ATL_BTL = new Set(['atl', 'btl']);

function normalizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((c) => CAMPAIGN_CHANNELS.has(c)))];
}
function normalizeStatus(v) { return CAMPAIGN_STATUSES.has(v) ? v : 'draft'; }
function normalizeAtlBtl(v) { return ATL_BTL.has(v) ? v : null; }

// ── Campaigns ──────────────────────────────────────────────────────────────

export async function listCampaignsWithStages(platformOrgId) {
  const { rows: campaigns } = await query(
    `SELECT c.*, u.first_name AS creator_first_name, u.last_name AS creator_last_name
       FROM campaigns c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.platform_org_id = $1
      ORDER BY c.position ASC, c.campaign_id ASC`,
    [platformOrgId],
  );
  if (campaigns.length === 0) return [];

  const ids = campaigns.map((c) => c.campaign_id);
  const { rows: stages } = await query(
    `SELECT s.*, f.name AS who_filter_name, f.scope AS who_filter_scope
       FROM campaign_stages s
       LEFT JOIN crm_custom_filters f ON f.filter_id = s.who_filter_id
      WHERE s.campaign_id = ANY($1::int[])
      ORDER BY s.position ASC, s.stage_id ASC`,
    [ids],
  );

  const byCampaign = new Map();
  for (const s of stages) {
    if (!byCampaign.has(s.campaign_id)) byCampaign.set(s.campaign_id, []);
    byCampaign.get(s.campaign_id).push(s);
  }
  return campaigns.map((c) => ({ ...c, stages: byCampaign.get(c.campaign_id) || [] }));
}

export async function getCampaign(platformOrgId, campaignId) {
  const { rows } = await query(
    `SELECT * FROM campaigns WHERE campaign_id = $1 AND platform_org_id = $2`,
    [campaignId, platformOrgId],
  );
  return rows[0] || null;
}

// Single campaign + its ordered stages (with WHO filter names) for the detail
// page.
export async function getCampaignWithStages(platformOrgId, campaignId) {
  const campaign = await getCampaign(platformOrgId, campaignId);
  if (!campaign) return null;
  const { rows: stages } = await query(
    `SELECT s.*, f.name AS who_filter_name
       FROM campaign_stages s
       LEFT JOIN crm_custom_filters f ON f.filter_id = s.who_filter_id
      WHERE s.campaign_id = $1
      ORDER BY s.position ASC, s.stage_id ASC`,
    [campaignId],
  );
  return { ...campaign, stages };
}

export async function createCampaign(platformOrgId, data, userId) {
  // New lanes go to the end of the board.
  const { rows: posRows } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM campaigns WHERE platform_org_id = $1`,
    [platformOrgId],
  );
  const position = posRows[0].next;

  const { rows } = await query(
    `INSERT INTO campaigns
       (name, description, objective, atl_btl, channels, owner_label, status, position, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      String(data.name || '').trim(),
      data.description ? String(data.description).trim() : null,
      data.objective ? String(data.objective).trim() : null,
      normalizeAtlBtl(data.atl_btl),
      normalizeChannels(data.channels),
      data.owner_label ? String(data.owner_label).trim() : null,
      normalizeStatus(data.status),
      position,
      platformOrgId,
      userId,
    ],
  );
  return rows[0];
}

export async function updateCampaign(platformOrgId, campaignId, data) {
  const sets = [];
  const values = [];
  let i = 1;
  const push = (col, val) => { sets.push(`${col} = $${i++}`); values.push(val); };

  if ('name' in data) push('name', String(data.name || '').trim());
  if ('description' in data) push('description', data.description ? String(data.description).trim() : null);
  if ('objective' in data) push('objective', data.objective ? String(data.objective).trim() : null);
  if ('atl_btl' in data) push('atl_btl', normalizeAtlBtl(data.atl_btl));
  if ('channels' in data) push('channels', normalizeChannels(data.channels));
  if ('owner_label' in data) push('owner_label', data.owner_label ? String(data.owner_label).trim() : null);
  if ('status' in data) push('status', normalizeStatus(data.status));
  if ('position' in data && Number.isInteger(data.position)) push('position', data.position);

  if (sets.length === 0) return getCampaign(platformOrgId, campaignId);

  sets.push('updated_at = NOW()');
  values.push(campaignId, platformOrgId);
  const { rows } = await query(
    `UPDATE campaigns SET ${sets.join(', ')} WHERE campaign_id = $${i++} AND platform_org_id = $${i++} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteCampaign(platformOrgId, campaignId) {
  await query(`DELETE FROM campaigns WHERE campaign_id = $1 AND platform_org_id = $2`, [campaignId, platformOrgId]);
}

// ── Stages ───────────────────────────────────────────────────────────────
// Every stage helper is scoped through its parent campaign's platform_org_id
// so a stage can never be read/written across workspaces.

export async function getStage(platformOrgId, stageId) {
  const { rows } = await query(
    `SELECT s.* FROM campaign_stages s
       JOIN campaigns c ON c.campaign_id = s.campaign_id
      WHERE s.stage_id = $1 AND c.platform_org_id = $2`,
    [stageId, platformOrgId],
  );
  return rows[0] || null;
}

function stageColumns(data) {
  const cols = {};
  if ('name' in data) cols.name = String(data.name || '').trim();
  if ('who_filter_id' in data) cols.who_filter_id = Number.isInteger(data.who_filter_id) ? data.who_filter_id : null;
  if ('channel' in data) cols.channel = data.channel && CAMPAIGN_CHANNELS.has(data.channel) ? data.channel : null;
  if ('links_to' in data) cols.links_to = data.links_to ? String(data.links_to).trim() : null;
  if ('blocker' in data) cols.blocker = data.blocker ? String(data.blocker).trim() : null;
  if ('branch_yes' in data) cols.branch_yes = data.branch_yes ? String(data.branch_yes).trim() : null;
  if ('branch_no' in data) cols.branch_no = data.branch_no ? String(data.branch_no).trim() : null;
  if ('notes' in data) cols.notes = data.notes ? String(data.notes).trim() : null;
  if ('position' in data && Number.isInteger(data.position)) cols.position = data.position;
  return cols;
}

export async function createStage(campaignId, data) {
  const { rows: posRows } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM campaign_stages WHERE campaign_id = $1`,
    [campaignId],
  );
  const cols = stageColumns(data);
  const { rows } = await query(
    `INSERT INTO campaign_stages
       (campaign_id, position, name, who_filter_id, channel, links_to, blocker, branch_yes, branch_no, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      campaignId,
      Number.isInteger(cols.position) ? cols.position : posRows[0].next,
      cols.name || 'Untitled stage',
      cols.who_filter_id ?? null,
      cols.channel ?? null,
      cols.links_to ?? null,
      cols.blocker ?? null,
      cols.branch_yes ?? null,
      cols.branch_no ?? null,
      cols.notes ?? null,
    ],
  );
  return rows[0];
}

export async function updateStage(platformOrgId, stageId, data) {
  const cols = stageColumns(data);
  const keys = Object.keys(cols);
  if (keys.length === 0) return getStage(platformOrgId, stageId);

  const sets = keys.map((k, idx) => `${k} = $${idx + 1}`);
  const values = keys.map((k) => cols[k]);
  sets.push('updated_at = NOW()');
  values.push(stageId, platformOrgId);
  const { rows } = await query(
    `UPDATE campaign_stages s SET ${sets.join(', ')}
       FROM campaigns c
      WHERE s.campaign_id = c.campaign_id
        AND s.stage_id = $${values.length - 1}
        AND c.platform_org_id = $${values.length}
      RETURNING s.*`,
    values,
  );
  return rows[0] || null;
}

export async function deleteStage(platformOrgId, stageId) {
  await query(
    `DELETE FROM campaign_stages s
       USING campaigns c
      WHERE s.campaign_id = c.campaign_id AND s.stage_id = $1 AND c.platform_org_id = $2`,
    [stageId, platformOrgId],
  );
}
