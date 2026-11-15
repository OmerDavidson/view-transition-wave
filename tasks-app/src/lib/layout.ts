import type { Task } from '../../shared/task';
import { addDays, daysBetween, minutesOf, type IsoDate } from './dates';

/** A task's piece within one row of consecutive days. */
export interface Segment {
  task: Task;
  /** First column the bar covers, 0-based. */
  column: number;
  span: number;
  lane: number;
  /** The task started before this row / goes on after it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** A task with a time on a single day goes on the time grid; everything else is a bar across days. */
export function isTimedSingleDay(task: Task): boolean {
  return task.startTime !== null && task.startDate === task.endDate;
}

export function overlaps(task: Task, start: IsoDate, end: IsoDate): boolean {
  return task.startDate <= end && task.endDate >= start;
}

function compareTasks(a: Task, b: Task): number {
  return (
    a.startDate.localeCompare(b.startDate) ||
    daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate) ||
    (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

/** Lays out bars for the days `rowStart … rowStart + days - 1`, stacking overlapping tasks in lanes. */
export function layoutRow(tasks: Task[], rowStart: IsoDate, days: number): Segment[] {
  const rowEnd = addDays(rowStart, days - 1);
  const lanes: number[] = []; // last column used per lane
  const segments: Segment[] = [];
  for (const task of tasks.filter((t) => overlaps(t, rowStart, rowEnd)).toSorted(compareTasks)) {
    const first = task.startDate < rowStart ? rowStart : task.startDate;
    const last = task.endDate > rowEnd ? rowEnd : task.endDate;
    const column = daysBetween(rowStart, first);
    const span = daysBetween(first, last) + 1;
    let lane = lanes.findIndex((end) => end < column);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = column + span - 1;
    segments.push({ task, column, span, lane, continuesBefore: task.startDate < rowStart, continuesAfter: task.endDate > rowEnd });
  }
  return segments;
}

export interface TimedBlock {
  task: Task;
  /** Minutes from midnight. */
  top: number;
  height: number;
  /** Side-by-side placement among tasks that overlap in time. */
  index: number;
  count: number;
}

/** Places one day's timed tasks, putting tasks that overlap in time next to each other. */
export function layoutDay(tasks: Task[]): TimedBlock[] {
  const sorted = tasks.toSorted((a, b) => minutesOf(a.startTime!) - minutesOf(b.startTime!) || minutesOf(b.endTime!) - minutesOf(a.endTime!));
  const blocks: TimedBlock[] = [];
  let cluster: TimedBlock[] = [];
  let columns: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const block of cluster) block.count = columns.length;
    cluster = [];
    columns = [];
  };

  for (const task of sorted) {
    const top = minutesOf(task.startTime!);
    const bottom = Math.max(minutesOf(task.endTime!), top + 15);
    if (top >= clusterEnd) closeCluster();
    let index = columns.findIndex((end) => end <= top);
    if (index < 0) index = columns.length;
    columns[index] = bottom;
    clusterEnd = Math.max(clusterEnd, bottom);
    const block = { task, top, height: bottom - top, index, count: 1 };
    cluster.push(block);
    blocks.push(block);
  }
  closeCluster();
  return blocks;
}
