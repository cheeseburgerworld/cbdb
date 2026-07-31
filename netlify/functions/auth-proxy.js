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
import { issuerRequest, getIssuerDid } from './_badge-issuer.js';

// ─── Active event tagging (evergreen gamification) ────────────────────────
// When a review's restaurant + createdAt match a currently-active event,
// the row gets stamped with that event's id ONCE, right here, at write
// time. From then on, badges/trophies just count rows carrying this tag —
// no re-matching, no date math, ever again. A review keeps its tag
// forever, even after the event record below is edited or deleted.
//
// SOURCE OF TRUTH: the world.cheeseburger.event record on CBDB's own PDS
// (see lexicons/world/cheeseburger/event.json). This function fetches it
// live, cached for CBDB_EVENT_CACHE_TTL_MS, so the restaurant list only
// needs to be edited in ONE place — no more keeping this file in sync
// with events-data.js by hand.
//
// FAIL-OPEN: if the PDS is unreachable, slow, or the record is missing,
// this falls back to CBDB_FALLBACK_EVENT below rather than failing the
// review. That fallback is a point-in-time snapshot for emergencies only —
// it is NOT meant to be kept up to date; the PDS record is what you edit.

const CBDB_ISSUER_DID = 'did:plc:lynstw6qgfcy5nek6i2rbqcs'; // @cheeseburger.world — CBDB's dedicated brand identity, issuer of events/badges (not a personal account)
const CBDB_EVENT_SLUG = 'PDXBW26'; // matches the event record's rkey and `slug` field
const CBDB_EVENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — balances PDS load vs. freshness if the list changes

// Emergency fallback only — mirrors the event record as of setup time.
// If you edit the restaurant list, edit the PDS record (or re-run
// scripts/setup-burger-week-event.mjs); this array is NOT the thing to
// maintain going forward. Kept here only so a PDS outage degrades
// gracefully instead of silently tagging nothing.
const CBDB_FALLBACK_EVENT = {
  slug: 'PDXBW26',
  startsAt: '2026-08-10T00:00:00Z',
  endsAt:   '2026-08-16T23:59:59Z',
  badgeThreshold: 1,
  championThreshold: 3,
  winnerThreshold: 7,
  restaurants: [
    "10 barrel brewing", "2nw5", "abigail hall", "aji tram restaurant and bar", "amaros table downtown", "arch bridge taphouse",
    "asl café (woodstock café)", "ate-oh-ate", "bacchus bar", "bar bar", "barbur world foods", "bergy's burgers",
    "besaw's", "big's chicken", "binary brewing", "birdie time pub", "bless your heart burgers", "boke bowl",
    "botto's bbq", "breaking buns @ alchemy cider", "breakside brewery - slabtown", "brix tavern", "bunk bar", "cecilia",
    "clarklewis", "creepy's", "daily planet", "dc vegetarian", "deschutes brewery & public house", "dimo's italian specialties",
    "double barrel tavern", "duke's public house", "farmer and the beast", "farmer and the beast @ breakside dekum", "fresh n' funky", "fuller's burger shack",
    "fuller's coffee shop", "gift public house", "gold dust meridian", "grand fir brewing", "grassa", "grays restaurant and bar",
    "hawker station pdx", "haymaker", "hopworks brewery", "hunker down", "hunny beez", "iron strike smash burgers at midtown beer garden",
    "john's marketplace", "kelly's olympian", "killer burger", "kingston bar and grill", "kooks sports bar", "lardo",
    "lariat lounge", "lay low tavern", "lazy days brewing", "lazy days brewing - beaverton", "lone star burger bar", "loowit brewing - downtown pub",
    "love eatz smashburger", "loyal legion", "metropolitan tavern", "midcity smashedburger", "midcity smashedburger @ level beer 1", "midcity smashedburger @ level beer 3",
    "midcity smashedburger @ prost! marketplace", "midcity smashedburger @ uptown beer", "migration brewing", "migration brewing co.", "mirisata", "moreland ale house",
    "next level veggie grill", "nicholas restaurant", "nick's famous coney island", "nom nom wings", "northport", "pacific standard",
    "pambiche", "papa haydn", "papa haydn (east)", "papa haydn (west)", "paymaster lounge", "pls on sixth",
    "podnah's pit barbecue", "portland burger", "prime tap house: west end district", "reverend's bbq", "river pig saloon", "sad valley",
    "salvador molly's", "sandy-o's", "say when", "show bar", "side eye", "solo club",
    "space room", "spoke & fork", "steakadelphia", "steely's", "steeplejack brewing co.", "superdeluxe",
    "sweet home bar & grill", "taylor street tavern", "the bulgarian job", "the diner vancouver", "the italian job", "the oaks pub",
    "the office bar", "the sandy jug", "the secret pizza society", "three mermaids public house", "urban farmer", "veggie grill",
    "veggie grill - cedar hills crossing", "veggie grill by next level", "von ebert brewing glendoveer + kitchen", "wayfinder beer", "white owl social club", "wolf's head portland",
    "wonderboy's smokestack", "world foods", "wow cow", "ya hala",
  ],
};

let _eventCache = { record: null, fetchedAt: 0, restaurantSet: null };

// Public (unauthenticated) read of CBDB's own event record from its PDS.
// getRecord is a public query — no session/DPoP needed, just resolvePDS.
async function fetchEventRecordFromPDS(slug) {
  const pds = await resolvePDS(CBDB_ISSUER_DID);
  const url = `${pds}/xrpc/com.atproto.repo.getRecord?` + new URLSearchParams({
    repo: CBDB_ISSUER_DID,
    collection: 'world.cheeseburger.event',
    rkey: slug.toLowerCase(),
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) }); // hard cap — never let a slow PDS stall a review
  if (!res.ok) throw new Error(`getRecord ${res.status}`);
  const data = await res.json();
  return data.value; // the record body
}

// Cached accessor. Fail-open to CBDB_FALLBACK_EVENT on any error — a
// review must never fail because the event record couldn't be fetched.
async function getActiveEvent(slug) {
  const now = Date.now();
  if (_eventCache.record && (now - _eventCache.fetchedAt) < CBDB_EVENT_CACHE_TTL_MS) {
    return _eventCache.record;
  }
  try {
    const record = await fetchEventRecordFromPDS(slug);
    const restaurantSet = new Set((record.restaurants || []).map(n => String(n).trim().toLowerCase()));
    _eventCache = { record, fetchedAt: now, restaurantSet };
    return record;
  } catch (err) {
    console.warn('[computeEventTag] PDS event fetch failed, using fallback:', err.message);
    // Back off for a short cooldown (not the full TTL) before retrying the
    // PDS again — without this, a sustained PDS outage would make EVERY
    // review submission eat the fetch's timeout, one at a time, forever.
    const cooldown = Math.min(CBDB_EVENT_CACHE_TTL_MS, 30 * 1000);
    if (!_eventCache.restaurantSet) {
      // First-ever failure with nothing cached yet — stand up the fallback.
      _eventCache = {
        record: CBDB_FALLBACK_EVENT,
        fetchedAt: now - CBDB_EVENT_CACHE_TTL_MS + cooldown,
        restaurantSet: new Set(CBDB_FALLBACK_EVENT.restaurants.map(n => n.toLowerCase())),
      };
    } else {
      // Had a good (now-stale) record — keep serving it, just push the
      // next retry attempt out by the cooldown instead of hammering the PDS.
      _eventCache.fetchedAt = now - CBDB_EVENT_CACHE_TTL_MS + cooldown;
    }
    return _eventCache.record;

  }
}

async function computeEventTag(restaurantName, createdAtIso) {
  const name = String(restaurantName || '').trim().toLowerCase();
  if (!name) return null;
  const ev = await getActiveEvent(CBDB_EVENT_SLUG);
  if (!ev) return null;
  const created = new Date(createdAtIso);
  const start = new Date(ev.startsAt || ev.start);
  const end   = new Date(ev.endsAt || ev.end);
  if (created < start || created > end) return null;
  if (!_eventCache.restaurantSet.has(name)) return null;
  return ev.slug || CBDB_EVENT_SLUG;
}

// ─── Badge issuance (community.lexicon.badge.award) ───────────────────────
// Real, portable badge records written to CBDB's OWN PDS (issuer-holds
// pattern — same as how the ATmosphereConf2026 badges reportedly work).
// The recipient can list these via com.atproto.repo.listRecords against
// CBDB's DID, filtering by `did` in the award body. Any other app reading
// community.lexicon.badge.award can see them too — that's the whole point.
//
// Authenticates via _badge-issuer.js (app password), NOT the DPoP/OAuth
// session flow above — there's no reviewer in the loop here, it's CBDB's
// own server writing to its own account, which is a simpler problem than
// what the DPoP flow is built to solve.
//
// REQUIRES A ONE-TIME BOOTSTRAP before this can do anything:
//   1. Create an app password for @cheeseburger.world, set
//      CBDB_ISSUER_HANDLE + CBDB_ISSUER_APP_PASSWORD in Netlify env vars.
//   2. Run scripts/setup-burger-week-event.mjs once — publishes the
//      world.cheeseburger.event record plus the two badge.definition
//      records, and prints their AT-URIs.
// Until both are done, this fails closed (logs a warning, issues
// nothing) — it does NOT block or fail review creation either way.
//
// NOTE ON VERIFICATION: community.lexicon.badge.* is a community-proposed
// lexicon. Confirm its exact schema against the lexicon-community source
// before relying on this in production — if the PDS rejects these writes
// (e.g. strict lexicon validation, schema mismatch), it fails the same
// safe way: logged, review unaffected, just no badge issued.
//
// Deliberately AWAITED at the call site below, not fire-and-forget — this
// function doesn't use Netlify's context.waitUntil (not wired up
// elsewhere in this file), so an un-awaited promise here isn't guaranteed
// to finish before the runtime tears the invocation down after the
// response is sent. A badge write silently getting killed mid-flight is
// worse than the review response taking a bit longer.
async function issueEventBadgesIfEarned(recipientDid, eventSlug) {
  const ev = await getActiveEvent(eventSlug);
  if (!ev || (!ev.badgeDefinition && !ev.championDefinition && !ev.winnerDefinition)) {
    console.warn('[issueEventBadgesIfEarned] no badge definitions on event record — skipping');
    return;
  }

  // Count this recipient's event-tagged reviews so far (including the one
  // just inserted). Supabase's exact count via Prefer: count=exact.
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/reviews?author_did=eq.${encodeURIComponent(recipientDid)}&event=eq.${encodeURIComponent(eventSlug)}&select=id`,
    {
      headers: {
        apikey: supabaseKey(),
        Authorization: `Bearer ${supabaseKey()}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    }
  );
  if (!countRes.ok) throw new Error(`count query failed (${countRes.status})`);
  const range = countRes.headers.get('content-range'); // "0-0/12"
  const count = range ? parseInt(range.split('/')[1], 10) : 0;

  const badgeThreshold    = ev.badgeThreshold    ?? 1;
  const championThreshold = ev.championThreshold ?? 3;
  const winnerThreshold   = ev.winnerThreshold   ?? 7;

  const tiers = [];
  if (ev.badgeDefinition    && count >= badgeThreshold)    tiers.push({ tier: 'badge',    defUri: ev.badgeDefinition    });
  if (ev.championDefinition && count >= championThreshold) tiers.push({ tier: 'champion', defUri: ev.championDefinition });
  if (ev.winnerDefinition   && count >= winnerThreshold)   tiers.push({ tier: 'winner',   defUri: ev.winnerDefinition   });
  if (!tiers.length) return;

  let issuerDid;
  try {
    issuerDid = await getIssuerDid();
  } catch (err) {
    console.warn('[issueEventBadgesIfEarned] issuer auth not configured — sign-up incomplete:', err.message);
    return;
  }

  for (const { tier, defUri } of tiers) {
    // Deterministic rkey = idempotent. Re-crossing the same threshold (or
    // retried requests) overwrites the same record instead of duplicating —
    // putRecord is an upsert, so this needs no separate existence check.
    const rkey = `${eventSlug.toLowerCase()}-${tier}-${recipientDid.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const awardRecord = {
      $type: 'community.lexicon.badge.award',
      did: recipientDid,
      badge: { uri: defUri }, // omitting cid — acceptable per spec if unknown; add if you have it cached
      createdAt: new Date().toISOString(),
    };
    try {
      await issuerRequest('POST', 'com.atproto.repo.putRecord', {
        repo: issuerDid,
        collection: 'community.lexicon.badge.award',
        rkey,
        record: awardRecord,
      });
    } catch (err) {
      console.warn(`[issueEventBadgesIfEarned] failed to issue ${tier} award:`, err.message);
    }
  }
}

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
  const eventTag = await computeEventTag(restaurant, record.createdAt);
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
        event:            eventTag,
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

  // ── Issue real badge.award records if this review crossed a threshold ──
  // Additive and best-effort: never allowed to fail the review response.
  // See issueEventBadgesIfEarned() for the idempotent putRecord approach.
  if (eventTag) {
    try {
      await issueEventBadgesIfEarned(session.did, eventTag);
    } catch (err) {
      console.warn('[createReview] badge issuance failed (review still saved):', err.message);
    }
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
