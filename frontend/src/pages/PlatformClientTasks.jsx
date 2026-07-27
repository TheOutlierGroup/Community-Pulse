import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import { useAuth } from '../components/shared/Auth.jsx';
import { Check, ClipboardList, Plus, RotateCcw, X } from 'lucide-react';
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

const ClientTaskDetailPanel = lazy(() => import('../components/platform/ClientTaskDetailPanel.jsx'));

function assigneeLabel(user) {
  if (!user) return '';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || '';
}

export default function PlatformClientTasks() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTaskParam = searchParams.get('task');
  const detailTaskId = rawTaskParam && String(rawTaskParam).trim() ? String(rawTaskParam).trim() : null;

  const [tasks, setTasks] = useState([]);
  const [columnItems, setColumnItems] = useState(emptyColumns);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [composingColumnId, setComposingColumnId] = useState(null);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerAssignedTo, setComposerAssignedTo] = useState('');
  const [composerDueDate, setComposerDueDate] = useState('');
  const [composerTag, setComposerTag] = useState('');
  const [deletedModalOpen, setDeletedModalOpen] = useState(false);
  const [deletedTasks, setDeletedTasks] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

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
    const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks`);
    const list = data.tasks || [];
    setTasks(list);
    setColumnItems(buildColumnItems(list));
  }, [orgId]);

  const loadAssignableUsers = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/assignable-users`);
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

  const openTaskDetail = useCallback((taskId) => {
    const id = String(taskId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', id);
        return next;
      },
      { replace: false }
    );
  }, [setSearchParams]);

  const closeTaskDetail = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  useEffect(() => {
    if (!detailTaskId || tasks.length === 0) return;
    const exists = tasks.some((t) => String(t.id) === detailTaskId);
    if (!exists) {
      closeTaskDetail();
    }
  }, [detailTaskId, tasks, closeTaskDetail]);

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
        setComposerAssignedTo('');
        setComposerDueDate('');
        setComposerTag('');
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
        const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/reorder`, {
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
    closeTaskDetail();
    setComposingColumnId(columnId);
    setComposerTitle('');
    setComposerAssignedTo('');
    setComposerDueDate('');
    setComposerTag('');
  }

  function closeComposer() {
    setComposingColumnId(null);
    setComposerTitle('');
    setComposerAssignedTo('');
    setComposerDueDate('');
    setComposerTag('');
  }

  const submitComposer = useCallback(
    async (columnId, e) => {
      e.preventDefault();
      const title = composerTitle.trim();
      if (!title) return;
      setBusy(true);
      try {
        const { data } = await api.post(`/api/platform/organizations/${orgId}/tasks`, {
          title,
          status: columnId,
          assignedTo: composerAssignedTo || null,
          dueDate: composerDueDate || null,
        });
        const tag = composerTag.trim();
        if (tag && data?.task?.id) {
          await api.patch(`/api/platform/organizations/${orgId}/tasks/${data.task.id}`, { labels: [tag] });
        }
        setComposerTitle('');
        setComposerAssignedTo('');
        setComposerDueDate('');
        setComposerTag('');
        await loadTasks();
        showToast('Card added.', { variant: 'success' });
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not add card.', { variant: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [composerTitle, composerAssignedTo, composerDueDate, composerTag, orgId, loadTasks, showToast]
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
        const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/${task.id}`, {
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

  const openDeletedModal = useCallback(async () => {
    setDeletedModalOpen(true);
    setDeletedLoading(true);
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks/deleted`);
      setDeletedTasks(data.tasks || []);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not load recently deleted tasks.', { variant: 'error' });
      setDeletedTasks([]);
    } finally {
      setDeletedLoading(false);
    }
  }, [orgId, showToast]);

  const restoreDeletedTask = useCallback(
    async (taskId) => {
      setRestoringId(taskId);
      try {
        await api.post(`/api/platform/organizations/${orgId}/tasks/${taskId}/restore`);
        setDeletedTasks((prev) => prev.filter((t) => String(t.id) !== String(taskId)));
        showToast('Task restored.', { variant: 'success' });
        await loadTasks();
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not restore task.', { variant: 'error' });
      } finally {
        setRestoringId(null);
      }
    },
    [orgId, showToast, loadTasks]
  );

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />

      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <ClipboardList size={28} strokeWidth={1.75} aria-hidden />
          Tasks
        </h1>
        <button type="button" className="btn btn-ghost" onClick={openDeletedModal}>
          <RotateCcw size={16} strokeWidth={2} aria-hidden style={{ marginRight: '0.4rem' }} />
          Recently deleted
        </button>
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
                      <label htmlFor={`task-board-composer-${colId}`} className="visually-hidden">
                        Card title
                      </label>
                      <textarea
                        id={`task-board-composer-${colId}`}
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
                        placeholder="Enter a title or paste a link"
                        rows={3}
                        autoComplete="off"
                        disabled={busy}
                      />
                      <div className="task-board__composer-fields">
                        <label htmlFor={`task-board-composer-assignee-${colId}`} className="visually-hidden">
                          Assignee
                        </label>
                        <select
                          id={`task-board-composer-assignee-${colId}`}
                          className="task-board__composer-select"
                          value={composerAssignedTo}
                          onChange={(e) => setComposerAssignedTo(e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Unassigned</option>
                          {assignableUsers.map((u) => (
                            <option key={u.id} value={u.id}>{assigneeLabel(u)}</option>
                          ))}
                        </select>
                        <label htmlFor={`task-board-composer-due-${colId}`} className="visually-hidden">
                          Due date
                        </label>
                        <input
                          id={`task-board-composer-due-${colId}`}
                          type="date"
                          className="task-board__composer-input-small"
                          value={composerDueDate}
                          onChange={(e) => setComposerDueDate(e.target.value)}
                          disabled={busy}
                        />
                        <label htmlFor={`task-board-composer-tag-${colId}`} className="visually-hidden">
                          Tag
                        </label>
                        <input
                          id={`task-board-composer-tag-${colId}`}
                          type="text"
                          className="task-board__composer-input-small"
                          value={composerTag}
                          onChange={(e) => setComposerTag(e.target.value)}
                          placeholder="Tag"
                          autoComplete="off"
                          disabled={busy}
                        />
                      </div>
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
                          currentUserId={user?.id}
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

      {detailTaskId && (
        <Suspense fallback={null}>
          <ClientTaskDetailPanel
            orgId={orgId}
            taskId={detailTaskId}
            assignableUsers={assignableUsers}
            onClose={closeTaskDetail}
            onTaskUpdated={upsertTaskInBoard}
            onTaskDeleted={removeTaskFromBoard}
          />
        </Suspense>
      )}

      <ModalDialog
        open={deletedModalOpen}
        title="Recently deleted"
        titleId="recently-deleted-tasks-title"
        onClose={() => setDeletedModalOpen(false)}
      >
        {deletedLoading ? (
          <p>Loading…</p>
        ) : deletedTasks.length === 0 ? (
          <p>No recently deleted tasks. Deleted tasks stay recoverable here for 30 days.</p>
        ) : (
          <ul className="task-board__list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {deletedTasks.map((t) => (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--border-color, #e5e7eb)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                    Deleted {t.deletedAt ? new Date(t.deletedAt).toLocaleDateString() : ''}
                    {t.deletedBy ? ` by ${[t.deletedBy.firstName, t.deletedBy.lastName].filter(Boolean).join(' ') || t.deletedBy.email}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={restoringId === t.id}
                  onClick={() => restoreDeletedTask(t.id)}
                >
                  {restoringId === t.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ModalDialog>

    </>
  );
}
