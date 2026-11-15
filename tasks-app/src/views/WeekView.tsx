import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTasks } from '../App';
import type { ViewProps } from '../screens/HomeScreen';
import { format, formatHour, formatTime, range, startOfWeek, today } from '../lib/dates';
import { isTimedSingleDay, layoutDay, layoutRow } from '../lib/layout';
import { TaskBar } from './TaskBar';

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(minutesNow);
  useEffect(() => {
    const timer = setInterval(() => setMinutes(minutesNow()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return minutes;
}

/** Sunday–Saturday (7 days) or the Sunday–Thursday work week (5 days). */
export function WeekView({ date, days, onOpen, onCreate }: ViewProps & { days: 5 | 7 }) {
  const { tasks } = useTasks();
  const start = startOfWeek(date);
  const dates = range(start, days);
  const todayIso = today();
  const now = useNowMinutes();

  const bars = layoutRow(tasks.filter((t) => !isTimedSingleDay(t)), start, days);
  const lanes = bars.reduce((max, s) => Math.max(max, s.lane + 1), 0);
  const timedByDay = new Map(dates.map((day) => [day, layoutDay(tasks.filter((t) => isTimedSingleDay(t) && t.startDate === day))]));

  const earliest = Math.min(7 * 60, ...[...timedByDay.values()].flat().map((b) => b.top));
  // Open at 7 am, or earlier if this week has something before then.
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!scroller.current || scrolledFor.current === start) return;
    scrolledFor.current = start;
    scroller.current.scrollTop = Math.max(0, (earliest / 60) * HOUR_PX - 8);
  }, [start, earliest]);

  const columns = { '--days': days } as CSSProperties;

  return (
    <div className="week" style={columns}>
      <div className="week-head">
        <div className="gutter" />
        {dates.map((day) => (
          <button key={day} type="button" className={`day-head${day === todayIso ? ' is-today' : ''}`} onClick={() => onCreate(day)} aria-label={`New task on ${format(day, { dateStyle: 'full' })}`}>
            <span className="day-name">{format(day, { weekday: 'short' })}</span>
            <span className="day-number">{format(day, { day: 'numeric' })}</span>
          </button>
        ))}
      </div>

      <div className="all-day" style={{ gridTemplateRows: `repeat(${Math.max(lanes, 1)}, var(--bar-height))` }}>
        <div className="gutter all-day-label" style={{ gridRow: `1 / span ${Math.max(lanes, 1)}` }}>
          all-day
        </div>
        {dates.map((day, i) => (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mouse shortcut; day headings do this from the keyboard
          <div key={day} className="all-day-cell" style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(lanes, 1)}` }} onClick={() => onCreate(day)} />
        ))}
        {bars.map((s) => (
          <TaskBar
            key={s.task.id}
            task={s.task}
            onOpen={onOpen}
            continuesBefore={s.continuesBefore}
            continuesAfter={s.continuesAfter}
            showTime
            style={{ gridColumn: `${s.column + 2} / span ${s.span}`, gridRow: s.lane + 1 }}
          />
        ))}
      </div>

      <div className="time-scroller" ref={scroller}>
        <div className="time-grid" style={{ height: 24 * HOUR_PX }}>
          <div className="gutter hours">
            {HOURS.map((h) => (
              <span key={h} className="hour-label" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : formatHour(h)}
              </span>
            ))}
          </div>
          {dates.map((day) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mouse shortcut; day headings do this from the keyboard
            <div
              key={day}
              className={`day-column${day === todayIso ? ' is-today' : ''}`}
              onClick={(event) => {
                const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                const hour = Math.min(23, Math.max(0, Math.floor(y / HOUR_PX)));
                onCreate(day, `${String(hour).padStart(2, '0')}:00`);
              }}
            >
              {timedByDay.get(day)!.map((b) => (
                <button
                  key={b.task.id}
                  type="button"
                  className={`timed-task${b.height < 45 ? ' is-short' : ''}`}
                  style={
                    {
                      '--task': b.task.color,
                      top: (b.top / 60) * HOUR_PX,
                      height: Math.max((b.height / 60) * HOUR_PX - 2, 18),
                      left: `calc(${(b.index / b.count) * 100}% + 2px)`,
                      width: `calc(${100 / b.count}% - 4px)`,
                    } as CSSProperties
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(b.task.id);
                  }}
                  title={b.task.title}
                >
                  <span className="task-title">{b.task.title}</span>
                  <span className="task-time">
                    {formatTime(b.task.startTime!)} – {formatTime(b.task.endTime!)}
                  </span>
                </button>
              ))}
              {day === todayIso && <div className="now-line" style={{ top: (now / 60) * HOUR_PX }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
