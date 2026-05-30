import { getActiveRoutingRules } from '../models/Lead.js';
import { getFirstStageForBu } from '../models/PipelineStage.js';

/**
 * Resolves a dot-notation path (e.g. "product_type" or "meta.region")
 * against a plain object. Returns undefined if any segment is missing.
 */
function resolvePath(obj, path) {
  const parts = String(path || '').split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Evaluate routing rules in priority order against sourceMetadata.
 * Returns { businessUnitId, pipelineStageId } for the first matching rule,
 * or null if no rule matches (caller must handle manual assignment).
 */
export async function resolveLeadDestination(organizationId, sourceMetadata = {}) {
  const rules = await getActiveRoutingRules(organizationId);
  for (const rule of rules) {
    const actual = resolvePath(sourceMetadata, rule.field_path);
    if (String(actual ?? '') === String(rule.field_value)) {
      const firstStage = await getFirstStageForBu(rule.business_unit_id);
      return {
        businessUnitId: rule.business_unit_id,
        pipelineStageId: firstStage?.id || null,
      };
    }
  }
  return null;
}
