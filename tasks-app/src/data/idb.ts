import type { Task } from '../../shared/task';

/** A task as kept on the device: `dirty` marks an edit the server hasn't acknowledged yet. */
export interface LocalTask extends Task {
  dirty: boolean;
}

const VERSION = 1;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error));
    tx.addEventListener('abort', () => reject(tx.error ?? new Error('Transaction aborted')));
  });
}

export function databaseName(userId: string): string {
  return `tasks:${userId}`;
}

/** Each signed-in Google account gets their own database on the device. */
export class LocalDatabase {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(userId: string): Promise<LocalDatabase> {
    const request = indexedDB.open(databaseName(userId), VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    });
    return new LocalDatabase(await promisify(request));
  }

  static async destroy(userId: string): Promise<void> {
    await promisify(indexedDB.deleteDatabase(databaseName(userId)));
  }

  close(): void {
    this.db.close();
  }

  async allTasks(): Promise<LocalTask[]> {
    return promisify(this.db.transaction('tasks').objectStore('tasks').getAll() as IDBRequest<LocalTask[]>);
  }

  async putTasks(tasks: LocalTask[], meta?: Record<string, unknown>): Promise<void> {
    const tx = this.db.transaction(['tasks', 'meta'], 'readwrite');
    const store = tx.objectStore('tasks');
    for (const task of tasks) store.put(task);
    if (meta) for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put(value, key);
    await done(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return promisify(this.db.transaction('meta').objectStore('meta').get(key) as IDBRequest<T | undefined>);
  }
}
