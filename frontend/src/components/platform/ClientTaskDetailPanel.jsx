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
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Plus,
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

function formatActivityTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
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

export default function ClientTaskDetailPanel({ orgId, taskId, assignableUsers, onClose, onTasksChanged }) {
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
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);

  const listRef = useRef(null);
  const moreRef = useRef(null);
  const taskImageInputRef = useRef(null);
  const commentEditorRef = useRef(null);
  const commentFileInputRef = useRef(null);

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
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useClickOutside(listRef, listOpen, () => setListOpen(false));
  useClickOutside(moreRef, moreOpen, () => setMoreOpen(false));

  useEffect(() => {
    if (task) {
      setDescriptionDraft(task.notes ?? task.body ?? '');
      setTitleDraft(task.title || '');
    }
  }, [task?.id, task?.title, task?.notes, task?.body]);

  const patchTask = useCallback(
    async (body) => {
      if (!taskId) return;
      setMetaSaving(true);
      try {
        const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/${taskId}`, body);
        setTask(data.task);
        onTasksChanged?.();
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not save.', { variant: 'error' });
      } finally {
        setMetaSaving(false);
      }
    },
    [orgId, taskId, onTasksChanged, showToast]
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
      await load();
      onTasksChanged?.();
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
      await load();
      onTasksChanged?.();
      showToast('Image added.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed.', { variant: 'error' });
    }
  }

  async function removeTaskImage(imageId) {
    try {
      await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}/images/${imageId}`);
      await load();
      onTasksChanged?.();
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
      setTask(data.task);
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
        await load();
      }
      onTasksChanged?.();
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
      setTask(data.task);
      onTasksChanged?.();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove image.', { variant: 'error' });
    }
  }

  async function confirmDeleteTask() {
    if (!taskId || !window.confirm('Delete this task and all comments?')) return;
    try {
      await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      showToast('Task deleted.', { variant: 'success' });
      onTasksChanged?.();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not delete.', { variant: 'error' });
    }
  }

  const activityItems = useMemo(() => {
    if (!task) return [];
    const createdBy = userLabel(task.createdBy);
    const listName = STATUS_LABEL[task.status] || task.status;
    const items = [
      {
        kind: 'system',
        key: `sys-${task.id}`,
        text: `${createdBy || 'Someone'} added this card to ${listName}`,
        at: task.createdAt,
      },
    ];
    for (const c of task.comments || []) {
      items.push({ kind: 'comment', key: `c-${c.id}`, comment: c, at: c.createdAt });
    }
    items.sort((a, b) => new Date(a.at) - new Date(b.at));
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
            accept="image/jpeg,image/png,image/gif,image/webp"
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
                  <button type="button" className="task-card-modal__chip" onClick={() => taskImageInputRef.current?.click()}>
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    Add
                  </button>
                  <button type="button" className="task-card-modal__chip" disabled title="Coming soon">
                    <Tag size={14} strokeWidth={2} aria-hidden />
                    Labels
                  </button>
                  <button
                    type="button"
                    className={`task-card-modal__chip${datesOpen ? ' task-card-modal__chip--active' : ''}`}
                    onClick={() => {
                      setDatesOpen((v) => !v);
                      setMembersOpen(false);
                    }}
                  >
                    <Clock size={14} strokeWidth={2} aria-hidden />
                    Dates
                  </button>
                  <button type="button" className="task-card-modal__chip" disabled title="Coming soon">
                    <CheckSquare size={14} strokeWidth={2} aria-hidden />
                    Checklist
                  </button>
                  <button
                    type="button"
                    className={`task-card-modal__chip${membersOpen ? ' task-card-modal__chip--active' : ''}`}
                    onClick={() => {
                      setMembersOpen((v) => !v);
                      setDatesOpen(false);
                    }}
                  >
                    <UserPlus size={14} strokeWidth={2} aria-hidden />
                    Members
                  </button>
                </div>

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

                {(task.images || []).length > 0 && (
                  <section className="task-card-modal__attachments">
                    <h2 className="task-card-modal__attachments-title">Attachments</h2>
                    <div className="task-card-modal__image-grid">
                      {(task.images || []).map((im) => (
                        <div key={im.id} className="task-card-modal__image-tile">
                          <AuthenticatedBlobImage path={taskImagePath(orgId, taskId, im.id)} alt="" className="task-card-modal__image-img" />
                          <button
                            type="button"
                            className="task-card-modal__image-remove"
                            onClick={() => removeTaskImage(im.id)}
                            aria-label="Remove image"
                          >
                            <Trash2 size={16} aria-hidden />
                          </button>
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
                  <button
                    type="button"
                    className="task-card-modal__show-details"
                    onClick={() => setShowActivityDetails((v) => !v)}
                  >
                    {showActivityDetails ? 'Hide details' : 'Show details'}
                  </button>
                </div>

                <form onSubmit={submitComment} className="task-card-modal__comment-form">
                  <TaskCommentRichEditor
                    ref={commentEditorRef}
                    disabled={saving}
                    fileInputRef={commentFileInputRef}
                    onEmptyChange={setCommentEditorEmpty}
                  />
                  <input
                    ref={commentFileInputRef}
                    id="task-card-comment-files"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    className="visually-hidden"
                    onChange={(e) => setCommentFiles([...(e.target.files || [])])}
                  />
                  {commentFiles.length > 0 ? (
                    <p className="muted task-card-modal__file-hint">{commentFiles.length} image(s) will attach when you save.</p>
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
                            {showActivityDetails && item.at ? ` · ${item.at}` : ''}
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
                        {showActivityDetails && c.mentions?.length > 0 && (
                          <p className="task-card-modal__mentions muted">
                            Mentioned: {c.mentions.map((m) => userLabel(m)).join(', ')}
                          </p>
                        )}
                        <div className="task-card-modal__comment-bubble">
                          <TaskCommentBodyDisplay body={c.body} />
                          {(c.images || []).length > 0 && (
                            <div className="task-card-modal__image-grid task-card-modal__image-grid--sm">
                              {c.images.map((im) => (
                                <div key={im.id} className="task-card-modal__image-tile">
                                  <AuthenticatedBlobImage
                                    path={commentImagePath(orgId, taskId, c.id, im.id)}
                                    alt=""
                                    className="task-card-modal__image-img"
                                  />
                                  <button
                                    type="button"
                                    className="task-card-modal__image-remove"
                                    onClick={() => removeCommentImage(c.id, im.id)}
                                    aria-label="Remove image"
                                  >
                                    <Trash2 size={16} aria-hidden />
                                  </button>
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
    </div>
  );
}
