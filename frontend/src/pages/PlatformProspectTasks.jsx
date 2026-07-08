import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, ClipboardList, Plus, Trash2, X } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import {
  buildColumnItems,
  COLUMN_IDS,
  COLUMN_META,
  columnItemsToUpdates,
  emptyColumns,
  findContainer,
  normalizeStatus,
} from './platformClientTasks/boardUtils.js';
import TaskBoardColumn from './platformClientTasks/TaskBoardColumn.jsx';
import TaskBoardCard from './platformClientTasks/TaskBoardCard.jsx';

function assigneeLabel(user) {
  if (!user) return '';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || '';
}

export default function PlatformProspectTasks() {
  const { orgId } = useOutletContext();
  const { showToast } = useToast();

  const [tasks, setTasks] = useState([]);
  const [columnItems, setColumnItems] = useState(emptyColumns);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [composingColumnId, setComposingColumnId] = useState(null);
  const [composerTitle, setComposerTitle] = useState('');

  const [detailTaskId, setDetailTaskId] = useState(null);
  const [detailForm, setDetailForm] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const tasksRef = useRef(tasks);
  const columnItemsRef = useRef(columnItems);
  const dragSnapshot = useRef(null);
  const composerInputRef = useRef(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    columnItemsRef.current = columnItems;
  }, [columnItems]);

  const loadTasks = useCallback(async () => {
    const { data } = await api.get(`/api/platform/crm/organisations/${orgId}/tasks`);
    const list = data.tasks || [];
    setTasks(list);
    setColumnItems(buildColumnItems(list));
  }, [orgId]);

  const loadAssignableUsers = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/platform/crm/organisations/${orgId}/tasks/assignable-users`);
      setAssignableUsers(data.users || []);
    } catch {
      setAssignableUsers([]);
    }
  }, [orgId]);

  useEffect(() => {
    loadTasks().catch(() => {
      setTasks([]);
      setColumnItems(emptyColumns());
    });
    loadAssignableUsers();
  }, [loadTasks, loadAssignableUsers]);

  useEffect(() => {
    if (!composingColumnId) return;
    const t = window.setTimeout(() => composerInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [composingColumnId]);

  useEffect(() => {
    if (!composingColumnId) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setComposingColumnId(null);
        setComposerTitle('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composingColumnId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const saveReorder = useCallback(
    async (nextItems) => {
      const updates = columnItemsToUpdates(nextItems);
      if (updates.length === 0) return;
      const prevTasks = tasksRef.current;
      const byId = Object.fromEntries(prevTasks.map((t) => [String(t.id), t]));
      const optimistic = updates.map((u) => ({
        ...byId[u.id],
        id: u.id,
        status: u.status,
        position: u.position,
      }));
      setTasks(optimistic);
      try {
        const { data } = await api.patch(`/api/platform/crm/organisations/${orgId}/tasks/reorder`, {
          tasks: updates,
        });
        if (data.tasks) {
          setTasks(data.tasks);
          setColumnItems(buildColumnItems(data.tasks));
        }
      } catch (err) {
        setTasks(prevTasks);
        if (dragSnapshot.current) {
          setColumnItems(dragSnapshot.current);
        }
        showToast(err.response?.data?.error || 'Could not save board.', { variant: 'error' });
      }
    },
    [orgId, showToast]
  );

  function openComposer(columnId) {
    setComposingColumnId(columnId);
    setComposerTitle('');
  }

  function closeComposer() {
    setComposingColumnId(null);
    setComposerTitle('');
  }

  const submitComposer = useCallback(
    async (columnId, e) => {
      e.preventDefault();
      const title = composerTitle.trim();
      if (!title) return;
      setBusy(true);
      try {
        await api.post(`/api/platform/crm/organisations/${orgId}/tasks`, {
          title,
          status: columnId,
        });
        setComposerTitle('');
        await loadTasks();
        showToast('Card added.', { variant: 'success' });
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not add card.', { variant: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [composerTitle, orgId, loadTasks, showToast]
  );

  const upsertTaskInBoard = useCallback((nextTask) => {
    if (!nextTask?.id) return;
    setTasks((prev) => {
      const id = String(nextTask.id);
      const idx = prev.findIndex((t) => String(t.id) === id);
      const next =
        idx >= 0 ? [...prev.slice(0, idx), { ...prev[idx], ...nextTask }, ...prev.slice(idx + 1)] : [...prev, nextTask];
      setColumnItems(buildColumnItems(next));
      return next;
    });
  }, []);

  const removeTaskFromBoard = useCallback((taskId) => {
    const id = String(taskId);
    setTasks((prev) => {
      const next = prev.filter((t) => String(t.id) !== id);
      setColumnItems(buildColumnItems(next));
      return next;
    });
  }, []);

  const toggleTaskComplete = useCallback(
    async (task) => {
      const done = normalizeStatus(task.status) === 'completed';
      const next = done ? 'todo' : 'completed';
      try {
        const { data } = await api.patch(`/api/platform/crm/organisations/${orgId}/tasks/${task.id}`, {
          status: next,
        });
        if (data?.task) upsertTaskInBoard(data.task);
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not update task.', { variant: 'error' });
      }
    },
    [orgId, showToast, upsertTaskInBoard]
  );

  const tasksById = useMemo(() => Object.fromEntries(tasks.map((t) => [String(t.id), t])), [tasks]);

  function openTaskDetail(taskId) {
    const task = tasksById[String(taskId)];
    if (!task) return;
    setDetailTaskId(String(taskId));
    setDetailForm({
      title: task.title,
      status: task.status,
      assignedTo: task.assignedTo || '',
      dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : '',
    });
  }

  function closeTaskDetail() {
    setDetailTaskId(null);
    setDetailForm(null);
  }

  async function saveTaskDetail(e) {
    e.preventDefault();
    if (!detailTaskId || !detailForm) return;
    setDetailBusy(true);
    try {
      const { data } = await api.patch(`/api/platform/crm/organisations/${orgId}/tasks/${detailTaskId}`, detailForm);
      if (data?.task) upsertTaskInBoard(data.task);
      showToast('Task updated.', { variant: 'success' });
      closeTaskDetail();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update task.', { variant: 'error' });
    } finally {
      setDetailBusy(false);
    }
  }

  async function deleteTaskDetail() {
    if (!detailTaskId) return;
    if (!confirm('Delete this task?')) return;
    setDetailBusy(true);
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/tasks/${detailTaskId}`);
      removeTaskFromBoard(detailTaskId);
      showToast('Task deleted.', { variant: 'success' });
      closeTaskDetail();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not delete task.', { variant: 'error' });
    } finally {
      setDetailBusy(false);
    }
  }

  function handleDragStart(e) {
    const c = columnItemsRef.current;
    dragSnapshot.current = {
      todo: [...c.todo],
      working: [...c.working],
      review: [...c.review],
      completed: [...c.completed],
    };
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e) {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const activeIdStr = String(active.id);
    if (overId === activeIdStr) return;

    setColumnItems((items) => {
      const activeContainer = findContainer(activeIdStr, items);
      const overContainer = findContainer(overId, items);
      if (!activeContainer || !overContainer || activeContainer === overContainer) return items;

      const activeItems = [...items[activeContainer]];
      const overItems = [...items[overContainer]];
      const activeIndex = activeItems.indexOf(activeIdStr);
      if (activeIndex < 0) return items;

      const overIndex = overItems.indexOf(overId);
      let newIndex;
      if (COLUMN_IDS.includes(overId)) {
        newIndex = overItems.length;
      } else {
        const isBelowOverItem =
          over &&
          active.rect.current.translated &&
          active.rect.current.translated.top > over.rect.top + over.rect.height;
        const modifier = isBelowOverItem ? 1 : 0;
        newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length;
      }

      const newActive = activeItems.filter((id) => id !== activeIdStr);
      const newOver = [
        ...overItems.slice(0, newIndex),
        activeIdStr,
        ...overItems.slice(newIndex),
      ];
      return { ...items, [activeContainer]: newActive, [overContainer]: newOver };
    });
  }

  function handleDragEnd(e) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) {
      if (dragSnapshot.current) setColumnItems(dragSnapshot.current);
      return;
    }

    setColumnItems((curr) => {
      let next = curr;
      const aid = String(active.id);
      const oid = String(over.id);
      const ac = findContainer(aid, curr);
      const oc = findContainer(oid, curr);
      if (ac && oc && ac === oc) {
        const oldIdx = curr[ac].indexOf(aid);
        const newIdx = curr[ac].indexOf(oid);
        if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
          next = { ...curr, [ac]: arrayMove(curr[ac], oldIdx, newIdx) };
        }
      }
      saveReorder(next);
      return next;
    });
  }

  function handleDragCancel() {
    setActiveId(null);
    if (dragSnapshot.current) setColumnItems(dragSnapshot.current);
  }

  const activeTask = activeId ? tasksById[activeId] : null;
  const detailTask = detailTaskId ? tasksById[detailTaskId] : null;

  return (
    <>
      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <ClipboardList size={28} strokeWidth={1.75} aria-hidden />
          Tasks
        </h1>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="task-board">
          {COLUMN_IDS.map((colId) => (
            <TaskBoardColumn
              key={colId}
              id={colId}
              title={COLUMN_META[colId].title}
              footer={
                composingColumnId === colId ? (
                  <div className="task-board__column-footer task-board__column-footer--composer">
                    <form
                      className="task-board__composer"
                      onSubmit={(e) => submitComposer(colId, e)}
                    >
                      <label htmlFor={`prospect-task-composer-${colId}`} className="visually-hidden">
                        Card title
                      </label>
                      <textarea
                        id={`prospect-task-composer-${colId}`}
                        ref={composerInputRef}
                        className="task-board__composer-input"
                        value={composerTitle}
                        onChange={(e) => setComposerTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            if (!busy && composerTitle.trim()) {
                              submitComposer(colId, e);
                            }
                          }
                        }}
                        placeholder="Enter a title"
                        rows={3}
                        autoComplete="off"
                        disabled={busy}
                      />
                      <div className="task-board__composer-actions">
                        <button
                          type="submit"
                          className="task-board__composer-submit"
                          disabled={busy || !composerTitle.trim()}
                        >
                          {busy ? 'Adding…' : 'Add card'}
                        </button>
                        <button
                          type="button"
                          className="task-board__composer-close"
                          onClick={closeComposer}
                          disabled={busy}
                          aria-label="Cancel"
                        >
                          <X size={20} strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="task-board__column-footer">
                    <button
                      type="button"
                      className="task-board__add-card"
                      onClick={() => openComposer(colId)}
                    >
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      <span>Add a card</span>
                    </button>
                  </div>
                )
              }
            >
              <SortableContext items={columnItems[colId]} strategy={verticalListSortingStrategy}>
                <ul className="task-board__list">
                  {columnItems[colId].map((tid) => {
                    const task = tasksById[tid];
                    if (!task) return null;
                    return (
                      <li key={tid} className="task-board__list-item">
                        <TaskBoardCard
                          id={tid}
                          task={task}
                          onOpenTask={openTaskDetail}
                          isSelected={detailTaskId === String(task.id)}
                          currentUserId={null}
                          onToggleComplete={toggleTaskComplete}
                        />
                      </li>
                    );
                  })}
                </ul>
              </SortableContext>
            </TaskBoardColumn>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="task-board__card task-board__card--overlay">
              <div className="task-board__card-top">
                <div className="task-board__card-title">{activeTask.title}</div>
                <span className="task-board__card-check task-board__card-check--static" aria-hidden>
                  <Check size={14} strokeWidth={2.5} />
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ModalDialog
        open={Boolean(detailTask && detailForm)}
        title="Edit task"
        titleId="prospect-task-modal-title"
        onClose={closeTaskDetail}
      >
        {detailForm && (
          <form onSubmit={saveTaskDetail} style={{ padding: '1rem 1.25rem' }}>
            <div className="field">
              <label htmlFor="prospect-task-title">Title</label>
              <input
                id="prospect-task-title"
                value={detailForm.title}
                onChange={(e) => setDetailForm((p) => ({ ...p, title: e.target.value }))}
                required
                disabled={detailBusy}
              />
            </div>
            <div className="field">
              <label htmlFor="prospect-task-status">Status</label>
              <select
                id="prospect-task-status"
                value={detailForm.status}
                onChange={(e) => setDetailForm((p) => ({ ...p, status: e.target.value }))}
                disabled={detailBusy}
              >
                {COLUMN_IDS.map((colId) => (
                  <option key={colId} value={colId}>{COLUMN_META[colId].title}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="prospect-task-assignee">Assignee</label>
              <select
                id="prospect-task-assignee"
                value={detailForm.assignedTo}
                onChange={(e) => setDetailForm((p) => ({ ...p, assignedTo: e.target.value }))}
                disabled={detailBusy}
              >
                <option value="">Unassigned</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{assigneeLabel(u)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="prospect-task-due">Due date</label>
              <input
                id="prospect-task-due"
                type="date"
                value={detailForm.dueDate}
                onChange={(e) => setDetailForm((p) => ({ ...p, dueDate: e.target.value }))}
                disabled={detailBusy}
              />
            </div>
            <div className="modal-dialog__actions" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: 'var(--danger, #dc3545)', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={deleteTaskDetail}
                disabled={detailBusy}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                Delete
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-ghost" onClick={closeTaskDetail} disabled={detailBusy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={detailBusy}>
                  {detailBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        )}
      </ModalDialog>
    </>
  );
}
