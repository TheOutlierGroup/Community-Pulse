import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import api from '../services/api.js';
import {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  normalizeServiceCatalog,
} from '../utils/clientServices.js';

const LOCKED_SERVICE_IDS = new Set([CLIENT_SERVICE_PULSE, CLIENT_SERVICE_OTHER]);
const TEMPLATE_MAX_SUBJECT_LENGTH = 200;

function defaultTemplateForAudience(audience) {
  if (audience === 'manager') {
    return {
      subject: 'Rhythm Engine manager questionnaire',
      bodyHtml:
        '<p>Hi {{name}},</p><p>You have been invited to complete the manager Rhythm Engine questionnaire.</p><p><a href="{{link}}">Open Rhythm Engine</a></p>',
    };
  }
  return {
    subject: 'Rhythm Engine questionnaire',
    bodyHtml:
      '<p>Hi {{name}},</p><p>You have been invited to complete a short Rhythm Engine questionnaire.</p><p><a href="{{link}}">Open Rhythm Engine</a></p>',
  };
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

export default function PlatformSettings() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const isPlatformAdmin = ok && user?.role === 'admin';
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceMessage, setServiceMessage] = useState('');
  const [serviceError, setServiceError] = useState('');
  const [loadingDefaultTemplates, setLoadingDefaultTemplates] = useState(false);
  const [savingDefaultTemplates, setSavingDefaultTemplates] = useState(false);
  const [defaultTemplateMessage, setDefaultTemplateMessage] = useState('');
  const [defaultTemplateError, setDefaultTemplateError] = useState('');
  const [defaultTemplates, setDefaultTemplates] = useState(() => normalizeDefaultTemplates(null));

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
        const { data } = await api.get('/api/platform/rhythm-engine-link-invites/default-templates');
        setDefaultTemplates(normalizeDefaultTemplates(data?.templates));
      } catch (err) {
        setDefaultTemplateError(err.response?.data?.error || 'Could not load default email templates.');
      } finally {
        setLoadingDefaultTemplates(false);
      }
    })();
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!loading && ok && user?.role !== 'admin') {
      navigate('/platform', { replace: true });
    }
  }, [loading, ok, user, navigate]);

  function updateServiceName(key, name) {
    setServiceCatalog((current) =>
      current.map((service) =>
        service.key === key
          ? {
              ...service,
              name:
                service.id === CLIENT_SERVICE_PULSE
                  ? 'Rhythm Engine'
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
    if (!subject || !bodyHtml) {
      setDefaultTemplateError('Each default template needs both a subject and body.');
      setDefaultTemplateMessage('');
      return;
    }
    setSavingDefaultTemplates(true);
    setDefaultTemplateError('');
    setDefaultTemplateMessage('');
    try {
      const { data } = await api.put('/api/platform/rhythm-engine-link-invites/default-templates', {
        audience: role,
        subject,
        bodyHtml,
      });
      setDefaultTemplates(normalizeDefaultTemplates(data?.templates));
      setDefaultTemplateMessage(`${role === 'manager' ? 'Manager' : 'Staff'} default template saved.`);
    } catch (err) {
      setDefaultTemplateError(err.response?.data?.error || 'Could not save default email template.');
    } finally {
      setSavingDefaultTemplates(false);
    }
  }

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
                ) : serviceCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted" style={{ padding: '1rem' }}>
                      No services yet. Add your first service below.
                    </td>
                  </tr>
                ) : (
                  serviceCatalog.map((service) => (
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
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Rhythm Engine default email templates</h2>
        <p className="muted" style={{ margin: '0.45rem 0 0.95rem' }}>
          These are the system-wide defaults used for every client. Teams can still edit templates per client in Rhythm Engine.
        </p>
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
                disabled={loadingDefaultTemplates || savingDefaultTemplates}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-staff-template-body">Body (HTML supported)</label>
              <textarea
                id="settings-staff-template-body"
                value={defaultTemplates.staff.bodyHtml}
                onChange={(e) => updateDefaultTemplateField('staff', 'bodyHtml', e.target.value)}
                disabled={loadingDefaultTemplates || savingDefaultTemplates}
                rows={6}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loadingDefaultTemplates || savingDefaultTemplates}
              onClick={() => saveDefaultTemplate('staff')}
            >
              {savingDefaultTemplates ? 'Saving…' : 'Save staff default'}
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
                disabled={loadingDefaultTemplates || savingDefaultTemplates}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-manager-template-body">Body (HTML supported)</label>
              <textarea
                id="settings-manager-template-body"
                value={defaultTemplates.manager.bodyHtml}
                onChange={(e) => updateDefaultTemplateField('manager', 'bodyHtml', e.target.value)}
                disabled={loadingDefaultTemplates || savingDefaultTemplates}
                rows={6}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loadingDefaultTemplates || savingDefaultTemplates}
              onClick={() => saveDefaultTemplate('manager')}
            >
              {savingDefaultTemplates ? 'Saving…' : 'Save manager default'}
            </button>
          </section>
        </div>
        <p className="muted" style={{ margin: '0.95rem 0 0' }}>
          Placeholders available in subject and body: <code>{'{{name}}'}</code>, <code>{'{{link}}'}</code>.
        </p>
      </div>
    </Layout>
  );
}
