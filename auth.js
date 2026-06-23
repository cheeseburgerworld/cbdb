/* ============================================================
   CB⚡DB — shared auth (ATProto / Bluesky OAuth)
   Ported from the working Pizza Official flow.
   - Full client-side OAuth 2.0 + PKCE (no server needed for login)
   - Session persists across pages via the library's own store + a
     localStorage cache, so "Online · @handle" stays put on nav.
   - STICKY SESSION: proactively refreshes the access token on load
     and on every tab-wake (visibility/focus), so an idle desktop tab
     doesn't return to an expired token and read as "logged out".
   Loaded as: <script type="module" src="auth.js"></script>
   ============================================================ */

import { BrowserOAuthClient } from
  'https://esm.sh/@atproto/oauth-client-browser@0.3.37?bundle';
import { Agent } from 'https://esm.sh/@atproto/api@0.13.35?bundle';

const CLIENT_ID = 'https://cheeseburger.world/oauth/client-metadata.json';
const HANDLE_RESOLVER = 'https://bsky.social';

// Shared session state the rest of the site reads.
const state = (window.__cbdb_state = window.__cbdb_state || {
  signedIn: false, handle: null, displayName: null, did: null, avatar: null
});

let oauthClient = null;
let agent = null;
let initDone = false;          // becomes true after the first full init() round-trip
let refreshing = false;        // guard so overlapping wake events don't stampede

async function initAuth() {
  // Paint instantly from the persisted cache BEFORE the async OAuth round-trip,
  // so a signed-in user never flashes as signed-out when navigating pages.
  restoreCache();
  if (state.signedIn) {
    window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
  }

  oauthClient = await BrowserOAuthClient.load({
    clientId: CLIENT_ID,
    handleResolver: HANDLE_RESOLVER,
  });

  // init() finishes a redirect (if we're on the callback) OR restores
  // an existing session on a normal page load.
  // IMPORTANT: a thrown init() (mobile tab wake, flaky network) must NOT be
  // treated as "logged out" — that would wipe a still-valid session. We only
  // clear the cache when the library *positively* reports no session.
  let result, initFailed = false;
  try {
    result = await oauthClient.init();
  } catch (e) {
    console.warn('CBDB auth: init() failed (likely transient/offline). Keeping cached session.', e);
    initFailed = true;
  }
  let session = result?.session;

  // If init() didn't hand us a session but we have a cached DID, the access
  // token has very likely just expired while the library still holds a valid
  // refresh token. Actively restore() that DID — this forces a token refresh
  // rather than passively reading a possibly-stale token. This is the single
  // biggest fix for "left and came back, now logged out".
  if (!session && !initFailed) {
    const cachedDid = cachedDID();
    if (cachedDid) {
      try {
        session = await oauthClient.restore(cachedDid);
      } catch (e) {
        console.warn('CBDB auth: restore() could not renew the session.', e);
        // Treat an explicit restore failure like a transient miss this pass —
        // we do NOT immediately wipe. The next wake/load gets another chance.
        initFailed = true;
      }
    }
  }

  await applySession(session, initFailed);
  initDone = true;
  return state;
}

// Resolve a session object into shared state + dispatch the auth event.
// `couldNotVerify` means we hit a transient/unknown condition and must NOT
// log the user out — keep whatever the optimistic cache painted.
async function applySession(session, couldNotVerify) {
  if (session) {
    agent = new Agent(session);
    state.did = session.did;
    // resolve handle + display name + avatar via the PUBLIC appview (no auth needed → no 401)
    try {
      const pub = await fetch(
        'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(session.did)
      );
      if (pub.ok) {
        const d = await pub.json();
        state.handle = d.handle;
        state.displayName = d.displayName || d.handle;
        state.avatar = d.avatar || null;
      } else if (!state.handle) {
        state.handle = session.did; state.displayName = session.did;
      }
    } catch {
      if (!state.handle) { state.handle = session.did; state.displayName = session.did; }
    }
    state.signedIn = true;
    cacheSession();
  } else if (couldNotVerify) {
    // Could not verify session right now (network/offline/tab-wake/restore miss).
    // Do NOT log the user out. Keep the optimistic cache and try again next wake.
    // (state stays as restoreCache() left it.)
  } else {
    // Library positively reported no session → genuinely logged out.
    clearState();
  }

  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
}

// Re-validate / refresh the session when the tab wakes from background.
// Desktop tabs left idle expire their access token; this renews it on return
// so the user never comes back to "Not signed in".
async function refreshOnWake() {
  if (!initDone || refreshing) return;       // wait until first init settled
  if (document.visibilityState === 'hidden') return;
  const did = state.did || cachedDID();
  if (!did || !oauthClient) return;
  refreshing = true;
  try {
    const session = await oauthClient.restore(did);
    await applySession(session, /*couldNotVerify on miss*/ true);
  } catch (e) {
    // Transient — keep the user signed in, next wake retries.
    console.warn('CBDB auth: wake refresh skipped (transient).', e);
  } finally {
    refreshing = false;
  }
}

// ---- session cache (UI paint + did pointer) ----------------------------
// localStorage persists across tabs and reloads.
function cacheSession() {
  try {
    localStorage.setItem('cbdb_auth', JSON.stringify({
      signedIn: state.signedIn, handle: state.handle,
      displayName: state.displayName, did: state.did, avatar: state.avatar
    }));
  } catch {}
}
function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem('cbdb_auth') || 'null');
    if (c && c.signedIn) Object.assign(state, c);
  } catch {}
}
// Read just the cached DID even if signedIn flag is stale — used to drive restore().
function cachedDID() {
  if (state.did) return state.did;
  try {
    const c = JSON.parse(localStorage.getItem('cbdb_auth') || 'null');
    return c && c.did ? c.did : null;
  } catch { return null; }
}
function clearState() {
  state.signedIn = false; state.handle = null; state.displayName = null; state.did = null; state.avatar = null;
  try { localStorage.removeItem('cbdb_auth'); } catch {}
}

async function signIn(handle) {
  if (!oauthClient) await initAuth();
  // redirects to Bluesky; returns to /oauth/callback then back here
  await oauthClient.signIn(handle, {
    scope: 'atproto transition:generic',
  });
}

async function signOut() {
  try { if (oauthClient && state.did) await oauthClient.revoke(state.did); } catch {}
  clearState();
  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
}

function getAgent() { return agent; }

// expose to non-module page scripts
window.cbdbAuth = { initAuth, signIn, signOut, getAgent, state, refreshOnWake };

// ---- wake / focus listeners --------------------------------------------
// These keep the token fresh on a returning desktop tab and on mobile resume.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshOnWake();
});
window.addEventListener('focus', refreshOnWake);
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshOnWake(); }); // bfcache restore

// auto-init on load
initAuth().catch(e => console.error('CBDB auth init failed:', e));
