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
const RATING = {
  legendary:{glyph:'⭐⭐⭐',label:'Legendary',cls:'pin-legendary',color:'#5BD94B'},
  trip:{glyph:'⭐⭐',label:'Worth A Trip',cls:'pin-trip',color:'#FFC72C'},
  solid:{glyph:'⭐',label:'Solid',cls:'pin-solid',color:'#E8843C'},
  skip:{glyph:'ㄨ',label:'Skip It',cls:'pin-skip',color:'#9A7B4F'}
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
    verdict: r.verdict || '',
    photoUrl: r.photo_url || '',
    bskyUri: r.bsky_post_uri || r.bsky_uri || '',
    createdAt: r.created_at || '',
    by: (r.contributors && r.contributors.handle) || r.author_handle || ''
  };
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

/* Fetch reviews from Supabase. Returns true if any rows loaded. */
async function loadReviews(){
  try{
    const url = CBDB_SUPABASE_URL +
      '/rest/v1/reviews?select=*,contributors(handle)&order=created_at.desc';
    const res = await fetch(url, {
      headers: { apikey: CBDB_SUPABASE_ANON, Authorization: 'Bearer ' + CBDB_SUPABASE_ANON }
    });
    if(!res.ok){
      console.error('CBDB: Supabase fetch failed —', res.status, await res.text());
      reviews = [];
      return false;
    }
    const rows = await res.json();
    reviews = Array.isArray(rows) ? rows.map(mapRow) : [];
    return reviews.length > 0;
  }catch(e){
    console.error('CBDB: Supabase fetch error —', e.message);
    reviews = [];
    return false;
  }
}
