// CB⚡DB — auth-signout Netlify function
// POST /auth/signout
//
// Revokes the refresh token with the auth server (best-effort), deletes
// the server-side session row, and clears the cookie.

import {
  getSession,
  deleteSession,
  parseCookies,
  clearCookie,
  revokeToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

export default async function handler(req) {
  const cookies   = parseCookies(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE];

  if (sessionId) {
    const session = await getSession(sessionId);

    if (session?.refresh_token) {
      try {
        // Use the revocation endpoint + issuer discovered for THIS account
        // at login time, falling back to bsky.social only for sessions
        // created before these fields existed.
        await revokeToken({
          token:              session.refresh_token,
          tokenTypeHint:      'refresh_token',
          revocationEndpoint: session.revocation_endpoint || 'https://bsky.social/oauth/revoke',
          privateJwk:         session.private_jwk,
          publicJwk:          session.public_jwk,
          issuer:             session.issuer || 'https://bsky.social',
        });
      } catch (err) {
        console.warn('[auth-signout] revocation failed (non-fatal):', err.message);
      }
    }

    // Clean up the server-side row — there's no longer a client-held
    // copy of the session for the cookie-clear alone to "delete."
    await deleteSession(sessionId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie':   clearCookie(SESSION_COOKIE),
    },
  });
}

export const config = { path: '/auth/signout' };
