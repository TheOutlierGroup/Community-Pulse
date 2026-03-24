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

function formatDisplayDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const STATUS_LABEL = {
  todo: 'To do',
  working: 'Working on',
  review: 'Review',
  completed: 'Completed',
};

function statusBadgeClass(status) {
  if (status === 'completed') return 'closed';
  if (status === 'working' || status === 'review') return 'active';
  return 'draft';
}

export default function ClientTaskDetailPanel({ orgId, taskId, assignableUsers, onClose, onTasksChanged }) {
  const { showToast } = useToast();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [commentBody, setCommentBody] = useState('');
  const [commentFiles, setCommentFiles] = useState([]);

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

  const notesText = task ? (task.notes ?? task.body ?? '').trim() : '';

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
          <h2 id="task-detail-title" style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.3 }}>
            {loading ? 'Task' : task?.title || 'Task'}
          </h2>
          <button type="button" className="btn btn-ghost modal-dialog__close" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden />
          </button>
        </div>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {!loading && task && (
          <div className="task-detail-panel__body">
            <div className="task-detail-panel__summary">
              <div className="task-detail-panel__summary-row">
                <span className={`badge badge-${statusBadgeClass(task.status)}`}>
                  {STATUS_LABEL[task.status] || task.status}
                </span>
                <span className="muted">
                  Assigned: {task.assignedTo ? userLabel(task.assignedTo) : '—'}
                </span>
              </div>
              <div className="task-detail-panel__summary-dates muted">
                <span>Start: {formatDisplayDate(task.startDate)}</span>
                <span aria-hidden> · </span>
                <span>Due: {formatDisplayDate(task.dueDate)}</span>
              </div>
              {notesText ? (
                <div className="task-detail-panel__summary-notes">
                  <div className="task-detail-panel__summary-label muted">Notes</div>
                  <div className="task-detail-panel__summary-notes-body">{notesText}</div>
                </div>
              ) : null}
            </div>

            <section className="task-detail-panel__section task-detail-panel__section--main">
              <h3 className="task-detail-panel__h3 task-detail-panel__h3--main">
                <MessageSquare size={22} strokeWidth={1.75} aria-hidden />
                Comments
              </h3>
              {(task.comments || []).length === 0 ? (
                <p className="muted task-detail-panel__comments-empty">No comments yet.</p>
              ) : (
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
              )}

              <form onSubmit={submitComment} className="task-detail-panel__new-comment">
                <div className="field">
                  <label htmlFor="td-comment">Add a comment</label>
                  <textarea
                    id="td-comment"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    rows={6}
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

            <section className="task-detail-panel__section">
              <h3 className="task-detail-panel__h3">Task images</h3>
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
