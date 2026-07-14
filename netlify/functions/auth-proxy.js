// CB⚡DB — auth-proxy Netlify function
// POST /auth/proxy
// Body: { action: 'post' | 'uploadBlob', payload: { ... } }
//
// The browser can't make DPoP-authenticated Bluesky API calls directly
// (requires crypto.subtle + stored DPoP keys). This function does it
// server-side, looking the session up from Supabase by the id in the cookie.
//
// Supported actions:
//   post:       Create a Bluesky post record. payload = { text, facets?, embed?, createdAt }
//   uploadBlob: Upload an image blob.          payload = { data (base64), mimeType }

import {
  getSession,
  updateSession,
  parseCookies,
  buildDPoPProof,
  refreshAccessToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  // 1. Read the session id cookie and look up the session
  const cookies   = parseCookies(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return json({ error: 'Not authenticated' }, 401);

  const session = await getSession(sessionId);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  // 2. Parse request body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, payload } = body;
  if (!action || !payload) {
    return json({ error: 'action and payload are required' }, 400);
  }

  // 3. Dispatch to the appropriate handler, with auto-refresh on 401
  try {
    const result = await dispatch(sessionId, session, action, payload);
    return json(result, 200);
  } catch (err) {
    console.error('[auth-proxy] error:', err);
    return json({ error: err.message || 'Proxy request failed' }, 500);
  }
}

// ─── Action dispatcher ────────────────────────────────────────────────────────

async function dispatch(sessionId, session, action, payload) {
  switch (action) {
    case 'post':       return doPost(sessionId, session, payload);
    case 'uploadBlob': return doUploadBlob(sessionId, session, payload);
    default:           throw new Error(`Unknown action: ${action}`);
  }
}

// ─── Resolve user's actual PDS from their DID document ───────────────────────

async function resolvePDS(did) {
  try {
    if (did.startsWith('did:plc:')) {
      const res = await fetch(`https://plc.directory/${did}`);
      if (res.ok) {
        const doc = await res.json();
        const svc = doc.service?.find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
        if (svc?.serviceEndpoint) return svc.serviceEndpoint;
      }
    } else if (did.startsWith('did:web:')) {
      return `https://${did.slice('did:web:'.length)}`;
    }
  } catch {}
  return 'https://bsky.social';
}

// ─── Create a Bluesky post ────────────────────────────────────────────────────

async function doPost(sessionId, session, payload) {
  const pds = await resolvePDS(session.did);
  const endpoint = `${pds}/xrpc/com.atproto.repo.createRecord`;
  const record = {
    $type:     'app.bsky.feed.post',
    text:      payload.text,
    createdAt: payload.createdAt || new Date().toISOString(),
  };
  if (payload.facets) record.facets = payload.facets;
  if (payload.embed)  record.embed  = payload.embed;

  const requestBody = JSON.stringify({
    repo:       session.did,
    collection: 'app.bsky.feed.post',
    record,
  });

  return bskyRequest(sessionId, session, 'POST', endpoint, requestBody, 'application/json');
}

// ─── Upload an image blob ─────────────────────────────────────────────────────

async function doUploadBlob(sessionId, session, payload) {
  const { data, mimeType } = payload;
  if (!data || !mimeType) throw new Error('uploadBlob requires data and mimeType');

  const binary = atob(data);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pds = await resolvePDS(session.did);
  const endpoint = `${pds}/xrpc/com.atproto.repo.uploadBlob`;

  return bskyRequest(sessionId, session, 'POST', endpoint, bytes, mimeType);
}

// ─── Authenticated Bluesky request with DPoP + auto-refresh ──────────────────

async function bskyRequest(sessionId, session, method, endpoint, body, contentType) {
  const attempt = async (sess, nonce) => {
    const dpopProof = await buildDPoPProof({
      privateJwk:  sess.private_jwk,
      publicJwk:   sess.public_jwk,
      method,
      url:         endpoint,
      nonce,
      accessToken: sess.access_token,
    });

    const headers = {
      'Authorization': `DPoP ${sess.access_token}`,
      'DPoP':          dpopProof,
      'Content-Type':  contentType,
    };

    return fetch(endpoint, { method, headers, body });
  };

  // First attempt (no nonce)
  let res = await attempt(session, null);

  // DPoP nonce required — retry once
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    const nonce = res.headers.get('DPoP-Nonce');
    res = await attempt(session, nonce);
  }

  // Token expired — refresh, persist, and retry once
  if (res.status === 401) {
    let newTokens;
    try {
      newTokens = await refreshAccessToken({
        refresh_token: session.refresh_token,
        privateJwk:    session.private_jwk,
        publicJwk:     session.public_jwk,
        tokenEndpoint: session.token_endpoint,
        issuer:        session.issuer,
      });
    } catch {
      throw new Error('Session expired. Please sign in again.');
    }

    const refreshedSession = {
      ...session,
      access_token:  newTokens.access_token,
      refresh_token: newTokens.refresh_token,
    };
    await updateSession(sessionId, {
      access_token:  newTokens.access_token,
      refresh_token: newTokens.refresh_token,
    });

    res = await attempt(refreshedSession, null);
    if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
      res = await attempt(refreshedSession, res.headers.get('DPoP-Nonce'));
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bluesky API error after refresh (${res.status}): ${text}`);
    }

    return res.json();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky API error (${res.status}): ${text}`);
  }

  return res.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/auth/proxy' };
