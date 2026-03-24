import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import ClientTaskDetailPanel from '../components/platform/ClientTaskDetailPanel.jsx';
import { taggedUserIdsFromMentionText } from '../utils/taskMentions.js';
import { ClipboardList, GripVertical, Plus, X } from 'lucide-react';

function userLabel(u) {
  if (!u) return '';
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || u.email;
}

const COLUMN_IDS = ['todo', 'working', 'review', 'completed'];

const COLUMN_META = {
  todo: { title: 'To do' },
  working: { title: 'Working on' },
  review: { title: 'Review' },
  completed: { title: 'Completed' },
};

function emptyColumns() {
  return {
    todo: [],
    working: [],
    review: [],
    completed: [],
  };
}

function normalizeStatus(s) {
  if (s === 'open') return 'todo';
  if (s === 'done') return 'completed';
  return COLUMN_IDS.includes(s) ? s : 'todo';
}

function buildColumnItems(tasks) {
  const m = emptyColumns();
  for (const col of COLUMN_IDS) {
    const arr = tasks
      .filter((t) => normalizeStatus(t.status) === col)
      .sort(
        (a, b) =>
          (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id))
      );
    m[col] = arr.map((t) => String(t.id));
  }
  return m;
}

function findContainer(id, items) {
  const idStr = String(id);
  if (COLUMN_IDS.includes(idStr)) return idStr;
  for (const col of COLUMN_IDS) {
    if (items[col].includes(idStr)) return col;
  }
  return undefined;
}

function columnItemsToUpdates(items) {
  const updates = [];
  for (const col of COLUMN_IDS) {
    items[col].forEach((taskId, index) => {
      updates.push({ id: taskId, status: col, position: index });
    });
  }
  return updates;
}

function BoardColumn({ id, title, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`task-board__column${isOver ? ' task-board__column--over' : ''}`}
      data-column-id={id}
    >
      <div className="task-board__column-head">
        <h2 className="task-board__column-title">{title}</h2>
      </div>
      <div className="task-board__column-body">{children}</div>
    </div>
  );
}

function SortableTaskCard({ id, task, onOpenTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const dateLine = [task.startDate, task.dueDate].filter(Boolean).join(' → ');
  const assignee = task.assignedTo ? userLabel(task.assignedTo) : null;
  const extras = [
    assignee ? `Assigned: ${assignee}` : null,
    task.imageCount ? `${task.imageCount} image${task.imageCount === 1 ? '' : 's'}` : null,
    task.commentCount ? `${task.commentCount} comment${task.commentCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div ref={setNodeRef} style={style} className="task-board__card" {...attributes}>
      <button
        type="button"
        className="task-board__card-grip"
        {...listeners}
        aria-label="Drag to move or reorder"
      >
        <GripVertical size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <div
        role="button"
        tabIndex={0}
        className="task-board__card-main"
        onClick={() => onOpenTask(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenTask(task.id);
          }
        }}
      >
        <div className="task-board__card-title">{task.title}</div>
        {task.notes || task.body ? (
          <p className="task-board__card-notes muted">{(task.notes || task.body).slice(0, 120)}{(task.notes || task.body).length > 120 ? '…' : ''}</p>
        ) : null}
        {dateLine ? <p className="task-board__card-dates muted">{dateLine}</p> : null}
        {extras ? <p className="task-board__card-meta muted">{extras}</p> : null}
        <p className="task-board__card-meta muted">
          {task.createdByEmail ? `Added by ${task.createdByEmail}` : 'Added'}
          {task.createdAt
            ? ` · ${new Date(task.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}`
            : ''}
        </p>
      </div>
    </div>
  );
}

export default function PlatformClientTasks() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTaskParam = searchParams.get('task');
  const detailTaskId = rawTaskParam && String(rawTaskParam).trim() ? String(rawTaskParam).trim() : null;

  const [tasks, setTasks] = useState([]);
  const [columnItems, setColumnItems] = useState(emptyColumns);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskStartDate, setTaskStartDate] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskAssignedTo, setTaskAssignedTo] = useState('');
  const [pendingTaskImages, setPendingTaskImages] = useState([]);

  const tasksRef = useRef(tasks);
  const columnItemsRef = useRef(columnItems);
  const dragSnapshot = useRef(null);

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
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

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

  async function addTask(e) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      const notesTrimmed = taskNotes.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/tasks`, {
        title: taskTitle.trim(),
        notes: notesTrimmed,
        startDate: taskStartDate || null,
        dueDate: taskDueDate || null,
        assignedTo: taskAssignedTo || null,
        taggedUserIds: taggedUserIdsFromMentionText(notesTrimmed, assignableUsers),
      });
      const newId = data.task?.id;
      if (newId && pendingTaskImages.length) {
        for (const file of pendingTaskImages) {
          const fd = new FormData();
          fd.append('image', file);
          await api.post(`/api/platform/organizations/${orgId}/tasks/${newId}/images`, fd);
        }
      }
      setTaskTitle('');
      setTaskNotes('');
      setTaskStartDate('');
      setTaskDueDate('');
      setTaskAssignedTo('');
      setPendingTaskImages([]);
      setModalOpen(false);
      await loadTasks();
      showToast('Task added.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add task.');
    } finally {
      setBusy(false);
    }
  }

  const tasksById = Object.fromEntries(tasks.map((t) => [String(t.id), t]));

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
      {error && !modalOpen && (
        <p className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <ClipboardList size={28} strokeWidth={1.75} aria-hidden />
            Tasks
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => {
            setError('');
            closeTaskDetail();
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Add task
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
            <BoardColumn key={colId} id={colId} title={COLUMN_META[colId].title}>
              <SortableContext items={columnItems[colId]} strategy={verticalListSortingStrategy}>
                <ul className="task-board__list">
                  {columnItems[colId].map((tid) => {
                    const task = tasksById[tid];
                    if (!task) return null;
                    return (
                      <li key={tid} className="task-board__list-item">
                        <SortableTaskCard
                          id={tid}
                          task={task}
                          onOpenTask={openTaskDetail}
                        />
                      </li>
                    );
                  })}
                </ul>
              </SortableContext>
            </BoardColumn>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="task-board__card task-board__card--overlay">
              <div className="task-board__card-grip task-board__card-grip--static">
                <GripVertical size={18} strokeWidth={1.75} aria-hidden />
              </div>
              <div className="task-board__card-body">
                <div className="task-board__card-title">{activeTask.title}</div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detailTaskId && (
        <ClientTaskDetailPanel
          orgId={orgId}
          taskId={detailTaskId}
          assignableUsers={assignableUsers}
          onClose={closeTaskDetail}
          onTasksChanged={loadTasks}
        />
      )}

      {modalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setModalOpen(false)}
        >
          <div
            className="modal-dialog modal-dialog--wide modal-dialog--add-task card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-task-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="add-task-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Add task
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            {error && modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={addTask}>
              <div className="field">
                <label htmlFor="task-title">Title</label>
                <input
                  id="task-title"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="e.g. Kickoff questionnaire"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="task-notes">Notes (optional)</label>
                <textarea
                  id="task-notes"
                  value={taskNotes}
                  onChange={(e) => setTaskNotes(e.target.value)}
                  rows={10}
                  placeholder="Details, links, or @someone@email.com to tag them"
                  className="platform-textarea platform-textarea--add-task-notes"
                />
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem', marginBottom: 0 }}>
                  Tag people inline with their full email after @, e.g. @alex@company.com
                </p>
              </div>
              <div className="task-detail-panel__dates">
                <div className="field">
                  <label htmlFor="task-start">Start date</label>
                  <input
                    id="task-start"
                    type="date"
                    value={taskStartDate}
                    onChange={(e) => setTaskStartDate(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="task-due">Due date</label>
                  <input
                    id="task-due"
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="task-assign">Assigned to</label>
                <select
                  id="task-assign"
                  value={taskAssignedTo}
                  onChange={(e) => setTaskAssignedTo(e.target.value)}
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
              <div className="field">
                <label htmlFor="task-images">Images (optional)</label>
                <input
                  id="task-images"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  onChange={(e) => setPendingTaskImages([...(e.target.files || [])])}
                />
              </div>
              <div className="modal-dialog__actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModalOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Adding…' : 'Add task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
