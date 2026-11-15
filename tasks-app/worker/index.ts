import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN, type SyncRequest } from '../shared/task';
import { UserStore } from './user-store';

export { UserStore };

const COOKIE = 'session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function sessionCookie(value: string, url: URL, maxAge: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** The cookie is `<username>.<secret>`: the username says which Durable Object to ask, the secret proves the session. */
function readSession(request: Request): { username: string; secret: string } | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const username = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!USERNAME_PATTERN.test(username) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { username, secret };
}

function store(env: Env, username: string): DurableObjectStub<UserStore> {
  return env.USER_STORE.get(env.USER_STORE.idFromName(username));
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return null;
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handleAuth(request: Request, env: Env, url: URL, mode: 'login' | 'register'): Promise<Response> {
  const body = await readJson(request);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!USERNAME_PATTERN.test(username)) {
    return error('Usernames are 3–32 characters: letters, numbers, dots, dashes and underscores.', 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
    return error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  }
  const stub = store(env, username);
  const result = mode === 'register' ? await stub.register(username, password) : await stub.login(password);
  if (!result.ok) return error(result.error, result.status);
  return json({ username }, 200, { 'Set-Cookie': sessionCookie(`${username}.${result.sessionSecret}`, url, COOKIE_MAX_AGE) });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const route = `${request.method} ${url.pathname}`;

  // Cookies are SameSite=Strict, but also refuse writes from other origins outright.
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return error('Cross-origin request refused.', 403);
  }

  if (route === 'POST /api/auth/register') return handleAuth(request, env, url, 'register');
  if (route === 'POST /api/auth/login') return handleAuth(request, env, url, 'login');

  const session = readSession(request);
  const stub = session && store(env, session.username);

  if (route === 'POST /api/auth/logout') {
    if (session && stub) await stub.logout(session.secret);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', url, 0) });
  }

  if (!session || !stub || (await stub.checkSession(session.secret)) === null) {
    return error('Sign in to continue.', 401);
  }

  if (route === 'GET /api/me') return json({ username: session.username });

  if (route === 'POST /api/sync') {
    const body = (await readJson(request)) as Partial<SyncRequest> | null;
    const since = body?.since;
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0 || !Array.isArray(body?.changes)) {
      return error('Malformed sync request.', 400);
    }
    const result = await stub.sync(since, body.changes);
    return 'error' in result ? error(result.error, 400) : json(result);
  }

  return error('Not found.', 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
