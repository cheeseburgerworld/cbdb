/* ============================================================
   CB⚡DB — auth.js (BFF version)
   Session is managed server-side via Netlify functions.
   This file is now a thin client:
   - On load: GET /auth/session → paint state
   - signIn: redirect to /auth/start
   - signOut: POST /auth/signout
   - No BrowserOAuthClient, no crypto.subtle, no IndexedDB
   - Works in every browser including Firefox/DDG on iPhone
   Loaded as: <script type="module" src="auth.js"></script>
   ============================================================ */

// Shared session state the rest of the site reads via window.__cbdb_state
const state = (window.__cbdb_state = window.__cbdb_state || {
  signedIn: false, handle: null, displayName: null, did: null, avatar: null
});

// Paint instantly from localStorage cache before the async session fetch,
// so signed-in users never flash as signed-out on page navigation.
(function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem('cbdb_auth') || 'null');
    if (c && c.signedIn) Object.assign(state, c);
  } catch {}
})();
if (state.signedIn) {
  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
}

// initPromise resolves when the server session check is complete.
// auth-bridge.js and submit.html can await this before acting.
let initResolve;
const initPromise = new Promise(res => { initResolve = res; });

async function initAuth() {
  try {
    const res = await fetch('/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error(`auth-session ${res.status}`);
    const data = await res.json();

    if (data.signedIn) {
      Object.assign(state, {
        signedIn:    true,
        did:         data.did,
        handle:      data.handle,
        displayName: data.displayName,
        avatar:      data.avatar,
      });
      // Persist for next page load's optimistic paint
      try {
        localStorage.setItem('cbdb_auth', JSON.stringify({
          signedIn: true, did: state.did, handle: state.handle,
          displayName: state.displayName, avatar: state.avatar,
        }));
      } catch {}
    } else {
      // Server says not signed in — clear any stale cache
      Object.assign(state, { signedIn: false, handle: null, displayName: null, did: null, avatar: null });
      try { localStorage.removeItem('cbdb_auth'); } catch {}
    }
  } catch (err) {
    console.warn('[cbdb-auth] session check failed (keeping cached state):', err.message);
    // Network error — don't log out, keep the optimistic cache
  }

  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
  initResolve();
}

// Sign in: store the return path, then redirect to the server-side auth start.
// The server handles PKCE + DPoP + the Bluesky redirect entirely.
function signIn(handle) {
  const clean = (handle || '').trim().replace(/^@/, '');
  if (!clean) return;
  try { sessionStorage.setItem('cbdb_return', location.pathname); } catch {}
  const params = new URLSearchParams({
    handle,
    return: location.pathname,
  });
  window.location.href = `/auth/start?${params}`;
}

// Sign out: call the server function to clear the httpOnly cookie
async function signOut() {
  try {
    await fetch('/auth/signout', { method: 'POST', credentials: 'include' });
  } catch {}
  Object.assign(state, { signedIn: false, handle: null, displayName: null, did: null, avatar: null });
  try { localStorage.removeItem('cbdb_auth'); } catch {}
  window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
}

// Proxy an authenticated action through the server.
// action: 'post' | 'uploadBlob'
// payload: the action-specific data
async function proxyAction(action, payload) {
  // Wait for the session to be confirmed before proxying
  await initPromise;

  if (!state.signedIn) throw new Error('Not signed in');

  const res = await fetch('/auth/proxy', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ action, payload }),
  });

  if (res.status === 401) {
    // Session expired — sign out and prompt re-auth
    await signOut();
    throw new Error('Your session expired. Please sign in again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Proxy request failed (${res.status})`);
  return data;
}

// Expose to non-module page scripts.
// getAgent() and ensureAgent() are kept as no-ops for backward compatibility —
// submit.html uses proxyAction() now for all Bluesky API calls.
window.cbdbAuth = {
  initPromise,
  signIn,
  signOut,
  proxyAction,
  state,
  // Legacy stubs (submit.html has been updated to use proxyAction)
  getAgent:    () => null,
  ensureAgent: async () => null,
};

// Tab-wake: re-check session when user returns to the tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.signedIn) {
    // Lightweight re-check — just re-fetch session in the background
    fetch('/auth/session', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.signedIn) {
          // Server says expired — update state
          Object.assign(state, { signedIn: false, handle: null, displayName: null, did: null, avatar: null });
          try { localStorage.removeItem('cbdb_auth'); } catch {}
          window.dispatchEvent(new CustomEvent('cbdb-auth', { detail: { ...state } }));
        }
      })
      .catch(() => {}); // Network error — keep current state
  }
});

// Auto-init on load
initAuth().catch(e => console.error('[cbdb-auth] init failed:', e));
