import { useEffect, useState } from 'react';
import api from '../../services/api.js';

const ACTION_LABELS = {
  'org.create': 'Organisation created',
  'org.update': 'Organisation updated',
  'org.delete': 'Organisation deleted',
  'org.logo.upload': 'Logo uploaded',
  'org.logo.delete': 'Logo removed',
  'user.invite.send': 'User invited',
  'user.invite.resend': 'Invite resent',
  'user.update': 'User updated',
  'user.deactivate': 'User deactivated',
  'user.password_reset_by_admin': 'Password reset by admin',
  'licence.config.update': 'Licence configuration updated',
  'licence.expiry.sweep': 'Licence expiry sweep run',
  'pulse.session.create': 'Assessment session created',
  'pulse.during_checkpoint.open': 'During-project checkpoint opened',
  'pulse.respondent_cap.override': 'Respondent cap overridden',
  'assessment.consume': 'Assessment opened',
  'assessment.refund': 'Assessment refunded',
  'status_incident.create': 'Status incident posted',
  'status_incident.update': 'Status incident updated',
  'status_incident.resolve': 'Status incident resolved',
  'status_incident.delete': 'Status incident deleted',
  'crm.organisation.create': 'Prospect created',
  'crm.organisation.update': 'Prospect updated',
  'crm.organisation.delete': 'Prospect deleted',
  'crm.contact.create': 'Contact added',
  'crm.contact.update': 'Contact updated',
  'crm.contact.delete': 'Contact removed',
  'crm.note.create': 'Note added',
  'crm.note.delete': 'Note removed',
  'crm.task.create': 'Task created',
  'crm.task.update': 'Task updated',
  'crm.task.delete': 'Task deleted',
  'crm.organisation.logo.upload': 'Logo uploaded',
  'crm.organisation.logo.delete': 'Logo removed',
  'crm.organisation.promote': 'Promoted to Client',
  'org.promoted_from_prospect': 'Promoted from Prospect',
};

function describeAction(action) {
  return ACTION_LABELS[action] || action;
}

// Fixed to Australia/Brisbane (AEST year-round, no daylight saving) rather
// than the viewer's local browser timezone, so both the on-screen list and
// the exported CSV always read in AEST regardless of where someone opens
// them from.
function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Australia/Brisbane', timeZoneName: 'short',
  });
}

const DISPLAY_LIMIT = 3;
const EXPORT_LIMIT = 500;
const BOM = '﻿';

function csvEscape(value) {
  const source = String(value ?? '');
  if (!/[",\n]/.test(source)) return source;
  return `"${source.replace(/"/g, '""')}"`;
}

function titleCaseFromSlug(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeProspectCarryover(m) {
  const bits = [];
  if (m.leadStatus) bits.push(`lead status: ${m.leadStatus}`);
  if (m.relationshipStatus) bits.push(`relationship status: ${titleCaseFromSlug(m.relationshipStatus)}`);
  if (m.website) bits.push(`website: ${m.website}`);
  if (m.phone) bits.push(`phone: ${m.phone}`);
  if (m.leadSource) bits.push(`lead source: ${m.leadSource}`);
  if (m.prospectCreatedDate) bits.push(`prospect created: ${m.prospectCreatedDate}`);
  if (m.expectedCloseDate) bits.push(`expected close: ${m.expectedCloseDate}`);
  return bits.length === 0 ? null : `From prospect "${m.prospectName || 'unknown'}" — ${bits.join(' · ')}`;
}

function describeMetadata(event) {
  if (!event?.metadata || typeof event.metadata !== 'object') return null;
  const m = event.metadata;
  if (event.action === 'org.promoted_from_prospect') return describeProspectCarryover(m);
  const bits = [];
  if (m.name) bits.push(m.name);
  if (m.title) bits.push(m.title);
  if (m.kind) bits.push(m.kind);
  if (m.businessUnit) bits.push(m.businessUnit);
  if (m.excerpt) bits.push(`"${m.excerpt}"`);
  if (Array.isArray(m.patchedFields) && m.patchedFields.length > 0) {
    bits.push(`fields: ${m.patchedFields.slice(0, 4).join(', ')}${m.patchedFields.length > 4 ? '…' : ''}`);
  }
  if (typeof m.notificationsSent === 'number') bits.push(`notifications: ${m.notificationsSent}`);
  if (m.source) bits.push(m.source);
  if (m.severity) bits.push(`severity: ${m.severity}`);
  if (typeof m.previousCap === 'number' || typeof m.nextCap === 'number') {
    bits.push(`cap ${m.previousCap ?? '∅'} → ${m.nextCap ?? '∅'}`);
  }
  return bits.length === 0 ? null : bits.join(' · ');
}

/**
 * INF-03 read surface. Shows the most recent audit events for the
 * current organization, scoped via the backend (platform admins see any
 * org; licensee admins see their own org and any owned client). Polls
 * once on mount; refresh button reloads on demand.
 */
export default function RecentActivityPanel({ orgId, style, resourcePath = '/api/platform/organizations' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function reload() {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`${resourcePath}/${orgId}/audit-events?limit=${DISPLAY_LIMIT}`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load recent activity.');
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    if (!orgId) return;
    setExporting(true);
    setExportError('');
    try {
      const { data } = await api.get(`${resourcePath}/${orgId}/audit-events?limit=${EXPORT_LIMIT}`);
      const rows = Array.isArray(data?.events) ? data.events : [];
      const headers = ['Action', 'Detail', 'Result', 'Timestamp'];
      const lines = [headers.map(csvEscape).join(',')];
      for (const event of rows) {
        lines.push(
          [
            describeAction(event.action),
            describeMetadata(event) || '',
            event.result || 'ok',
            formatDate(event.occurredAt),
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      // Leading BOM so Excel detects UTF-8 and renders the — / · characters
      // in the detail column correctly instead of as mojibake.
      const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `org-${orgId}-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e?.response?.data?.error || 'Could not export activity.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    reload();
  }, [orgId, resourcePath]);

  return (
    <div className="card platform-client-dashboard__card" style={{ marginBottom: '1.5rem', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem', gap: '0.5rem' }}>
        <h2 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
          Recent activity
        </h2>
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={exportCsv}
            disabled={exporting}
            style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reload}
            disabled={loading}
            style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        The {DISPLAY_LIMIT} most recent audit-logged changes for this organisation. Export CSV for the full history.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      {exportError && <p className="error" style={{ marginBottom: '0.5rem' }}>{exportError}</p>}
      {!loading && events.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>No recent activity recorded.</p>
      )}
      {events.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
          {events.map((event) => {
            const detail = describeMetadata(event);
            return (
              <li
                key={event.id}
                style={{
                  padding: '0.55rem 0.75rem',
                  borderRadius: 6,
                  background: '#fafaf9',
                  border: '1px solid rgba(0,0,0,0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  alignItems: 'baseline',
                }}
              >
                <span>
                  <strong>{describeAction(event.action)}</strong>
                  {detail ? (
                    <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>· {detail}</span>
                  ) : null}
                  {event.result && event.result !== 'ok' ? (
                    <span style={{ marginLeft: '0.5rem', color: '#b45309', fontSize: '0.8rem' }}>
                      ({event.result})
                    </span>
                  ) : null}
                </span>
                <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                  {formatDate(event.occurredAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
