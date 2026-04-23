import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import api from '../../services/api.js';
import { IS_RHYTHM_ENGINE_SURFACE } from '../../config/appSurface.js';

function NotificationsEmptyIllustration() {
  return (
    <svg
      className="notif-empty__art"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="60" cy="60" r="52" fill="var(--notif-empty-circle, #eceef1)" />
      <path
        d="M38 52c0-8 6.5-14 14.5-14 3.8 0 7.3 1.4 9.9 3.8 2.1-1.8 4.8-2.8 7.8-2.8 6.4 0 11.8 5.2 11.8 11.6 0 .5 0 1-.1 1.5 5.3 1.2 9.1 5.9 9.1 11.4 0 6.5-5.3 11.8-11.8 11.8H44.5c-7.2 0-13-5.8-13-13 0-5.8 3.8-10.7 9-12.3z"
        fill="#9ca3af"
        opacity="0.85"
      />
      <ellipse cx="52" cy="58" rx="10" ry="8" fill="#f3f4f6" />
      <path
        d="M48 76c4-6 10-9 17-9s13 3 17 9c-4 5-10 8-17 8s-13-3-17-8z"
        fill="#d1d5db"
      />
      <ellipse cx="46" cy="54" rx="2.2" ry="1.2" fill="#6b7280" />
      <ellipse cx="58" cy="54" rx="2.2" ry="1.2" fill="#6b7280" />
      <path d="M50 60c2 1.5 4 1.5 6 0" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round" />
      <ellipse cx="72" cy="62" rx="5" ry="4" fill="#e5e7eb" />
      <path
        d="M68 58c2-1 4.5-1.2 6.5-.3"
        stroke="#9ca3af"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M64 68h10" stroke="#0c66e4" strokeWidth="2.2" strokeLinecap="round" />
      <path
        fill="#c4b5fd"
        d="M28 36l1.8 3.5 3.5 1.8-3.5 1.8-1.8 3.5-1.8-3.5-3.5-1.8 3.5-1.8z"
      />
      <path
        fill="#ddd6fe"
        d="M86 32l1.2 2.4 2.4 1.2-2.4 1.2-1.2 2.4-1.2-2.4-2.4-1.2 2.4-1.2z"
      />
      <path fill="#e9d5ff" d="M78 44l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    </svg>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function notificationTargetPath(notification) {
  const orgId = String(notification?.organizationId || '').trim();
  if (!orgId) return '/platform';

  const type = String(notification?.type || '').trim().toLowerCase();
  const taskId = String(notification?.taskId || '').trim();

  if (type === 'pulse_alert') {
    return `/platform/clients/${encodeURIComponent(orgId)}/rhythm-engine#organisation-dashboard`;
  }

  if (!IS_RHYTHM_ENGINE_SURFACE) {
    if (taskId) {
      return `/platform/clients/${encodeURIComponent(orgId)}/tasks?task=${encodeURIComponent(taskId)}`;
    }
    return `/platform/clients/${encodeURIComponent(orgId)}/tasks`;
  }

  return `/platform/clients/${encodeURIComponent(orgId)}/rhythm-engine#organisation-dashboard`;
}

export default function PlatformNotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(true);
  const wrapRef = useRef(null);

  const filteredItems = useMemo(
    () => (onlyUnread ? items.filter((n) => !n.read) : items),
    [items, onlyUnread]
  );

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/platform/me/notifications', { params: { limit: 40 } });
      setItems(data.notifications || []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      /* not platform session or network */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 45000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  async function onItemClick(n) {
    if (!n.read) {
      try {
        await api.patch(`/api/platform/me/notifications/${n.id}/read`);
        setUnread((u) => Math.max(0, u - 1));
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    navigate(notificationTargetPath(n));
  }

  async function markAllRead(e) {
    e.stopPropagation();
    try {
      await api.post('/api/platform/me/notifications/read-all');
      setUnread(0);
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => {
          setOpen((v) => !v);
          load();
        }}
      >
        <Bell size={22} strokeWidth={1.75} aria-hidden />
        {unread > 0 ? (
          <span className="notif-bell-badge">{unread > 99 ? '99+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notif-dropdown" role="listbox" aria-label="Notification list">
          <div className="notif-dropdown__head">
            <span className="notif-dropdown__title" id="notif-panel-title">
              Notifications
            </span>
            <div className="notif-dropdown__head-right">
              <span className="notif-filter-toggle__label" id="notif-unread-only-label">
                Only show unread
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={onlyUnread}
                aria-labelledby="notif-unread-only-label"
                className="notif-filter-toggle"
                onClick={() => setOnlyUnread((v) => !v)}
              >
                <span className="notif-filter-toggle__track" aria-hidden>
                  {onlyUnread ? (
                    <span className="notif-filter-toggle__check-wrap">
                      <svg className="notif-filter-toggle__check" viewBox="0 0 12 12" aria-hidden>
                        <path
                          d="M2.5 6l2.2 2.2L9.5 3.4"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : null}
                  <span className="notif-filter-toggle__thumb" />
                </span>
              </button>
            </div>
          </div>
          {unread > 0 ? (
            <div className="notif-dropdown__subhead">
              <button type="button" className="notif-dropdown__mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            </div>
          ) : null}
          <div className="notif-dropdown__body">
            {filteredItems.length === 0 ? (
              <div className="notif-dropdown__empty-state">
                <NotificationsEmptyIllustration />
                <p className="notif-dropdown__empty-title">
                  {items.length === 0 ? 'No notifications yet' : 'No unread notifications'}
                </p>
              </div>
            ) : (
              filteredItems.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="option"
                  aria-selected={!n.read}
                  className={`notif-item${n.read ? '' : ' notif-item--unread'}`}
                  onClick={() => onItemClick(n)}
                >
                  <span className="notif-item__title">{n.title}</span>
                  {n.body ? <span className="notif-item__body muted">{n.body}</span> : null}
                  <span className="notif-item__meta muted">
                    {n.organizationName} · {formatWhen(n.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
