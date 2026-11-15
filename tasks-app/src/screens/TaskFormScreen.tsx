import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { TASK_COLORS, validateFields, type TaskFields } from '../../shared/task';
import { useSession, useTasks } from '../App';
import { Check, Close, Trash } from '../components/Icons';
import { isValidIso, today } from '../lib/dates';
import { goBack, type Route } from '../lib/router';

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function initialFields(params: URLSearchParams): TaskFields {
  const dateParam = params.get('date');
  const date = isValidIso(dateParam) ? dateParam : today();
  const time = params.get('time');
  const hasTime = time !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return {
    title: '',
    startDate: date,
    endDate: date,
    startTime: hasTime ? time : null,
    endTime: hasTime ? addHour(time) : null,
    color: TASK_COLORS[0],
  };
}

export function TaskFormScreen({ route }: { route: Exclude<Route, { name: 'home' }> }) {
  const { store } = useSession();
  const { loaded } = useTasks();
  const editing = route.name === 'edit' ? store.get(route.id) : undefined;
  const [fields, setFields] = useState<TaskFields>(() => (editing ? { ...editing } : initialFields(route.params)));
  // Remember the last times used, so turning "Add time" off and on again doesn't lose them.
  const [times, setTimes] = useState({ start: fields.startTime ?? '09:00', end: fields.endTime ?? '10:00' });
  const [error, setError] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const hasTime = fields.startTime !== null;

  useEffect(() => {
    if (route.name === 'new') titleInput.current?.focus();
  }, [route.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && goBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (route.name === 'edit' && !editing) {
    return (
      <div className="sheet">
        <div className="sheet-card empty">
          <h2>{loaded ? 'This task no longer exists' : 'Loading…'}</h2>
          <button type="button" className="button primary" onClick={() => goBack()}>
            Back to calendar
          </button>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<TaskFields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const setStartDate = (startDate: string) => {
    // Keep the length of a multi-day task when moving its start; never let the end fall before it.
    set({ startDate, endDate: fields.endDate < startDate ? startDate : fields.endDate });
  };

  const toggleTime = (on: boolean) => set(on ? { startTime: times.start, endTime: times.end } : { startTime: null, endTime: null });

  const setTime = (which: 'start' | 'end', value: string) => {
    const next = { ...times, [which]: value };
    if (which === 'start' && fields.startDate === fields.endDate && next.end <= value) next.end = addHour(value);
    setTimes(next);
    set({ startTime: next.start, endTime: next.end });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateFields(fields);
    if (problem) return setError(problem);
    if (editing) await store.update(editing.id, fields);
    else await store.create(fields);
    goBack();
  };

  const remove = async () => {
    if (!editing || !confirm(`Delete “${editing.title}”?`)) return;
    await store.remove(editing.id);
    goBack();
  };

  const customColor = !TASK_COLORS.includes(fields.color as (typeof TASK_COLORS)[number]);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- clicking outside closes; Escape and the close button do it from the keyboard
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && goBack()}>
      <form className="sheet-card task-form" onSubmit={submit} noValidate style={{ viewTransitionName: 'sheet' }}>
        <header className="sheet-header">
          <button type="button" className="icon-button" onClick={() => goBack()} aria-label="Close">
            <Close />
          </button>
          <h1>{editing ? 'Edit task' : 'New task'}</h1>
          <button type="submit" className="button primary">
            <Check /> Save
          </button>
        </header>

        <label className="field title-field" style={{ '--task': fields.color } as CSSProperties}>
          <span className="visually-hidden">Title</span>
          <input ref={titleInput} placeholder="Title" value={fields.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} required />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Start date</span>
            <input type="date" value={fields.startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>End date</span>
            <input type="date" value={fields.endDate} min={fields.startDate} onChange={(e) => e.target.value && set({ endDate: e.target.value })} required />
          </label>
        </div>

        <label className="switch">
          <input type="checkbox" role="switch" aria-checked={hasTime} checked={hasTime} onChange={(e) => toggleTime(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>Add time</span>
        </label>

        {hasTime && (
          <div className="field-row">
            <label className="field">
              <span>Start time</span>
              <input type="time" value={fields.startTime ?? ''} onChange={(e) => e.target.value && setTime('start', e.target.value)} required />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" value={fields.endTime ?? ''} onChange={(e) => e.target.value && setTime('end', e.target.value)} required />
            </label>
          </div>
        )}

        <fieldset className="field colors">
          <legend>Colour</legend>
          <div className="swatches">
            {TASK_COLORS.map((color) => (
              <label key={color} className="swatch-option" style={{ '--swatch': color } as CSSProperties}>
                <input type="radio" name="color" value={color} checked={fields.color === color} onChange={() => set({ color })} aria-label={color} />
              </label>
            ))}
            <label className={`swatch-option custom${customColor ? ' is-custom' : ''}`} style={{ '--swatch': fields.color } as CSSProperties} title="Custom colour">
              <input type="color" value={fields.color} onChange={(e) => set({ color: e.target.value })} aria-label="Custom colour" />
            </label>
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {editing && (
          <button type="button" className="button danger" onClick={() => void remove()}>
            <Trash /> Delete task
          </button>
        )}
      </form>
    </div>
  );
}
