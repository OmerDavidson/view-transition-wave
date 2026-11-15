import { useMemo, type CSSProperties } from 'react';
import { useTasks } from '../App';
import type { ViewProps } from '../screens/HomeScreen';
import { addDays, daysBetween, format, range, startOfMonth, startOfWeek, today } from '../lib/dates';
import { isTimedSingleDay, layoutRow } from '../lib/layout';
import { TaskBar } from './TaskBar';

/** Bars shown per day before the rest fold into "+N more". */
const VISIBLE_LANES = 3;

export function MonthView({ date, onOpen, onCreate, onShowDay }: ViewProps) {
  const { tasks } = useTasks();
  const monthStart = startOfMonth(date);
  const month = monthStart.slice(0, 7);
  const gridStart = startOfWeek(monthStart);
  const nextMonth = addDays(monthStart, 32).slice(0, 7);
  const weekCount = Math.ceil((daysBetween(gridStart, `${nextMonth}-01`)) / 7);
  const todayIso = today();

  const weeks = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, i) => {
        const weekStart = addDays(gridStart, i * 7);
        const segments = layoutRow(tasks, weekStart, 7);
        const hidden = Array.from({ length: 7 }, (_unused, col) => segments.filter((s) => s.lane >= VISIBLE_LANES && s.column <= col && s.column + s.span > col).length);
        return { weekStart, days: range(weekStart, 7), segments: segments.filter((s) => s.lane < VISIBLE_LANES), hidden };
      }),
    [tasks, gridStart, weekCount],
  );

  return (
    <div className="month" style={{ '--weeks': weekCount } as CSSProperties}>
      <div className="month-head">
        {range(gridStart, 7).map((day) => (
          <span key={day}>{format(day, { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="month-body">
        {weeks.map((week) => (
          <div className="month-week" key={week.weekStart}>
            {week.days.map((day, col) => (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mouse shortcut; the New task button does this from the keyboard
              <div
                key={day}
                className={`month-day${day.slice(0, 7) !== month ? ' is-outside' : ''}${day === todayIso ? ' is-today' : ''}`}
                style={{ gridColumn: col + 1 }}
                onClick={() => onCreate(day)}
              >
                <span className="month-day-number">{format(day, { day: 'numeric' })}</span>
              </div>
            ))}
            {week.segments.map((s) => (
              <TaskBar
                key={s.task.id}
                task={s.task}
                onOpen={onOpen}
                continuesBefore={s.continuesBefore}
                continuesAfter={s.continuesAfter}
                compact={isTimedSingleDay(s.task)}
                showTime={isTimedSingleDay(s.task)}
                style={{ gridColumn: `${s.column + 1} / span ${s.span}`, gridRow: s.lane + 2 }}
              />
            ))}
            {week.hidden.map((count, col) =>
              count > 0 ? (
                <button key={week.days[col]} type="button" className="more" style={{ gridColumn: col + 1, gridRow: VISIBLE_LANES + 2 }} onClick={() => onShowDay(week.days[col])}>
                  +{count} more
                </button>
              ) : null,
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
