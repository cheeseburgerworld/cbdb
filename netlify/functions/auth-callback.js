// CB⚡DB — auth-callback Netlify function
// GET /oauth/callback?code=...&state=...   (Bluesky redirects here)
//
// 1. Read + verify the PKCE cookie
// 2. Validate state parameter (CSRF check)
// 3. Exchange code for tokens at Bluesky token endpoint
// 4. Store session (tokens + DPoP keys + DID) in a signed httpOnly cookie
// 5. Redirect to the original return path

import {
  buildDPoPProof,
  signPayload,
  verifyPayload,
  parseCookies,
  setCookie,
  clearCookie,
  PKCE_COOKIE,
  SESSION_COOKIE,
} from '../_auth-utils.js';

const CLIENT_ID    = 'https://cheeseburger.world/oauth/client-metadata.json';
const REDIRECT_URI = 'https://cheeseburger.world/oauth/callback';

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

  const { verifier, privateJwk, publicJwk, tokenEndpoint, pdsEndpoint, did, return: returnPath } = pkceData;

  try {
    // 4. Exchange code for tokens
    const tokens = await exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint });

    // 5. Build session payload — stored in httpOnly cookie, never exposed to JS
    const session = {
      did:           tokens.did || did,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      privateJwk,
      publicJwk,
      tokenEndpoint,
      pdsEndpoint: pdsEndpoint || 'https://bsky.social',
      iat:           Math.floor(Date.now() / 1000),
    };
    const sessionValue  = signPayload(session);
    const sessionCookie = setCookie(SESSION_COOKIE, sessionValue, {
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
    console.error('[auth-callback] token exchange failed:', err);
    const msg = encodeURIComponent(err.message || 'Token exchange failed');
    return redirect(`/submit.html?auth_error=${msg}`, [clearCookie(PKCE_COOKIE)]);
  }
}

// Exchange the authorization code for access + refresh tokens.
// Handles DPoP nonce challenges automatically.
async function exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint }) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    code_verifier: verifier,
  });

  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({
      privateJwk, publicJwk,
      method: 'POST',
      url:    tokenEndpoint,
      nonce,
    });
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP':         dpopProof,
      },
      body,
    });
  }

  let res = await attempt(null);

  // Bluesky may return a nonce on the first attempt — retry with it
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    const nonce = res.headers.get('DPoP-Nonce');
    res = await attempt(nonce);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

function redirect(location, cookies = []) {
  const headers = new Headers({ 'Location': location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export const config = { path: '/oauth/callback' };
