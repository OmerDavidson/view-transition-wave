import { useEffect, useState } from 'react';
import { REAUTH_EVENT, useSession, useTasks } from '../App';
import { Alert, Check, ChevronLeft, ChevronRight, CloudOff, Logout, Plus, Sync } from '../components/Icons';
import { addDays, addMonths, format, formatSpan, isValidIso, startOfWeek, today, type IsoDate } from '../lib/dates';
import { navigate, navigateForward } from '../lib/router';
import { ListView } from '../views/ListView';
import { MonthView } from '../views/MonthView';
import { WeekView } from '../views/WeekView';

export type ViewName = 'week' | 'workweek' | 'month' | 'list';

const VIEWS: { name: ViewName; label: string; short: string }[] = [
  { name: 'week', label: 'Week', short: 'Week' },
  { name: 'workweek', label: 'Work week', short: 'Work' },
  { name: 'month', label: 'Month', short: 'Month' },
  { name: 'list', label: 'List', short: 'List' },
];

function homeUrl(view: ViewName, date: IsoDate): string {
  const params = new URLSearchParams();
  if (view !== 'week') params.set('view', view);
  if (date !== today()) params.set('date', date);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export interface ViewProps {
  date: IsoDate;
  onOpen: (id: string) => void;
  onCreate: (date: IsoDate, time?: string) => void;
  onShowDay: (date: IsoDate) => void;
}

export function HomeScreen({ params }: { params: URLSearchParams }) {
  const viewParam = params.get('view');
  const view: ViewName = VIEWS.some((v) => v.name === viewParam) ? (viewParam as ViewName) : 'week';
  const dateParam = params.get('date');
  const date = isValidIso(dateParam) ? dateParam : today();

  const go = (nextView: ViewName, nextDate: IsoDate) => navigate(homeUrl(nextView, nextDate), { replace: true });
  const step = (direction: 1 | -1) => go(view, view === 'month' ? addMonths(date, direction) : addDays(date, 7 * direction));

  // Keyboard: ←/→ to page, T for today, N for a new task.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft' && view !== 'list') step(-1);
      else if (event.key === 'ArrowRight' && view !== 'list') step(1);
      else if (event.key === 't') go(view, today());
      else if (event.key === 'n') navigateForward(`/new?date=${date}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const viewProps: ViewProps = {
    date,
    onOpen: (id) => navigateForward(`/task/${id}`),
    onCreate: (day, time) => navigateForward(`/new?date=${day}${time ? `&time=${time}` : ''}`),
    onShowDay: (day) => go('week', day),
  };

  let title: string;
  if (view === 'month') title = format(date, { month: 'long', year: 'numeric' });
  else if (view === 'list') title = 'All tasks';
  else {
    const start = startOfWeek(date);
    title = formatSpan(start, addDays(start, view === 'week' ? 6 : 4));
  }

  return (
    <div className="home">
      <header className="topbar">
        <div className="topbar-row">
          <h1 className="range-title">{title}</h1>
          <SyncBadge />
          <AccountButton />
        </div>
        <div className="topbar-row">
          <nav className="segmented" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.name} type="button" aria-pressed={view === v.name} onClick={() => go(v.name, date)}>
                <span className="label-long">{v.label}</span>
                <span className="label-short">{v.short}</span>
              </button>
            ))}
          </nav>
          {view !== 'list' && (
            <div className="pager">
              <button type="button" className="icon-button" onClick={() => step(-1)} aria-label="Previous">
                <ChevronLeft />
              </button>
              <button type="button" className="button subtle" onClick={() => go(view, today())}>
                Today
              </button>
              <button type="button" className="icon-button" onClick={() => step(1)} aria-label="Next">
                <ChevronRight />
              </button>
            </div>
          )}
          <button type="button" className="button primary new-button" onClick={() => viewProps.onCreate(date)}>
            <Plus /> New task
          </button>
        </div>
      </header>

      <main className="view" style={{ viewTransitionName: 'view' }}>
        {view === 'week' && <WeekView {...viewProps} days={7} />}
        {view === 'workweek' && <WeekView {...viewProps} days={5} />}
        {view === 'month' && <MonthView {...viewProps} />}
        {view === 'list' && <ListView {...viewProps} />}
      </main>

      <button type="button" className="fab" onClick={() => viewProps.onCreate(date)} aria-label="New task">
        <Plus width={26} height={26} />
      </button>
    </div>
  );
}

function SyncBadge() {
  const { store } = useSession();
  const { sync, pending } = useTasks();
  const unsynced = pending > 0 ? ` · ${pending} unsynced` : '';
  let content;
  if (sync.status === 'syncing') content = <><Sync className="spin" /> Syncing</>;
  else if (sync.status === 'offline') content = <><CloudOff /> Offline{unsynced}</>;
  else if (sync.status === 'signed-out') content = <><Alert /> Sign in to sync</>;
  else if (sync.status === 'error') content = <><Alert /> Sync failed</>;
  else if (pending > 0) content = <><Sync /> {pending} unsynced</>;
  else content = <><Check /> Synced</>;

  return (
    <button
      type="button"
      className={`sync-badge sync-${sync.status}`}
      title={sync.status === 'error' ? sync.message : 'Sync now'}
      onClick={() => {
        if (sync.status === 'signed-out') window.dispatchEvent(new Event(REAUTH_EVENT));
        else void store.sync();
      }}
    >
      {content}
    </button>
  );
}

function AccountButton() {
  const { user, signOut } = useSession();
  const [pictureFailed, setPictureFailed] = useState(false);
  const label = user.email || user.name;
  return (
    <button type="button" className="account" onClick={() => void signOut()} title={`Signed in as ${label}. Sign out`}>
      {user.picture && !pictureFailed ? (
        <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} />
      ) : (
        <span className="avatar" aria-hidden="true">
          {(user.name[0] ?? '?').toUpperCase()}
        </span>
      )}
      <Logout className="account-logout" />
      <span className="visually-hidden">Sign out {label}</span>
    </button>
  );
}
