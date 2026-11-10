import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import api from '../../services/api.js';
import { useAuth } from '../shared/Auth.jsx';
import { useToast } from '../shared/ToastProvider.jsx';
import ModalDialog from '../shared/ModalDialog.jsx';

/**
 * Invite email and survey welcome templates for a Rhythm Engine client.
 *
 * These used to sit on the Respondents (recipients) page as four buttons in
 * the table toolbar. They are configuration, not per-recipient actions, so
 * they now live under Rhythm Engine Configurations → Email templates. The
 * templates are still stored per survey timepoint, so this follows the
 * Point in Time selector in the sidebar exactly as the old buttons did.
 */

const WELCOME_TEMPLATE_MAX_TEXT_LENGTH = 4000;

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultTemplateForAudience(audience) {
  if (audience === 'manager') {
    return {
      subject: 'Rhythm Engine manager questionnaire — {{name}}',
      bodyHtml:
        '<p>Hi {{name}},</p><p>You have been invited to complete the manager Rhythm Engine questionnaire.</p><p style="margin: 1.2rem 0;"><a href="{{link}}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Rhythm Engine</a></p>',
    };
  }
  return {
    subject: 'Rhythm Engine questionnaire — {{name}}',
    bodyHtml:
      '<p>Hi {{name}},</p><p>You have been invited to complete a short Rhythm Engine questionnaire.</p><p style="margin: 1.2rem 0;"><a href="{{link}}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Rhythm Engine</a></p>',
  };
}

function defaultWelcomeTemplateForAudience() {
  return {
    bodyHtml:
      '<p>Welcome {{name}}!</p><p>Change can look many ways: from implementing a new payroll system to reorganising how a team collaborates, or even refining a single workflow to cut out unnecessary steps. As we move through this journey, it’s important that we hear from everyone; and as a manager, your perspective on how change is landing across your team is especially valuable.</p><p>There are no right or wrong answers – your honest perspective is what matters most.</p>',
  };
}

function normalizeWelcomeTemplates(rawTemplates) {
  const templates = rawTemplates && typeof rawTemplates === 'object' ? rawTemplates : {};
  const normalizeRole = (role) => {
    const fallback = defaultWelcomeTemplateForAudience(role);
    const raw = templates[role] && typeof templates[role] === 'object' ? templates[role] : {};
    const bodyHtml = String(raw.bodyHtml || '').trim();
    const intro = String(raw.intro || '').trim();
    const context = String(raw.context || '').trim();
    return {
      ...fallback,
      ...raw,
      bodyHtml: bodyHtml || (intro ? `<p>${intro}</p>${context ? `<p>${context}</p>` : ''}` : fallback.bodyHtml),
    };
  };
  return {
    staff: normalizeRole('staff'),
    manager: normalizeRole('manager'),
  };
}

function applyTemplatePlaceholders(template, replacements) {
  let out = String(template || '');
  const map = replacements && typeof replacements === 'object' ? replacements : {};
  for (const [key, value] of Object.entries(map)) {
    const tokenPattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    out = out.replace(tokenPattern, String(value ?? ''));
  }
  return out;
}

function formatDueDatePreview(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function EmailTemplateRichEditor({ value, onChange, disabled }) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
        }),
        Placeholder.configure({
          placeholder: 'Write email body. Use {{name}}, {{link}}, {{dueDate}}, {{clientName}} and {{contactInfo}} placeholders.',
        }),
      ],
      content: value || '<p></p>',
      editable: !disabled,
      onUpdate: ({ editor: nextEditor }) => {
        onChange(nextEditor.getHTML());
      },
    },
    [disabled]
  );

  useEffect(() => {
    if (!editor) return;
    const next = value || '<p></p>';
    if (next !== editor.getHTML()) {
      editor.commands.setContent(next, false);
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return <div className="task-card-modal__rte task-card-modal__rte--loading muted">Loading editor…</div>;
  }

  function setLink() {
    const previous = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', previous || 'https://');
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  }

  return (
    <div className={`task-card-modal__rte${disabled ? ' task-card-modal__rte--disabled' : ''}`}>
      <div className="task-card-modal__rte-toolbar" role="toolbar" aria-label="Email template formatting">
        <div className="task-card-modal__rte-toolbar-group">
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('bold') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={disabled}
            aria-label="Bold"
          >
            <Bold size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('italic') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={disabled}
            aria-label="Italic"
          >
            <Italic size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('bulletList') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            disabled={disabled}
            aria-label="Bullet list"
          >
            <List size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('orderedList') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            disabled={disabled}
            aria-label="Numbered list"
          >
            <ListOrdered size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('link') ? ' is-active' : ''}`}
            onClick={setLink}
            disabled={disabled}
            aria-label="Insert link"
          >
            <Link2 size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
      <EditorContent editor={editor} className="task-card-modal__rte-content" />
    </div>
  );
}

function apiErrorDetail(err, fallback) {
  const d = err?.response?.data;
  if (!d || typeof d !== 'object') return fallback;
  const msg = typeof d.error === 'string' ? d.error : fallback;
  const det = typeof d.details === 'string' ? d.details.trim() : '';
  if (det) return `${msg}\n\n${det}`;
  return msg;
}

function normalizeInviteTimepoint(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'during') return 'mid';
  if (v === 'completed') return 'post';
  if (v === 'pre' || v === 'mid' || v === 'post') return v;
  return 'pre';
}

const TEMPLATE_CARDS = [
  {
    key: 'email-staff',
    kind: 'email',
    audience: 'staff',
    title: 'Staff invite email',
    description: 'Sent to staff respondents with their personal survey link.',
  },
  {
    key: 'email-manager',
    kind: 'email',
    audience: 'manager',
    title: 'Manager invite email',
    description: 'Sent to manager respondents with their personal survey link.',
  },
  {
    key: 'welcome-staff',
    kind: 'welcome',
    audience: 'staff',
    title: 'Staff welcome screen',
    description: 'Shown to staff when they open the survey, before the first question.',
  },
  {
    key: 'welcome-manager',
    kind: 'welcome',
    audience: 'manager',
    title: 'Manager welcome screen',
    description: 'Shown to managers when they open the survey, before the first question.',
  },
];

export default function RhythmEngineEmailTemplates() {
  const { orgId, org, clientLogoUrl, pulseTimepoint, pulseDuringSessionId } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [dueDate, setDueDate] = useState('');
  const [templateModalAudience, setTemplateModalAudience] = useState(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateResetting, setTemplateResetting] = useState(false);
  const [templateTestSending, setTemplateTestSending] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [emailTemplates, setEmailTemplates] = useState({
    staff: defaultTemplateForAudience('staff'),
    manager: defaultTemplateForAudience('manager'),
  });
  const [editingTemplateSubject, setEditingTemplateSubject] = useState('');
  const [editingTemplateBodyHtml, setEditingTemplateBodyHtml] = useState('<p></p>');
  const [templateEditorMode, setTemplateEditorMode] = useState('edit');
  const [welcomeTemplateModalAudience, setWelcomeTemplateModalAudience] = useState(null);
  const [welcomeTemplatesLoading, setWelcomeTemplatesLoading] = useState(false);
  const [welcomeTemplateSaving, setWelcomeTemplateSaving] = useState(false);
  const [welcomeTemplateResetting, setWelcomeTemplateResetting] = useState(false);
  const [welcomeTemplateError, setWelcomeTemplateError] = useState('');
  const [welcomeTemplates, setWelcomeTemplates] = useState(() => normalizeWelcomeTemplates(null));
  const [editingWelcomeTemplateBodyHtml, setEditingWelcomeTemplateBodyHtml] = useState('<p></p>');
  const [welcomeTemplateEditorMode, setWelcomeTemplateEditorMode] = useState('edit');

  const inviteTimepoint = useMemo(() => normalizeInviteTimepoint(pulseTimepoint), [pulseTimepoint]);
  const missingDuringSession = inviteTimepoint === 'mid' && !pulseDuringSessionId;
  const inviteRequestParams = useMemo(() => {
    const params = { timepoint: inviteTimepoint };
    if (inviteTimepoint === 'mid' && pulseDuringSessionId) {
      params.duringSessionId = pulseDuringSessionId;
    }
    return params;
  }, [inviteTimepoint, pulseDuringSessionId]);

  // The {{dueDate}} placeholder preview needs the timepoint's due date,
  // which is only returned alongside the recipient list.
  useEffect(() => {
    if (missingDuringSession) {
      setDueDate('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites`, {
          params: inviteRequestParams,
        });
        if (!cancelled) setDueDate(typeof data?.dueDate === 'string' ? data.dueDate : '');
      } catch {
        if (!cancelled) setDueDate('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteRequestParams, missingDuringSession, orgId]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    if (missingDuringSession) {
      setEmailTemplates({
        staff: defaultTemplateForAudience('staff'),
        manager: defaultTemplateForAudience('manager'),
      });
      setTemplatesLoading(false);
      return;
    }
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-link-invites/templates`, {
        params: inviteRequestParams,
      });
      const templates = data?.templates || {};
      setEmailTemplates({
        staff: {
          ...defaultTemplateForAudience('staff'),
          ...(templates.staff || {}),
        },
        manager: {
          ...defaultTemplateForAudience('manager'),
          ...(templates.manager || {}),
        },
      });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not load email templates.', { variant: 'error' });
    } finally {
      setTemplatesLoading(false);
    }
  }, [inviteRequestParams, missingDuringSession, orgId, showToast]);

  const loadWelcomeTemplates = useCallback(async () => {
    setWelcomeTemplatesLoading(true);
    if (missingDuringSession) {
      setWelcomeTemplates(normalizeWelcomeTemplates(null));
      setWelcomeTemplatesLoading(false);
      return;
    }
    try {
      const { data } = await api.get(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/survey-start-templates`,
        { params: inviteRequestParams }
      );
      setWelcomeTemplates(normalizeWelcomeTemplates(data?.templates));
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not load welcome templates.', { variant: 'error' });
    } finally {
      setWelcomeTemplatesLoading(false);
    }
  }, [inviteRequestParams, missingDuringSession, orgId, showToast]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    loadWelcomeTemplates();
  }, [loadWelcomeTemplates]);

  function openTemplateModal(audience) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const template = emailTemplates[role] || defaultTemplateForAudience(role);
    setTemplateModalAudience(role);
    setTemplateError('');
    setEditingTemplateSubject(String(template.subject || ''));
    setEditingTemplateBodyHtml(String(template.bodyHtml || '<p></p>'));
    setTemplateEditorMode('edit');
  }

  function closeTemplateModal() {
    if (templateSaving || templateResetting) return;
    setTemplateModalAudience(null);
    setTemplateError('');
  }

  async function saveEmailTemplate(e) {
    e.preventDefault();
    if (!templateModalAudience) return;
    const subject = String(editingTemplateSubject || '').trim();
    if (!subject) {
      setTemplateError('Subject is required.');
      return;
    }
    if (subject.length > 200) {
      setTemplateError('Subject must be 200 characters or less.');
      return;
    }
    const bodyHtml = String(editingTemplateBodyHtml || '').trim();
    if (!stripHtmlToText(bodyHtml)) {
      setTemplateError('Body is required.');
      return;
    }

    setTemplateSaving(true);
    setTemplateError('');
    try {
      const { data } = await api.put(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/templates`,
        {
          audience: templateModalAudience,
          subject,
          bodyHtml,
        },
        { params: inviteRequestParams }
      );
      const templates = data?.templates || {};
      setEmailTemplates({
        staff: {
          ...defaultTemplateForAudience('staff'),
          ...(templates.staff || {}),
        },
        manager: {
          ...defaultTemplateForAudience('manager'),
          ...(templates.manager || {}),
        },
      });
      showToast(`${templateModalAudience === 'manager' ? 'Manager' : 'Staff'} email template saved.`, {
        variant: 'success',
      });
      setTemplateModalAudience(null);
    } catch (err) {
      setTemplateError(err.response?.data?.error || 'Could not save email template.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function sendTemplateTestEmail() {
    if (!templateModalAudience) return;
    const subject = String(editingTemplateSubject || '').trim();
    if (!subject) {
      setTemplateError('Subject is required.');
      return;
    }
    if (subject.length > 200) {
      setTemplateError('Subject must be 200 characters or less.');
      return;
    }
    const bodyHtml = String(editingTemplateBodyHtml || '').trim();
    if (!stripHtmlToText(bodyHtml)) {
      setTemplateError('Body is required.');
      return;
    }
    setTemplateError('');
    setTemplateTestSending(true);
    try {
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/templates/send-test`,
        {
          audience: templateModalAudience,
          subject,
          bodyHtml,
        },
        { params: inviteRequestParams }
      );
      const sentTo = String(data?.to || user?.email || '').trim();
      showToast(sentTo ? `Test email sent to ${sentTo}.` : 'Test email sent.', {
        variant: 'success',
      });
    } catch (err) {
      setTemplateError(apiErrorDetail(err, 'Could not send test email.'));
    } finally {
      setTemplateTestSending(false);
    }
  }

  async function resetTemplateToTimepointDefault() {
    if (!templateModalAudience) return;
    const confirmed = window.confirm('Reset this template to the default for the current survey timepoint?');
    if (!confirmed) return;
    setTemplateError('');
    setTemplateResetting(true);
    try {
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/templates/reset-default`,
        { audience: templateModalAudience },
        { params: inviteRequestParams }
      );
      const templates = data?.templates || {};
      const nextTemplates = {
        staff: {
          ...defaultTemplateForAudience('staff'),
          ...(templates.staff || {}),
        },
        manager: {
          ...defaultTemplateForAudience('manager'),
          ...(templates.manager || {}),
        },
      };
      setEmailTemplates(nextTemplates);
      const resetTemplate = nextTemplates[templateModalAudience] || defaultTemplateForAudience(templateModalAudience);
      setEditingTemplateSubject(String(resetTemplate.subject || ''));
      setEditingTemplateBodyHtml(String(resetTemplate.bodyHtml || '<p></p>'));
      showToast(
        `${templateModalAudience === 'manager' ? 'Manager' : 'Staff'} template reset to timepoint default.`,
        { variant: 'success' }
      );
    } catch (err) {
      setTemplateError(err.response?.data?.error || 'Could not reset template to default.');
    } finally {
      setTemplateResetting(false);
    }
  }

  function openWelcomeTemplateModal(audience) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const template = welcomeTemplates[role] || defaultWelcomeTemplateForAudience(role);
    setWelcomeTemplateModalAudience(role);
    setWelcomeTemplateError('');
    setEditingWelcomeTemplateBodyHtml(String(template.bodyHtml || '<p></p>'));
    setWelcomeTemplateEditorMode('edit');
  }

  function closeWelcomeTemplateModal() {
    if (welcomeTemplateSaving || welcomeTemplateResetting) return;
    setWelcomeTemplateModalAudience(null);
    setWelcomeTemplateError('');
  }

  async function saveWelcomeTemplate(e) {
    e.preventDefault();
    if (!welcomeTemplateModalAudience) return;
    const bodyHtml = String(editingWelcomeTemplateBodyHtml || '').trim();
    if (!stripHtmlToText(bodyHtml)) {
      setWelcomeTemplateError('Body text is required.');
      return;
    }
    if (bodyHtml.length > WELCOME_TEMPLATE_MAX_TEXT_LENGTH) {
      setWelcomeTemplateError(`Body text must be ${WELCOME_TEMPLATE_MAX_TEXT_LENGTH} characters or less.`);
      return;
    }
    setWelcomeTemplateSaving(true);
    setWelcomeTemplateError('');
    try {
      const { data } = await api.put(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/survey-start-templates`,
        {
          audience: welcomeTemplateModalAudience,
          bodyHtml,
        },
        { params: inviteRequestParams }
      );
      setWelcomeTemplates(normalizeWelcomeTemplates(data?.templates));
      showToast(`${welcomeTemplateModalAudience === 'manager' ? 'Manager' : 'Staff'} welcome template saved.`, {
        variant: 'success',
      });
      setWelcomeTemplateModalAudience(null);
    } catch (err) {
      setWelcomeTemplateError(err.response?.data?.error || 'Could not save welcome template.');
    } finally {
      setWelcomeTemplateSaving(false);
    }
  }

  async function resetWelcomeTemplateToTimepointDefault() {
    if (!welcomeTemplateModalAudience) return;
    const confirmed = window.confirm('Reset this welcome template to the default for the current survey timepoint?');
    if (!confirmed) return;
    setWelcomeTemplateError('');
    setWelcomeTemplateResetting(true);
    try {
      const { data } = await api.post(
        `/api/platform/organizations/${orgId}/rhythm-engine-link-invites/survey-start-templates/reset-default`,
        { audience: welcomeTemplateModalAudience },
        { params: inviteRequestParams }
      );
      const nextTemplates = normalizeWelcomeTemplates(data?.templates);
      setWelcomeTemplates(nextTemplates);
      const resetTemplate = nextTemplates[welcomeTemplateModalAudience] || defaultWelcomeTemplateForAudience(welcomeTemplateModalAudience);
      setEditingWelcomeTemplateBodyHtml(String(resetTemplate.bodyHtml || '<p></p>'));
      showToast(
        `${welcomeTemplateModalAudience === 'manager' ? 'Manager' : 'Staff'} welcome template reset to timepoint default.`,
        { variant: 'success' }
      );
    } catch (err) {
      setWelcomeTemplateError(err.response?.data?.error || 'Could not reset welcome template to default.');
    } finally {
      setWelcomeTemplateResetting(false);
    }
  }

  const previewName = 'Alex';
  // Same fallback the server uses when the client has no report contact.
  const previewContactInfo = String(org?.report_contact || '').trim() || 'your project lead';
  const previewLink = `https://app.employeepulse.app/rhythm-engine/${inviteTimepoint}/link/your-personal-token`;
  const previewSubject = applyTemplatePlaceholders(editingTemplateSubject, {
    name: previewName,
    link: previewLink,
    clientName: String(org?.name || ''),
    dueDate: formatDueDatePreview(dueDate) || dueDate || '',
    contactInfo: previewContactInfo,
  });
  const previewBodyHtml = applyTemplatePlaceholders(editingTemplateBodyHtml, {
    name: previewName,
    link: previewLink,
    clientName: String(org?.name || ''),
    dueDate: formatDueDatePreview(dueDate) || dueDate || '',
    contactInfo: previewContactInfo,
  });
  const previewWelcomeBodyHtml = applyTemplatePlaceholders(editingWelcomeTemplateBodyHtml, {
    name: previewName,
    clientName: String(org?.name || ''),
    contactInfo: previewContactInfo,
  });

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 0.9rem' }}>
        Templates are saved per survey stage. You are editing the templates for the{' '}
        <strong>{inviteTimepoint}</strong> survey; switch stage with the Point in Time selector in the sidebar.
      </p>
      {missingDuringSession ? (
        <p className="error">Select or create a During checkpoint before editing During templates.</p>
      ) : null}
      <div className="card pulse-settings-list">
        {TEMPLATE_CARDS.map((card) => {
          const busy =
            card.kind === 'email'
              ? templatesLoading || templateSaving || welcomeTemplateSaving
              : welcomeTemplatesLoading || welcomeTemplateSaving || templateSaving;
          return (
            <div key={card.key} className="pulse-settings-row">
              <div className="pulse-settings-row__heading">
                <span className="pulse-settings-row__title">{card.title}</span>
                <p className="muted" style={{ margin: '0.3rem 0 0', fontWeight: 400 }}>
                  {card.description}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || missingDuringSession}
                onClick={() =>
                  card.kind === 'email' ? openTemplateModal(card.audience) : openWelcomeTemplateModal(card.audience)
                }
              >
                Edit template
              </button>
            </div>
          );
        })}
      </div>

      <ModalDialog
        open={Boolean(templateModalAudience)}
        title={templateModalAudience === 'manager' ? 'Manager email template' : 'Staff email template'}
        titleId="pulse-email-template-title"
        onClose={closeTemplateModal}
        dialogClassName="modal-dialog--pulse-template"
      >
        {templateModalAudience ? (
          <form
            onSubmit={saveEmailTemplate}
            className="pulse-template-form"
            style={{ padding: '0 0 0.25rem' }}
          >
            {templateError ? <p className="error" style={{ marginBottom: '1rem' }}>{templateError}</p> : null}
            <div className="field">
              <label htmlFor="pulse-template-subject">Subject</label>
              <input
                id="pulse-template-subject"
                value={editingTemplateSubject}
                onChange={(e) => setEditingTemplateSubject(e.target.value)}
                placeholder="Email subject"
                maxLength={200}
                disabled={templateSaving}
                required
              />
            </div>
            <div className="pulse-template-mode-switch" role="tablist" aria-label="Template editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode === 'edit'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode('edit')}
                disabled={templateSaving}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode === 'view'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode('view')}
                disabled={templateSaving}
              >
                View
              </button>
            </div>
            <div className="field pulse-template-body-field">
              <label>{templateEditorMode === 'view' ? 'Preview' : 'Body'}</label>
              {templateEditorMode === 'edit' ? (
                <div className="pulse-template-editor">
                  <EmailTemplateRichEditor
                    value={editingTemplateBodyHtml}
                    onChange={setEditingTemplateBodyHtml}
                    disabled={templateSaving}
                  />
                </div>
              ) : (
                <div className="pulse-template-preview">
                  <div className="pulse-template-preview__subject">{previewSubject || '(No subject)'}</div>
                  <div className="pulse-template-preview__canvas">
                    {clientLogoUrl ? (
                      <div className="pulse-template-preview__logo-wrap">
                        <img
                          src={clientLogoUrl}
                          alt={`${String(org?.name || 'Client')} logo`}
                          className="pulse-template-preview__logo"
                        />
                      </div>
                    ) : null}
                    <div
                      className="pulse-template-preview__body"
                      dangerouslySetInnerHTML={{ __html: previewBodyHtml || '<p></p>' }}
                    />
                    <p className="pulse-template-preview__footer">
                      If the button does not work, copy and paste this URL into your browser:
                      <br />
                      <span>{previewLink}</span>
                    </p>
                  </div>
                </div>
              )}
              <p className="muted" style={{ marginTop: '0.45rem' }}>
                Placeholders: <code>{'{{name}}'}</code> (respondent&rsquo;s name), <code>{'{{link}}'}</code> (their
                personal survey link), <code>{'{{dueDate}}'}</code>, <code>{'{{clientName}}'}</code> and{' '}
                <code>{'{{contactInfo}}'}</code> (the client&rsquo;s report contact, or &ldquo;your project lead&rdquo; if
                none is set). Capitalisation doesn&rsquo;t matter: <code>{'{{clientname}}'}</code> works too.
              </p>
            </div>
            <p className="muted" style={{ margin: '0 0 0.75rem' }}>
              Test emails will be sent to: <code>{String(user?.email || 'your account email')}</code>
            </p>
            <div className="modal-dialog__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={sendTemplateTestEmail}
                disabled={templateSaving || templateResetting || templateTestSending}
                title={user?.email ? `Send to ${user.email}` : 'Send to your account email'}
              >
                {templateTestSending ? 'Sending test…' : 'Send test'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetTemplateToTimepointDefault}
                disabled={templateSaving || templateResetting || templateTestSending}
              >
                {templateResetting ? 'Resetting…' : 'Reset to default'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeTemplateModal}
                disabled={templateSaving || templateResetting || templateTestSending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary modal-dialog__submit"
                disabled={templateSaving || templateResetting || templateTestSending}
              >
                {templateSaving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </form>
        ) : null}
      </ModalDialog>

      <ModalDialog
        open={Boolean(welcomeTemplateModalAudience)}
        title={welcomeTemplateModalAudience === 'manager' ? 'Manager welcome template' : 'Staff welcome template'}
        titleId="pulse-welcome-template-title"
        onClose={closeWelcomeTemplateModal}
        dialogClassName="modal-dialog--pulse-template"
      >
        {welcomeTemplateModalAudience ? (
          <form
            onSubmit={saveWelcomeTemplate}
            className="pulse-template-form"
            style={{ padding: '0 0 0.25rem' }}
          >
            {welcomeTemplateError ? <p className="error" style={{ marginBottom: '1rem' }}>{welcomeTemplateError}</p> : null}
            <div className="pulse-template-mode-switch" role="tablist" aria-label="Welcome template editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={welcomeTemplateEditorMode === 'edit'}
                className={`pulse-template-mode-switch__pill${
                  welcomeTemplateEditorMode === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setWelcomeTemplateEditorMode('edit')}
                disabled={welcomeTemplateSaving || welcomeTemplateResetting}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={welcomeTemplateEditorMode === 'view'}
                className={`pulse-template-mode-switch__pill${
                  welcomeTemplateEditorMode === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setWelcomeTemplateEditorMode('view')}
                disabled={welcomeTemplateSaving || welcomeTemplateResetting}
              >
                View
              </button>
            </div>
            {welcomeTemplateEditorMode === 'edit' ? (
              <div className="field">
                <label>Body</label>
                <EmailTemplateRichEditor
                  value={editingWelcomeTemplateBodyHtml}
                  onChange={setEditingWelcomeTemplateBodyHtml}
                  disabled={welcomeTemplateSaving || welcomeTemplateResetting}
                />
              </div>
            ) : (
              <div className="pulse-template-preview">
                <div className="pulse-template-preview__canvas" style={{ textAlign: 'center' }}>
                  <div
                    className="pulse-template-preview__body"
                    dangerouslySetInnerHTML={{ __html: previewWelcomeBodyHtml || '<p></p>' }}
                  />
                </div>
              </div>
            )}
            <p className="muted" style={{ margin: '0.45rem 0 0.75rem' }}>
              Optional placeholders: <code>{'{{name}}'}</code>, <code>{'{{clientName}}'}</code> and{' '}
              <code>{'{{contactInfo}}'}</code>. Capitalisation doesn&rsquo;t matter.
            </p>
            <div className="modal-dialog__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetWelcomeTemplateToTimepointDefault}
                disabled={welcomeTemplateSaving || welcomeTemplateResetting}
              >
                {welcomeTemplateResetting ? 'Resetting…' : 'Reset to default'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeWelcomeTemplateModal}
                disabled={welcomeTemplateSaving || welcomeTemplateResetting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary modal-dialog__submit"
                disabled={welcomeTemplateSaving || welcomeTemplateResetting}
              >
                {welcomeTemplateSaving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </form>
        ) : null}
      </ModalDialog>
    </div>
  );
}
