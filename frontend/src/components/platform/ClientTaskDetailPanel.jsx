import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import AuthenticatedBlobImage from './AuthenticatedBlobImage.jsx';
import { taggedUserIdsFromMentionText } from '../../utils/taskMentions.js';
import { ImagePlus, MessageSquare, Trash2, X } from 'lucide-react';

function userLabel(u) {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || u.email;
}

function taskImagePath(orgId, taskId, imageId) {
  return `/api/platform/organizations/${orgId}/tasks/${taskId}/images/${imageId}/file`;
}

function commentImagePath(orgId, taskId, commentId, imageId) {
  return `/api/platform/organizations/${orgId}/tasks/${taskId}/comments/${commentId}/images/${imageId}/file`;
}

export default function ClientTaskDetailPanel({ orgId, taskId, assignableUsers, onClose, onTasksChanged }) {
  const { showToast } = useToast();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const [commentBody, setCommentBody] = useState('');
  const [commentFiles, setCommentFiles] = useState([]);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      const t = data.task;
      setTask(t);
      setTitle(t.title || '');
      setNotes(t.notes ?? t.body ?? '');
      setStartDate(t.startDate || '');
      setDueDate(t.dueDate || '');
      setAssignedTo(t.assignedTo?.id ? String(t.assignedTo.id) : '');
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

  async function saveTask(e) {
    e.preventDefault();
    if (!taskId) return;
    setSaving(true);
    setError('');
    try {
      const notesTrimmed = notes.trim();
      const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/${taskId}`, {
        title: title.trim(),
        notes: notesTrimmed,
        startDate: startDate || null,
        dueDate: dueDate || null,
        assignedTo: assignedTo || null,
        taggedUserIds: taggedUserIdsFromMentionText(notesTrimmed, assignableUsers),
      });
      setTask(data.task);
      showToast('Task saved.', { variant: 'success' });
      onTasksChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save.');
    } finally {
      setSaving(false);
    }
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
    setSaving(true);
    setError('');
    try {
      const bodyTrimmed = commentBody.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/comments`, {
        body: bodyTrimmed,
        mentionUserIds: taggedUserIdsFromMentionText(bodyTrimmed, assignableUsers),
      });
      const newCommentId = data.comment?.id;
      setTask(data.task);
      setCommentBody('');
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

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="modal-dialog modal-dialog--wide modal-dialog--task-form card task-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-dialog__head">
          <h2 id="task-detail-title" style={{ margin: 0, fontSize: '1.15rem' }}>
            Task details
          </h2>
          <button type="button" className="btn btn-ghost modal-dialog__close" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden />
          </button>
        </div>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {!loading && task && (
          <div className="task-detail-panel__body">
            <form onSubmit={saveTask} className="task-detail-panel__form">
              <div className="field">
                <label htmlFor="td-title">Title</label>
                <input id="td-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="td-notes">Notes</label>
                <textarea
                  id="td-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={10}
                  placeholder="Tag people inline with @email@domain.com"
                  className="platform-textarea platform-textarea--task-detail-notes"
                />
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem', marginBottom: 0 }}>
                  Mentions use the full email after @ (must match an assignable user).
                </p>
              </div>
              <div className="task-detail-panel__dates">
                <div className="field">
                  <label htmlFor="td-start">Start date</label>
                  <input
                    id="td-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="td-due">Due date</label>
                  <input id="td-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="td-assign">Assigned to</label>
                <select
                  id="td-assign"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
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
              <div className="modal-dialog__actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>

            <section className="task-detail-panel__section">
              <h3 className="task-detail-panel__h3">Images</h3>
              <div className="task-detail-panel__image-grid">
                {(task.images || []).map((im) => (
                  <div key={im.id} className="task-detail-panel__image-tile">
                    <AuthenticatedBlobImage
                      path={taskImagePath(orgId, taskId, im.id)}
                      alt=""
                      className="task-detail-panel__image-img"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost task-detail-panel__image-remove"
                      onClick={() => removeTaskImage(im.id)}
                      aria-label="Remove image"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <label className="btn btn-ghost task-detail-panel__upload-label">
                <ImagePlus size={18} aria-hidden />
                Add image
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="task-detail-panel__file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) uploadTaskImage(f);
                  }}
                />
              </label>
            </section>

            <section className="task-detail-panel__section">
              <h3 className="task-detail-panel__h3" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <MessageSquare size={20} strokeWidth={1.75} aria-hidden />
                Comments
              </h3>
              <ul className="task-detail-panel__comments">
                {(task.comments || []).map((c) => (
                  <li key={c.id} className="task-detail-panel__comment">
                    <div className="task-detail-panel__comment-head">
                      <strong>{c.author ? userLabel(c.author) : 'Unknown'}</strong>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {c.createdAt
                          ? new Date(c.createdAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : ''}
                      </span>
                    </div>
                    {c.mentions?.length > 0 && (
                      <p className="task-detail-panel__mentions muted" style={{ fontSize: '0.8rem' }}>
                        Mentioned:{' '}
                        {c.mentions.map((m) => userLabel(m)).join(', ')}
                      </p>
                    )}
                    <p className="task-detail-panel__comment-body">{c.body}</p>
                    {(c.images || []).length > 0 && (
                      <div className="task-detail-panel__image-grid task-detail-panel__image-grid--sm">
                        {c.images.map((im) => (
                          <div key={im.id} className="task-detail-panel__image-tile">
                            <AuthenticatedBlobImage
                              path={commentImagePath(orgId, taskId, c.id, im.id)}
                              alt=""
                              className="task-detail-panel__image-img"
                            />
                            <button
                              type="button"
                              className="btn btn-ghost task-detail-panel__image-remove"
                              onClick={() => removeCommentImage(c.id, im.id)}
                              aria-label="Remove image"
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <form onSubmit={submitComment} className="task-detail-panel__new-comment">
                <div className="field">
                  <label htmlFor="td-comment">New comment</label>
                  <textarea
                    id="td-comment"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    rows={5}
                    className="platform-textarea platform-textarea--task-comment"
                    placeholder="Write a comment… Use @email@domain.com to mention someone."
                  />
                </div>
                <div className="field">
                  <label htmlFor="td-comment-files">Attach images (optional)</label>
                  <input
                    id="td-comment-files"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    onChange={(e) => setCommentFiles([...(e.target.files || [])])}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={saving || !commentBody.trim()}>
                  Post comment
                </button>
              </form>
            </section>

            <div className="task-detail-panel__danger">
              <button type="button" className="btn btn-danger-ghost" onClick={confirmDeleteTask}>
                Delete task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
