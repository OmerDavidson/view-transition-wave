import { GOOGLE_CLIENT_ID_PLACEHOLDER, type SyncRequest, type User } from '../shared/task';
import { GOOGLE_JWKS_URL, googleKeys, SUB_PATTERN, verifyGoogleIdToken, type GoogleProfile } from './google';
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

/** The cookie is `<google id>.<secret>`: the ID says which Durable Object to ask, the secret proves the session. */
function readSession(request: Request): { userId: string; secret: string } | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const userId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!SUB_PATTERN.test(userId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { userId, secret };
}

/** Each Google account gets its own Durable Object. */
function store(env: Env, userId: string): DurableObjectStub<UserStore> {
  return env.USER_STORE.get(env.USER_STORE.idFromName(`google:${userId}`));
}

function toUser(profile: GoogleProfile): User {
  return { id: profile.sub, email: profile.email, name: profile.name, picture: profile.picture };
}

/** Tests may point the Worker at their own keys, but only on localhost, so a deployed Worker always trusts Google's. */
function keysUrl(env: Env, url: URL): string {
  const override = (env as Env & { GOOGLE_JWKS_URL?: string }).GOOGLE_JWKS_URL;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return override && local && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(override) ? override : GOOGLE_JWKS_URL;
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

async function handleGoogleSignIn(request: Request, env: Env, url: URL): Promise<Response> {
  if (env.GOOGLE_CLIENT_ID === GOOGLE_CLIENT_ID_PLACEHOLDER) return error('Google sign-in is not configured yet.', 503);
  const body = await readJson(request);
  const credential = typeof body?.credential === 'string' && body.credential.length < 8192 ? body.credential : '';
  const profile = credential ? await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID, googleKeys(keysUrl(env, url))) : null;
  if (!profile) return error('Google sign-in failed. Try again.', 401);
  const secret = await store(env, profile.sub).signIn(profile);
  return json(toUser(profile), 200, { 'Set-Cookie': sessionCookie(`${profile.sub}.${secret}`, url, COOKIE_MAX_AGE) });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const route = `${request.method} ${url.pathname}`;

  // Cookies are SameSite=Strict, but also refuse writes from other origins outright.
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return error('Cross-origin request refused.', 403);
  }

  // The client ID isn't a secret: the sign-in button needs it in the page.
  if (route === 'GET /api/config') return json({ googleClientId: env.GOOGLE_CLIENT_ID });
  if (route === 'POST /api/auth/google') return handleGoogleSignIn(request, env, url);

  const session = readSession(request);
  const stub = session && store(env, session.userId);

  if (route === 'POST /api/auth/logout') {
    if (session && stub) await stub.logout(session.secret);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', url, 0) });
  }

  const profile = session && stub ? await stub.checkSession(session.secret) : null;
  if (!session || !stub || !profile) return error('Sign in to continue.', 401);

  if (route === 'GET /api/me') return json(toUser(profile));

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
