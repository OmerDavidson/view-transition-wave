import { beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../worker/crypto';
import { verifyGoogleIdToken, type KeySource } from '../worker/google';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 10, 15, 12);
let privateKey: CryptoKey;
let keys: KeySource;

const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }, key = privateKey) {
  const body = `${encode(header)}.${encode(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

const claims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '110169484474386276334',
  email: 'ada@example.com',
  name: 'Ada',
  picture: 'https://lh3.googleusercontent.com/a/x',
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
  ...over,
});

async function rsaKey() {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  const pair = await rsaKey();
  privateKey = pair.privateKey;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  keys = async (kid) => (kid === 'k1' ? jwk : null);
});

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and returns the profile', async () => {
    expect(await verifyGoogleIdToken(await sign(claims()), CLIENT_ID, keys, NOW)).toEqual({
      sub: '110169484474386276334',
      email: 'ada@example.com',
      name: 'Ada',
      picture: 'https://lh3.googleusercontent.com/a/x',
    });
  });

  it('rejects tokens for another app, from another issuer, or expired', async () => {
    expect(await verifyGoogleIdToken(await sign(claims({ aud: 'other' })), CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(claims({ iss: 'https://evil.example' })), CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(claims({ exp: NOW / 1000 - 3600 })), CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(claims({ sub: undefined })), CLIENT_ID, keys, NOW)).toBeNull();
  });

  it('rejects forged or tampered tokens', async () => {
    const other = await rsaKey();
    expect(await verifyGoogleIdToken(await sign(claims(), undefined, other.privateKey), CLIENT_ID, keys, NOW)).toBeNull();
    const [h, , s] = (await sign(claims())).split('.');
    expect(await verifyGoogleIdToken(`${h}.${encode(claims({ sub: '999' }))}.${s}`, CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(claims(), { alg: 'none', kid: 'k1' }), CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken(await sign(claims(), { alg: 'RS256', kid: 'unknown' }), CLIENT_ID, keys, NOW)).toBeNull();
    expect(await verifyGoogleIdToken('not-a-token', CLIENT_ID, keys, NOW)).toBeNull();
  });
});
