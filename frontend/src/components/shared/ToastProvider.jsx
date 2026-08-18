import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

const DISMISS_MS = 6500;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const dismiss = useCallback(() => setToast(null), []);

  const showToast = useCallback((message, options = {}) => {
    const variant = options.variant === 'success' ? 'success' : 'error';
    const durationMs =
      typeof options.durationMs === 'number' && options.durationMs > 0
        ? options.durationMs
        : DISMISS_MS;
    const action =
      options.action && typeof options.action.onClick === 'function' && options.action.label
        ? { label: options.action.label, onClick: options.action.onClick }
        : null;
    setToast({
      id: Date.now(),
      message,
      variant,
      durationMs,
      action,
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(dismiss, toast.durationMs);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <ToastContext.Provider value={{ showToast, dismiss }}>
      {children}
      {toast && (
        <div
          className="toast-stack"
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
        >
          <div className={`toast toast--${toast.variant}`} role="status">
            <span className="toast__icon" aria-hidden>
              {toast.variant === 'success' ? (
                <CheckCircle size={22} strokeWidth={2} />
              ) : (
                <AlertCircle size={22} strokeWidth={2} />
              )}
            </span>
            <p className="toast__message">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action.onClick();
                  dismiss();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast__close"
              onClick={dismiss}
              aria-label="Dismiss notification"
            >
              <X size={20} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
