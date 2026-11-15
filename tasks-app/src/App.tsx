import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { User } from '../shared/task';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { TaskFormScreen } from './screens/TaskFormScreen';
import { api } from './data/api';
import { disableGoogleAutoSelect } from './data/google';
import { LocalDatabase } from './data/idb';
import { TaskStore, type Snapshot } from './data/store';
import { useRoute } from './lib/router';

const USER_KEY = 'tasks.account';
/** Fired to show the sign-in dialog again after the user dismissed it. */
export const REAUTH_EVENT = 'tasks:reauth';

function readUser(): User | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null;
    return user && typeof user.id === 'string' && typeof user.name === 'string' ? user : null;
  } catch {
    return null;
  }
}

function writeUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Private mode: the user signs in again next time.
  }
}

interface Session {
  user: User;
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
  const [user, setUser] = useState(readUser);
  const [store, setStore] = useState<TaskStore | null>(null);
  const userId = user?.id;

  const signIn = (next: User) => {
    writeUser(next);
    setUser(next);
  };

  useEffect(() => {
    if (!userId) return;
    const next = new TaskStore(userId);
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
  }, [userId]);

  const session = useMemo<Session | null>(() => {
    if (!store || !user) return null;
    const signOut = async () => {
      await store.sync();
      const { pending } = store.getSnapshot();
      if (pending > 0 && !confirm(`${pending} change${pending === 1 ? '' : 's'} haven't synced yet and will be lost. Sign out anyway?`)) return;
      await api('/api/auth/logout', {}).catch(() => undefined);
      disableGoogleAutoSelect();
      store.close();
      await LocalDatabase.destroy(store.userId).catch(() => undefined);
      writeUser(null);
      setUser(null);
    };
    return { user, store, signOut };
  }, [store, user]);

  if (!user) return <AuthScreen onSignedIn={signIn} />;
  if (!session) return <div className="splash" aria-busy="true" />;

  return (
    <SessionContext value={session}>
      <Screens onSignedIn={signIn} />
    </SessionContext>
  );
}

function Screens({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const route = useRoute();
  const { user, store } = useSession();
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
          <AuthScreen
            expectedUser={user}
            onSignedIn={(next) => {
              onSignedIn(next); // picks up a new name or picture
              store.requestSync(0);
            }}
            onDismiss={() => setDismissed(true)}
          />
        </div>
      )}
    </>
  );
}
