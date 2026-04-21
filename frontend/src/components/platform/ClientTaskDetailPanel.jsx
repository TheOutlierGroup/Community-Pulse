import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import AuthenticatedBlobImage from './AuthenticatedBlobImage.jsx';
import TaskCommentRichEditor, { TaskCommentBodyDisplay } from './TaskCommentRichEditor.jsx';
import { taggedUserIdsFromMentionText } from '../../utils/taskMentions.js';
import {
  AlignJustify,
  CheckSquare,
  ChevronDown,
  Circle,
  Clock,
  Eye,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Tag,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

function userLabel(u) {
  if (!u) return '';
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || u.email;
}

function userInitials(u) {
  if (!u) return '?';
  const f = (u.firstName || '').trim().charAt(0);
  const l = (u.lastName || '').trim().charAt(0);
  if (f || l) return `${f}${l}`.toUpperCase();
  return (u.email || '?').charAt(0).toUpperCase();
}

function taskImagePath(orgId, taskId, imageId) {
  return `/api/platform/organizations/${orgId}/tasks/${taskId}/images/${imageId}/file`;
}

function commentImagePath(orgId, taskId, commentId, imageId) {
  return `/api/platform/organizations/${orgId}/tasks/${taskId}/comments/${commentId}/images/${imageId}/file`;
}

function attachmentLabel(isImage) {
  return isImage ? 'Image attachment' : 'Document attachment';
}

function formatActivityTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
    });
  } catch {
    return '';
  }
}

const STATUS_LABEL = {
  todo: 'To do',
  working: 'Working on',
  review: 'Review',
  completed: 'Completed',
};

const STATUS_ORDER = ['todo', 'working', 'review', 'completed'];
const ACTIVITY_CREATED = 'created';
const ACTIVITY_STATUS_CHANGED = 'status_changed';
const ACTIVITY_ASSIGNEE_CHANGED = 'assignee_changed';
const ACTIVITY_START_DATE_CHANGED = 'start_date_changed';
const ACTIVITY_DUE_DATE_CHANGED = 'due_date_changed';
const ACTIVITY_CHECKLIST_ITEM_ADDED = 'checklist_item_added';
const ACTIVITY_CHECKLIST_ITEM_REMOVED = 'checklist_item_removed';

const MAX_LABELS_PER_CARD = 25;

function linkifyText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, li) => (
    <span key={li} className="task-card-modal__desc-line">
      {li > 0 ? <br /> : null}
      {linkifyLine(line)}
    </span>
  ));
}

function linkifyLine(line) {
  const re = /(https?:\/\/[^\s]+)/g;
  const parts = [];
  let last = 0;
  let m;
  const copy = line;
  while ((m = re.exec(copy)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t-${last}`}>{copy.slice(last, m.index)}</span>);
    }
    const url = m[1];
    parts.push(
      <a key={`u-${m.index}`} href={url} target="_blank" rel="noopener noreferrer" className="task-card-modal__inline-link">
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (last < copy.length) {
    parts.push(<span key={`t-${last}`}>{copy.slice(last)}</span>);
  }
  return parts.length ? parts : line;
}

function useClickOutside(ref, isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    const fn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [isOpen, onClose, ref]);
}

export default function ClientTaskDetailPanel({
  orgId,
  taskId,
  assignableUsers,
  onClose,
  onTaskUpdated,
  onTaskDeleted,
  onTasksChanged,
}) {
  const { showToast } = useToast();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);

  const [commentFiles, setCommentFiles] = useState([]);
  const [commentEditorEmpty, setCommentEditorEmpty] = useState(true);

  const [listOpen, setListOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelInputDraft, setLabelInputDraft] = useState('');
  const [labelSuggestions, setLabelSuggestions] = useState([]);
  const [checklistNewDraft, setChecklistNewDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

  const listRef = useRef(null);
  const moreRef = useRef(null);
  const taskImageInputRef = useRef(null);
  const commentEditorRef = useRef(null);
  const commentFileInputRef = useRef(null);
  const checklistSectionRef = useRef(null);
  const checklistNewInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      setTask(data.task);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load task.');
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (imagePreview) {
        setImagePreview(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, imagePreview]);

  useClickOutside(listRef, listOpen, () => setListOpen(false));
  useClickOutside(moreRef, moreOpen, () => setMoreOpen(false));

  useEffect(() => {
    if (!labelsOpen || !orgId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/label-suggestions`);
        if (!cancelled) setLabelSuggestions(Array.isArray(data.labels) ? data.labels : []);
      } catch {
        if (!cancelled) setLabelSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labelsOpen, orgId]);

  useEffect(() => {
    if (task) {
      setDescriptionDraft(task.notes ?? task.body ?? '');
      setTitleDraft(task.title || '');
    }
  }, [task?.id, task?.title, task?.notes, task?.body]);

  const syncTask = useCallback(
    (nextTask) => {
      if (!nextTask) return;
      setTask(nextTask);
      onTaskUpdated?.(nextTask);
      onTasksChanged?.();
    },
    [onTaskUpdated, onTasksChanged]
  );

  const patchTask = useCallback(
    async (body) => {
      if (!taskId) return;
      setMetaSaving(true);
      try {
        const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/${taskId}`, body);
        syncTask(data.task);
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not save.', { variant: 'error' });
      } finally {
        setMetaSaving(false);
      }
    },
    [orgId, taskId, syncTask, showToast]
  );

  async function toggleWatch() {
    if (!taskId || !task) return;
    setWatchBusy(true);
    try {
      if (task.watching) {
        await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}/watch`);
      } else {
        await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/watch`);
      }
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      syncTask(data.task);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update watch.', { variant: 'error' });
    } finally {
      setWatchBusy(false);
    }
  }

  async function commitTitle() {
    setTitleEditing(false);
    if (!task) return;
    const t = titleDraft.trim();
    if (!t || t === task.title) return;
    await patchTask({ title: t });
  }

  async function saveDescription() {
    const notesTrimmed = descriptionDraft.trim();
    await patchTask({
      notes: notesTrimmed,
      taggedUserIds: taggedUserIdsFromMentionText(notesTrimmed, assignableUsers),
    });
    setEditingDescription(false);
  }

  async function uploadTaskImage(file) {
    if (!file || !taskId) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/images`, fd);
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      syncTask(data.task);
      showToast('Attachment added.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed.', { variant: 'error' });
    }
  }

  async function removeTaskImage(imageId) {
    try {
      const { data } = await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}/images/${imageId}`);
      const nextTask = data?.task;
      if (nextTask) syncTask(nextTask);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove image.', { variant: 'error' });
    }
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!taskId) return;
    const text = commentEditorRef.current?.getText?.() ?? '';
    const html = commentEditorRef.current?.getHTML?.() ?? '';
    if (!text.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/comments`, {
        body: html.trim() ? html : text.trim(),
        mentionUserIds: taggedUserIdsFromMentionText(text, assignableUsers),
      });
      const newCommentId = data.comment?.id;
      syncTask(data.task);
      commentEditorRef.current?.clear?.();
      setCommentEditorEmpty(true);
      const files = [...commentFiles];
      setCommentFiles([]);
      if (newCommentId && files.length) {
        for (const f of files) {
          const fd = new FormData();
          fd.append('image', f);
          await api.post(
            `/api/platform/organizations/${orgId}/tasks/${taskId}/comments/${newCommentId}/images`,
            fd
          );
        }
        const refreshed = await api.get(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
        syncTask(refreshed.data.task);
      }
      showToast('Comment added.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add comment.');
    } finally {
      setSaving(false);
    }
  }

  async function removeCommentImage(commentId, imageId) {
    try {
      const { data } = await api.delete(
        `/api/platform/organizations/${orgId}/tasks/${taskId}/comments/${commentId}/images/${imageId}`
      );
      syncTask(data.task);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove image.', { variant: 'error' });
    }
  }

  function openImagePreview(path, label) {
    setImagePreview({ path, label: label || 'Attachment preview' });
  }

  async function confirmDeleteTask() {
    if (!taskId || !window.confirm('Delete this task and all comments?')) return;
    try {
      await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      showToast('Task deleted.', { variant: 'success' });
      onTaskDeleted?.(taskId);
      onTasksChanged?.();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not delete.', { variant: 'error' });
    }
  }

  function currentLabelNames() {
    const raw = task?.labels;
    if (!Array.isArray(raw)) return [];
    return raw.map((lb) => String(lb?.name ?? '').trim()).filter(Boolean);
  }

  const pickableLabelSuggestions = useMemo(() => {
    const raw = task?.labels;
    const onCard = new Set(
      (Array.isArray(raw) ? raw : [])
        .map((lb) => String(lb?.name ?? '').trim().toLowerCase())
        .filter(Boolean)
    );
    return (labelSuggestions || []).filter((s) => s && !onCard.has(String(s).toLowerCase()));
  }, [labelSuggestions, task]);

  async function addLabelToCard(rawName) {
    if (!task) return;
    const next = String(rawName ?? '').trim().slice(0, 80);
    if (!next) return;
    const existing = currentLabelNames();
    if (existing.some((n) => n.toLowerCase() === next.toLowerCase())) return;
    if (existing.length >= MAX_LABELS_PER_CARD) {
      showToast(`You can add at most ${MAX_LABELS_PER_CARD} labels per card.`, { variant: 'error' });
      return;
    }
    await patchTask({ labels: [...existing, next] });
    setLabelSuggestions((prev) =>
      prev.some((p) => p.toLowerCase() === next.toLowerCase())
        ? prev
        : [...prev, next].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    );
  }

  async function commitNewLabel() {
    const next = labelInputDraft.trim();
    if (!next) return;
    if (currentLabelNames().some((n) => n.toLowerCase() === next.toLowerCase())) {
      setLabelInputDraft('');
      return;
    }
    if (currentLabelNames().length >= MAX_LABELS_PER_CARD) {
      showToast(`You can add at most ${MAX_LABELS_PER_CARD} labels per card.`, { variant: 'error' });
      return;
    }
    await addLabelToCard(next);
    setLabelInputDraft('');
  }

  async function removeLabelByName(name) {
    if (!task) return;
    const filtered = currentLabelNames().filter((n) => n.toLowerCase() !== String(name).toLowerCase());
    await patchTask({ labels: filtered });
  }

  async function submitChecklistNew() {
    if (!taskId) return;
    const text = checklistNewDraft.trim();
    if (!text) return;
    try {
      const { data } = await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/checklist-items`, {
        text,
      });
      syncTask(data.task);
      setChecklistNewDraft('');
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not add item.', { variant: 'error' });
    }
  }

  async function toggleChecklistItem(item) {
    if (!taskId) return;
    try {
      const { data } = await api.patch(
        `/api/platform/organizations/${orgId}/tasks/${taskId}/checklist-items/${item.id}`,
        { done: !item.done }
      );
      syncTask(data.task);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update item.', { variant: 'error' });
    }
  }

  async function deleteChecklistItemLine(itemId) {
    if (!taskId) return;
    try {
      const { data } = await api.delete(
        `/api/platform/organizations/${orgId}/tasks/${taskId}/checklist-items/${itemId}`
      );
      syncTask(data.task);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove item.', { variant: 'error' });
    }
  }

  const activityItems = useMemo(() => {
    if (!task) return [];
    const items = [];
    for (const activity of task.activities || []) {
      const actor = userLabel(activity.actor);
      if (activity.type === ACTIVITY_CREATED) {
        items.push({
          kind: 'system',
          key: `act-${activity.id}`,
          text: `${actor || 'Someone'} created this card`,
          at: activity.createdAt,
        });
        continue;
      }
      if (activity.type === ACTIVITY_STATUS_CHANGED) {
        const fromStatus = STATUS_LABEL[activity.payload?.fromStatus] || activity.payload?.fromStatus;
        const toStatus = STATUS_LABEL[activity.payload?.toStatus] || activity.payload?.toStatus;
        if (fromStatus && toStatus && fromStatus !== toStatus) {
          items.push({
            kind: 'system',
            key: `act-${activity.id}`,
            text: `${actor || 'Someone'} moved this card from ${fromStatus} to ${toStatus}`,
            at: activity.createdAt,
          });
        }
        continue;
      }
      if (activity.type === ACTIVITY_ASSIGNEE_CHANGED) {
        const fromAssignee = activity.payload?.fromAssignee || 'Unassigned';
        const toAssignee = activity.payload?.toAssignee || 'Unassigned';
        if (fromAssignee !== toAssignee) {
          items.push({
            kind: 'system',
            key: `act-${activity.id}`,
            text: `${actor || 'Someone'} changed assignee from ${fromAssignee} to ${toAssignee}`,
            at: activity.createdAt,
          });
        }
        continue;
      }
      if (activity.type === ACTIVITY_START_DATE_CHANGED) {
        const fromDate = activity.payload?.fromDate || 'No start date';
        const toDate = activity.payload?.toDate || 'No start date';
        if (fromDate !== toDate) {
          items.push({
            kind: 'system',
            key: `act-${activity.id}`,
            text: `${actor || 'Someone'} changed start date from ${fromDate} to ${toDate}`,
            at: activity.createdAt,
          });
        }
        continue;
      }
      if (activity.type === ACTIVITY_DUE_DATE_CHANGED) {
        const fromDate = activity.payload?.fromDate || 'No due date';
        const toDate = activity.payload?.toDate || 'No due date';
        if (fromDate !== toDate) {
          items.push({
            kind: 'system',
            key: `act-${activity.id}`,
            text: `${actor || 'Someone'} changed due date from ${fromDate} to ${toDate}`,
            at: activity.createdAt,
          });
        }
        continue;
      }
      if (activity.type === ACTIVITY_CHECKLIST_ITEM_ADDED) {
        const text = String(activity.payload?.text || '').trim();
        items.push({
          kind: 'system',
          key: `act-${activity.id}`,
          text: `${actor || 'Someone'} added checklist item${text ? `: ${text}` : ''}`,
          at: activity.createdAt,
        });
        continue;
      }
      if (activity.type === ACTIVITY_CHECKLIST_ITEM_REMOVED) {
        const text = String(activity.payload?.text || '').trim();
        items.push({
          kind: 'system',
          key: `act-${activity.id}`,
          text: `${actor || 'Someone'} removed checklist item${text ? `: ${text}` : ''}`,
          at: activity.createdAt,
        });
      }
    }
    for (const c of task.comments || []) {
      items.push({ kind: 'comment', key: `c-${c.id}`, comment: c, at: c.createdAt });
    }
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    return items;
  }, [task]);

  const notesText = task ? (task.notes ?? task.body ?? '').trim() : '';

  return (
    <div
      className="modal-backdrop task-card-modal__backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="modal-dialog modal-dialog--task-card card task-card-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-card-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="task-card-modal">
          <header className="task-card-modal__topbar">
            <div className="task-card-modal__topbar-left" ref={listRef}>
              <button
                type="button"
                className="task-card-modal__list-btn"
                aria-expanded={listOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  setListOpen((v) => !v);
                  setMoreOpen(false);
                }}
              >
                <span>{task ? STATUS_LABEL[task.status] || task.status : '…'}</span>
                <ChevronDown size={16} strokeWidth={2} aria-hidden />
              </button>
              {listOpen && task && (
                <ul className="task-card-modal__dropdown" role="listbox">
                  {STATUS_ORDER.map((s) => (
                    <li key={s} role="option" aria-selected={task.status === s}>
                      <button
                        type="button"
                        className="task-card-modal__dropdown-item"
                        onClick={async () => {
                          setListOpen(false);
                          await patchTask({ status: s });
                        }}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="task-card-modal__topbar-right">
              <button
                type="button"
                className="task-card-modal__icon-btn"
                aria-label="Add image"
                onClick={() => taskImageInputRef.current?.click()}
              >
                <ImageIcon size={18} strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                className={`task-card-modal__icon-btn${task?.watching ? ' task-card-modal__icon-btn--watching' : ''}`}
                title={task?.watching ? 'Stop watching' : 'Watch card'}
                aria-label={task?.watching ? 'Stop watching' : 'Watch card'}
                aria-pressed={Boolean(task?.watching)}
                disabled={watchBusy || !task}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWatch();
                }}
              >
                <Eye size={18} strokeWidth={1.75} aria-hidden />
              </button>
              <div className="task-card-modal__more-wrap" ref={moreRef}>
                <button
                  type="button"
                  className="task-card-modal__icon-btn"
                  aria-expanded={moreOpen}
                  aria-label="More actions"
                  onClick={() => {
                    setMoreOpen((v) => !v);
                    setListOpen(false);
                  }}
                >
                  <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
                </button>
                {moreOpen && (
                  <ul className="task-card-modal__dropdown task-card-modal__dropdown--right">
                    <li>
                      <button
                        type="button"
                        className="task-card-modal__dropdown-item task-card-modal__dropdown-item--danger"
                        onClick={() => {
                          setMoreOpen(false);
                          confirmDeleteTask();
                        }}
                      >
                        Delete card
                      </button>
                    </li>
                  </ul>
                )}
              </div>
              <button type="button" className="task-card-modal__icon-btn" onClick={onClose} aria-label="Close">
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </header>

          <input
            ref={taskImageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,.pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="task-card-modal__hidden-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) uploadTaskImage(f);
            }}
          />

          {loading && <p className="task-card-modal__loading muted">Loading…</p>}
          {error && !loading && <p className="task-card-modal__banner error">{error}</p>}

          {!loading && task && (
            <div className="task-card-modal__layout">
              <div className="task-card-modal__main">
                <div className="task-card-modal__title-row">
                  <span className="task-card-modal__title-icon" aria-hidden>
                    <Circle size={22} strokeWidth={1.5} />
                  </span>
                  <div className="task-card-modal__title-wrap">
                    {titleEditing ? (
                      <input
                        id="task-card-modal-title"
                        className="task-card-modal__title-input"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitTitle();
                          }
                        }}
                        disabled={metaSaving}
                        autoComplete="off"
                        autoFocus
                      />
                    ) : (
                      <h1
                        id="task-card-modal-title"
                        className="task-card-modal__title"
                        onClick={() => setTitleEditing(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setTitleEditing(true);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {task.title}
                      </h1>
                    )}
                  </div>
                </div>

                <div className="task-card-modal__chips">
                  <button
                    type="button"
                    className={`task-card-modal__chip${labelsOpen ? ' task-card-modal__chip--active' : ''}`}
                    onClick={() => {
                      setLabelsOpen((v) => !v);
                      setDatesOpen(false);
                      setMembersOpen(false);
                    }}
                  >
                    <Tag size={14} strokeWidth={2} aria-hidden />
                    Labels
                  </button>
                  <button
                    type="button"
                    className={`task-card-modal__chip${datesOpen ? ' task-card-modal__chip--active' : ''}`}
                    onClick={() => {
                      setDatesOpen((v) => !v);
                      setMembersOpen(false);
                      setLabelsOpen(false);
                    }}
                  >
                    <Clock size={14} strokeWidth={2} aria-hidden />
                    Dates
                  </button>
                  <button
                    type="button"
                    className="task-card-modal__chip"
                    onClick={() => {
                      setDatesOpen(false);
                      setMembersOpen(false);
                      setLabelsOpen(false);
                      checklistSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      requestAnimationFrame(() => checklistNewInputRef.current?.focus());
                    }}
                  >
                    <CheckSquare size={14} strokeWidth={2} aria-hidden />
                    Checklist
                  </button>
                  <button
                    type="button"
                    className={`task-card-modal__chip${membersOpen ? ' task-card-modal__chip--active' : ''}`}
                    onClick={() => {
                      setMembersOpen((v) => !v);
                      setDatesOpen(false);
                      setLabelsOpen(false);
                    }}
                  >
                    <UserPlus size={14} strokeWidth={2} aria-hidden />
                    Members
                  </button>
                </div>

                {(task.labels || []).length > 0 ? (
                  <div className="task-card-modal__labels-row" aria-label="Card labels">
                    {(task.labels || []).map((lb) => (
                      <span key={lb.id} className="task-card-modal__label-pill task-card-modal__label-pill--display">
                        {lb.name}
                      </span>
                    ))}
                  </div>
                ) : null}

                {labelsOpen && (
                  <div className="task-card-modal__panel task-card-modal__panel--labels">
                    <p className="task-card-modal__panel-hint muted">Short tags for this card (separate from people tagged via the description).</p>
                    {pickableLabelSuggestions.length > 0 ? (
                      <div className="task-card-modal__label-suggestions">
                        <span className="task-card-modal__label-suggestions-title muted">Previously used in this workspace</span>
                        <div className="task-card-modal__label-pick-list">
                          {pickableLabelSuggestions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              className="task-card-modal__label-pick"
                              disabled={metaSaving}
                              onClick={() => {
                                void addLabelToCard(name);
                              }}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="task-card-modal__label-pill-wrap">
                      {currentLabelNames().map((name) => (
                        <span key={name} className="task-card-modal__label-pill">
                          {name}
                          <button
                            type="button"
                            className="task-card-modal__label-pill-remove"
                            aria-label={`Remove label ${name}`}
                            onClick={() => removeLabelByName(name)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="task-card-modal__label-add-row">
                      <input
                        type="text"
                        className="task-card-modal__label-input"
                        value={labelInputDraft}
                        onChange={(e) => setLabelInputDraft(e.target.value)}
                        placeholder="New label"
                        maxLength={80}
                        disabled={metaSaving}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitNewLabel();
                          }
                        }}
                      />
                      <button type="button" className="btn btn-secondary" onClick={commitNewLabel} disabled={metaSaving}>
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {datesOpen && (
                  <div className="task-card-modal__panel">
                    <div className="task-card-modal__field-row">
                      <label htmlFor="tcd-start">Start</label>
                      <input
                        id="tcd-start"
                        type="date"
                        value={task.startDate ? task.startDate.slice(0, 10) : ''}
                        onChange={(e) => patchTask({ startDate: e.target.value || null })}
                        disabled={metaSaving}
                      />
                    </div>
                    <div className="task-card-modal__field-row">
                      <label htmlFor="tcd-due">Due</label>
                      <input
                        id="tcd-due"
                        type="date"
                        value={task.dueDate ? task.dueDate.slice(0, 10) : ''}
                        onChange={(e) => patchTask({ dueDate: e.target.value || null })}
                        disabled={metaSaving}
                      />
                    </div>
                  </div>
                )}

                {membersOpen && (
                  <div className="task-card-modal__panel">
                    <label htmlFor="tcd-assign" className="task-card-modal__panel-label">
                      Assigned to
                    </label>
                    <select
                      id="tcd-assign"
                      className="task-card-modal__select"
                      value={task.assignedTo?.id || ''}
                      onChange={(e) => patchTask({ assignedTo: e.target.value || null })}
                      disabled={metaSaving}
                    >
                      <option value="">— None —</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {userLabel(u)}
                          {u.organizationKind === 'platform' ? ' (Outlier)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <section className="task-card-modal__description">
                  <div className="task-card-modal__section-head">
                    <div className="task-card-modal__section-head-title">
                      <AlignJustify size={18} strokeWidth={1.75} aria-hidden />
                      <span>Description</span>
                    </div>
                    {!editingDescription && (
                      <button type="button" className="task-card-modal__edit-link" onClick={() => setEditingDescription(true)}>
                        Edit
                      </button>
                    )}
                  </div>
                  {editingDescription ? (
                    <div className="task-card-modal__description-edit">
                      <textarea
                        value={descriptionDraft}
                        onChange={(e) => setDescriptionDraft(e.target.value)}
                        className="task-card-modal__description-textarea platform-textarea"
                        rows={8}
                        placeholder="Add a more detailed description…"
                        disabled={metaSaving}
                      />
                      <div className="task-card-modal__description-actions">
                        <button type="button" className="btn btn-primary" onClick={saveDescription} disabled={metaSaving}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setDescriptionDraft(task.notes ?? task.body ?? '');
                            setEditingDescription(false);
                          }}
                          disabled={metaSaving}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : notesText ? (
                    <div className="task-card-modal__description-body">{linkifyText(notesText)}</div>
                  ) : (
                    <button type="button" className="task-card-modal__description-placeholder" onClick={() => setEditingDescription(true)}>
                      Add a more detailed description…
                    </button>
                  )}
                </section>

                <section id="task-card-checklist" ref={checklistSectionRef} className="task-card-modal__checklist">
                  <div className="task-card-modal__section-head">
                    <div className="task-card-modal__section-head-title">
                      <CheckSquare size={18} strokeWidth={1.75} aria-hidden />
                      <span>Checklist</span>
                    </div>
                  </div>
                  <ul className="task-card-modal__checklist-list">
                    {(task.checklistItems || []).map((it) => (
                      <li key={it.id} className="task-card-modal__checklist-item">
                        <label className="task-card-modal__checklist-label">
                          <input
                            type="checkbox"
                            checked={Boolean(it.done)}
                            onChange={() => toggleChecklistItem(it)}
                            disabled={metaSaving}
                          />
                          <span className={it.done ? 'task-card-modal__checklist-text is-done' : 'task-card-modal__checklist-text'}>
                            {it.text}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="task-card-modal__checklist-remove"
                          aria-label="Remove checklist item"
                          onClick={() => deleteChecklistItemLine(it.id)}
                          disabled={metaSaving}
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="task-card-modal__checklist-new">
                    <input
                      ref={checklistNewInputRef}
                      type="text"
                      className="task-card-modal__checklist-new-input"
                      value={checklistNewDraft}
                      onChange={(e) => setChecklistNewDraft(e.target.value)}
                      placeholder="Add an item"
                      disabled={metaSaving}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          submitChecklistNew();
                        }
                      }}
                    />
                    <button type="button" className="btn btn-secondary" onClick={submitChecklistNew} disabled={metaSaving}>
                      Add
                    </button>
                  </div>
                </section>

                {(task.images || []).length > 0 && (
                  <section className="task-card-modal__attachments">
                    <h2 className="task-card-modal__attachments-title">Attachments</h2>
                    <div className="task-card-modal__image-grid">
                      {(task.images || []).map((im) => (
                        <div key={im.id} className="task-card-modal__image-tile">
                          {im.isImage !== false ? (
                            <button
                              type="button"
                              className="task-card-modal__image-open-btn"
                              onClick={() => openImagePreview(taskImagePath(orgId, taskId, im.id), 'Task attachment')}
                              aria-label="Open attachment image"
                            >
                              <AuthenticatedBlobImage path={taskImagePath(orgId, taskId, im.id)} alt="" className="task-card-modal__image-img" />
                            </button>
                          ) : (
                            <a
                              href={taskImagePath(orgId, taskId, im.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="task-card-modal__file-hint"
                            >
                              <FileText size={16} strokeWidth={1.75} aria-hidden /> {attachmentLabel(im.isImage)}
                            </a>
                          )}
                          {im.canDelete ? (
                            <button
                              type="button"
                              className="task-card-modal__image-remove"
                              onClick={() => removeTaskImage(im.id)}
                              aria-label="Remove image"
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <aside className="task-card-modal__sidebar">
                <div className="task-card-modal__sidebar-head">
                  <div className="task-card-modal__sidebar-head-title">
                    <MessageSquare size={18} strokeWidth={1.75} aria-hidden />
                    <span>Comments and activity</span>
                  </div>
                </div>

                <form onSubmit={submitComment} className="task-card-modal__comment-form">
                  <TaskCommentRichEditor
                    ref={commentEditorRef}
                    disabled={saving}
                    mentionUsers={assignableUsers}
                    fileInputRef={commentFileInputRef}
                    onEmptyChange={setCommentEditorEmpty}
                  />
                  <input
                    ref={commentFileInputRef}
                    id="task-card-comment-files"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,.pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    multiple
                    className="visually-hidden"
                    onChange={(e) => setCommentFiles([...(e.target.files || [])])}
                  />
                  {commentFiles.length > 0 ? (
                    <p className="muted task-card-modal__file-hint">{commentFiles.length} file(s) will attach when you save.</p>
                  ) : null}
                  <button type="submit" className="task-card-modal__rte-save" disabled={saving || commentEditorEmpty}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </form>

                <div className="task-card-modal__activity">
                  {activityItems.map((item) => {
                    if (item.kind === 'system') {
                      return (
                        <div key={item.key} className="task-card-modal__activity-system">
                          <p className="task-card-modal__activity-system-text">{item.text}</p>
                          <time className="task-card-modal__activity-time" dateTime={item.at}>
                            {formatActivityTime(item.at)}
                          </time>
                        </div>
                      );
                    }
                    const c = item.comment;
                    return (
                      <article key={item.key} className="task-card-modal__activity-comment">
                        <div className="task-card-modal__comment-meta">
                          <div className="task-card-modal__avatar" aria-hidden>
                            {userInitials(c.author)}
                          </div>
                          <div className="task-card-modal__comment-author-block">
                            <span className="task-card-modal__comment-author">{c.author ? userLabel(c.author) : 'Unknown'}</span>
                            <time className="task-card-modal__activity-time" dateTime={c.createdAt}>
                              {formatActivityTime(c.createdAt)}
                            </time>
                          </div>
                        </div>
                        {c.mentions?.length > 0 ? (
                          <p className="task-card-modal__mentions muted">
                            Mentioned: {c.mentions.map((m) => userLabel(m)).join(', ')}
                          </p>
                        ) : null}
                        <div className="task-card-modal__comment-bubble">
                          <TaskCommentBodyDisplay body={c.body} />
                          {(c.images || []).length > 0 && (
                            <div className="task-card-modal__image-grid task-card-modal__image-grid--sm">
                              {c.images.map((im) => (
                                <div key={im.id} className="task-card-modal__image-tile">
                                  {im.isImage !== false ? (
                                    <button
                                      type="button"
                                      className="task-card-modal__image-open-btn"
                                      onClick={() =>
                                        openImagePreview(
                                          commentImagePath(orgId, taskId, c.id, im.id),
                                          'Comment attachment'
                                        )
                                      }
                                      aria-label="Open comment attachment image"
                                    >
                                      <AuthenticatedBlobImage
                                        path={commentImagePath(orgId, taskId, c.id, im.id)}
                                        alt=""
                                        className="task-card-modal__image-img"
                                      />
                                    </button>
                                  ) : (
                                    <a
                                      href={commentImagePath(orgId, taskId, c.id, im.id)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="task-card-modal__file-hint"
                                    >
                                      <FileText size={16} strokeWidth={1.75} aria-hidden /> {attachmentLabel(im.isImage)}
                                    </a>
                                  )}
                                  {im.canDelete ? (
                                    <button
                                      type="button"
                                      className="task-card-modal__image-remove"
                                      onClick={() => removeCommentImage(c.id, im.id)}
                                      aria-label="Remove image"
                                    >
                                      <Trash2 size={16} aria-hidden />
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
      {imagePreview ? (
        <div
          className="task-card-modal__image-preview-backdrop"
          role="presentation"
          onClick={() => setImagePreview(null)}
        >
          <div
            className="task-card-modal__image-preview"
            role="dialog"
            aria-modal="true"
            aria-label={imagePreview.label}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="task-card-modal__icon-btn task-card-modal__image-preview-close"
              onClick={() => setImagePreview(null)}
              aria-label="Close preview"
            >
              <X size={20} strokeWidth={2} aria-hidden />
            </button>
            <AuthenticatedBlobImage
              path={imagePreview.path}
              alt={imagePreview.label}
              className="task-card-modal__image-preview-img"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
