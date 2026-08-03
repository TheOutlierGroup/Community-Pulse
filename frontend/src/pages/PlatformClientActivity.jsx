import { useOutletContext } from 'react-router-dom';
import RecentActivityPanel from '../components/platform/RecentActivityPanel.jsx';

export default function PlatformClientActivity() {
  const { orgId, refreshOrg } = useOutletContext();
  return (
    <RecentActivityPanel
      orgId={orgId}
      resourcePath="/api/platform/organizations"
      style={{ marginBottom: 0 }}
      onReverted={refreshOrg}
    />
  );
}
