import { useMemo, useState } from 'react';
import type { Task } from '../../shared/task';
import { useTasks } from '../App';
import type { ViewProps } from '../screens/HomeScreen';
import { addDays, format, formatTime, today, type IsoDate } from '../lib/dates';

const shortDay = (iso: IsoDate) => format(iso, { weekday: 'short', month: 'short', day: 'numeric' });

function describe(task: Task): string {
  const sameDay = task.startDate === task.endDate;
  if (task.startTime && task.endTime) {
    return sameDay
      ? `${formatTime(task.startTime)} – ${formatTime(task.endTime)}`
      : `${shortDay(task.startDate)}, ${formatTime(task.startTime)} – ${shortDay(task.endDate)}, ${formatTime(task.endTime)}`;
  }
  return sameDay ? 'All day' : `${shortDay(task.startDate)} – ${shortDay(task.endDate)}`;
}

function dayLabel(iso: IsoDate, todayIso: IsoDate): string {
  if (iso === todayIso) return 'Today';
  if (iso === addDays(todayIso, 1)) return 'Tomorrow';
  return format(iso, { weekday: 'long', month: 'long', day: 'numeric', year: iso.slice(0, 4) === todayIso.slice(0, 4) ? undefined : 'numeric' });
}

function byStart(a: Task, b: Task): number {
  return a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title);
}

function group(tasks: Task[], key: (t: Task) => string): [string, Task[]][] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const k = key(task);
    groups.set(k, [...(groups.get(k) ?? []), task]);
  }
  return [...groups];
}

export function ListView({ onOpen, onCreate }: ViewProps) {
  const { tasks } = useTasks();
  const [showPast, setShowPast] = useState(false);
  const todayIso = today();

  const { ongoing, upcoming, past } = useMemo(() => {
    const sorted = tasks.toSorted(byStart);
    return {
      ongoing: sorted.filter((t) => t.startDate < todayIso && t.endDate >= todayIso),
      upcoming: group(sorted.filter((t) => t.startDate >= todayIso), (t) => t.startDate),
      past: group(sorted.filter((t) => t.endDate < todayIso).toReversed(), (t) => t.startDate),
    };
  }, [tasks, todayIso]);

  const row = (task: Task) => (
    <li key={task.id}>
      <button type="button" className="list-task" onClick={() => onOpen(task.id)}>
        <span className="swatch" style={{ background: task.color }} />
        <span className="list-task-title">{task.title}</span>
        <span className="list-task-when">{describe(task)}</span>
      </button>
    </li>
  );

  if (tasks.length === 0) {
    return (
      <div className="empty">
        <h2>No tasks yet</h2>
        <p className="muted">Add your first one and it shows up here and on the calendar.</p>
        <button type="button" className="button primary" onClick={() => onCreate(todayIso)}>
          New task
        </button>
      </div>
    );
  }

  return (
    <div className="list">
      {ongoing.length > 0 && (
        <section>
          <h2 className="list-heading">In progress</h2>
          <ul>{ongoing.map(row)}</ul>
        </section>
      )}
      {upcoming.map(([day, items]) => (
        <section key={day}>
          <h2 className="list-heading">{dayLabel(day, todayIso)}</h2>
          <ul>{items.map(row)}</ul>
        </section>
      ))}
      {upcoming.length === 0 && ongoing.length === 0 && <p className="muted list-note">Nothing coming up.</p>}
      {past.length > 0 && (
        <section className="past">
          <button type="button" className="button subtle" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
            {showPast ? 'Hide past tasks' : `Show past tasks (${past.reduce((n, [, items]) => n + items.length, 0)})`}
          </button>
          {showPast &&
            past.map(([day, items]) => (
              <div key={day}>
                <h2 className="list-heading">{dayLabel(day, todayIso)}</h2>
                <ul>{items.map(row)}</ul>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
