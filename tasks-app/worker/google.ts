import { fromBase64Url } from './crypto';

/** What we keep from a verified Google ID token. */
export interface GoogleProfile {
  /** Google's stable account ID. Emails can change; this can't. */
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_S = 60;
export const SUB_PATTERN = /^[0-9A-Za-z_-]{1,255}$/;

export type KeySource = (kid: string) => Promise<JsonWebKey | null>;

let cached: { keys: Map<string, Jwk>; expires: number } | null = null;

/** Fetches Google's signing keys, cached for as long as Google says (they rotate every few days). */
export function googleKeys(url = GOOGLE_JWKS_URL): KeySource {
  return async (kid) => {
    if (!cached || cached.expires < Date.now() || !cached.keys.has(kid)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch Google's keys (${response.status})`);
      const { keys } = (await response.json()) as { keys: Jwk[] };
      const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
      cached = { keys: new Map(keys.map((k) => [k.kid, k])), expires: Date.now() + maxAge * 1000 };
    }
    return cached.keys.get(kid) ?? null;
  };
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Google ID token (signature, issuer, audience, expiry) and returns the account it names,
 * or null if anything about it is wrong.
 */
export async function verifyGoogleIdToken(token: string, clientId: string, keys: KeySource, now = Date.now()): Promise<GoogleProfile | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const jwk = await keys(header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let signature: Uint8Array;
  try {
    signature = fromBase64Url(parts[2]);
  } catch {
    return null;
  }
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed))) return null;

  const seconds = now / 1000;
  if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp < seconds - CLOCK_SKEW_S) return null;
  if (typeof claims.iat === 'number' && claims.iat > seconds + CLOCK_SKEW_S) return null;
  if (typeof claims.sub !== 'string' || !SUB_PATTERN.test(claims.sub)) return null;

  const email = typeof claims.email === 'string' ? claims.email : '';
  return {
    sub: claims.sub,
    email,
    name: typeof claims.name === 'string' && claims.name ? claims.name : email || 'Google user',
    picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : null,
  };
}
