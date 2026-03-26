import { useDroppable } from '@dnd-kit/core';

export default function TaskBoardColumn({ id, title, children, footer }) {
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
      {footer}
    </div>
  );
}
