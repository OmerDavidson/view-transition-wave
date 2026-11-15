import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID_PLACEHOLDER, type User } from '../../shared/task';
import { ApiError, api } from '../data/api';
import { loadGoogleIdentity } from '../data/google';
import { Logo } from '../components/Icons';

interface Props {
  /** Set when the session expired: the user signs back in to the same account. */
  expectedUser?: User;
  onSignedIn: (user: User) => void;
  onDismiss?: () => void;
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'busy' } | { kind: 'error'; message: string };

const OFFLINE = "Can't reach the server. Signing in needs a connection the first time.";

export function AuthScreen({ expectedUser, onSignedIn, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const buttonSlot = useRef<HTMLDivElement>(null);
  // Google keeps the callback from initialize(); read the latest props through a ref.
  const latest = useRef({ expectedUser, onSignedIn });
  useEffect(() => {
    latest.current = { expectedUser, onSignedIn };
  });

  useEffect(() => {
    let cancelled = false;

    const onCredential = async ({ credential }: { credential: string }) => {
      setStatus({ kind: 'busy' });
      try {
        const user = await api<User>('/api/auth/google', { credential });
        const expected = latest.current.expectedUser;
        if (expected && user.id !== expected.id) {
          // This device holds another account's tasks: don't mix them.
          await api('/api/auth/logout', {}).catch(() => undefined);
          setStatus({ kind: 'error', message: `This device is signed in as ${expected.email || expected.name}. Sign in with that account, or sign out first.` });
          return;
        }
        latest.current.onSignedIn(user);
      } catch (error) {
        setStatus({ kind: 'error', message: error instanceof ApiError ? error.message : OFFLINE });
      }
    };

    (async () => {
      setStatus({ kind: 'loading' });
      let clientId: string;
      try {
        clientId = (await api<{ googleClientId: string }>('/api/config')).googleClientId;
      } catch {
        if (!cancelled) setStatus({ kind: 'error', message: OFFLINE });
        return;
      }
      if (clientId === GOOGLE_CLIENT_ID_PLACEHOLDER) {
        if (!cancelled) setStatus({ kind: 'error', message: 'Google sign-in isn’t set up yet: put your OAuth client ID in GOOGLE_CLIENT_ID in wrangler.jsonc.' });
        return;
      }
      try {
        const google = await loadGoogleIdentity();
        if (cancelled || !buttonSlot.current) return;
        google.initialize({ client_id: clientId, callback: (r) => void onCredential(r), ux_mode: 'popup', auto_select: true, itp_support: true, use_fedcm_for_button: true });
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        buttonSlot.current.replaceChildren();
        google.renderButton(buttonSlot.current, { theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 300, logo_alignment: 'center' });
        setStatus({ kind: 'ready' });
      } catch {
        if (!cancelled) setStatus({ kind: 'error', message: "Couldn't load Google sign-in. Check your connection or content blocker." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reauth = expectedUser !== undefined;

  return (
    <main className={reauth ? 'auth auth-dialog' : 'auth'} role={reauth ? 'dialog' : undefined} aria-labelledby="auth-title">
      <div className="auth-card">
        <Logo className="auth-logo" />
        <h1 id="auth-title">{reauth ? 'Sign in to sync' : 'Welcome to Tasks'}</h1>
        <p className="muted">
          {reauth
            ? `Your session expired. Your tasks are safe on this device and sync once you sign in as ${expectedUser.email || expectedUser.name}.`
            : 'Plan your week. Your tasks live on this device and sync to your own private store.'}
        </p>

        <div className="google-button" ref={buttonSlot} aria-busy={status.kind === 'loading' || status.kind === 'busy'} hidden={status.kind === 'error'} />
        {status.kind === 'loading' && <p className="muted auth-note">Loading sign-in…</p>}
        {status.kind === 'busy' && <p className="muted auth-note">Signing you in…</p>}
        {status.kind === 'error' && (
          <>
            <p className="form-error" role="alert">
              {status.message}
            </p>
            <button className="button subtle block" type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        )}

        {onDismiss && (
          <button className="button ghost block" type="button" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </main>
  );
}
