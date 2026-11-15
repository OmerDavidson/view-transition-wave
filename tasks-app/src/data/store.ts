import type { SyncResponse, Task, TaskFields } from '../../shared/task';
import { ApiError, api } from './api';
import { LocalDatabase, type LocalTask } from './idb';
import { mergeServerChanges } from './merge';

export type SyncState =
  | { status: 'idle' } // everything is on the server
  | { status: 'syncing' }
  | { status: 'offline' }
  | { status: 'signed-out' } // the session expired; local edits wait until the user signs in again
  | { status: 'error'; message: string };

export interface Snapshot {
  /** Live tasks, deletions excluded. */
  tasks: Task[];
  pending: number;
  sync: SyncState;
  loaded: boolean;
}

const BATCH = 500;
const PERIODIC_SYNC_MS = 60_000;

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

function strip({ dirty: _dirty, ...task }: LocalTask): Task {
  return task;
}

/**
 * The device's copy of one user's tasks. The UI reads and writes only this; it is saved to IndexedDB
 * at once and synced with the user's Durable Object in the background, whenever the network allows.
 */
export class TaskStore {
  private db: LocalDatabase | null = null;
  private readonly tasks = new Map<string, LocalTask>();
  private cursor = 0;
  private snapshot: Snapshot = { tasks: [], pending: 0, sync: { status: 'idle' }, loaded: false };
  private readonly listeners = new Set<() => void>();
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly channel: BroadcastChannel;
  private readonly cleanups: (() => void)[] = [];
  private closed = false;

  constructor(readonly username: string) {
    this.channel = new BroadcastChannel(`tasks:${username}`);
  }

  async open(): Promise<void> {
    this.db = await LocalDatabase.open(this.username);
    await this.reload();
    this.cursor = (await this.db.getMeta<number>('cursor')) ?? 0;
    this.snapshot = { ...this.snapshot, loaded: true };
    this.emit();

    // Another tab wrote to the same database.
    this.channel.addEventListener('message', () => void this.reload());

    const sync = () => this.requestSync(0);
    const onVisible = () => document.visibilityState === 'visible' && sync();
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(sync, PERIODIC_SYNC_MS);
    this.cleanups.push(
      () => window.removeEventListener('online', sync),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => clearInterval(interval),
    );
    sync();
  }

  close(): void {
    this.closed = true;
    for (const cleanup of this.cleanups) cleanup();
    clearTimeout(this.syncTimer);
    this.channel.close();
    this.db?.close();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task && !task.deleted ? strip(task) : undefined;
  }

  async create(fields: TaskFields): Promise<Task> {
    const task: LocalTask = { ...fields, title: fields.title.trim(), id: newId(), updatedAt: Date.now(), deleted: false, dirty: true };
    await this.write(task);
    return strip(task);
  }

  async update(id: string, fields: TaskFields): Promise<void> {
    const current = this.tasks.get(id);
    if (!current) return;
    await this.write({ ...current, ...fields, title: fields.title.trim(), updatedAt: this.nextStamp(current), dirty: true });
  }

  async remove(id: string): Promise<void> {
    const current = this.tasks.get(id);
    if (!current) return;
    await this.write({ ...current, deleted: true, updatedAt: this.nextStamp(current), dirty: true });
  }

  /** Never go back in time, even if the clock does. */
  private nextStamp(task: Task): number {
    return Math.max(Date.now(), task.updatedAt + 1);
  }

  private async write(task: LocalTask): Promise<void> {
    this.tasks.set(task.id, task);
    this.publish();
    await this.db!.putTasks([task]);
    this.channel.postMessage('changed');
    this.requestSync(300);
  }

  private async reload(): Promise<void> {
    const all = await this.db!.allTasks();
    this.tasks.clear();
    for (const task of all) this.tasks.set(task.id, task);
    this.publish();
  }

  private publish(): void {
    const tasks: Task[] = [];
    let pending = 0;
    for (const task of this.tasks.values()) {
      if (task.dirty) pending++;
      if (!task.deleted) tasks.push(strip(task));
    }
    this.snapshot = { ...this.snapshot, tasks, pending };
    this.emit();
  }

  private setSync(sync: SyncState): void {
    this.snapshot = { ...this.snapshot, sync };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Syncs after `delay` ms, coalescing bursts of edits. */
  requestSync(delay: number): void {
    if (this.closed) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.sync(), delay);
  }

  sync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.syncAgain) {
        this.syncAgain = false;
        this.requestSync(0);
      }
    });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    if (!navigator.onLine) return this.setSync({ status: 'offline' });
    this.setSync({ status: 'syncing' });
    try {
      // Push in batches; the last round (possibly with nothing to push) pulls everything left.
      for (;;) {
        const outgoing = [...this.tasks.values()].filter((t) => t.dirty).slice(0, BATCH);
        const pushed = new Map(outgoing.map((t) => [t.id, t.updatedAt]));
        const response = await api<SyncResponse>('/api/sync', { since: this.cursor, changes: outgoing.map(strip) });
        if (this.closed) return;

        const changed = mergeServerChanges(this.tasks, response.changes, pushed);
        // The server already has a pushed task that it didn't send back (it had this exact edit).
        const returned = new Set(response.changes.map((t) => t.id));
        for (const [id, stamp] of pushed) {
          const task = this.tasks.get(id);
          if (task?.dirty && task.updatedAt === stamp && !returned.has(id)) {
            const clean = { ...task, dirty: false };
            this.tasks.set(id, clean);
            changed.push(clean);
          }
        }
        this.cursor = response.cursor;
        await this.db!.putTasks(changed, { cursor: this.cursor });
        if (changed.length > 0) {
          this.publish();
          this.channel.postMessage('changed');
        }
        if (outgoing.length < BATCH) break;
      }
      this.setSync({ status: 'idle' });
    } catch (error) {
      if (this.closed) return;
      if (error instanceof ApiError && error.status === 401) this.setSync({ status: 'signed-out' });
      else if (error instanceof ApiError) this.setSync({ status: 'error', message: error.message });
      else this.setSync({ status: 'offline' });
    }
  }
}
