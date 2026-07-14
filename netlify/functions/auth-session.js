// CB⚡DB — auth-session Netlify function
// GET /auth/session
//
// Called by auth.js on every page load.
// Reads the session id from the cookie, looks up the session in Supabase,
// refreshes the access token server-side if it's getting stale, and
// returns public session info.
// Returns: { signedIn: bool, did?, handle?, displayName?, avatar? }

import {
  getSession,
  updateSession,
  parseCookies,
  clearCookie,
  refreshAccessToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

// Access tokens from bsky.social expire after ~2 hours.
// Refresh if it's been more than 90 minutes since we last touched the session.
const REFRESH_THRESHOLD_SECS = 90 * 60;

export default async function handler(req) {
  const cookies   = parseCookies(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) return json({ signedIn: false });

  const session = await getSession(sessionId);
  if (!session) {
    // Cookie points at a session that doesn't exist (expired, revoked,
    // or from before this migration) — clear it so we stop trying.
    return json({ signedIn: false }, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  }

  let current = session;
  const ageSecs = Math.floor((Date.now() - new Date(session.updated_at).getTime()) / 1000);

  if (ageSecs > REFRESH_THRESHOLD_SECS) {
    try {
      const fresh = await refreshAccessToken({
        refresh_token: session.refresh_token,
        privateJwk:    session.private_jwk,
        publicJwk:     session.public_jwk,
        tokenEndpoint: session.token_endpoint,
        issuer:        session.issuer,
      });
      current = { ...session, access_token: fresh.access_token, refresh_token: fresh.refresh_token };
      // Persist the refreshed tokens. Note: no Set-Cookie needed here —
      // the cookie only ever held the session id, which hasn't changed.
      await updateSession(sessionId, {
        access_token:  fresh.access_token,
        refresh_token: fresh.refresh_token,
      });
    } catch (err) {
      console.warn('[auth-session] token refresh failed, session may be stale:', err.message);
      // Don't log out — return the existing session and let the next
      // proxy call surface a real 401 if it's actually dead.
    }
  }

  // Fetch the user's public profile from Bluesky (handle, displayName, avatar)
  // This is a public endpoint — no auth needed, so no DPoP required
  try {
    const profileRes = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(current.did)}`
    );
    if (profileRes.ok) {
      const p = await profileRes.json();
      return json({
        signedIn:    true,
        did:         current.did,
        handle:      p.handle,
        displayName: p.displayName || p.handle,
        avatar:      p.avatar || null,
      });
    }
  } catch (err) {
    console.warn('[auth-session] profile fetch failed:', err.message);
  }

  // Profile fetch failed — return what we have from the session row
  return json({
    signedIn:    true,
    did:         current.did,
    handle:      null,
    displayName: null,
    avatar:      null,
  });
}

function json(data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export const config = { path: '/auth/session' };
