import { useCallback, useEffect, useRef, useState } from 'react';
import { setMfaReverifyPrompt } from '../../services/api.js';

/**
 * Step-up multi-factor prompt.
 *
 * Admin verification is only good for the server's re-verify window; once
 * it lapses, protected actions answer 403 with `mfaReverifyRequired`. The
 * api interceptor calls the prompt registered here, and replays the
 * original request once a fresh code has been accepted — so a lapsed
 * window costs six digits, not the work in progress.
 *
 * Renders nothing until an action actually lapses.
 */
export default function MfaReverifyProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const resolveRef = useRef(null);

  const settle = useCallback((value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    setCode('');
    setError('');
    if (resolve) resolve(value);
  }, []);

  useEffect(() => {
    setMfaReverifyPrompt(({ error: message } = {}) => new Promise((resolve) => {
      // A second lapse while the dialog is already open joins the first.
      if (resolveRef.current) {
        const previous = resolveRef.current;
        resolveRef.current = (value) => { previous(value); resolve(value); };
        return;
      }
      resolveRef.current = resolve;
      setError(message || '');
      setCode('');
      setOpen(true);
    }));
    return () => setMfaReverifyPrompt(null);
  }, []);

  function submit(e) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter the code from your authenticator app.');
      return;
    }
    settle(trimmed);
  }

  return (
    <>
      {children}
      {open && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-dialog card" role="dialog" aria-modal="true" aria-labelledby="mfa-reverify-title">
            <div className="modal-dialog__head">
              <h2 id="mfa-reverify-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Confirm it&apos;s you
              </h2>
            </div>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Your verification has expired. Enter a code from your authenticator app to
              continue — the action you started will carry on. A recovery key also works.
            </p>
            <form onSubmit={submit} style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label htmlFor="mfa-reverify-code">Authentication code</label>
                <input
                  id="mfa-reverify-code"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setError(''); }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              {error && <p className="error">{error}</p>}
              <div className="modal-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={() => settle(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
