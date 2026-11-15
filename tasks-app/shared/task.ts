/** A task as both the device and the server store it. */
export interface Task {
  id: string;
  title: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  startDate: string;
  /** Local calendar date, `YYYY-MM-DD`, never before `startDate`. */
  endDate: string;
  /** `HH:MM`, or null when the task has no time ("Add time" is off). */
  startTime: string | null;
  endTime: string | null;
  /** `#rrggbb` */
  color: string;
  /** Milliseconds since the epoch of the last edit, set by the device that made it. Last writer wins. */
  updatedAt: number;
  /** A deleted task is kept as a tombstone so the deletion syncs to other devices. */
  deleted: boolean;
}

export type TaskFields = Pick<Task, 'title' | 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'color'>;

export const TASK_COLORS = ['#5b5bd6', '#0b8a8a', '#2f9e44', '#e8590c', '#e03131', '#c2255c', '#9c36b5', '#868e96'] as const;

export interface SyncRequest {
  /** The server cursor from the last successful sync, 0 for the first. */
  since: number;
  /** Local edits the server hasn't acknowledged yet. */
  changes: Task[];
}

export interface SyncResponse {
  cursor: number;
  /** Every task that changed on the server after `since`, including the ones just pushed. */
  changes: Task[];
}

/** The signed-in Google account, as the app shows it. */
export interface User {
  /** Google's account ID (`sub`). */
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

/** The value in wrangler.jsonc until a real OAuth client ID replaces it. */
export const GOOGLE_CLIENT_ID_PLACEHOLDER = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Returns the first problem with the fields, or null when they're valid. */
export function validateFields(fields: TaskFields): string | null {
  const title = fields.title.trim();
  if (!title) return 'Give the task a title.';
  if (title.length > 200) return 'Keep the title under 200 characters.';
  if (!isRealDate(fields.startDate)) return 'Pick a start date.';
  if (!isRealDate(fields.endDate)) return 'Pick an end date.';
  if (fields.endDate < fields.startDate) return 'The end date is before the start date.';
  if ((fields.startTime === null) !== (fields.endTime === null)) return 'Set both a start and an end time.';
  if (fields.startTime !== null && fields.endTime !== null) {
    if (!TIME.test(fields.startTime) || !TIME.test(fields.endTime)) return 'Times must look like 09:30.';
    if (fields.startDate === fields.endDate && fields.endTime <= fields.startTime) return 'The end time is before the start time.';
  }
  if (!COLOR.test(fields.color)) return 'Pick a colour.';
  return null;
}

const str = (x: unknown) => (typeof x === 'string' ? x : null);
const timeOrNull = (x: unknown) => (x === null ? null : str(x));

/** Parses an untrusted value into a Task, or returns null. Used by the server on every pushed change. */
export function parseTask(value: unknown): Task | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const task: Task = {
    id: str(v.id) ?? '',
    title: str(v.title) ?? '',
    startDate: str(v.startDate) ?? '',
    endDate: str(v.endDate) ?? '',
    startTime: timeOrNull(v.startTime),
    endTime: timeOrNull(v.endTime),
    color: (str(v.color) ?? '').toLowerCase(),
    updatedAt: typeof v.updatedAt === 'number' && Number.isSafeInteger(v.updatedAt) && v.updatedAt > 0 ? v.updatedAt : 0,
    deleted: v.deleted === true,
  };
  if (!ID.test(task.id) || task.updatedAt === 0) return null;
  if (v.startTime !== null && task.startTime === null) return null;
  if (v.endTime !== null && task.endTime === null) return null;
  if (validateFields(task) !== null) return null;
  task.title = task.title.trim();
  return task;
}
