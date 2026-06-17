/* ============================================================
   CB⚡DB — shared auth (ATProto / Bluesky OAuth)
   Ported from the working Pizza Official flow.
   - Full client-side OAuth 2.0 + PKCE (no server needed for login)
   - Session persists across pages via the library's own store + a
     sessionStorage cache, so "Online · @handle" stays put on nav.
   Loaded as: <script type="module" src="auth.js"></script>
   ============================================================ */

import { BrowserOAuthClient } from
  'https://esm.sh/@atproto/oauth-client-browser@0.3.37?bundle';
import { Agent } from 'https://esm.sh/@atproto/api@0.13.35?bundle';

const CLIENT_ID = 'https://cheeseburger.world/oauth/client-metadata.json';
const HANDLE_RESOLVER = 'https://bsky.social';

// Shared session state the rest of the site reads.
// (window.__cbdb_state is the same object the pages already use.)
const state = (window.__cbdb_state = window.__cbdb_state || {
  signedIn: false, handle: null, displayName: null, did: null
});

let oauthClient = null;
let agent = null;

async function initAuth() {
  oauthClient = await BrowserOAuthClient.load({
    clientId: CLIENT_ID,
    handleResolver: HANDLE_RESOLVER,
  });

  // init() finishes a redirect (if we're on the callback) OR restores
  // an existing session on a normal page load — this is what makes
  // login persist across every page.
  const result = await oauthClient.init();
  const session = result?.session;

  if (session) {
    agent = new Agent(session);
    state.did = session.did;
    // resolve handle + display name from the profile
    try {
      const prof = await agent.getProfile({ actor: session.did });
      state.handle = prof.data.handle;
      state.displayName = prof.data.displayName || prof.data.handle;
    } catch {
      state.handle = session.did;
      state.displayName = session.did;
    }
    state.signedIn = true;
    cacheSession();
  } else {
    restoreCache(); // paint nav instantly from cache while init settles
  }

  // let pages update their nav/UI now that we know the auth state
  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
  return state;
}

// lightweight cache so the nav shows "Online" immediately on next page,
// before the async init round-trips
function cacheSession() {
  try {
    sessionStorage.setItem('cbdb_auth', JSON.stringify({
      signedIn: state.signedIn, handle: state.handle,
      displayName: state.displayName, did: state.did
    }));
  } catch {}
}
function restoreCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem('cbdb_auth') || 'null');
    if (c && c.signedIn) Object.assign(state, c);
  } catch {}
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
  try { sessionStorage.removeItem('cbdb_auth'); } catch {}
  state.signedIn = false; state.handle = null; state.displayName = null; state.did = null;
  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
}

function getAgent() { return agent; }

// expose to non-module page scripts
window.cbdbAuth = { initAuth, signIn, signOut, getAgent, state };

// auto-init on load
initAuth().catch(e => console.error('CBDB auth init failed:', e));
