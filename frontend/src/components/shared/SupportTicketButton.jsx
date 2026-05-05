import { useState } from 'react';
import { LifeBuoy, X } from 'lucide-react';
import api from '../../services/api.js';

/**
 * SUP-02 floating support contact button. Opens a modal where a
 * licensee user can submit a support request. The backend creates a
 * card on that licensee's CRM task board, so platform staff triage it
 * alongside any other work for that account — no separate ticket inbox.
 *
 * Only renders for licensee users (platform staff have other channels);
 * the parent layout handles the gating.
 */
export default function SupportTicketButton() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setSubject('');
    setBody('');
    setCategory('general');
    setError('');
    setSubmitted(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/platform/me/support-task', {
        subject: subject.trim(),
        body: body.trim(),
        category,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit support request. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        title="Contact support"
        aria-label="Contact support"
        style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          background: '#1f2937',
          color: '#fff',
          border: 'none',
          borderRadius: '50%',
          width: 44,
          height: 44,
          cursor: 'pointer',
          boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
        }}
      >
        <LifeBuoy size={20} aria-hidden />
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-dialog card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-ticket-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <div className="modal-dialog__head">
              <h2 id="support-ticket-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Contact support
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            {submitted ? (
              <>
                <p style={{ marginTop: '1rem' }}>
                  Thanks — your request has been added to your account's task board. The Outlier team will follow up.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
                <div className="field">
                  <label htmlFor="support-cat">Category</label>
                  <select id="support-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="general">General question</option>
                    <option value="bug">Bug or unexpected behaviour</option>
                    <option value="billing">Billing or licence</option>
                    <option value="feature">Feature request</option>
                    <option value="security">Security concern</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="support-subj">Subject</label>
                  <input
                    id="support-subj"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="support-body">Describe what's going on</label>
                  <textarea
                    id="support-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={6}
                    maxLength={8000}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Sending…' : 'Send ticket'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
