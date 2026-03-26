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
import { useAuth } from '../components/shared/Auth.jsx';
import { Check, ClipboardList, Plus, X } from 'lucide-react';
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

  const toggleTaskComplete = useCallback(
    async (task) => {
      const done = normalizeStatus(task.status) === 'completed';
      const next = done ? 'todo' : 'completed';
      try {
        const { data } = await api.patch(`/api/platform/organizations/${orgId}/tasks/${task.id}`, { status: next });
        if (data?.task) upsertTaskInBoard(data.task);
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not update task.', { variant: 'error' });
      }
    },
    [orgId, showToast, upsertTaskInBoard]
  );

  function openComposer(columnId) {
    closeTaskDetail();
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
        await api.post(`/api/platform/organizations/${orgId}/tasks`, {
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

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />

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

    </>
  );
}
