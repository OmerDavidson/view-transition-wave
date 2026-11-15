import { DurableObject } from 'cloudflare:workers';
import { parseTask, type SyncResponse, type Task } from '../shared/task';
import { randomBytes, sha256, toBase64Url } from './crypto';
import type { GoogleProfile } from './google';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** An edit stamped further in the future than this is clamped, so one device with a wrong clock can't win forever. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_CHANGES_PER_SYNC = 500;

interface TaskRow extends Record<string, SqlStorageValue> {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  updated_at: number;
  deleted: number;
  version: number;
}

const MIGRATIONS = [
  `CREATE TABLE account (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     google_sub TEXT NOT NULL,
     email TEXT NOT NULL,
     name TEXT NOT NULL,
     picture TEXT,
     created_at INTEGER NOT NULL,
     last_sign_in INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     start_date TEXT NOT NULL,
     end_date TEXT NOT NULL,
     start_time TEXT,
     end_time TEXT,
     color TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     version INTEGER NOT NULL
   );
   CREATE INDEX tasks_by_version ON tasks (version);`,
];

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  };
}

/**
 * One instance per user, named after their Google account ID. It holds the account, its sessions and its tasks,
 * all in this object's own SQLite database.
 */
export class UserStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  /** Durable Object SQLite doesn't allow PRAGMA user_version, so the schema version lives in a table. */
  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.sql.exec<{ version: number }>('SELECT version FROM schema_version').toArray()[0];
    if (!row) this.sql.exec('INSERT INTO schema_version (version) VALUES (0)');
    for (let i = row?.version ?? 0; i < MIGRATIONS.length; i++) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(MIGRATIONS[i]);
        this.sql.exec('UPDATE schema_version SET version = ?', i + 1);
      });
    }
  }

  private async newSession(): Promise<string> {
    const secret = toBase64Url(randomBytes(32));
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', now);
    this.sql.exec('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', await sha256(secret), now, now + SESSION_TTL_MS);
    return secret;
  }

  /**
   * Called with a profile from an ID token the Worker has already verified. Creates the account on first
   * sign-in, refreshes the name, email and picture after that, and returns a new session secret.
   */
  async signIn(profile: GoogleProfile): Promise<string> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO account (id, google_sub, email, name, picture, created_at, last_sign_in) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_sign_in = excluded.last_sign_in`,
      profile.sub,
      profile.email,
      profile.name,
      profile.picture,
      now,
      now,
    );
    return this.newSession();
  }

  /** Returns the account when the session is valid. */
  async checkSession(secret: string): Promise<GoogleProfile | null> {
    const row = this.sql
      .exec<{ google_sub: string; email: string; name: string; picture: string | null }>(
        'SELECT a.google_sub, a.email, a.name, a.picture FROM sessions s, account a WHERE s.token_hash = ? AND s.expires_at > ?',
        await sha256(secret),
        Date.now(),
      )
      .toArray()[0];
    return row ? { sub: row.google_sub, email: row.email, name: row.name, picture: row.picture } : null;
  }

  async logout(secret: string): Promise<void> {
    this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256(secret));
  }

  /**
   * Applies the device's changes (last writer wins, per task) and returns everything newer than its cursor.
   * Callers must have checked the session first.
   */
  sync(since: number, rawChanges: unknown[]): SyncResponse | { error: string } {
    if (rawChanges.length > MAX_CHANGES_PER_SYNC) return { error: 'Too many changes in one sync.' };
    const changes: Task[] = [];
    for (const raw of rawChanges) {
      const task = parseTask(raw);
      if (!task) return { error: 'A change is not a valid task.' };
      changes.push(task);
    }

    // Each sync runs in one implicit transaction: the object handles one call at a time and nothing here awaits.
    const maxUpdatedAt = Date.now() + MAX_CLOCK_SKEW_MS;
    let version = this.sql.exec<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM tasks').one().v;
    for (const task of changes) {
      const updatedAt = Math.min(task.updatedAt, maxUpdatedAt);
      const existing = this.sql.exec<{ updated_at: number }>('SELECT updated_at FROM tasks WHERE id = ?', task.id).toArray()[0];
      if (existing && existing.updated_at >= updatedAt) continue;
      version += 1;
      this.sql.exec(
        `INSERT INTO tasks (id, title, start_date, end_date, start_time, end_time, color, updated_at, deleted, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
           start_time = excluded.start_time, end_time = excluded.end_time, color = excluded.color,
           updated_at = excluded.updated_at, deleted = excluded.deleted, version = excluded.version`,
        task.id,
        task.title,
        task.startDate,
        task.endDate,
        task.startTime,
        task.endTime,
        task.color,
        updatedAt,
        task.deleted ? 1 : 0,
        version,
      );
    }

    const rows = this.sql.exec<TaskRow>('SELECT * FROM tasks WHERE version > ? ORDER BY version', since).toArray();
    return { cursor: version, changes: rows.map(rowToTask) };
  }
}
