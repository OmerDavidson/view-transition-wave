import type { Task } from '../../shared/task';
import type { LocalTask } from './idb';

/**
 * Folds the server's changes into the device's copy. Last writer wins per task, with one twist:
 * a task that was pushed in this sync and hasn't been touched since takes the server's copy even if
 * the server stamped it older (the server clamps timestamps from clocks that run fast).
 *
 * @param pushed the `updatedAt` of each task as it was sent in this sync
 * @returns the tasks whose local copy changed
 */
export function mergeServerChanges(local: Map<string, LocalTask>, incoming: Task[], pushed: Map<string, number>): LocalTask[] {
  const changed: LocalTask[] = [];
  for (const remote of incoming) {
    const mine = local.get(remote.id);
    if (mine?.dirty) {
      const untouchedSincePush = pushed.get(mine.id) === mine.updatedAt;
      if (!untouchedSincePush && mine.updatedAt > remote.updatedAt) continue; // our newer edit goes out next sync
    } else if (mine && mine.updatedAt === remote.updatedAt && mine.deleted === remote.deleted) {
      continue;
    }
    const next: LocalTask = { ...remote, dirty: false };
    local.set(next.id, next);
    changed.push(next);
  }
  return changed;
}
