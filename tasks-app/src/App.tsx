import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { TaskFormScreen } from './screens/TaskFormScreen';
import { api } from './data/api';
import { LocalDatabase } from './data/idb';
import { TaskStore, type Snapshot } from './data/store';
import { useRoute } from './lib/router';

const USER_KEY = 'tasks.user';
/** Fired to show the sign-in dialog again after the user dismissed it. */
export const REAUTH_EVENT = 'tasks:reauth';

function readUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

function writeUser(username: string | null): void {
  try {
    if (username) localStorage.setItem(USER_KEY, username);
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Private mode: the user signs in again next time.
  }
}

interface Session {
  store: TaskStore;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession outside a signed-in app');
  return session;
}

export function useTasks(): Snapshot {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function App() {
  // Local first: the last signed-in user's tasks open straight from the device, online or not.
  const [username, setUsername] = useState(readUser);
  const [store, setStore] = useState<TaskStore | null>(null);

  useEffect(() => {
    if (!username) return;
    const next = new TaskStore(username);
    let cancelled = false;
    next.open().then(
      () => !cancelled && setStore(next),
      (error: unknown) => console.error('Could not open the local database', error),
    );
    return () => {
      cancelled = true;
      next.close();
      setStore(null);
    };
  }, [username]);

  const session = useMemo<Session | null>(() => {
    if (!store) return null;
    const signOut = async () => {
      await store.sync();
      const { pending } = store.getSnapshot();
      if (pending > 0 && !confirm(`${pending} change${pending === 1 ? '' : 's'} haven't synced yet and will be lost. Sign out anyway?`)) return;
      await api('/api/auth/logout', {}).catch(() => undefined);
      store.close();
      await LocalDatabase.destroy(store.username).catch(() => undefined);
      writeUser(null);
      setUsername(null);
    };
    return { store, signOut };
  }, [store]);

  if (!username) {
    return (
      <AuthScreen
        onSignedIn={(name) => {
          writeUser(name);
          setUsername(name);
        }}
      />
    );
  }
  if (!session) return <div className="splash" aria-busy="true" />;

  return (
    <SessionContext value={session}>
      <Screens />
    </SessionContext>
  );
}

function Screens() {
  const route = useRoute();
  const { store } = useSession();
  const { sync } = useTasks();
  // Ask to sign in again when the session expires, but let the user keep working offline-style if they'd rather.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const reopen = () => setDismissed(false);
    window.addEventListener(REAUTH_EVENT, reopen);
    return () => window.removeEventListener(REAUTH_EVENT, reopen);
  }, []);
  return (
    <>
      {route.name === 'home' ? <HomeScreen params={route.params} /> : <TaskFormScreen route={route} />}
      {sync.status === 'signed-out' && !dismissed && (
        <div className="modal-backdrop">
          <AuthScreen username={store.username} onSignedIn={() => store.requestSync(0)} onDismiss={() => setDismissed(true)} />
        </div>
      )}
    </>
  );
}
