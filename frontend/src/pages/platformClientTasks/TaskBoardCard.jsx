import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  CheckSquare,
  Eye,
  MessageSquare,
  Paperclip,
} from 'lucide-react';
import { normalizeStatus } from './boardUtils.js';

function TaskCardDescriptionIcon() {
  return (
    <span className="task-board__card-desc-icon" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

export default function TaskBoardCard({
  id,
  task,
  onOpenTask,
  isSelected,
  currentUserId,
  onToggleComplete,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const descriptionText = String(task.notes || task.body || '').trim();
  const hasDescription = descriptionText.length > 0;
  const commentCount = task.commentCount ?? 0;
  const imageCount = task.imageCount ?? 0;
  const checklistItemCount = task.checklistItemCount ?? 0;
  const isCompleted = normalizeStatus(task.status) === 'completed';
  const tagged = Array.isArray(task.taggedUsers) ? task.taggedUsers : [];
  const cardLabels = Array.isArray(task.labels) ? task.labels : [];
  const showWatching =
    currentUserId != null && tagged.some((u) => String(u.id) === String(currentUserId));

  function openCard() {
    onOpenTask(task.id);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-board__card${isSelected ? ' task-board__card--selected' : ''}`}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCard();
        }
      }}
    >
      {cardLabels.length > 0 ? (
        <div className="task-board__card-labels" aria-hidden>
          {cardLabels.map((lb) => (
            <span key={lb.id} className="task-board__card-label" title={lb.name}>
              {lb.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="task-board__card-top">
        <div className="task-board__card-title">{task.title}</div>
        <button
          type="button"
          className={`task-board__card-check${isCompleted ? ' task-board__card-check--done' : ''}`}
          aria-label={isCompleted ? 'Mark as not done' : 'Mark complete'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task);
          }}
        >
          <Check size={14} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
      <div className="task-board__card-icons">
        {showWatching ? (
          <span className="task-board__card-icon-slot" title="You are tagged on this card.">
            <Eye size={14} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
        {hasDescription ? (
          <span className="task-board__card-icon-slot" title="This card has a description.">
            <TaskCardDescriptionIcon />
          </span>
        ) : null}
        {commentCount > 0 ? (
          <span className="task-board__card-icon-slot task-board__card-icon-slot--comments" title="Comments">
            <MessageSquare size={14} strokeWidth={2} aria-hidden />
            <span className="task-board__card-icon-count">{commentCount}</span>
          </span>
        ) : null}
        {checklistItemCount > 0 ? (
          <span
            className="task-board__card-icon-slot task-board__card-icon-slot--comments"
            title={`Checklist (${checklistItemCount} item${checklistItemCount === 1 ? '' : 's'})`}
          >
            <CheckSquare size={14} strokeWidth={2} aria-hidden />
            <span className="task-board__card-icon-count">{checklistItemCount}</span>
          </span>
        ) : null}
        {imageCount > 0 ? (
          <span className="task-board__card-icon-slot" title={`${imageCount} attachment${imageCount === 1 ? '' : 's'}`}>
            <Paperclip size={14} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
      </div>
    </div>
  );
}
