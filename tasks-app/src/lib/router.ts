import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type Route =
  | { name: 'home'; params: URLSearchParams }
  | { name: 'new'; params: URLSearchParams }
  | { name: 'edit'; id: string; params: URLSearchParams };

const listeners = new Set<() => void>();
let current = parse();

function parse(): Route {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (pathname === '/new') return { name: 'new', params };
  const edit = pathname.match(/^\/task\/([A-Za-z0-9_-]+)$/);
  if (edit) return { name: 'edit', id: edit[1], params };
  return { name: 'home', params };
}

function update(): void {
  current = parse();
  for (const listener of listeners) listener();
}

/** Runs `change` as a view transition when the browser supports it, so screens cross-fade. */
export function transition(change: () => void): void {
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  document.startViewTransition(() => flushSync(change));
}

window.addEventListener('popstate', () => transition(update));

export function navigate(to: string, { replace = false } = {}): void {
  transition(() => {
    if (replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    update();
  });
}

/** Goes back when the previous entry is ours, so the back button doesn't pile up screens. */
export function goBack(fallback = '/'): void {
  if (history.state?.fromApp) history.back();
  else navigate(fallback, { replace: true });
}

export function navigateForward(to: string): void {
  transition(() => {
    history.pushState({ fromApp: true }, '', to);
    update();
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
