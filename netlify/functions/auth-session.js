// CB⚡DB — auth-session Netlify function
// GET /auth/session
//
// Called by auth.js on every page load.
// Reads the httpOnly session cookie, validates it, optionally refreshes
// the access token if it's getting stale, and returns public session info.
// Returns: { signedIn: bool, did?, handle?, displayName?, avatar? }

import {
  verifyPayload,
  signPayload,
  parseCookies,
  setCookie,
  clearCookie,
  refreshAccessToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

// Access tokens from bsky.social expire after ~2 hours.
// Refresh if less than 30 minutes remain.
const REFRESH_THRESHOLD_SECS = 30 * 60;

export default async function handler(req) {
  const cookies = parseCookies(req.headers.get('cookie'));
  const session = verifyPayload(cookies[SESSION_COOKIE]);

  if (!session || !session.did || !session.access_token) {
    return json({ signedIn: false });
  }

  const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
  let currentSession = session;

  // Check if access token needs refreshing.
  // We don't store expiry explicitly — access tokens are typically 2h.
  // Refresh if the session was issued > 90 minutes ago.
  const age = Math.floor(Date.now() / 1000) - (session.iat || 0);
  const shouldRefresh = age > (90 * 60);

  if (shouldRefresh && session.refresh_token) {
    try {
      const newTokens = await refreshAccessToken(session);
      currentSession = {
        ...session,
        access_token:  newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        iat:           Math.floor(Date.now() / 1000),
      };
      // Rewrite the session cookie with fresh tokens
      responseHeaders.append('Set-Cookie', setCookie(SESSION_COOKIE, signPayload(currentSession), {
        maxAge:   60 * 60 * 24 * 7,
        path:     '/',
        httpOnly: true,
        secure:   true,
        sameSite: 'Lax',
      }));
    } catch (err) {
      console.warn('[auth-session] token refresh failed, session may be stale:', err.message);
      // Don't log out — return existing session and let the next proxy call handle it
    }
  }

  // Fetch the user's public profile from Bluesky (handle, displayName, avatar)
  // This is a public endpoint — no auth needed, so no DPoP required
  try {
    const profileRes = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(currentSession.did)}`
    );
    if (profileRes.ok) {
      const p = await profileRes.json();
      return new Response(JSON.stringify({
        signedIn:    true,
        did:         currentSession.did,
        handle:      p.handle,
        displayName: p.displayName || p.handle,
        avatar:      p.avatar || null,
      }), { headers: responseHeaders });
    }
  } catch (err) {
    console.warn('[auth-session] profile fetch failed:', err.message);
  }

  // Profile fetch failed — return what we have from the cookie
  return new Response(JSON.stringify({
    signedIn:    true,
    did:         currentSession.did,
    handle:      null,
    displayName: null,
    avatar:      null,
  }), { headers: responseHeaders });
}

function json(data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

export const config = { path: '/auth/session' };
