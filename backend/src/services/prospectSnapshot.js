import { listContacts } from '../models/CrmContact.js';
import { listNotesForOrg, listNotesForContact } from '../models/CrmNote.js';
import { listRecentAuditEvents } from './auditLog.js';
import { getOpportunityForOrganisation, listCheckpoints } from '../models/CrmOpportunity.js';

const ACTIVITY_ACTION_LABELS = {
  'crm.organisation.create': 'Prospect created',
  'crm.organisation.update': 'Prospect updated',
  'crm.organisation.delete': 'Prospect deleted',
  'crm.organisation.logo.upload': 'Logo uploaded',
  'crm.organisation.logo.delete': 'Logo removed',
  'crm.organisation.promote': 'Promoted to Client',
  'crm.contact.create': 'Contact added',
  'crm.contact.update': 'Contact updated',
  'crm.contact.delete': 'Contact removed',
  'crm.note.create': 'Note added',
  'crm.note.delete': 'Note removed',
  'crm.task.create': 'Task created',
  'crm.task.update': 'Task updated',
  'crm.task.delete': 'Task deleted',
};

function describeActivityMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('/') : value}`)
    .join('; ');
}

/**
 * Gathers everything known about a prospect at promotion time — core
 * fields, organisation + contact notes, contacts, and the full CRM audit
 * trail — into one plain JSON-serializable snapshot. Stored once and never
 * regenerated, so it stays a faithful record of the prospect regardless of
 * later changes to the promoted Client.
 */
export async function buildProspectSnapshot({ prospect, platformOrgId }) {
  const contacts = await listContacts(prospect.organisation_id);
  const orgNotes = await listNotesForOrg(prospect.organisation_id);
  const contactNotes = [];
  for (const contact of contacts) {
    const notes = await listNotesForContact(contact.contact_id);
    for (const note of notes) {
      contactNotes.push({ ...note, contact_name: [contact.contact_firstname, contact.contact_lastname].filter(Boolean).join(' ') });
    }
  }
  const auditEvents = await listRecentAuditEvents({
    organizationId: platformOrgId,
    targetId: prospect.organisation_id,
    targetType: 'crm_organisation',
    limit: 500,
  });

  const opportunityRow = await getOpportunityForOrganisation(prospect.organisation_id);
  const opportunity = opportunityRow
    ? {
        currentStage: opportunityRow.current_stage,
        progressPct: opportunityRow.progress_pct,
        summary: opportunityRow.summary,
        checkpoints: (await listCheckpoints(opportunityRow.opportunity_id)).map((c) => ({
          stage: c.stage,
          expectedValue: c.expected_value,
          financialGain: c.financial_gain,
          targetDate: c.target_date,
          notes: c.notes,
        })),
      }
    : null;

  return {
    capturedAt: new Date().toISOString(),
    organisationName: prospect.organisation_name,
    industry: prospect.industry,
    website: prospect.website,
    phone: prospect.phone,
    businessUnit: prospect.business_unit,
    leadStatus: prospect.lead_status,
    relationshipStatus: prospect.relationship_status,
    leadSource: prospect.lead_source,
    doNotContact: Boolean(prospect.do_not_contact),
    createdDate: prospect.created_date,
    expectedCloseDate: prospect.expected_close_date,
    opportunity,
    contacts: contacts.map((c) => ({
      firstName: c.contact_firstname,
      lastName: c.contact_lastname,
      email: c.contact_email,
      phone: c.contact_phone,
      role: c.contact_role,
    })),
    notes: [
      ...orgNotes.map((n) => ({ source: 'Organisation', author: n.author_name || '', text: n.note_text, occurredAt: n.created_at })),
      ...contactNotes.map((n) => ({ source: `Contact: ${n.contact_name}`, author: n.author_name || '', text: n.note_text, occurredAt: n.created_at })),
    ].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
    activity: auditEvents.map((e) => ({
      action: ACTIVITY_ACTION_LABELS[e.action] || e.action,
      detail: describeActivityMetadata(e.metadata),
      result: e.result,
      occurredAt: e.occurred_at,
    })),
  };
}

function titleCaseFromSlug(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function csvEscape(value) {
  const source = String(value ?? '');
  if (!/[",\n]/.test(source)) return source;
  return `"${source.replace(/"/g, '""')}"`;
}

function fmtDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Australia/Brisbane', timeZoneName: 'short',
  });
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}

/**
 * Renders a stored snapshot to CSV text (with a UTF-8 BOM so Excel decodes
 * special characters correctly, and all timestamps fixed to AEST). Kept as
 * a pure formatting step, separate from snapshot capture, so future CSV
 * formatting fixes apply to old snapshots too.
 */
export function prospectSnapshotToCsv(snapshot) {
  const lines = [];
  lines.push(csvRow(['Field', 'Value']));
  lines.push(csvRow(['Organisation name', snapshot.organisationName]));
  lines.push(csvRow(['Industry', snapshot.industry || '']));
  lines.push(csvRow(['Website', snapshot.website || '']));
  lines.push(csvRow(['Phone', snapshot.phone || '']));
  lines.push(csvRow(['Business unit', snapshot.businessUnit || '']));
  lines.push(csvRow(['Lead status', snapshot.leadStatus || '']));
  lines.push(csvRow(['Relationship status', titleCaseFromSlug(snapshot.relationshipStatus)]));
  lines.push(csvRow(['Lead source', snapshot.leadSource || '']));
  lines.push(csvRow(['Do not contact', snapshot.doNotContact ? 'Yes' : 'No']));
  lines.push(csvRow(['Created', fmtDate(snapshot.createdDate)]));
  lines.push(csvRow(['Expected close', fmtDate(snapshot.expectedCloseDate)]));
  lines.push(csvRow(['Snapshot captured', fmtDate(snapshot.capturedAt)]));
  lines.push('');

  if (snapshot.opportunity) {
    lines.push(csvRow(['Opportunity']));
    lines.push(csvRow(['Current stage', snapshot.opportunity.currentStage || '']));
    lines.push(csvRow(['Progress', `${snapshot.opportunity.progressPct ?? 0}%`]));
    if (snapshot.opportunity.summary) lines.push(csvRow(['Summary', snapshot.opportunity.summary]));
    lines.push('');

    lines.push(csvRow(['Sales timeline checkpoints']));
    lines.push(csvRow(['Stage', 'Expected value', 'Financial gain', 'Target date', 'Notes']));
    for (const c of snapshot.opportunity.checkpoints || []) {
      lines.push(csvRow([
        c.stage || '',
        c.expectedValue ?? '',
        c.financialGain ?? '',
        fmtDate(c.targetDate) || '',
        c.notes || '',
      ]));
    }
    lines.push('');
  }

  lines.push(csvRow(['Contacts']));
  lines.push(csvRow(['First name', 'Last name', 'Email', 'Phone', 'Role']));
  for (const c of snapshot.contacts || []) {
    lines.push(csvRow([c.firstName || '', c.lastName || '', c.email || '', c.phone || '', c.role || '']));
  }
  lines.push('');

  lines.push(csvRow(['Notes']));
  lines.push(csvRow(['Date', 'Source', 'Author', 'Note']));
  for (const n of snapshot.notes || []) {
    lines.push(csvRow([fmtDate(n.occurredAt), n.source || '', n.author || '', n.text || '']));
  }
  lines.push('');

  lines.push(csvRow(['Activity log']));
  lines.push(csvRow(['Date', 'Action', 'Detail', 'Result']));
  for (const a of snapshot.activity || []) {
    lines.push(csvRow([fmtDate(a.occurredAt), a.action || '', a.detail || '', a.result || 'ok']));
  }

  return '﻿' + lines.join('\n');
}
