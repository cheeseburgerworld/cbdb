// CB⚡DB — auth-proxy Netlify function
// POST /auth/proxy
// Body: { action: 'post' | 'uploadBlob' | 'createReview', payload: { ... } }
//
// The browser can't make DPoP-authenticated Bluesky API calls directly
// (requires crypto.subtle + stored DPoP keys). This function does it
// server-side, looking the session up from Supabase by the id in the cookie.
//
// Supported actions:
//   post:         Create a Bluesky post record. payload = { text, facets?, embed?, createdAt }
//   uploadBlob:   Upload an image blob.          payload = { data (base64), mimeType }
//   createReview: Write a world.cheeseburger.review record to the user's PDS,
//                 optionally crosspost to Bluesky, and eagerly index into
//                 Supabase server-side (browser no longer writes reviews).

import {
  getSession,
  updateSession,
  parseCookies,
  buildDPoPProof,
  refreshAccessToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

// ─── Supabase (service key, server-side only) ────────────────────────────────
// Lazy getter — never read env at module top level in edge functions, and
// process.env doesn't exist in the Deno runtime. Mirrors _auth-utils.js.
const SUPABASE_URL = 'https://nakdvfxbopakdzaxhnwk.supabase.co';
function supabaseKey() {
  const key = typeof Deno !== 'undefined'
    ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is not set');
  return key;
}

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
    case 'post':         return doPost(sessionId, session, payload);
    case 'uploadBlob':   return doUploadBlob(sessionId, session, payload);
    case 'createReview': return doCreateReview(sessionId, session, payload);
    default:             throw new Error(`Unknown action: ${action}`);
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

// ─── Create a world.cheeseburger.review record ────────────────────────────────
// payload = {
//   blobRef,        // the blob ref returned from a prior uploadBlob call
//   restaurant, location, style, rating, price,
//   burger, take, photoAlt,
//   aspectRatio?,   // { width, height } from client-side prepareImage()
//   geo?,           // { latitude, longitude } strings
//   address?,       // { street?, locality?, region?, country, postalCode? }
//   placeId?,
//   crosspost?,     // boolean — also write an app.bsky.feed.post
//   agreedAt?       // guidelines agreement timestamp (indexed, not on PDS)
// }
//
// The review record is the canonical artifact, written to the user's own
// PDS. The crosspost is a share of it. Supabase is the index, not the truth.
// Crosspost or index failures never fail the review itself.

async function doCreateReview(sessionId, session, payload) {
  const {
    blobRef, restaurant, location, style, rating, price,
    burger, take, photoAlt, aspectRatio, geo, address, placeId, crosspost
  } = payload;

  if (!blobRef || !restaurant || !location || !style || !rating ||
      !price || !burger || !take || !photoAlt) {
    throw new Error('Missing required review fields');
  }

  const pds = await resolvePDS(session.did);
  const createUrl = `${pds}/xrpc/com.atproto.repo.createRecord`;

  // Normalize the form's display style ("Fast Food") to the lexicon's
  // knownValues ("fastFood") for the PDS record. The raw display string
  // is kept for the Supabase index so existing rows stay consistent.
  const styleMap = {
    'classic': 'classic', 'smash': 'smash', 'bistro': 'bistro',
    'fast food': 'fastFood', 'fastfood': 'fastFood', 'veggie': 'veggie',
  };
  const lexStyle = styleMap[String(style).toLowerCase()] || style;

  // ── Build the review record ──────────────────────────────────────────
  const record = {
    $type:      'world.cheeseburger.review',
    restaurant,
    location,
    style:      lexStyle,
    rating,
    price,
    burger,
    take,
    photo:      blobRef,   // the blob ref object from uploadBlob
    photoAlt,
    createdAt:  new Date().toISOString(),
  };

  if (geo?.latitude && geo?.longitude) {
    record.geo = {
      $type:     'community.lexicon.location.geo',
      latitude:  String(geo.latitude),
      longitude: String(geo.longitude),
    };
  }

  if (address?.country) {
    record.address = {
      $type:   'community.lexicon.location.address',
      country: address.country,
      ...(address.street     && { street:     address.street }),
      ...(address.locality   && { locality:   address.locality }),
      ...(address.region     && { region:     address.region }),
      ...(address.postalCode && { postalCode: address.postalCode }),
    };
  }

  if (placeId) record.placeId = placeId;

  // ── Write the review record to the user's PDS ────────────────────────
  const result = await bskyRequest(
    sessionId, session, 'POST', createUrl,
    JSON.stringify({ repo: session.did, collection: 'world.cheeseburger.review', record }),
    'application/json'
  );
  // result = { uri: 'at://did:.../world.cheeseburger.review/tid', cid: '...' }

  // ── Optionally crosspost to Bluesky ──────────────────────────────────
  // Preserves the exact live-post format: header / body / #CBDB tail,
  // with the clickable #CBDB tag facet and image aspectRatio — the same
  // output the hashtag scraper and existing posts rely on.
  let bskyPostUri = null;
  if (crosspost) {
    try {
      const glyph = { legendary: '⚡', trip: '⭐⭐', solid: '⭐', skip: 'ㄨ' }[rating] || '';
      const header = `${restaurant}\n${location}\n${glyph}\n${price}\n\n`;
      const tail = '\n\n#CBDB';
      const graphemes = s => [...s].length;
      const budget = 300 - graphemes(header) - graphemes(tail);
      let body = burger + (take ? '\n\n' + take : '');
      if (graphemes(body) > budget) {
        body = [...body].slice(0, budget - 1).join('') + '…';
      }
      const text = header + body + tail;

      // Tag facet byte offsets — identical to the previous client-side logic.
      const enc = new TextEncoder();
      const tagStart = enc.encode(header + body + '\n\n').length;
      const tagEnd   = enc.encode(text).length;
      const facets = [{
        index:    { byteStart: tagStart + 1, byteEnd: tagEnd },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'CBDB' }],
      }];

      const imageRecord = { image: blobRef, alt: photoAlt };
      if (aspectRatio?.width && aspectRatio?.height) {
        imageRecord.aspectRatio = { width: aspectRatio.width, height: aspectRatio.height };
      }

      const postRecord = {
        $type:     'app.bsky.feed.post',
        text,
        facets,
        createdAt: new Date().toISOString(),
        embed:     { $type: 'app.bsky.embed.images', images: [imageRecord] },
      };

      const postResult = await bskyRequest(
        sessionId, session, 'POST', createUrl,
        JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record: postRecord }),
        'application/json'
      );
      bskyPostUri = postResult.uri;

      // Update the review record to point back at the crosspost
      // (patch via putRecord with the known rkey)
      if (bskyPostUri) {
        const rkey = result.uri.split('/').pop();
        record.bskyPost = bskyPostUri;
        await bskyRequest(
          sessionId, session, 'POST', `${pds}/xrpc/com.atproto.repo.putRecord`,
          JSON.stringify({
            repo:       session.did,
            collection: 'world.cheeseburger.review',
            rkey,
            record,
          }),
          'application/json'
        ).catch(err => console.warn('[createReview] putRecord bskyPost update failed:', err.message));
      }
    } catch (err) {
      // Crosspost failing should NOT fail the whole review
      console.warn('[createReview] crosspost failed (review still saved):', err.message);
    }
  }

  // ── Eagerly index into Supabase ───────────────────────────────────────
  // Service key, server-side only — the browser no longer writes reviews.
  // Phase 2 replaces this with the Jetstream consumer; this becomes a
  // fallback or gets removed.
  const photoCid = blobRef?.ref?.$link || blobRef?.ref?.toString() || null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
      method:  'POST',
      headers: {
        apikey:         supabaseKey(),
        Authorization:  `Bearer ${supabaseKey()}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify({
        at_uri:           result.uri,
        at_cid:           result.cid,
        rkey:             result.uri.split('/').pop(),
        author_did:       session.did,
        restaurant,
        location,
        style,
        price_tier:       price,
        rating,
        burger,
        value_experience: take,
        photo_url:        photoCid ? `https://cdn.bsky.app/img/feed_fullsize/plain/${session.did}/${photoCid}@jpeg` : null,
        photo_cid:        photoCid,
        photo_alt:        photoAlt,
        bsky_post_uri:    bskyPostUri,
        bsky_uri:         bskyPostUri,
        lat:              geo?.latitude  ? parseFloat(geo.latitude)  : null,
        lng:              geo?.longitude ? parseFloat(geo.longitude) : null,
        agreed_at:        payload.agreedAt || null,
        created_at:       record.createdAt,
        indexed_at:       new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.warn('[createReview] Supabase index failed (PDS record still written):', res.status, await res.text());
    }
  } catch (err) {
    // Supabase index failure should NOT fail the review — the PDS record exists.
    console.warn('[createReview] Supabase index failed (PDS record still written):', err.message);
  }

  return { ok: true, uri: result.uri, cid: result.cid, bskyPostUri };
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
