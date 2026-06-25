// CB⚡DB — auth-proxy Netlify function
// POST /auth/proxy
// Body: { action: 'post' | 'uploadBlob', payload: { ... } }
//
// The browser can't make DPoP-authenticated Bluesky API calls directly
// (requires crypto.subtle + stored DPoP keys). This function does it server-side.
//
// Supported actions:
//   post:       Create a Bluesky post record. payload = { text, facets?, embed?, createdAt }
//   uploadBlob: Upload an image blob.          payload = { data (base64), mimeType }

import {
  verifyPayload,
  signPayload,
  parseCookies,
  setCookie,
  buildDPoPProof,
  refreshAccessToken,
  SESSION_COOKIE,
} from './_auth-utils.js';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  // 1. Read + verify session cookie
  const cookies = parseCookies(req.headers.get('cookie'));
  const session = verifyPayload(cookies[SESSION_COOKIE]);

  if (!session || !session.did || !session.access_token) {
    return json({ error: 'Not authenticated' }, 401);
  }

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
    const result = await dispatch(session, action, payload);
    // If dispatch updated the session (token refresh), write new cookie
    if (result._updatedSession) {
      const newSession = result._updatedSession;
      delete result._updatedSession;
      const sessionCookie = setCookie(SESSION_COOKIE, signPayload(newSession), {
        maxAge:   60 * 60 * 24 * 7,
        path:     '/',
        httpOnly: true,
        secure:   true,
        sameSite: 'Lax',
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie },
      });
    }
    return json(result, 200);
  } catch (err) {
    console.error('[auth-proxy] error:', err);
    return json({ error: err.message || 'Proxy request failed' }, 500);
  }
}

// ─── Action dispatcher ────────────────────────────────────────────────────────

async function dispatch(session, action, payload) {
  switch (action) {
    case 'post':       return doPost(session, payload);
    case 'uploadBlob': return doUploadBlob(session, payload);
    default:           throw new Error(`Unknown action: ${action}`);
  }
}

// ─── Create a Bluesky post ────────────────────────────────────────────────────

async function doPost(session, payload) {
  const endpoint = `https://bsky.social/xrpc/com.atproto.repo.createRecord`;
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

  const result = await bskyRequest(session, 'POST', endpoint, requestBody, 'application/json');
  return result;
}

// ─── Upload an image blob ─────────────────────────────────────────────────────

async function doUploadBlob(session, payload) {
  // payload.data is a base64-encoded image
  const { data, mimeType } = payload;
  if (!data || !mimeType) throw new Error('uploadBlob requires data and mimeType');

  const bytes    = Buffer.from(data, 'base64');
  const endpoint = `https://bsky.social/xrpc/com.atproto.repo.uploadBlob`;

  const result = await bskyRequest(session, 'POST', endpoint, bytes, mimeType);
  return result;
}

// ─── Authenticated Bluesky request with DPoP + auto-refresh ──────────────────

async function bskyRequest(session, method, endpoint, body, contentType) {
  const attempt = async (sess, nonce) => {
    const dpopProof = await buildDPoPProof({
      privateJwk:  sess.privateJwk,
      publicJwk:   sess.publicJwk,
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

  // Token expired — refresh and retry once
  if (res.status === 401) {
    let newTokens;
    try {
      newTokens = await refreshAccessToken(session);
    } catch (refreshErr) {
      throw new Error('Session expired. Please sign in again.');
    }

    const refreshedSession = {
      ...session,
      access_token:  newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      iat:           Math.floor(Date.now() / 1000),
    };

    // Retry the original request with the new token
    res = await attempt(refreshedSession, null);
    if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
      res = await attempt(refreshedSession, res.headers.get('DPoP-Nonce'));
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bluesky API error after refresh (${res.status}): ${text}`);
    }

    const data = await res.json();
    // Signal to caller that the session was updated
    data._updatedSession = refreshedSession;
    return data;
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
