// CB⚡DB — auth-start Netlify function
// GET /.netlify/functions/auth-start?handle=ash.bsky.social&return=/submit.html
//
// 1. Resolve handle → auth server via ATProto discovery
// 2. Generate PKCE code_verifier + challenge
// 3. Generate DPoP EC keypair
// 4. Store everything in a signed short-lived cookie
// 5. Redirect browser to Bluesky authorization endpoint

import {
  generatePKCE,
  generateDPoPKeypair,
  buildDPoPProof,
  discoverAuthServer,
  signPayload,
  setCookie,
  PKCE_COOKIE,
} from '../_auth-utils.js';
import { randomBytes } from 'node:crypto';

const CLIENT_ID    = 'https://cheeseburger.world/oauth/client-metadata.json';
const REDIRECT_URI = 'https://cheeseburger.world/oauth/callback';

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
    // 1. Discover the auth server for this handle
    const { did, authServerBase, authorizationEndpoint, tokenEndpoint, pushedAuthorizationEndpoint } =
      await discoverAuthServer(handle);

    // 2. Generate PKCE
    const { verifier, challenge } = generatePKCE();

    // 3. Generate DPoP keypair
    const { privateJwk, publicJwk } = await generateDPoPKeypair();

    // 4. OAuth state parameter (CSRF protection)
    const state = randomBytes(16).toString('hex');

    // 5. Store PKCE verifier + DPoP keys + state in a short-lived signed cookie
    //    (10 minutes — enough time to complete the Bluesky auth screen)
    const pkcePayload = {
      verifier,
      privateJwk,
      publicJwk,
      tokenEndpoint,
      pdsEndpoint: authServerBase,
      did,
      state,
      return: returnPath,
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const pkceValue = signPayload(pkcePayload);
    const pkceCookie = setCookie(PKCE_COOKIE, pkceValue, {
      maxAge: 600,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });

    // 6. Build the authorization URL
    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             CLIENT_ID,
      redirect_uri:          REDIRECT_URI,
      scope:                 'atproto transition:generic',
      state,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      login_hint:            handle,
    });

    // Build a DPoP proof for the authorization endpoint
    // (some ATProto servers require DPoP even at the auth endpoint)
    const dpopProof = await buildDPoPProof({
      privateJwk, publicJwk,
      method: 'GET',
      url: authorizationEndpoint,
    });

    const authUrl = `${authorizationEndpoint}?${params}`;

    return new Response(null, {
      status: 302,
      headers: {
        'Location':  authUrl,
        'Set-Cookie': pkceCookie,
        'DPoP':      dpopProof,
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
