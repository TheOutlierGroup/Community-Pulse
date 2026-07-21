import { BUSINESS_UNITS } from '../../config/crmConstants.js';
import { RELATIONSHIP_STATUS_OPTIONS } from '../../pages/platformClientUtils.js';
import { LINK_TYPE_OPTIONS } from '../../utils/segments.js';

// Shared editor for a segment's filter predicates. Used by the Settings
// Segments panel and anywhere else a definition is built. `def` is a
// normalised definition object; `setDef` receives an updater.
export default function SegmentDefinitionFields({ def, setDef, disabled = false, idPrefix = 'seg' }) {
  const patch = (partial) => setDef((prev) => ({ ...prev, ...partial }));

  function toggleStatus(statusId) {
    setDef((prev) => {
      const current = new Set(prev.relationshipStatuses || []);
      if (current.has(statusId)) current.delete(statusId);
      else current.add(statusId);
      return { ...prev, relationshipStatuses: [...current] };
    });
  }

  return (
    <fieldset className="segment-def" disabled={disabled} style={{ border: 'none', padding: 0, margin: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label htmlFor={`${idPrefix}-search`}>Name / email / role contains</label>
          <input
            id={`${idPrefix}-search`}
            value={def.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="e.g. gov, health"
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-role`}>Title / role contains</label>
          <input
            id={`${idPrefix}-role`}
            value={def.roleContains}
            onChange={(e) => patch({ roleContains: e.target.value })}
            placeholder="e.g. Chief, Head of, Director"
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label htmlFor={`${idPrefix}-link`}>Link</label>
          <select id={`${idPrefix}-link`} value={def.linkType} onChange={(e) => patch({ linkType: e.target.value })}>
            {LINK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-bu`}>Business unit</label>
          <select id={`${idPrefix}-bu`} value={def.businessUnit} onChange={(e) => patch({ businessUnit: e.target.value })}>
            <option value="">Any business unit</option>
            {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Relationship status</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginTop: '0.25rem' }}>
          {RELATIONSHIP_STATUS_OPTIONS.map((o) => (
            <label key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 400, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={def.relationshipStatuses.includes(o.id)}
                onChange={() => toggleStatus(o.id)}
              />
              {o.label}
            </label>
          ))}
          <span className="muted" style={{ fontSize: '0.8rem' }}>(none = any)</span>
        </div>
      </div>
      <div className="field">
        <label>Reachable by</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginTop: '0.25rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 400, cursor: 'pointer' }}>
            <input type="checkbox" checked={def.hasEmail} onChange={(e) => patch({ hasEmail: e.target.checked })} />
            Has email
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 400, cursor: 'pointer' }}>
            <input type="checkbox" checked={def.hasPhone} onChange={(e) => patch({ hasPhone: e.target.checked })} />
            Has phone
          </label>
        </div>
      </div>
    </fieldset>
  );
}
