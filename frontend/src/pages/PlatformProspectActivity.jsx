import { useOutletContext } from 'react-router-dom';
import RecentActivityPanel from '../components/platform/RecentActivityPanel.jsx';

export default function PlatformProspectActivity() {
  const { orgId } = useOutletContext();
  return (
    <RecentActivityPanel orgId={orgId} resourcePath="/api/platform/crm/organisations" style={{ marginBottom: 0 }} />
  );
}
