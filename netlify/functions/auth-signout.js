// CB⚡DB — auth-signout Netlify function
// POST /auth/signout
//
// Clears the session cookie. Optionally revokes the token with Bluesky.

import {
  verifyPayload,
  parseCookies,
  clearCookie,
  buildDPoPProof,
  SESSION_COOKIE,
  PKCE_COOKIE,
} from './_auth-utils.js';

export default async function handler(req) {
  const cookies = parseCookies(req.headers.get('cookie'));
  const session = verifyPayload(cookies[SESSION_COOKIE]);

  // Best-effort token revocation — don't block sign-out if it fails
  if (session?.access_token && session?.refresh_token) {
    try {
      // Revoke the refresh token (invalidates all access tokens)
      const revocationEndpoint = 'https://bsky.social/oauth/revoke';
      const dpopProof = await buildDPoPProof({
        privateJwk: session.privateJwk,
        publicJwk:  session.publicJwk,
        method:     'POST',
        url:        revocationEndpoint,
      });
      await fetch(revocationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'DPoP': dpopProof,
        },
        body: new URLSearchParams({
          token:           session.refresh_token,
          token_type_hint: 'refresh_token',
          client_id:       'https://cheeseburger.world/oauth/client-metadata.json',
        }),
      });
    } catch (err) {
      console.warn('[auth-signout] revocation failed (non-fatal):', err.message);
    }
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
