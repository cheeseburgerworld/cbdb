// CB⚡DB — auth-start Netlify function
// GET /auth/start?handle=ash.bsky.social&return=/submit.html
//
// 1. Resolve handle → auth server via ATProto discovery
// 2. Generate PKCE code_verifier + challenge
// 3. Generate a per-session DPoP EC keypair
// 4. Push the authorization request (PAR) to the auth server — required by
//    the atproto spec for all clients — authenticated as a confidential
//    client (client assertion) and DPoP-bound
// 5. Store PKCE + DPoP state in a signed, short-lived cookie
// 6. Redirect the browser to Bluesky's authorization endpoint with just
//    client_id + request_uri (PAR keeps the real params off the URL)

import {
  generatePKCE,
  generateDPoPKeypair,
  discoverAuthServer,
  pushAuthorizationRequest,
  signPayload,
  setCookie,
  PKCE_COOKIE,
  CLIENT_ID,
  REDIRECT_URI,
} from '../_auth-utils.js';
import { randomBytes } from 'node:crypto';

export default async function handler(req) {
  const url    = new URL(req.url);
  const handle = (url.searchParams.get('handle') || '').trim().replace(/^@/, '');
  const returnPath = url.searchParams.get('return') || '/submit.html';

  if (!handle) {
    return new Response(JSON.stringify({ error: 'handle is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Discover the auth server for this handle (throws if it doesn't
    //    advertise a PAR endpoint — atproto requires one)
    const { did, pds, issuer, authorizationEndpoint, tokenEndpoint, revocationEndpoint, pushedAuthorizationEndpoint } =
      await discoverAuthServer(handle);

    // 2. PKCE
    const { verifier, challenge } = generatePKCE();

    // 3. Per-session DPoP keypair — generated fresh for every login,
    //    never reused across sessions. Distinct from CBDB's own static
    //    client-assertion keypair used below.
    const { privateJwk, publicJwk } = await generateDPoPKeypair();

    // 4. CSRF state
    const state = randomBytes(16).toString('hex');

    // 5. Push the authorization request server-to-server — DPoP-bound AND
    //    authenticated as a confidential client via a signed assertion.
    const { request_uri } = await pushAuthorizationRequest({
      pushedAuthorizationEndpoint,
      issuer,
      params: {
        response_type:         'code',
        client_id:             CLIENT_ID,
        redirect_uri:          REDIRECT_URI,
        scope:                 'atproto transition:generic',
        state,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        login_hint:            handle,
      },
      privateJwk, publicJwk,
    });

    // 6. Store everything the callback will need in a short-lived signed
    //    cookie (10 minutes — enough time to complete the Bluesky auth
    //    screen). This payload has no tokens in it, so its size is small
    //    and stable regardless of account/PDS.
    const pkcePayload = {
      verifier,
      privateJwk,
      publicJwk,
      tokenEndpoint,
      revocationEndpoint,
      issuer,     // aud for client assertions on the token/refresh/revoke calls
      pds,        // the account's actual PDS endpoint
      did,
      state,
      return: returnPath,
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const pkceCookie = setCookie(PKCE_COOKIE, signPayload(pkcePayload), {
      maxAge: 600,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });

    // 7. Send the browser to Bluesky. Per PAR, the only params needed here
    //    are client_id + request_uri — everything else already went over
    //    the PAR POST above.
    const authUrl = `${authorizationEndpoint}?${new URLSearchParams({ client_id: CLIENT_ID, request_uri })}`;

    return new Response(null, {
      status: 302,
      headers: {
        'Location':   authUrl,
        'Set-Cookie': pkceCookie,
      },
    });

  } catch (err) {
    console.error('[auth-start] error:', err);
    const msg = encodeURIComponent(err.message || 'Sign-in failed');
    return new Response(null, {
      status: 302,
      headers: { 'Location': `/submit.html?auth_error=${msg}` },
    });
  }
}

export const config = { path: '/auth/start' };
