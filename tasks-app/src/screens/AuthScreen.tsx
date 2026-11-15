import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from '../../shared/task';
import { ApiError, api } from '../data/api';
import { Logo } from '../components/Icons';

interface Props {
  /** Set when the session expired: the user signs back in to the same account. */
  username?: string;
  onSignedIn: (username: string) => void;
  onDismiss?: () => void;
}

export function AuthScreen({ username: fixedUsername, onSignedIn, onDismiss }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(fixedUsername ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reauth = fixedUsername !== undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(name)) return setError('Usernames are 3–32 characters: letters, numbers, dots, dashes and underscores.');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (mode === 'register' && password !== confirmation) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ username: string }>(`/api/auth/${mode}`, { username: name, password });
      onSignedIn(result.username);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Can't reach the server. Signing in needs a connection the first time.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={reauth ? 'auth auth-dialog' : 'auth'} role={reauth ? 'dialog' : undefined} aria-labelledby="auth-title">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo className="auth-logo" />
        <h1 id="auth-title">{reauth ? 'Sign in to sync' : mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted">
          {reauth
            ? 'Your session expired. Your tasks are safe on this device and sync once you sign in.'
            : 'Your tasks live on this device and sync to your own private store.'}
        </p>

        {!reauth && (
          <div className="segmented auth-tabs" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            readOnly={reauth}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Confirm password</span>
            <input name="confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
          </label>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="button primary block" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        {onDismiss && (
          <button className="button ghost block" type="button" onClick={onDismiss}>
            Not now
          </button>
        )}
      </form>
    </main>
  );
}
