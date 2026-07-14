// CB⚡DB — auth-callback Netlify function
// GET /oauth/callback?code=...&state=...   (Bluesky redirects here)
//
// 1. Read + verify the PKCE cookie
// 2. Validate state parameter (CSRF check)
// 3. Exchange code for tokens at Bluesky's token endpoint (DPoP-bound,
//    confidential-client-authenticated)
// 4. Verify the returned account (sub) matches who we started the flow
//    with — atproto spec calls this "critical."
// 5. Store the session server-side (Supabase), keyed by a random id
// 6. Set a cookie holding ONLY that id — never tokens, never keys
// 7. Redirect to the original return path

import {
  verifyPayload,
  parseCookies,
  setCookie,
  clearCookie,
  createSession,
  exchangeCode,
  PKCE_COOKIE,
  SESSION_COOKIE,
} from '../_auth-utils.js';

export default async function handler(req) {
  const url   = new URL(req.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // User declined or Bluesky returned an error
  if (error) {
    return redirect('/submit.html?auth_error=' + encodeURIComponent(error), [clearCookie(PKCE_COOKIE)]);
  }

  if (!code || !state) {
    return redirect('/submit.html?auth_error=missing_params', [clearCookie(PKCE_COOKIE)]);
  }

  // 1. Read + verify PKCE cookie
  const cookies = parseCookies(req.headers.get('cookie'));
  const pkceData = verifyPayload(cookies[PKCE_COOKIE]);

  if (!pkceData) {
    console.error('[auth-callback] PKCE cookie missing or invalid');
    return redirect('/submit.html?auth_error=session_expired', [clearCookie(PKCE_COOKIE)]);
  }

  // 2. CSRF: verify state matches what we generated in auth-start
  if (pkceData.state !== state) {
    console.error('[auth-callback] state mismatch — possible CSRF');
    return redirect('/submit.html?auth_error=state_mismatch', [clearCookie(PKCE_COOKIE)]);
  }

  // 3. Check PKCE cookie hasn't expired
  if (pkceData.exp && Math.floor(Date.now() / 1000) > pkceData.exp) {
    return redirect('/submit.html?auth_error=session_expired', [clearCookie(PKCE_COOKIE)]);
  }

  const { verifier, privateJwk, publicJwk, tokenEndpoint, revocationEndpoint, issuer, pds, did, return: returnPath } = pkceData;

  try {
    // 4. Exchange code for tokens (DPoP-bound + client-assertion authenticated)
    const tokens = await exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint, issuer });

    // 5. Mandatory per atproto spec: verify the account in the token
    //    response matches who we started the flow with. Without this, a
    //    misbehaving or compromised auth server could hand back tokens
    //    for a different account than the one the user picked.
    if (tokens.sub && tokens.sub !== did) {
      throw new Error('Account mismatch — token response did not match the expected account');
    }

    // 6. Store the session server-side. The cookie the browser gets back
    //    is just a random lookup key — the tokens and DPoP private key
    //    never leave this server.
    const sessionId = await createSession({
      did:                 tokens.did || tokens.sub || did,
      access_token:        tokens.access_token,
      refresh_token:       tokens.refresh_token,
      private_jwk:         privateJwk,
      public_jwk:          publicJwk,
      token_endpoint:      tokenEndpoint,
      revocation_endpoint: revocationEndpoint || null,
      issuer:              issuer,
      pds_endpoint:        pds || 'https://bsky.social',
    });

    const sessionCookie = setCookie(SESSION_COOKIE, sessionId, {
      maxAge:   60 * 60 * 24 * 7,  // 7 days
      path:     '/',
      httpOnly: true,
      secure:   true,
      sameSite: 'Lax',
    });

    const dest = (returnPath && returnPath.startsWith('/') && returnPath !== '/oauth/callback')
      ? returnPath
      : '/submit.html';

    return redirect(dest, [sessionCookie, clearCookie(PKCE_COOKIE)]);

  } catch (err) {
    console.error('[auth-callback] login failed:', err);
    const msg = encodeURIComponent(err.message || 'Sign-in failed');
    return redirect(`/submit.html?auth_error=${msg}`, [clearCookie(PKCE_COOKIE)]);
  }
}

function redirect(location, cookies = []) {
  const headers = new Headers({ 'Location': location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export const config = { path: '/oauth/callback' };
