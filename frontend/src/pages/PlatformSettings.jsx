import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Link2, List, ListOrdered, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformOnlyAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import api from '../services/api.js';
import {
  CLIENT_SERVICE_LICENSEE,
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  normalizeServiceCatalog,
} from '../utils/clientServices.js';
import StatusIncidentsAdminPanel from '../components/platform/StatusIncidentsAdminPanel.jsx';
import LicenseeHealthPanel from '../components/platform/LicenseeHealthPanel.jsx';
import AnnouncementsAdminPanel from '../components/platform/AnnouncementsAdminPanel.jsx';
import CustomFiltersPanel from '../components/platform/CustomFiltersPanel.jsx';

const LOCKED_SERVICE_IDS = new Set([
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_LICENSEE,
  CLIENT_SERVICE_OTHER,
]);
const TEMPLATE_MAX_SUBJECT_LENGTH = 200;

const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'custom-filters', label: 'Custom Filters' },
  { id: 'rhythm-engine', label: 'Rhythm Engine' },
  { id: 'licensees', label: 'Practitioners' },
  { id: 'communications', label: 'Communications' },
];
const SETTINGS_TAB_IDS = new Set(SETTINGS_TABS.map((tab) => tab.id));
const DEFAULT_SETTINGS_TAB = 'general';
const TEMPLATE_TIMEPOINT_OPTIONS = [
  { value: 'pre', label: 'Pre' },
  { value: 'during', label: 'During' },
  { value: 'post', label: 'Post' },
];

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function defaultTemplateForAudience(audience) {
  if (audience === 'manager') {
    return {
      subject: 'Rhythm Engine manager questionnaire',
      bodyHtml:
        '<p>Hi {{name}},</p><p>You have been invited to complete the manager Rhythm Engine questionnaire.</p><p style="margin: 1.2rem 0;"><a href="{{link}}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Rhythm Engine</a></p>',
    };
  }
  return {
    subject: 'Rhythm Engine questionnaire',
    bodyHtml:
      '<p>Hi {{name}},</p><p>You have been invited to complete a short Rhythm Engine questionnaire.</p><p style="margin: 1.2rem 0;"><a href="{{link}}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #ffcc80; color: #1c1917; font-weight: 600; text-decoration: none; border-radius: 8px;">Open Rhythm Engine</a></p>',
  };
}

const LICENSEE_WELCOME_TEMPLATE_PLACEHOLDERS = ['name', 'licenseeName', 'loginLink', 'setPasswordLink', 'tokenDays'];

function defaultLicenseeWelcomeEmailTemplate() {
  return {
    subject: 'Welcome to Outlier — your licensee workspace is ready',
    bodyHtml: [
      '<h2 style="margin: 0 0 1rem;">Your licensee workspace is ready</h2>',
      '<p style="color: #555; line-height: 1.6;">Hi {{name}},</p>',
      '<p style="color: #555; line-height: 1.6;">',
      'Welcome to Outlier. Your <strong>{{licenseeName}}</strong> licensee workspace has been provisioned and is ready for you to start onboarding clients.',
      '</p>',
      '<p style="color: #555; line-height: 1.6;">',
      'Use <strong>Create password</strong> below to set a password for your account (the link expires in {{tokenDays}} days), then use <strong>Sign in</strong> to access your workspace.',
      '</p>',
    ].join('\n'),
  };
}

function normalizeLicenseeWelcomeTemplate(raw) {
  const fallback = defaultLicenseeWelcomeEmailTemplate();
  const source = raw && typeof raw === 'object' ? raw : {};
  const subject = String(source.subject || '').trim();
  const bodyHtml = String(source.bodyHtml || '').trim();
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
  };
}

function defaultWelcomeTemplateForAudience(audience) {
  if (audience === 'manager') {
    return {
      bodyHtml:
        '<p>You’ve been invited to share a short, honest view of how work feels day to day. Most people finish in about five to ten minutes.</p><p>Your perspective as a manager helps leaders see what’s working and what might need attention.</p>',
    };
  }
  return {
    bodyHtml:
      '<p>You’ve been invited to share a short, honest view of how work feels day to day. Most people finish in about five to ten minutes.</p><p>Your answers help leaders understand what’s working and what might need attention.</p>',
  };
}

function templateTimepointLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'during' || normalized === 'mid') return 'During';
  if (normalized === 'post' || normalized === 'completed') return 'Post';
  return 'Pre';
}

function EmailTemplateRichEditor({ value, onChange, disabled, placeholder }) {
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
          placeholder:
            placeholder || 'Write email body. Use {{name}}, {{link}}, {{dueDate}}, and {{clientname}} placeholders.',
        }),
      ],
      content: value || '<p></p>',
      editable: !disabled,
      onUpdate: ({ editor: nextEditor }) => {
        onChange(nextEditor.getHTML());
      },
    },
    [disabled, placeholder]
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
    return <div className="task-card-modal__rte task-card-modal__rte--loading muted">Loading editor...</div>;
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

function normalizeDefaultTemplates(rawTemplates) {
  const templates = rawTemplates && typeof rawTemplates === 'object' ? rawTemplates : {};
  return {
    staff: {
      ...defaultTemplateForAudience('staff'),
      ...(templates.staff && typeof templates.staff === 'object' ? templates.staff : {}),
    },
    manager: {
      ...defaultTemplateForAudience('manager'),
      ...(templates.manager && typeof templates.manager === 'object' ? templates.manager : {}),
    },
  };
}

function normalizeDefaultWelcomeTemplates(rawTemplates) {
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

export default function PlatformSettings() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const ok = usePlatformOnlyAccess(user, loading, navigate);
  const isPlatformAdmin = ok && user?.role === 'admin';
  // Basic tier loses Settings visibility entirely (same blank-page result
  // non-admins already got here, just made explicit). Platform tier is
  // meant to get read-only visibility per spec, but isPlatformAdmin below
  // still blanks the whole page for non-admins rather than rendering a
  // read-only mode — untangling that across every tab here is follow-up
  // work, not done in this pass.
  const isBasicTier = ok && user?.role === 'basic';
  useEffect(() => {
    if (isBasicTier) navigate('/platform');
  }, [isBasicTier, navigate]);

  const initialTab = (() => {
    const fromHash = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
    return SETTINGS_TAB_IDS.has(fromHash) ? fromHash : DEFAULT_SETTINGS_TAB;
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceMessage, setServiceMessage] = useState('');
  const [serviceError, setServiceError] = useState('');
  // Rhythm Engine Practitioner status is chosen via the Practitioner/
  // Enterprise prompt in NewClientModal, not toggled independently — it
  // has no separate configuration a platform admin can edit, so it's
  // hidden here to avoid presenting it as a second, separately-managed
  // service.
  const visibleServiceCatalog = serviceCatalog.filter((service) => service.id !== CLIENT_SERVICE_LICENSEE);
  const [loadingDefaultTemplates, setLoadingDefaultTemplates] = useState(false);
  const [savingDefaultTemplates, setSavingDefaultTemplates] = useState({
    staff: false,
    manager: false,
  });
  const [defaultTemplateMessage, setDefaultTemplateMessage] = useState('');
  const [defaultTemplateError, setDefaultTemplateError] = useState('');
  const [loadingDefaultWelcomeTemplates, setLoadingDefaultWelcomeTemplates] = useState(false);
  const [savingDefaultWelcomeTemplates, setSavingDefaultWelcomeTemplates] = useState({
    staff: false,
    manager: false,
  });
  const [defaultWelcomeTemplateMessage, setDefaultWelcomeTemplateMessage] = useState('');
  const [defaultWelcomeTemplateError, setDefaultWelcomeTemplateError] = useState('');
  const [defaultEmailTemplateTimepoint, setDefaultEmailTemplateTimepoint] = useState('pre');
  const [defaultWelcomeTemplateTimepoint, setDefaultWelcomeTemplateTimepoint] = useState('pre');
  const [defaultTemplates, setDefaultTemplates] = useState(() => normalizeDefaultTemplates(null));
  const [defaultWelcomeTemplates, setDefaultWelcomeTemplates] = useState(() => normalizeDefaultWelcomeTemplates(null));
  const [templateEditorMode, setTemplateEditorMode] = useState({
    staff: 'edit',
    manager: 'edit',
  });
  const [welcomeTemplateEditorMode, setWelcomeTemplateEditorMode] = useState({
    staff: 'edit',
    manager: 'edit',
  });
  const anySavingDefaultTemplates = savingDefaultTemplates.staff || savingDefaultTemplates.manager;
  const anySavingDefaultWelcomeTemplates =
    savingDefaultWelcomeTemplates.staff || savingDefaultWelcomeTemplates.manager;

  const [licenseeWelcomeTemplate, setLicenseeWelcomeTemplate] = useState(() =>
    normalizeLicenseeWelcomeTemplate(null)
  );
  const [loadingLicenseeWelcomeTemplate, setLoadingLicenseeWelcomeTemplate] = useState(false);
  const [savingLicenseeWelcomeTemplate, setSavingLicenseeWelcomeTemplate] = useState(false);
  const [licenseeWelcomeTemplateMessage, setLicenseeWelcomeTemplateMessage] = useState('');
  const [licenseeWelcomeTemplateError, setLicenseeWelcomeTemplateError] = useState('');
  const [licenseeWelcomeTemplateMode, setLicenseeWelcomeTemplateMode] = useState('edit');

  const previewName = 'Alex';
  const previewClientName = 'Acme Co';
  const previewDueDate = '30 Apr 2026';
  const previewStage = defaultEmailTemplateTimepoint === 'during'
    ? 'during'
    : defaultEmailTemplateTimepoint === 'post'
      ? 'post'
      : 'pre';
  const previewLink = `https://app.employeepulse.app/rhythm-engine/${previewStage}/link/your-personal-token`;
  const staffPreviewSubject = applyTemplatePlaceholders(defaultTemplates.staff.subject, {
    name: previewName,
    link: previewLink,
    dueDate: previewDueDate,
    duedate: previewDueDate,
    clientname: previewClientName,
    clientName: previewClientName,
  });
  const managerPreviewSubject = applyTemplatePlaceholders(defaultTemplates.manager.subject, {
    name: previewName,
    link: previewLink,
    dueDate: previewDueDate,
    duedate: previewDueDate,
    clientname: previewClientName,
    clientName: previewClientName,
  });
  const staffPreviewBodyHtml = applyTemplatePlaceholders(defaultTemplates.staff.bodyHtml, {
    name: previewName,
    link: previewLink,
    dueDate: previewDueDate,
    duedate: previewDueDate,
    clientname: previewClientName,
    clientName: previewClientName,
  });
  const managerPreviewBodyHtml = applyTemplatePlaceholders(defaultTemplates.manager.bodyHtml, {
    name: previewName,
    link: previewLink,
    dueDate: previewDueDate,
    duedate: previewDueDate,
    clientname: previewClientName,
    clientName: previewClientName,
  });

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      setLoadingCatalog(true);
      setServiceError('');
      try {
        const { data } = await api.get('/api/platform/service-catalog');
        const normalized = normalizeServiceCatalog(data.services, { fallbackToDefaults: false }).map((service) => ({
          key: service.id,
          id: service.id,
          name: service.name,
        }));
        setServiceCatalog(normalized);
      } catch (err) {
        setServiceError(err.response?.data?.error || 'Could not load service catalog.');
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      setLoadingDefaultTemplates(true);
      setDefaultTemplateError('');
      try {
        const { data } = await api.get('/api/platform/rhythm-engine-link-invites/default-templates', {
          params: { timepoint: defaultEmailTemplateTimepoint },
        });
        setDefaultTemplates(normalizeDefaultTemplates(data?.templates));
      } catch (err) {
        setDefaultTemplateError(err.response?.data?.error || 'Could not load default email templates.');
      } finally {
        setLoadingDefaultTemplates(false);
      }
    })();
  }, [defaultEmailTemplateTimepoint, isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      setLoadingDefaultWelcomeTemplates(true);
      setDefaultWelcomeTemplateError('');
      try {
        const { data } = await api.get('/api/platform/rhythm-engine-link-invites/default-survey-start-templates', {
          params: { timepoint: defaultWelcomeTemplateTimepoint },
        });
        setDefaultWelcomeTemplates(normalizeDefaultWelcomeTemplates(data?.templates));
      } catch (err) {
        setDefaultWelcomeTemplateError(err.response?.data?.error || 'Could not load default welcome templates.');
      } finally {
        setLoadingDefaultWelcomeTemplates(false);
      }
    })();
  }, [defaultWelcomeTemplateTimepoint, isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      setLoadingLicenseeWelcomeTemplate(true);
      setLicenseeWelcomeTemplateError('');
      try {
        const { data } = await api.get('/api/platform/licensee-welcome-email-template');
        setLicenseeWelcomeTemplate(normalizeLicenseeWelcomeTemplate(data?.template));
      } catch (err) {
        setLicenseeWelcomeTemplateError(
          err.response?.data?.error || 'Could not load licensee welcome email template.'
        );
      } finally {
        setLoadingLicenseeWelcomeTemplate(false);
      }
    })();
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!loading && ok && user?.role !== 'admin') {
      navigate('/platform', { replace: true });
    }
  }, [loading, ok, user, navigate]);

  useEffect(() => {
    const fromHash = String(location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (SETTINGS_TAB_IDS.has(fromHash) && fromHash !== activeTab) {
      setActiveTab(fromHash);
    }
  }, [location.hash, activeTab]);

  function changeTab(nextTab) {
    if (!SETTINGS_TAB_IDS.has(nextTab) || nextTab === activeTab) return;
    setActiveTab(nextTab);
    navigate(`#${nextTab}`, { replace: false });
  }

  function updateServiceName(key, name) {
    setServiceCatalog((current) =>
      current.map((service) =>
        service.key === key
          ? {
              ...service,
              name:
                service.id === CLIENT_SERVICE_PULSE
                  ? 'Rhythm Engine'
                  : service.id === CLIENT_SERVICE_LICENSEE
                    ? 'Rhythm Engine Practitioner'
                    : service.id === CLIENT_SERVICE_OTHER
                      ? 'Other'
                      : name,
            }
          : service
      )
    );
  }

  function addServiceRow() {
    const trimmed = newServiceName.trim();
    if (!trimmed) return;
    setServiceCatalog((current) => [
      ...current,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        id: '',
        name: trimmed,
      },
    ]);
    setNewServiceName('');
  }

  function removeServiceRow(key, name) {
    const label = String(name || '').trim() || 'this service';
    if (!window.confirm(`Delete "${label}" from the service catalog?`)) return;
    setServiceCatalog((current) => current.filter((service) => service.key !== key));
  }

  async function saveServiceCatalog(e) {
    e.preventDefault();
    const nextServices = serviceCatalog
      .map((service) => ({
        id: String(service.id || '').trim(),
        name:
          service.id === CLIENT_SERVICE_PULSE
            ? 'Rhythm Engine'
            : service.id === CLIENT_SERVICE_LICENSEE
              ? 'Rhythm Engine Practitioner'
              : service.id === CLIENT_SERVICE_OTHER
                ? 'Other'
                : String(service.name || '').trim(),
      }))
      .filter((service) => service.name);
    if (nextServices.length !== serviceCatalog.length) {
      setServiceError('Each service needs a name before saving.');
      setServiceMessage('');
      return;
    }
    setServiceSaving(true);
    setServiceMessage('');
    setServiceError('');
    try {
      const { data } = await api.patch('/api/platform/service-catalog', {
        services: nextServices,
      });
      const normalized = normalizeServiceCatalog(data.services, { fallbackToDefaults: false }).map((service) => ({
        key: service.id,
        id: service.id,
        name: service.name,
      }));
      setServiceCatalog(normalized);
      setServiceMessage('Service catalog saved.');
    } catch (err) {
      setServiceError(err.response?.data?.error || 'Could not save service catalog.');
    } finally {
      setServiceSaving(false);
    }
  }

  function updateDefaultTemplateField(audience, field, value) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    setDefaultTemplates((current) => ({
      ...current,
      [role]: {
        ...(current[role] || defaultTemplateForAudience(role)),
        [field]: value,
      },
    }));
  }

  async function saveDefaultTemplate(audience) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const template = defaultTemplates[role] || defaultTemplateForAudience(role);
    const subject = String(template.subject || '').trim();
    const bodyHtml = String(template.bodyHtml || '').trim();
    if (!subject || !stripHtmlToText(bodyHtml)) {
      setDefaultTemplateError('Each default template needs both a subject and body.');
      setDefaultTemplateMessage('');
      return;
    }
    setSavingDefaultTemplates((current) => ({ ...current, [role]: true }));
    setDefaultTemplateError('');
    setDefaultTemplateMessage('');
    try {
      const { data } = await api.put('/api/platform/rhythm-engine-link-invites/default-templates', {
        audience: role,
        subject,
        bodyHtml,
      }, {
        params: { timepoint: defaultEmailTemplateTimepoint },
      });
      setDefaultTemplates(normalizeDefaultTemplates(data?.templates));
      setDefaultTemplateMessage(
        `${templateTimepointLabel(defaultEmailTemplateTimepoint)} ${role === 'manager' ? 'manager' : 'staff'} default template saved.`
      );
    } catch (err) {
      setDefaultTemplateError(err.response?.data?.error || 'Could not save default email template.');
    } finally {
      setSavingDefaultTemplates((current) => ({ ...current, [role]: false }));
    }
  }

  function updateDefaultWelcomeTemplateField(audience, value) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    setDefaultWelcomeTemplates((current) => ({
      ...current,
      [role]: {
        ...(current[role] || defaultWelcomeTemplateForAudience(role)),
        bodyHtml: value,
      },
    }));
  }

  async function saveDefaultWelcomeTemplate(audience) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const template = defaultWelcomeTemplates[role] || defaultWelcomeTemplateForAudience(role);
    const bodyHtml = String(template.bodyHtml || '').trim();
    if (!stripHtmlToText(bodyHtml)) {
      setDefaultWelcomeTemplateError('Each welcome template needs body copy.');
      setDefaultWelcomeTemplateMessage('');
      return;
    }
    setSavingDefaultWelcomeTemplates((current) => ({ ...current, [role]: true }));
    setDefaultWelcomeTemplateError('');
    setDefaultWelcomeTemplateMessage('');
    try {
      const { data } = await api.put('/api/platform/rhythm-engine-link-invites/default-survey-start-templates', {
        audience: role,
        bodyHtml,
      }, {
        params: { timepoint: defaultWelcomeTemplateTimepoint },
      });
      setDefaultWelcomeTemplates(normalizeDefaultWelcomeTemplates(data?.templates));
      setDefaultWelcomeTemplateMessage(
        `${templateTimepointLabel(defaultWelcomeTemplateTimepoint)} ${role === 'manager' ? 'manager' : 'staff'} default welcome template saved.`
      );
    } catch (err) {
      setDefaultWelcomeTemplateError(err.response?.data?.error || 'Could not save default welcome template.');
    } finally {
      setSavingDefaultWelcomeTemplates((current) => ({ ...current, [role]: false }));
    }
  }

  function updateLicenseeWelcomeTemplateField(field, value) {
    setLicenseeWelcomeTemplate((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveLicenseeWelcomeTemplate() {
    const subject = String(licenseeWelcomeTemplate.subject || '').trim();
    const bodyHtml = String(licenseeWelcomeTemplate.bodyHtml || '').trim();
    if (!subject || !stripHtmlToText(bodyHtml)) {
      setLicenseeWelcomeTemplateError('Subject and body are both required.');
      setLicenseeWelcomeTemplateMessage('');
      return;
    }
    setSavingLicenseeWelcomeTemplate(true);
    setLicenseeWelcomeTemplateError('');
    setLicenseeWelcomeTemplateMessage('');
    try {
      const { data } = await api.put('/api/platform/licensee-welcome-email-template', {
        subject,
        bodyHtml,
      });
      setLicenseeWelcomeTemplate(normalizeLicenseeWelcomeTemplate(data?.template));
      setLicenseeWelcomeTemplateMessage('Practitioner welcome email template saved.');
    } catch (err) {
      setLicenseeWelcomeTemplateError(
        err.response?.data?.error || 'Could not save licensee welcome email template.'
      );
    } finally {
      setSavingLicenseeWelcomeTemplate(false);
    }
  }

  const licenseeWelcomePreviewSubject = applyTemplatePlaceholders(licenseeWelcomeTemplate.subject, {
    name: previewName,
    licenseeName: 'Acme Consulting',
    licenseename: 'Acme Consulting',
    tokenDays: '7',
    tokendays: '7',
  });
  const licenseeWelcomePreviewBodyHtml = applyTemplatePlaceholders(licenseeWelcomeTemplate.bodyHtml, {
    name: previewName,
    licenseeName: 'Acme Consulting',
    licenseename: 'Acme Consulting',
    tokenDays: '7',
    tokendays: '7',
  });

  useDocumentTitle(!loading && isPlatformAdmin ? `Settings | ${DEFAULT_TAB}` : null);

  if (loading || !isPlatformAdmin) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <SlidersHorizontal size={28} strokeWidth={1.75} aria-hidden />
            Settings
          </h1>
        </div>
      </div>
      <div
        className="pulse-template-mode-switch"
        role="tablist"
        aria-label="Settings sections"
        style={{ marginTop: '1rem', marginBottom: 0 }}
      >
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-tab-${tab.id}`}
            id={`settings-tab-trigger-${tab.id}`}
            className={`pulse-template-mode-switch__pill${
              activeTab === tab.id ? ' pulse-template-mode-switch__pill--active' : ''
            }`}
            onClick={() => changeTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'general' && (
      <div
        role="tabpanel"
        id="settings-tab-general"
        aria-labelledby="settings-tab-trigger-general"
      >
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Service catalog</h2>
        {serviceError ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {serviceError}
          </p>
        ) : null}
        {serviceMessage ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {serviceMessage}
          </p>
        ) : null}
        <form onSubmit={saveServiceCatalog}>
          <div className="table-wrap service-catalog-table-wrap">
            <table className="admin-table service-catalog-table">
              <thead>
                <tr>
                  <th scope="col">Service name</th>
                  <th scope="col" style={{ width: '1%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingCatalog ? (
                  <tr>
                    <td colSpan={2} className="muted" style={{ padding: '1rem' }}>
                      Loading services...
                    </td>
                  </tr>
                ) : visibleServiceCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted" style={{ padding: '1rem' }}>
                      No services yet. Add your first service below.
                    </td>
                  </tr>
                ) : (
                  visibleServiceCatalog.map((service) => (
                    <tr key={service.key}>
                      <td>
                        <div className="service-catalog-name-cell">
                        <input
                          className="service-catalog-input"
                          value={service.name}
                          onChange={(e) => updateServiceName(service.key, e.target.value)}
                          disabled={serviceSaving || LOCKED_SERVICE_IDS.has(service.id)}
                          aria-label="Service name"
                        />
                          {service.id === CLIENT_SERVICE_PULSE ? (
                            <span className="badge badge-active">Required</span>
                          ) : service.id === CLIENT_SERVICE_LICENSEE ? (
                            <span className="badge badge-active">Locked</span>
                          ) : service.id === CLIENT_SERVICE_OTHER ? (
                            <span className="badge badge-active">Locked</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {LOCKED_SERVICE_IDS.has(service.id) ? (
                          <span className="muted" style={{ fontSize: '0.85rem' }}>
                            Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost service-catalog-remove-btn"
                            disabled={serviceSaving}
                            onClick={() => removeServiceRow(service.key, service.name)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="service-catalog-add-row" style={{ marginTop: '0.9rem' }}>
            <input
              className="service-catalog-input"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
              placeholder="Add a new service name"
              disabled={serviceSaving}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={serviceSaving || !newServiceName.trim()}
              onClick={addServiceRow}
            >
              Add service
            </button>
          </div>
          <button type="submit" className="btn btn-ghost" disabled={serviceSaving || loadingCatalog} style={{ marginTop: '0.9rem' }}>
            Save services
          </button>
        </form>
      </div>
      </div>
      )}
      {activeTab === 'custom-filters' && (
      <div
        role="tabpanel"
        id="settings-tab-custom-filters"
        aria-labelledby="settings-tab-trigger-custom-filters"
      >
        <CustomFiltersPanel isAdmin={isPlatformAdmin} />
      </div>
      )}
      {activeTab === 'rhythm-engine' && (
      <div
        role="tabpanel"
        id="settings-tab-rhythm-engine"
        aria-labelledby="settings-tab-trigger-rhythm-engine"
      >
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Rhythm Engine default email templates</h2>
        <p className="muted" style={{ margin: '0.45rem 0 0.95rem' }}>
          These are the system-wide defaults used for every client. Teams can still edit templates per client in Rhythm Engine.
        </p>
        <div
          className="pulse-template-mode-switch"
          role="tablist"
          aria-label="Default template survey stage"
          style={{ marginBottom: '0.9rem' }}
        >
          {TEMPLATE_TIMEPOINT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={defaultEmailTemplateTimepoint === option.value}
              className={`pulse-template-mode-switch__pill${
                defaultEmailTemplateTimepoint === option.value ? ' pulse-template-mode-switch__pill--active' : ''
              }`}
              onClick={() => setDefaultEmailTemplateTimepoint(option.value)}
              disabled={loadingDefaultTemplates || anySavingDefaultTemplates}
            >
              {option.label}
            </button>
          ))}
        </div>
        {defaultTemplateError ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {defaultTemplateError}
          </p>
        ) : null}
        {defaultTemplateMessage ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {defaultTemplateMessage}
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: '1rem' }}>
          <section aria-labelledby="settings-staff-default-template">
            <h3 id="settings-staff-default-template" style={{ margin: 0 }}>Staff default template</h3>
            <div className="field" style={{ marginTop: '0.65rem' }}>
              <label htmlFor="settings-staff-template-subject">Subject</label>
              <input
                id="settings-staff-template-subject"
                value={defaultTemplates.staff.subject}
                maxLength={TEMPLATE_MAX_SUBJECT_LENGTH}
                onChange={(e) => updateDefaultTemplateField('staff', 'subject', e.target.value)}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.staff}
              />
            </div>
            <div className="pulse-template-mode-switch" role="tablist" aria-label="Staff template editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode.staff === 'edit'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode.staff === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode((current) => ({ ...current, staff: 'edit' }))}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.staff}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode.staff === 'view'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode.staff === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode((current) => ({ ...current, staff: 'view' }))}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.staff}
              >
                View
              </button>
            </div>
            <div className="field">
              <label>{templateEditorMode.staff === 'view' ? 'Preview' : 'Body'}</label>
              {templateEditorMode.staff === 'view' ? (
                <div className="pulse-template-preview">
                  <div className="pulse-template-preview__subject">{staffPreviewSubject || '(No subject)'}</div>
                  <div className="pulse-template-preview__canvas">
                    <div
                      className="pulse-template-preview__body"
                      dangerouslySetInnerHTML={{ __html: staffPreviewBodyHtml || '<p></p>' }}
                    />
                    <p className="pulse-template-preview__footer">
                      If the button does not work, copy and paste this URL into your browser:
                      <br />
                      <span>{previewLink}</span>
                    </p>
                  </div>
                </div>
              ) : (
                <EmailTemplateRichEditor
                  value={defaultTemplates.staff.bodyHtml}
                  onChange={(nextBodyHtml) => updateDefaultTemplateField('staff', 'bodyHtml', nextBodyHtml)}
                  disabled={loadingDefaultTemplates || savingDefaultTemplates.staff}
                  placeholder="Write staff email body. Use {{name}}, {{link}}, {{dueDate}}, and {{clientname}} placeholders."
                />
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loadingDefaultTemplates || savingDefaultTemplates.staff}
              onClick={() => saveDefaultTemplate('staff')}
            >
              {savingDefaultTemplates.staff ? 'Saving…' : 'Save staff default'}
            </button>
          </section>
          <section aria-labelledby="settings-manager-default-template">
            <h3 id="settings-manager-default-template" style={{ margin: 0 }}>Manager default template</h3>
            <div className="field" style={{ marginTop: '0.65rem' }}>
              <label htmlFor="settings-manager-template-subject">Subject</label>
              <input
                id="settings-manager-template-subject"
                value={defaultTemplates.manager.subject}
                maxLength={TEMPLATE_MAX_SUBJECT_LENGTH}
                onChange={(e) => updateDefaultTemplateField('manager', 'subject', e.target.value)}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.manager}
              />
            </div>
            <div className="pulse-template-mode-switch" role="tablist" aria-label="Manager template editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode.manager === 'edit'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode.manager === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode((current) => ({ ...current, manager: 'edit' }))}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.manager}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateEditorMode.manager === 'view'}
                className={`pulse-template-mode-switch__pill${
                  templateEditorMode.manager === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
                }`}
                onClick={() => setTemplateEditorMode((current) => ({ ...current, manager: 'view' }))}
                disabled={loadingDefaultTemplates || savingDefaultTemplates.manager}
              >
                View
              </button>
            </div>
            <div className="field">
              <label>{templateEditorMode.manager === 'view' ? 'Preview' : 'Body'}</label>
              {templateEditorMode.manager === 'view' ? (
                <div className="pulse-template-preview">
                  <div className="pulse-template-preview__subject">{managerPreviewSubject || '(No subject)'}</div>
                  <div className="pulse-template-preview__canvas">
                    <div
                      className="pulse-template-preview__body"
                      dangerouslySetInnerHTML={{ __html: managerPreviewBodyHtml || '<p></p>' }}
                    />
                    <p className="pulse-template-preview__footer">
                      If the button does not work, copy and paste this URL into your browser:
                      <br />
                      <span>{previewLink}</span>
                    </p>
                  </div>
                </div>
              ) : (
                <EmailTemplateRichEditor
                  value={defaultTemplates.manager.bodyHtml}
                  onChange={(nextBodyHtml) => updateDefaultTemplateField('manager', 'bodyHtml', nextBodyHtml)}
                  disabled={loadingDefaultTemplates || savingDefaultTemplates.manager}
                  placeholder="Write manager email body. Use {{name}}, {{link}}, {{dueDate}}, and {{clientname}} placeholders."
                />
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loadingDefaultTemplates || savingDefaultTemplates.manager}
              onClick={() => saveDefaultTemplate('manager')}
            >
              {savingDefaultTemplates.manager ? 'Saving…' : 'Save manager default'}
            </button>
          </section>
        </div>
        <p className="muted" style={{ margin: '0.95rem 0 0' }}>
          Placeholders available in subject and body: <code>{'{{name}}'}</code>, <code>{'{{link}}'}</code>,{' '}
          <code>{'{{dueDate}}'}</code>, <code>{'{{clientname}}'}</code>.
        </p>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Rhythm Engine default welcome templates</h2>
        <p className="muted" style={{ margin: '0.45rem 0 0.95rem' }}>
          This controls the first page users see when they open a Rhythm Engine survey link. Teams can still override
          these per client and per survey timepoint.
        </p>
        <div
          className="pulse-template-mode-switch"
          role="tablist"
          aria-label="Default welcome template survey stage"
          style={{ marginBottom: '0.9rem' }}
        >
          {TEMPLATE_TIMEPOINT_OPTIONS.map((option) => (
            <button
              key={`welcome-${option.value}`}
              type="button"
              role="tab"
              aria-selected={defaultWelcomeTemplateTimepoint === option.value}
              className={`pulse-template-mode-switch__pill${
                defaultWelcomeTemplateTimepoint === option.value ? ' pulse-template-mode-switch__pill--active' : ''
              }`}
              onClick={() => setDefaultWelcomeTemplateTimepoint(option.value)}
              disabled={loadingDefaultWelcomeTemplates || anySavingDefaultWelcomeTemplates}
            >
              {option.label}
            </button>
          ))}
        </div>
        {defaultWelcomeTemplateError ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {defaultWelcomeTemplateError}
          </p>
        ) : null}
        {defaultWelcomeTemplateMessage ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {defaultWelcomeTemplateMessage}
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: '1rem' }}>
          {(['staff', 'manager']).map((role) => (
            <section
              key={`welcome-template-${role}`}
              aria-labelledby={`settings-${role}-welcome-template`}
            >
              <h3 id={`settings-${role}-welcome-template`} style={{ margin: 0 }}>
                {role === 'manager' ? 'Manager' : 'Staff'} default welcome template
              </h3>
              <div className="pulse-template-mode-switch" role="tablist" aria-label={`${role} welcome template editor mode`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={welcomeTemplateEditorMode[role] === 'edit'}
                  className={`pulse-template-mode-switch__pill${
                    welcomeTemplateEditorMode[role] === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
                  }`}
                  onClick={() => setWelcomeTemplateEditorMode((current) => ({ ...current, [role]: 'edit' }))}
                  disabled={loadingDefaultWelcomeTemplates || savingDefaultWelcomeTemplates[role]}
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={welcomeTemplateEditorMode[role] === 'view'}
                  className={`pulse-template-mode-switch__pill${
                    welcomeTemplateEditorMode[role] === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
                  }`}
                  onClick={() => setWelcomeTemplateEditorMode((current) => ({ ...current, [role]: 'view' }))}
                  disabled={loadingDefaultWelcomeTemplates || savingDefaultWelcomeTemplates[role]}
                >
                  View
                </button>
              </div>
              <div className="field" style={{ marginTop: '0.65rem' }}>
                <label>{welcomeTemplateEditorMode[role] === 'view' ? 'Preview' : 'Body'}</label>
                {welcomeTemplateEditorMode[role] === 'view' ? (
                  <div className="pulse-template-preview">
                    <div className="pulse-template-preview__canvas">
                      <div
                        className="pulse-template-preview__body"
                        dangerouslySetInnerHTML={{ __html: defaultWelcomeTemplates[role]?.bodyHtml || '<p></p>' }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                      The survey page already shows a &lsquo;Welcome&rsquo; heading above this text,
                      so there is no need to repeat it here. Optional placeholder: <code>{'{{clientname}}'}</code>
                    </p>
                    <EmailTemplateRichEditor
                      value={defaultWelcomeTemplates[role]?.bodyHtml || '<p></p>'}
                      onChange={(nextBodyHtml) => updateDefaultWelcomeTemplateField(role, nextBodyHtml)}
                      disabled={loadingDefaultWelcomeTemplates || savingDefaultWelcomeTemplates[role]}
                      placeholder="Write welcome page copy. This appears on the first survey screen."
                    />
                  </>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loadingDefaultWelcomeTemplates || savingDefaultWelcomeTemplates[role]}
                onClick={() => saveDefaultWelcomeTemplate(role)}
              >
                {savingDefaultWelcomeTemplates[role]
                  ? 'Saving…'
                  : `Save ${role === 'manager' ? 'manager' : 'staff'} default`}
              </button>
            </section>
          ))}
        </div>
      </div>
      </div>
      )}
      {activeTab === 'licensees' && (
      <div
        role="tabpanel"
        id="settings-tab-licensees"
        aria-labelledby="settings-tab-trigger-licensees"
      >
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Practitioner admin welcome email</h2>
        <p className="muted" style={{ margin: '0.45rem 0 0.95rem' }}>
          Sent to the first admin when a new Practitioner organisation is created
          (i.e. when "Practitioner" is chosen for a new Rhythm Engine org). The standard
          Outlier logo header, <strong>Create password</strong> and <strong>Sign in</strong>{' '}
          buttons, and link-fallback footer are added automatically — only the subject
          and editorial body below are configurable.
        </p>
        {licenseeWelcomeTemplateError ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {licenseeWelcomeTemplateError}
          </p>
        ) : null}
        {licenseeWelcomeTemplateMessage ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {licenseeWelcomeTemplateMessage}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="settings-licensee-welcome-subject">Subject</label>
          <input
            id="settings-licensee-welcome-subject"
            value={licenseeWelcomeTemplate.subject}
            maxLength={TEMPLATE_MAX_SUBJECT_LENGTH}
            onChange={(e) => updateLicenseeWelcomeTemplateField('subject', e.target.value)}
            disabled={loadingLicenseeWelcomeTemplate || savingLicenseeWelcomeTemplate}
          />
        </div>
        <div className="pulse-template-mode-switch" role="tablist" aria-label="Practitioner welcome template editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={licenseeWelcomeTemplateMode === 'edit'}
            className={`pulse-template-mode-switch__pill${
              licenseeWelcomeTemplateMode === 'edit' ? ' pulse-template-mode-switch__pill--active' : ''
            }`}
            onClick={() => setLicenseeWelcomeTemplateMode('edit')}
            disabled={loadingLicenseeWelcomeTemplate || savingLicenseeWelcomeTemplate}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={licenseeWelcomeTemplateMode === 'view'}
            className={`pulse-template-mode-switch__pill${
              licenseeWelcomeTemplateMode === 'view' ? ' pulse-template-mode-switch__pill--active' : ''
            }`}
            onClick={() => setLicenseeWelcomeTemplateMode('view')}
            disabled={loadingLicenseeWelcomeTemplate || savingLicenseeWelcomeTemplate}
          >
            View
          </button>
        </div>
        <div className="field">
          <label>{licenseeWelcomeTemplateMode === 'view' ? 'Preview' : 'Body'}</label>
          {licenseeWelcomeTemplateMode === 'view' ? (
            <div className="pulse-template-preview">
              <div className="pulse-template-preview__subject">
                {licenseeWelcomePreviewSubject || '(No subject)'}
              </div>
              <div className="pulse-template-preview__canvas">
                <div
                  className="pulse-template-preview__body"
                  dangerouslySetInnerHTML={{ __html: licenseeWelcomePreviewBodyHtml || '<p></p>' }}
                />
                <p className="pulse-template-preview__footer">
                  The standard Create password / Sign in buttons and footer are appended automatically.
                </p>
              </div>
            </div>
          ) : (
            <EmailTemplateRichEditor
              value={licenseeWelcomeTemplate.bodyHtml}
              onChange={(nextBodyHtml) => updateLicenseeWelcomeTemplateField('bodyHtml', nextBodyHtml)}
              disabled={loadingLicenseeWelcomeTemplate || savingLicenseeWelcomeTemplate}
              placeholder="Write the welcome email body. Use {{name}}, {{licenseeName}}, and {{tokenDays}} placeholders."
            />
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loadingLicenseeWelcomeTemplate || savingLicenseeWelcomeTemplate}
          onClick={saveLicenseeWelcomeTemplate}
        >
          {savingLicenseeWelcomeTemplate ? 'Saving…' : 'Save Practitioner welcome email'}
        </button>
        <p className="muted" style={{ margin: '0.95rem 0 0' }}>
          Placeholders available in subject and body:{' '}
          {LICENSEE_WELCOME_TEMPLATE_PLACEHOLDERS.map((token, idx) => (
            <span key={token}>
              {idx > 0 ? ', ' : ''}
              <code>{`{{${token}}}`}</code>
            </span>
          ))}
          . The <code>{'{{loginLink}}'}</code> and <code>{'{{setPasswordLink}}'}</code> URLs are
          generated per-recipient and only resolve inside the sent email.
        </p>
      </div>
      <LicenseeHealthPanel />
      </div>
      )}
      {activeTab === 'communications' && (
      <div
        role="tabpanel"
        id="settings-tab-communications"
        aria-labelledby="settings-tab-trigger-communications"
      >
        <AnnouncementsAdminPanel />
        <StatusIncidentsAdminPanel />
      </div>
      )}
    </Layout>
  );
}
