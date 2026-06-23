/* ============================================================
   CB⚡DB — shared config + data layer
   Loaded by every page before its own script.
   LIVE DATA ONLY — reads reviews from Supabase, no fallback.
   If the fetch fails, the page shows empty + logs the error,
   so problems are visible instead of hidden behind seed data.
   ============================================================ */

// ---- Supabase connection (publishable key is browser-safe; RLS protects writes) ----
const CBDB_SUPABASE_URL  = 'https://nakdvfxbopakdzaxhnwk.supabase.co';
const CBDB_SUPABASE_ANON = 'sb_publishable_Lz84QCjGGjaHR7O60rYmAw_uUm0AnDT';

// ---- Rating metadata (shared across pages) ----
// `color` = chip/pin background. `text` = readable label color ON that background:
// the three light tiers take dark ink; Skip It's dark brown takes white.
const RATING = {
  legendary:{glyph:'⚡',label:'Legendary',cls:'pin-legendary',color:'#5BD94B',text:'#15130f'},
  trip:{glyph:'⭐⭐',label:'Worth A Trip',cls:'pin-trip',color:'#FFC72C',text:'#15130f'},
  solid:{glyph:'⭐',label:'Solid',cls:'pin-solid',color:'#E8843C',text:'#15130f'},
  skip:{glyph:'ㄨ',label:'Skip It',cls:'pin-skip',color:'#6B4A2F',text:'#F5F4F2'}
};

// Live reviews — empty until loadReviews() pulls from Supabase.
let reviews = [];

/* Map a Supabase row (snake_case columns) to the shape the pages expect. */
function mapRow(r){
  return {
    name: r.restaurant,
    loc: r.location,
    lat: r.lat, lng: r.lng,
    rating: r.rating,
    tier: r.price_tier,
    style: r.style,
    burger: r.burger,
    value: r.value_experience,
    // Admin-set per-city crown (nullable bool). Defaults false; the editor
    // ticks this in Supabase for the one canonical Legendary per city.
    legendaryCanonical: r.legendary_canonical === true,
    photoUrl: r.photo_url || '',
    bskyUri: r.bsky_post_uri || r.bsky_uri || '',
    createdAt: r.created_at || '',
    // DID is canonical identity (handles change); keep both so the profile
    // can match a contributor's reviews by DID first, handle as fallback.
    did: r.author_did || (r.contributors && r.contributors.did) || '',
    by: (r.contributors && r.contributors.handle) || r.author_handle || '',
    // contributor avatar, if the contributors table stores one (nullable)
    byAvatar: (r.contributors && r.contributors.avatar) || ''
  };
}

/* Return the signed-in contributor's own reviews.
   Matches on DID (canonical) first, then falls back to handle.
   `st` is the shared session state (window.__cbdb_state). */
function myReviews(st){
  if(!st) return [];
  const did = st.did || '';
  const handle = (st.handle || '').replace(/^@/, '');
  return reviews.filter(r => {
    if(did && r.did) return r.did === did;
    return r.by && r.by.replace(/^@/, '') === handle;
  });
}

/* "Jun 2026" style short date for cards/map */
function shortDate(iso){
  if(!iso) return '';
  const d=new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleDateString('en-US',{ month:'short', year:'numeric' });
}

/* Convert an at:// URI to a clickable bsky.app post URL.
   at://did:plc:xxx/app.bsky.feed.post/rkey  →  https://bsky.app/profile/<handle-or-did>/post/<rkey> */
function bskyWebUrl(uri, handle){
  if(!uri || !uri.startsWith('at://')) return '';
  const parts = uri.split('/');
  const rkey = parts[parts.length-1];
  const who = handle || parts[2]; // handle if we have it, else the DID
  return 'https://bsky.app/profile/'+who+'/post/'+rkey;
}

/* Verify each indexed review still exists on Bluesky.
   Supabase is a cache of canonical posts; if a contributor deletes a post
   (or their account), the post 404s on the AppView and we must not show it.
   - Reads from the PUBLIC AppView (no auth → no 401).
   - Batches up to 25 URIs per getPosts call.
   - FAILS OPEN: any network/AppView error keeps the rows visible, so an
     outage can never blank the database (same principle as the schema retry).
   - Returns { live, orphans }. Orphans are logged with name + row id so the
     editor has a clean delete list for Supabase.
   Rows with no bskyUri (legacy/seed) are always treated as live. */
async function verifyLivePosts(rows){
  const checkable = rows.filter(r => r.bskyUri && r.bskyUri.startsWith('at://'));
  if(!checkable.length) return { live: rows, orphans: [] };

  const existing = new Set();   // at:// URIs confirmed to still exist
  let verificationFailed = false;
  const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts';

  for(let i=0; i<checkable.length; i+=25){
    const batch = checkable.slice(i, i+25);
    const qs = batch.map(r => 'uris=' + encodeURIComponent(r.bskyUri)).join('&');
    try{
      const res = await fetch(API + '?' + qs);
      if(!res.ok){ verificationFailed = true; break; }
      const data = await res.json();
      // getPosts only returns posts that exist; deleted ones are simply absent.
      (data.posts || []).forEach(p => { if(p && p.uri) existing.add(p.uri); });
    }catch(e){
      verificationFailed = true;
      break;
    }
  }

  // If we couldn't verify (offline / AppView down), keep everything.
  if(verificationFailed){
    console.warn('CBDB: post verification skipped (AppView unreachable). Showing all indexed rows.');
    return { live: rows, orphans: [] };
  }

  const orphans = checkable.filter(r => !existing.has(r.bskyUri));
  const orphanUris = new Set(orphans.map(r => r.bskyUri));
  const live = rows.filter(r => !(r.bskyUri && orphanUris.has(r.bskyUri)));

  if(orphans.length){
    console.warn(
      'CBDB: %d indexed review(s) no longer exist on Bluesky and were hidden. ' +
      'Delete these rows in Supabase when ready:',
      orphans.length
    );
    orphans.forEach(o => console.warn(
      '  • "%s" (%s) — bsky_post_uri: %s', o.name, o.loc || '', o.bskyUri
    ));
  }

  return { live, orphans };
}

/* Fetch reviews from Supabase. Returns true if any rows loaded.
   Tries to pull the contributor avatar via the join; if that column
   isn't in the schema yet (PostgREST 400), it retries WITHOUT avatar
   so a schema mismatch can never blank the whole site. */
async function loadReviews(){
  const base = CBDB_SUPABASE_URL + '/rest/v1/reviews?';
  const withAvatar = 'select=*,contributors(handle,did,avatar)&order=created_at.desc';
  const noAvatar   = 'select=*,contributors(handle,did)&order=created_at.desc';
  const headers = { apikey: CBDB_SUPABASE_ANON, Authorization: 'Bearer ' + CBDB_SUPABASE_ANON };
  async function pull(query){
    const res = await fetch(base + query, { headers });
    if(!res.ok) return { ok:false, status:res.status, body: await res.text() };
    return { ok:true, rows: await res.json() };
  }
  try{
    let r = await pull(withAvatar);
    // 400 usually means the avatar column isn't there yet — degrade gracefully.
    if(!r.ok && r.status === 400){
      console.warn('CBDB: avatar column not found, loading without it.');
      r = await pull(noAvatar);
    }
    if(!r.ok){
      console.error('CBDB: Supabase fetch failed —', r.status, r.body);
      reviews = [];
      return false;
    }
    const mapped = Array.isArray(r.rows) ? r.rows.map(mapRow) : [];
    // Reconcile against canonical Bluesky posts: hide any that were deleted.
    const { live } = await verifyLivePosts(mapped);
    reviews = live;
    try { window.dispatchEvent(new CustomEvent('cbdb-reviews-loaded')); } catch(e){}
    return reviews.length > 0;
  }catch(e){
    console.error('CBDB: Supabase fetch error —', e.message);
    reviews = [];
    return false;
  }
}
