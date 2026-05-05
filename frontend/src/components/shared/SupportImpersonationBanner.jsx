import { useState, useEffect } from 'react';
import api, { setAuthToken } from '../../services/api.js';

/**
 * SUP-01 visual reminder when the current session is a read-only
 * support impersonation. Renders nothing in normal sessions. The
 * "Exit support session" button restores the previous admin token and
 * sends the user back to the platform home.
 */
export default function SupportImpersonationBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(sessionStorage.getItem('pulse_support_impersonation') === '1');
  }, []);

  if (!active) return null;

  return (
    <div
      role="status"
      style={{
        background: '#fef3c7',
        color: '#78350f',
        padding: '0.5rem 1rem',
        textAlign: 'center',
        fontSize: '0.85rem',
        borderBottom: '1px solid #fcd34d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
      }}
    >
      <strong>Support session — read only.</strong>
      <span>Writes are disabled. All viewing is audit logged.</span>
      <button
        type="button"
        onClick={() => {
          const previous = sessionStorage.getItem('pulse_token__pre_impersonate');
          sessionStorage.removeItem('pulse_support_impersonation');
          sessionStorage.removeItem('pulse_token__pre_impersonate');
          if (previous) {
            setAuthToken(previous);
          } else {
            setAuthToken(null);
          }
          api.defaults.headers.common.Authorization = previous ? `Bearer ${previous}` : undefined;
          window.location.assign('/platform');
        }}
        style={{
          background: '#fff',
          border: '1px solid #d97706',
          color: '#78350f',
          padding: '0.2rem 0.6rem',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
      >
        Exit support session
      </button>
    </div>
  );
}
