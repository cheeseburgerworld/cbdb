/* ============================================================
   CB⚡DB — auth bridge (non-module)
   Connects the real OAuth session (auth.js) to each page's existing
   nav + UI, so we don't have to rewrite every page's logic.
   Loaded after auth.js with a plain <script src="auth-bridge.js">.
   ============================================================ */
(function(){
  const state = (window.__cbdb_state = window.__cbdb_state || {});

  // Build an avatar element: real Bluesky photo if we have it, else the initial letter.
  // `cls` is the base class ('avatar' for the id-strip, 'bsky-av' for the preview card).
  function avatarHTML(cls){
    const initial = (state.displayName||state.handle||'?').charAt(0).toUpperCase();
    if(state.avatar){
      return '<div class="'+cls+'" style="overflow:hidden;padding:0;">'+
        '<img src="'+state.avatar+'" alt="" '+
        'style="width:100%;height:100%;object-fit:cover;display:block;" '+
        'onerror="this.parentNode.textContent=\''+initial+'\'">'+
        '</div>';
    }
    return '<div class="'+cls+'">'+initial+'</div>';
  }

  // Paint the nav status pill from current auth state.
  function paintNav(){
    const nav = document.getElementById('navId');
    if(!nav) return;
    if(state.signedIn){
      nav.innerHTML = '<span class="dot"></span>Online · @' + state.handle;
    } else {
      nav.innerHTML = '<span class="dot out"></span>Not signed in';
    }
  }

  // Reveal the submit form + fill identity strip (submit page only).
  function paintSubmit(){
    const gate = document.getElementById('gate');
    const form = document.getElementById('reviewForm');
    if(!gate || !form) return; // not the submit page
    if(state.signedIn){
      gate.style.display = 'none';
      form.classList.add('show');
      const initial = (state.displayName||state.handle||'?').charAt(0).toUpperCase();
      const strip = document.getElementById('idStrip');
      if(strip) strip.innerHTML =
        avatarHTML('avatar')+
        '<div><div class="handle">@'+state.handle+'</div><div class="role">Contributor</div></div>';
      // Bluesky preview card avatar: real photo if present, else initial.
      const bAv=document.getElementById('bAv');
      if(bAv){
        if(state.avatar){
          bAv.style.overflow='hidden'; bAv.style.padding='0';
          bAv.innerHTML='<img src="'+state.avatar+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentNode.textContent=\''+initial+'\'">';
        } else { bAv.textContent=initial; }
      }
      const bName=document.getElementById('bName'); if(bName) bName.textContent=state.displayName||state.handle;
      const bHandle=document.getElementById('bHandle'); if(bHandle) bHandle.textContent='@'+state.handle;
      if(typeof renderPreview==='function') renderPreview();
    } else {
      gate.style.display = '';
      form.classList.remove('show');
    }
  }

  // Update everything when auth state changes (or on first load).
  function refresh(){ paintNav(); paintSubmit(); }
  window.addEventListener('cbdb-auth', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  refresh();

  // Sign-in entry point used by the gate button and nav.
  // Remembers where the user was so the callback can return them.
  window.cbdbSignInPrompt = async function(){
    const handle = prompt('Your Bluesky handle (e.g. you.bsky.social):');
    if(!handle) return;
    try { sessionStorage.setItem('cbdb_return', location.pathname); } catch {}
    try {
      await window.cbdbAuth.signIn(handle.trim());
    } catch(e){
      alert('Sign-in failed: ' + (e.message||e));
    }
  };
  // Replace the old simulated signIn() global so existing onclick="signIn()" works.
  window.signIn = window.cbdbSignInPrompt;

  // Sign out — closes the profile drawer (if open) and repaints the nav.
  window.cbdbSignOut = function(){
    const drawer = document.getElementById('drawer');
    const dbg = document.getElementById('drawerBg');
    if(drawer) drawer.classList.remove('show');
    if(dbg) dbg.classList.remove('show');
    window.cbdbAuth.signOut();
  };
})();
