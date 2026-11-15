import { describe, expect, it } from 'vitest';
import { parseTask, validateFields, type Task } from '../shared/task';
import { mergeServerChanges } from '../src/data/merge';
import type { LocalTask } from '../src/data/idb';
import { addMonths, startOfWeek, weekday } from '../src/lib/dates';
import { layoutDay, layoutRow } from '../src/lib/layout';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'task-0000001',
  title: 'Write report',
  startDate: '2026-11-16',
  endDate: '2026-11-16',
  startTime: null,
  endTime: null,
  color: '#5b5bd6',
  updatedAt: 1000,
  deleted: false,
  ...over,
});

describe('dates', () => {
  it('starts weeks on Sunday', () => {
    expect(startOfWeek('2026-11-15')).toBe('2026-11-15'); // a Sunday
    expect(startOfWeek('2026-11-21')).toBe('2026-11-15');
    expect(startOfWeek('2026-11-01')).toBe('2026-11-01');
    expect(weekday('2026-11-19')).toBe(4); // Thursday
  });
  it('clamps month steps to the month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
});

describe('validation', () => {
  it('rejects an end before the start', () => {
    expect(validateFields(task({ endDate: '2026-11-15' }))).toMatch(/end date/);
    expect(validateFields(task({ startTime: '10:00', endTime: '09:00' }))).toMatch(/end time/);
    expect(validateFields(task({ startTime: '10:00', endTime: null }))).toMatch(/both/);
    expect(validateFields(task({ startTime: '22:00', endTime: '09:00', endDate: '2026-11-17' }))).toBeNull();
  });
  it('parses only well-formed tasks', () => {
    expect(parseTask(task())).toEqual(task());
    expect(parseTask({ ...task(), startDate: '2026-02-30' })).toBeNull();
    expect(parseTask({ ...task(), color: 'red' })).toBeNull();
    expect(parseTask({ ...task(), startTime: 5 })).toBeNull();
    expect(parseTask({ ...task(), id: 'x' })).toBeNull();
  });
});

describe('layout', () => {
  it('stacks overlapping bars and clips them to the row', () => {
    const a = task({ id: 'aaaaaaaa', startDate: '2026-11-10', endDate: '2026-11-17' });
    const b = task({ id: 'bbbbbbbb', startDate: '2026-11-17', endDate: '2026-11-25' });
    const c = task({ id: 'cccccccc', startDate: '2026-11-19', endDate: '2026-11-19' });
    const rows = layoutRow([c, b, a], '2026-11-15', 7);
    expect(rows.map((s) => [s.task.id, s.column, s.span, s.lane, s.continuesBefore, s.continuesAfter])).toEqual([
      ['aaaaaaaa', 0, 3, 0, true, false],
      ['bbbbbbbb', 2, 5, 1, false, true],
      ['cccccccc', 4, 1, 0, false, false],
    ]);
  });
  it('puts tasks that overlap in time side by side', () => {
    const blocks = layoutDay([
      task({ id: 'aaaaaaaa', startTime: '09:00', endTime: '11:00' }),
      task({ id: 'bbbbbbbb', startTime: '10:00', endTime: '10:30' }),
      task({ id: 'cccccccc', startTime: '12:00', endTime: '13:00' }),
    ]);
    expect(blocks.map((b) => [b.task.id, b.index, b.count])).toEqual([
      ['aaaaaaaa', 0, 2],
      ['bbbbbbbb', 1, 2],
      ['cccccccc', 0, 1],
    ]);
  });
});

const local = (t: Task, dirty: boolean): LocalTask => ({ ...t, dirty });

describe('merge', () => {
  it('takes newer server edits', () => {
    const map = new Map([['task-0000001', local(task(), false)]]);
    const changed = mergeServerChanges(map, [task({ title: 'From phone', updatedAt: 2000 })], new Map());
    expect(changed).toHaveLength(1);
    expect(map.get('task-0000001')).toMatchObject({ title: 'From phone', dirty: false });
  });
  it('keeps a newer local edit made during the sync', () => {
    const map = new Map([['task-0000001', local(task({ title: 'Mine', updatedAt: 3000 }), true)]]);
    mergeServerChanges(map, [task({ title: 'Theirs', updatedAt: 2000 })], new Map([['task-0000001', 2500]]));
    expect(map.get('task-0000001')).toMatchObject({ title: 'Mine', dirty: true });
  });
  it('accepts the server copy of a pushed edit, even when the server clamped its clock', () => {
    const map = new Map([['task-0000001', local(task({ updatedAt: 9_999_999 }), true)]]);
    mergeServerChanges(map, [task({ updatedAt: 5000 })], new Map([['task-0000001', 9_999_999]]));
    expect(map.get('task-0000001')).toMatchObject({ updatedAt: 5000, dirty: false });
  });
});

describe('formatSpan', () => {
  it('formats week titles as a range', async () => {
    const { formatSpan } = await import('../src/lib/dates');
    expect(formatSpan('2026-11-15', '2026-11-21')).toMatch(/15.+21/);
    expect(formatSpan('2026-11-15', '2026-11-21')).not.toMatch(/day:/);
  });
});
