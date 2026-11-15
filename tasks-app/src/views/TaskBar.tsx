import type { CSSProperties } from 'react';
import type { Task } from '../../shared/task';
import { formatTime } from '../lib/dates';

interface Props {
  task: Task;
  onOpen: (id: string) => void;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  style?: CSSProperties;
  /** Show the start time before the title. */
  showTime?: boolean;
  /** A small dot-and-text chip instead of a filled bar. */
  compact?: boolean;
}

export function TaskBar({ task, onOpen, continuesBefore, continuesAfter, style, showTime, compact }: Props) {
  const classes = ['task-bar'];
  if (compact) classes.push('compact');
  if (continuesBefore) classes.push('cont-before');
  if (continuesAfter) classes.push('cont-after');
  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ '--task': task.color, ...style } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(task.id);
      }}
      title={task.title}
    >
      {showTime && task.startTime && <span className="task-time">{formatTime(task.startTime)}</span>}
      <span className="task-title">{task.title}</span>
    </button>
  );
}
