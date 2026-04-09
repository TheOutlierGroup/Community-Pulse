import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { normalizeServices } from './platformClientUtils.js';
import api from '../services/api.js';
import { IS_CRM_SURFACE, pulseAppBaseUrl } from '../config/appSurface.js';

export default function PlatformClientPulseShell() {
  const ctx = useOutletContext();
  const { org, orgId } = ctx || {};
  const navigate = useNavigate();
  const [handoffFailed, setHandoffFailed] = useState(false);
  const enabledServices = normalizeServices(org?.settings);
  const pulseEnabled = enabledServices.includes('pulse');

  useEffect(() => {
    if (org && !pulseEnabled) {
      navigate(`/platform/clients/${orgId}/account`, { replace: true });
    }
  }, [navigate, org, orgId, pulseEnabled]);

  useEffect(() => {
    if (!org || !pulseEnabled || !IS_CRM_SURFACE || handoffFailed) return;
    if (!pulseAppBaseUrl()) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post(`/api/platform/organizations/${orgId}/pulse-handoff-link`);
        if (cancelled) return;
        if (data?.url) {
          window.location.replace(data.url);
          return;
        }
        setHandoffFailed(true);
      } catch {
        if (!cancelled) setHandoffFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, orgId, pulseEnabled, handoffFailed]);

  if (!org || !pulseEnabled) return null;

  return <Outlet context={ctx} />;
}
