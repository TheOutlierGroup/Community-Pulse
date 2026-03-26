import { X } from 'lucide-react';

export default function ModalDialog({
  open,
  title,
  titleId,
  onClose,
  children,
  dialogClassName = 'modal-dialog--wide',
}) {
  if (!open) return null;

  const className = ['modal-dialog', dialogClassName, 'card'].filter(Boolean).join(' ');

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-dialog__head">
          <h2 id={titleId} style={{ margin: 0, fontSize: '1.15rem' }}>
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-ghost modal-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={22} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
