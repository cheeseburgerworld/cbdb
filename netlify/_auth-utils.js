// CB⚡DB — shared auth utilities for Netlify edge functions
// Deno-compatible: no Buffer, no process.env, uses Web APIs throughout

import { createHmac, randomBytes, createHash } from 'node:crypto';
import { SignJWT, importJWK, exportJWK, generateKeyPair } from 'https://esm.sh/jose@6.0.10';

// ─── Cookie secret ────────────────────────────────────────────────────────────
const SECRET = (typeof Deno !== 'undefined'
  ? Deno.env.get('CBDB_COOKIE_SECRET')
  : process.env.CBDB_COOKIE_SECRET) || '';
if (!SECRET) throw new Error('CBDB_COOKIE_SECRET env var is not set');

// ─── Cookie names ─────────────────────────────────────────────────────────────
export const PKCE_COOKIE    = 'cbdb_pkce';
export const SESSION_COOKIE = 'cbdb_session';

// ─── Base64url helpers (no Buffer needed) ────────────────────────────────────
function toBase64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function fromBase64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '=='.slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export function signPayload(payload) {
  const data = toBase64url(JSON.stringify(payload));
  const sig  = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyPayload(value) {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const data = value.slice(0, dot);
  const sig  = value.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try { return JSON.parse(fromBase64url(data)); }
  catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.path)           parts.push(`Path=${opts.path}`);
  if (opts.httpOnly)       parts.push('HttpOnly');
  if (opts.secure)         parts.push('Secure');
  if (opts.sameSite)       parts.push(`SameSite=${opts.sameSite}`);
  return parts.join('; ');
}

export function clearCookie(name) {
  return setCookie(name, '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────
export function generatePKCE() {
  const verifier  = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── DPoP ─────────────────────────────────────────────────────────────────────
export async function generateDPoPKeypair() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk  = await exportJWK(publicKey);
  privateJwk.kty = publicJwk.kty = 'EC';
  return { privateJwk, publicJwk };
}

export async function buildDPoPProof({ privateJwk, publicJwk, method, url, nonce, accessToken }) {
  const privateKey = await importJWK(privateJwk, 'ES256');
  const payload = {
    jti: randomBytes(16).toString('hex'),
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };
  if (nonce)       payload.nonce = nonce;
  if (accessToken) payload.ath = createHash('sha256').update(accessToken).digest('base64url');
  return new SignJWT(payload)
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'dpop+jwt',
      jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    })
    .sign(privateKey);
}

// ─── ATProto discovery ────────────────────────────────────────────────────────
export async function discoverAuthServer(handle) {
  const resolveRes = await fetch(
    `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  );
  if (!resolveRes.ok) throw new Error(`Could not resolve handle @${handle}`);
  const { did } = await resolveRes.json();

  let pds;
  if (did.startsWith('did:plc:')) {
    const docRes = await fetch(`https://plc.directory/${did}`);
    if (!docRes.ok) throw new Error(`Could not fetch DID document for ${did}`);
    const doc = await docRes.json();
    const svc = doc.service?.find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    pds = svc?.serviceEndpoint;
  } else if (did.startsWith('did:web:')) {
    pds = `https://${did.slice('did:web:'.length)}`;
  }
  if (!pds) throw new Error(`Could not determine PDS for ${did}`);

  const authServerBase = (pds.includes('bsky.network') || pds.includes('bsky.social'))
    ? 'https://bsky.social'
    : pds;

  const metaRes = await fetch(`${authServerBase}/.well-known/oauth-authorization-server`);
  if (!metaRes.ok) throw new Error(`Could not fetch OAuth metadata from ${authServerBase}`);
  const meta = await metaRes.json();

  return {
    did,
    authServerBase,
    tokenEndpoint:               meta.token_endpoint,
    authorizationEndpoint:       meta.authorization_endpoint,
    revocationEndpoint:          meta.revocation_endpoint,
    pushedAuthorizationEndpoint: meta.pushed_authorization_request_endpoint,
  };
}

// ─── Token refresh ────────────────────────────────────────────────────────────
export async function refreshAccessToken(session) {
  const { refresh_token, privateJwk, publicJwk, tokenEndpoint } = session;
  const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: tokenEndpoint });
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token,
    client_id:     'https://cheeseburger.world/oauth/client-metadata.json',
  });
  let res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
    body,
  });
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    const dpopProof2 = await buildDPoPProof({
      privateJwk, publicJwk, method: 'POST', url: tokenEndpoint,
      nonce: res.headers.get('DPoP-Nonce'),
    });
    res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof2 },
      body,
    });
  }
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const tokens = await res.json();
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token || refresh_token };
}
