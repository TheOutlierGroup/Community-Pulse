import { useEffect } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { normalizeServices } from './platformClientUtils.js';

export default function PlatformClientPulseShell() {
  const ctx = useOutletContext();
  const { org, orgId } = ctx || {};
  const navigate = useNavigate();
  const enabledServices = normalizeServices(org?.settings);
  const pulseEnabled = enabledServices.includes('pulse');

  useEffect(() => {
    if (org && !pulseEnabled) {
      navigate(`/platform/clients/${orgId}/account`, { replace: true });
    }
  }, [navigate, org, orgId, pulseEnabled]);

  if (!org || !pulseEnabled) return null;

  return <Outlet context={ctx} />;
}
