// CB⚡DB — shared auth utilities for Netlify edge functions
// Deno-compatible: no Buffer, no process.env, uses Web APIs throughout
//
// ── What changed across this rewrite ────────────────────────────────────
// 1. Sessions are no longer stuffed into a cookie. The cookie now carries
//    only an unguessable, random session id. The actual session (tokens,
//    DPoP keypair) lives server-side in Supabase, keyed by that id. This
//    fixes a real bug: the old cookie packed access_token + refresh_token +
//    a DPoP keypair into one Set-Cookie header, which browsers silently
//    drop if it ever crosses ~4KB — exactly the "redirected but still
//    logged out" symptom.
// 2. Added pushAuthorizationRequest() — atproto requires PAR (Pushed
//    Authorization Requests) for every client. The previous code built the
//    /authorize URL with raw query params and skipped PAR entirely.
//    https://atproto.com/specs/oauth: "PKCE and PAR are required for all
//    client types and Authorization Servers."
// 3. discoverAuthServer() now hard-fails if the auth server doesn't
//    advertise a PAR endpoint, and returns the real PDS endpoint and the
//    auth server's issuer as distinct fields (the previous version
//    conflated them under "pdsEndpoint").
// 4. CBDB is now a confidential client (private_key_jwt), not a public
//    one. Every PAR / token / refresh / revoke request is authenticated
//    with a signed client assertion, on top of the existing per-session
//    DPoP proof — two independent, complementary proofs. Confirmed the
//    exact assertion shape (aud = auth server issuer, not the specific
//    endpoint URL) against a working production integration, since public
//    guidance on this claim is inconsistent across generic OAuth writeups.

import { createHmac, randomBytes, createHash } from 'node:crypto';
import { SignJWT, importJWK, exportJWK, generateKeyPair } from 'https://esm.sh/jose@6.0.10';

// ─── Secrets / env ──────────────────────────────────────────────────────────
function env(name) {
  return typeof Deno !== 'undefined' ? Deno.env.get(name) : process.env[name];
}

const SECRET = env('CBDB_COOKIE_SECRET') || '';
if (!SECRET) throw new Error('CBDB_COOKIE_SECRET env var is not set');

const SUPABASE_URL = 'https://nakdvfxbopakdzaxhnwk.supabase.co';
const SUPABASE_SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is not set');

// This app's own signing key (confidential client authentication) — one
// static keypair for the whole app, distinct from the per-session DPoP
// keypair generated in generateDPoPKeypair() below. Public half is
// published in oauth/client-metadata.json's `jwks`.
const CLIENT_PRIVATE_JWK_RAW = env('CBDB_CLIENT_PRIVATE_JWK') || '';
if (!CLIENT_PRIVATE_JWK_RAW) throw new Error('CBDB_CLIENT_PRIVATE_JWK env var is not set');
const CLIENT_PRIVATE_JWK = JSON.parse(CLIENT_PRIVATE_JWK_RAW);
const CLIENT_KEY_ID = CLIENT_PRIVATE_JWK.kid;
if (!CLIENT_KEY_ID) throw new Error('CBDB_CLIENT_PRIVATE_JWK is missing a "kid"');

export const CLIENT_ID    = 'https://cheeseburger.world/oauth/client-metadata.json';
export const REDIRECT_URI = 'https://cheeseburger.world/oauth/callback';

// ─── Cookie names ─────────────────────────────────────────────────────────────
export const PKCE_COOKIE    = 'cbdb_pkce';     // short-lived, signed, holds PKCE+DPoP state during login
export const SESSION_COOKIE = 'cbdb_session';  // long-lived, holds ONLY a random session id — never tokens

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

// ─── Signed payload helpers — used only for the short-lived PKCE cookie now ──

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

// ─── Cookie helpers ───────────────────────────────────────────────────────────

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

// ─── Random ids ───────────────────────────────────────────────────────────────
// 256 bits of entropy, base64url-encoded — used for session ids. Unguessable;
// no need to sign/HMAC it the way the PKCE payload is, since it carries no
// information of its own (it's just a lookup key into Supabase).
export function randomId() {
  return randomBytes(32).toString('base64url');
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────
export function generatePKCE() {
  const verifier  = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── DPoP (per-session keypair, proves possession of THIS session's tokens) ──
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

// ─── Client assertion (app-wide static keypair, proves THIS REQUEST really
// comes from CBDB's backend — RFC 7523 private_key_jwt). Distinct from and
// complementary to the per-session DPoP proof above. Required on every PAR,
// token, refresh, and revocation call now that the client is confidential.
//
// aud = the auth server's issuer (e.g. "https://bsky.social"), not the
// specific endpoint being called. Verified against a working production
// atproto integration — generic private_key_jwt guidance elsewhere is
// inconsistent on this point (some use the literal endpoint URL instead),
// so this was checked rather than assumed.
export async function buildClientAssertion({ issuer }) {
  const privateKey = await importJWK(CLIENT_PRIVATE_JWK, 'ES256');
  return new SignJWT({ iss: CLIENT_ID, sub: CLIENT_ID })
    .setProtectedHeader({ alg: 'ES256', kid: CLIENT_KEY_ID })
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime('60s')
    .setJti(randomBytes(16).toString('hex'))
    .sign(privateKey);
}

function withClientAssertionFields(params, assertion) {
  return {
    ...params,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  };
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

  if (!meta.pushed_authorization_request_endpoint) {
    // atproto spec: PAR is required for all clients and all conformant
    // auth servers. If it's missing, something's misconfigured upstream —
    // fail loudly rather than silently falling back to a non-PAR request.
    throw new Error(`Auth server ${authServerBase} does not advertise a PAR endpoint`);
  }

  return {
    did,
    pds,                                             // the account's actual PDS endpoint
    issuer: meta.issuer || authServerBase,            // aud for client assertions; = authServerBase for bsky.social
    tokenEndpoint:               meta.token_endpoint,
    authorizationEndpoint:       meta.authorization_endpoint,
    revocationEndpoint:          meta.revocation_endpoint,
    pushedAuthorizationEndpoint: meta.pushed_authorization_request_endpoint,
  };
}

// ─── PAR (Pushed Authorization Request) ───────────────────────────────────────
// Required by atproto for all clients. Submits the authorization params
// server-to-server, DPoP-bound AND client-assertion-authenticated, and gets
// back a short-lived request_uri to send the browser to.
export async function pushAuthorizationRequest({ pushedAuthorizationEndpoint, issuer, params, privateJwk, publicJwk }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({
      privateJwk, publicJwk,
      method: 'POST',
      url: pushedAuthorizationEndpoint,
      nonce,
    });
    // Fresh assertion per attempt — jti must be unique, and nonce retries
    // are a new request as far as the auth server is concerned.
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields(params, clientAssertion));
    return fetch(pushedAuthorizationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PAR request failed (${res.status}): ${text}`);
  }
  return res.json(); // { request_uri, expires_in }
}

// ─── Token exchange (authorization_code) ──────────────────────────────────────
// Lives here (rather than only in auth-callback.js) so it shares the
// client-assertion + DPoP-nonce-retry plumbing with refreshAccessToken below.
export async function exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint, issuer }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: tokenEndpoint, nonce });
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      code_verifier: verifier,
    }, clientAssertion));
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Token refresh ────────────────────────────────────────────────────────────
export async function refreshAccessToken({ refresh_token, privateJwk, publicJwk, tokenEndpoint, issuer }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: tokenEndpoint, nonce });
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields({
      grant_type: 'refresh_token',
      refresh_token,
      client_id:  CLIENT_ID,
    }, clientAssertion));
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const tokens = await res.json();
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token || refresh_token };
}

// ─── Token revocation ──────────────────────────────────────────────────────────
export async function revokeToken({ token, tokenTypeHint, revocationEndpoint, privateJwk, publicJwk, issuer }) {
  const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: revocationEndpoint });
  const clientAssertion = await buildClientAssertion({ issuer });
  const body = new URLSearchParams(withClientAssertionFields({
    token,
    token_type_hint: tokenTypeHint,
    client_id: CLIENT_ID,
  }, clientAssertion));
  await fetch(revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
    body,
  });
}

// ─── Session store (Supabase) ─────────────────────────────────────────────────
// Sessions are rows in `oauth_sessions`, keyed by a random id. The RLS
// policy on this table grants NO access to anon/authenticated roles — only
// the service_role key (used here, server-side only) can read or write it.
// See supabase-oauth-sessions.sql for the table definition.

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function createSession(session) {
  const id = randomId();
  const row = {
    id,
    ...session,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/oauth_sessions`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Failed to create session (${res.status}): ${await res.text()}`);
  return id;
}

export async function getSession(id) {
  if (!id) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function updateSession(id, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) console.warn('[auth] session update failed:', res.status, await res.text());
}

export async function deleteSession(id) {
  if (!id) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: supabaseHeaders() }
    );
  } catch {}
}
