import { useOutletContext } from 'react-router-dom';
import RecentActivityPanel from '../components/platform/RecentActivityPanel.jsx';

export default function PlatformClientActivity() {
  const { orgId } = useOutletContext();
  return (
    <RecentActivityPanel orgId={orgId} resourcePath="/api/platform/organizations" style={{ marginBottom: 0 }} />
  );
}
