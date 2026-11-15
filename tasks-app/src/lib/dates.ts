/**
 * Calendar dates are `YYYY-MM-DD` strings. Arithmetic runs in UTC so daylight-saving changes never shift a day.
 */

export type IsoDate = string;

function toDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function today(): IsoDate {
  const now = new Date();
  return fromDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDate(date);
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = toDate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return fromDate(date);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: IsoDate): number {
  return toDate(iso).getUTCDay();
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

/** Weeks start on Sunday. */
export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -weekday(iso));
}

export function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

export function range(start: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function isValidIso(value: string | null): value is IsoDate {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDate(toDate(value)) === value;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function format(iso: IsoDate, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' });
    formatters.set(key, formatter);
  }
  return formatter.format(toDate(iso));
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return timeFormatter.format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

const hourFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' });
/** "9 AM" or "09", for the time grid's labels. */
export function formatHour(hour: number): string {
  return hourFormatter.format(new Date(Date.UTC(2000, 0, 1, hour)));
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const spanFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Title for a span of days, e.g. "Nov 15 – 21, 2026" or "Dec 28, 2025 – Jan 3, 2026" (in the user's locale). */
export function formatSpan(start: IsoDate, end: IsoDate): string {
  return spanFormatter.formatRange(toDate(start), toDate(end));
}
