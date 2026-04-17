import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
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

export default function PlatformTasks() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTaskParam = searchParams.get('task');
  const detailTaskId = rawTaskParam && String(rawTaskParam).trim() ? String(rawTaskParam).trim() : null;
  const orgId = user?.organizationId ? String(user.organizationId) : '';
  const isPlatformAdmin = user?.role === 'admin';

  const [tasks, setTasks] = useState([]);
  const [columnItems, setColumnItems] = useState(emptyColumns);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [staffUsers, setStaffUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [composingColumnId, setComposingColumnId] = useState(null);
  const [composerTitle, setComposerTitle] = useState('');

  const tasksRef = useRef(tasks);
  const columnItemsRef = useRef(columnItems);
  const dragSnapshot = useRef(null);
  const composerInputRef = useRef(null);

  const viewingAssignee = selectedUserId
    ? staffUsers.find((row) => String(row.id) === selectedUserId) || null
    : null;
  const isCrossClientMode = Boolean(selectedUserId);

  useDocumentTitle(
    !loading && ok
      ? isCrossClientMode
        ? `CRM Tasks · ${viewingAssignee?.email || 'Assignee'} | ${DEFAULT_TAB}`
        : `CRM Tasks | ${DEFAULT_TAB}`
      : null
  );

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    columnItemsRef.current = columnItems;
  }, [columnItems]);

  const loadStaffUsers = useCallback(async () => {
    if (!isPlatformAdmin) {
      setStaffUsers([]);
      return;
    }
    try {
      const { data } = await api.get('/api/platform/staff', { params: { limit: 500, offset: 0 } });
      setStaffUsers(data.users || []);
    } catch {
      setStaffUsers([]);
    }
  }, [isPlatformAdmin]);

  const loadTasks = useCallback(async () => {
    if (!orgId) return;
    setLoadingTasks(true);
    try {
      if (selectedUserId) {
        const { data } = await api.get(`/api/platform/staff/${selectedUserId}/tasks`);
        const list = (data.tasks || []).map((task) => ({
          ...task,
          organizationId: String(task.organizationId || ''),
        }));
        setTasks(list);
        setColumnItems(buildColumnItems(list));
      } else {
        const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks`);
        const list = (data.tasks || []).map((task) => ({
          ...task,
          organizationId: orgId,
        }));
        setTasks(list);
        setColumnItems(buildColumnItems(list));
      }
    } catch {
      setTasks([]);
      setColumnItems(emptyColumns());
      showToast('Could not load tasks.', { variant: 'error' });
    } finally {
      setLoadingTasks(false);
    }
  }, [orgId, selectedUserId, showToast]);

  useEffect(() => {
    if (!ok || !orgId) return;
    loadStaffUsers();
  }, [ok, orgId, loadStaffUsers]);

  useEffect(() => {
    if (!ok || !orgId) return;
    loadTasks();
  }, [ok, orgId, loadTasks]);

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

  const tasksById = useMemo(() => Object.fromEntries(tasks.map((t) => [String(t.id), t])), [tasks]);
  const detailTask = detailTaskId ? tasksById[detailTaskId] : null;
  const detailTaskOrgId = detailTask?.organizationId ? String(detailTask.organizationId) : orgId;

  useEffect(() => {
    if (!detailTaskId || !detailTaskOrgId) {
      setAssignableUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/platform/organizations/${detailTaskOrgId}/tasks/assignable-users`);
        if (!cancelled) setAssignableUsers(data.users || []);
      } catch {
        if (!cancelled) setAssignableUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailTaskId, detailTaskOrgId]);

  const saveReorder = useCallback(
    async (nextItems) => {
      if (isCrossClientMode) return;
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
    [orgId, showToast, isCrossClientMode]
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
      if (isCrossClientMode) return;
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
    [composerTitle, orgId, loadTasks, showToast, isCrossClientMode]
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
      const taskOrgId = String(task.organizationId || orgId);
      try {
        const { data } = await api.patch(`/api/platform/organizations/${taskOrgId}/tasks/${task.id}`, {
          status: next,
        });
        if (data?.task) upsertTaskInBoard(data.task);
      } catch (err) {
        showToast(err.response?.data?.error || 'Could not update task.', { variant: 'error' });
      }
    },
    [orgId, showToast, upsertTaskInBoard]
  );

  function handleDragStart(e) {
    if (isCrossClientMode) return;
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
    if (isCrossClientMode) return;
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
    if (isCrossClientMode) {
      setActiveId(null);
      return;
    }
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

  const displayTaskTitle = useCallback((task) => {
    if (!isCrossClientMode) return task.title;
    const orgName = String(task.organizationName || 'Client').trim() || 'Client';
    return `${orgName} - ${task.title}`;
  }, [isCrossClientMode]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (staffUsers.some((u) => String(u.id) === selectedUserId)) return;
    setSelectedUserId('');
  }, [selectedUserId, staffUsers]);

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <ClipboardList size={28} strokeWidth={1.75} aria-hidden />
          CRM Tasks
        </h1>
      </div>
      {isPlatformAdmin ? (
        <div className="field" style={{ maxWidth: '32rem', marginBottom: '0.9rem' }}>
          <label htmlFor="crm-task-assignee-filter">View tasks for</label>
          <select
            id="crm-task-assignee-filter"
            value={selectedUserId}
            onChange={(e) => {
              closeTaskDetail();
              setComposingColumnId(null);
              setComposerTitle('');
              setSelectedUserId(String(e.target.value || ''));
            }}
          >
            <option value="">Main org CRM board</option>
            {staffUsers.map((staffUser) => (
              <option key={staffUser.id} value={staffUser.id}>
                {staffUser.email}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
            {isCrossClientMode
              ? 'Showing this user’s assigned tasks across all client organizations.'
              : 'Showing tasks created for the main org CRM board.'}
          </p>
        </div>
      ) : null}
      {loadingTasks ? <p className="muted">Loading tasks…</p> : null}

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
                isCrossClientMode ? null : composingColumnId === colId ? (
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
                    const cardTask = { ...task, title: displayTaskTitle(task) };
                    return (
                      <li key={tid} className="task-board__list-item">
                        <TaskBoardCard
                          id={tid}
                          task={cardTask}
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
                <div className="task-board__card-title">{displayTaskTitle(activeTask)}</div>
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
            orgId={detailTaskOrgId}
            taskId={detailTaskId}
            assignableUsers={assignableUsers}
            onClose={closeTaskDetail}
            onTaskUpdated={upsertTaskInBoard}
            onTaskDeleted={removeTaskFromBoard}
          />
        </Suspense>
      )}
    </Layout>
  );
}
