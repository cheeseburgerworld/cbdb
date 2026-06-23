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
      if(strip){
        strip.innerHTML =
          avatarHTML('avatar')+
          '<div><div class="handle">@'+state.handle+'</div></div>';
      }
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
  window.addEventListener('cbdb-reviews-loaded', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  refresh();

  // ── Sign-in modal: presents a choice — use an existing Bluesky handle,
  //    or create a new account (handoff to Bluesky, then return and sign in).
  //    Injected once into the DOM so every page gets it with no per-page markup.
  function ensureSignInModal(){
    if(document.getElementById('cbdbSignInModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'cbdbSignInModal';
    wrap.setAttribute('style','display:none;position:fixed;inset:0;z-index:3000;align-items:center;justify-content:center;padding:20px;background:rgba(8,6,3,0.82);');
    // Bluesky butterfly logo, inline SVG (no external request), Bluesky blue.
    const BSKY_LOGO = '<svg width="15" height="13" viewBox="0 0 568 501" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;" aria-hidden="true"><path fill="#3B9AF8" d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.193 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.66 0 75.293 0 57.947 0-28.906 76.135-1.611 123.121 33.664Z"/></svg>';
    wrap.innerHTML =
      '<div role="dialog" aria-label="Sign in" style="width:100%;max-width:420px;background:#211e1a;border:1px solid #38332b;font-family:\'IBM Plex Mono\',monospace;color:#F5F4F2;">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #38332b;">'+
          '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:1px;color:#FF9D2E;">Sign in to CB⚡DB</span>'+
          '<button id="cbdbSignInX" aria-label="Close" style="background:none;border:none;color:#C3BDB2;font-size:24px;line-height:1;cursor:pointer;">×</button>'+
        '</div>'+
        '<div style="padding:20px;">'+
          '<div style="font-size:13px;color:#C3BDB2;line-height:1.6;margin-bottom:18px;">CB⚡DB runs on Bluesky. Your reviews live on your profile — we just index them.</div>'+
          // Sign-in box: bordered in Bluesky blue.
          '<div style="border:1px solid #3B9AF8;padding:16px;margin-bottom:16px;">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+BSKY_LOGO+
              '<span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#948D80;">Already on Bluesky?</span>'+
            '</div>'+
            '<input id="cbdbHandleInput" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="you.bsky.social" style="width:100%;background:#16140f;border:1px solid #38332b;color:#F5F4F2;font-family:\'IBM Plex Mono\',monospace;font-size:14px;padding:11px 13px;margin-bottom:10px;box-sizing:border-box;">'+
            '<button id="cbdbHandleGo" style="width:100%;background:#3B9AF8;color:#fff;border:none;font-family:\'IBM Plex Mono\',monospace;font-weight:600;font-size:14px;padding:12px;cursor:pointer;">Sign in</button>'+
            '<div id="cbdbSignInErr" style="display:none;font-size:12px;color:#FF5A4E;margin-top:10px;"></div>'+
          '</div>'+
          // New-account box: same design, bordered in amber.
          '<div style="border:1px solid #FF9D2E;padding:16px;">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+BSKY_LOGO+
              '<span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#948D80;">New account?</span>'+
            '</div>'+
            '<div style="font-size:12px;color:#C3BDB2;line-height:1.6;margin-bottom:10px;">If you don\u2019t have an account (or you don\u2019t want to post burgers on main) click here.</div>'+
            '<button id="cbdbCreate" style="width:100%;background:none;color:#FF9D2E;border:1px solid #FF9D2E;font-family:\'IBM Plex Mono\',monospace;font-weight:600;font-size:14px;padding:12px;cursor:pointer;">Create a new account →</button>'+
            '<div style="font-size:11px;color:#948D80;line-height:1.6;margin-top:10px;">Use it as your main handle for all Atmosphere apps, or make a dedicated one for Cheeseburger World. Your call.</div>'+
          '</div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(wrap);

    function close(){ wrap.style.display='none'; }
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    document.getElementById('cbdbSignInX').addEventListener('click', close);

    async function go(){
      const input = document.getElementById('cbdbHandleInput');
      const err = document.getElementById('cbdbSignInErr');
      const handle = (input.value||'').trim().replace(/^@/,'');
      if(!handle){ err.textContent='Enter your Bluesky handle.'; err.style.display='block'; return; }
      err.style.display='none';

      // auth.js loads as a deferred ES module, so on a slow connection
      // window.cbdbAuth may not be defined yet when this runs. Wait briefly
      // for it instead of throwing "undefined is not an object".
      if(!window.cbdbAuth || typeof window.cbdbAuth.signIn !== 'function'){
        err.textContent='Connecting…'; err.style.display='block';
        let waited = 0;
        while((!window.cbdbAuth || typeof window.cbdbAuth.signIn !== 'function') && waited < 5000){
          await new Promise(r=>setTimeout(r, 100));
          waited += 100;
        }
        if(!window.cbdbAuth || typeof window.cbdbAuth.signIn !== 'function'){
          err.textContent='Sign-in didn\u2019t load. Reload the page and try again.';
          err.style.display='block';
          return;
        }
        err.style.display='none';
      }

      try { sessionStorage.setItem('cbdb_return', location.pathname); } catch {}
      try {
        await window.cbdbAuth.signIn(handle);
      } catch(e){
        err.textContent='Sign-in failed: ' + (e.message||e);
        err.style.display='block';
      }
    }
    document.getElementById('cbdbHandleGo').addEventListener('click', go);
    document.getElementById('cbdbHandleInput').addEventListener('keydown', e=>{ if(e.key==='Enter') go(); });
    document.getElementById('cbdbCreate').addEventListener('click', ()=>{
      window.open('https://bsky.app/', '_blank', 'noopener');
    });
  }

  // Sign-in entry point used by the gate button and nav.
  window.cbdbSignInPrompt = function(){
    ensureSignInModal();
    const m = document.getElementById('cbdbSignInModal');
    m.style.display = 'flex';
    const input = document.getElementById('cbdbHandleInput');
    if(input){ input.value=''; setTimeout(()=>input.focus(), 50); }
  };
  // Existing onclick="signIn()" hooks still work.
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
