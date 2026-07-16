/* ============================================================
   CB⚡DB — Shared Profile Drawer
   Single source of truth for the profile drawer across every page.
   A page only needs:  <script src="drawer.js"></script>
   (loaded AFTER cbdb-config.js + auth-bridge.js, which provide
   RATING, reviews, myReviews, bskyWebUrl, and cbdbSignOut).

   This module injects its own CSS + markup, then wires the behavior.
   ============================================================ */
(function(){
  'use strict';

  // ---- Rank ladder (single canonical definition) ----
  // Climbs by approved-review count; each tier earns an emoji badge,
  // building the burger as you go: 🥬 → 🧀 → 🍔 → ⚡
  const RANKS = [
    { min:0,  name:'Guest',         badge:'🍽️', desc:'Signed in. Nothing posted yet.' },
    { min:1,  name:'Reviewer',      badge:'🥬', desc:'One review live. You\u2019ve contributed to the database.' },
    { min:10, name:'Regular',       badge:'🧀', desc:'Ten reviews. You\u2019re a regular here now.' },
    { min:25, name:'Editor',        badge:'🍔', desc:'Twenty-five reviews in. Your palate is dialed.' },
    { min:50, name:'Burger Master', badge:'⚡', desc:'Fifty reviews. A true connoisseur — and the top of the ladder.' }
  ];
  function rankFor(n){ let r=RANKS[0]; for(const x of RANKS) if(n>=x.min) r=x; return r; }
  function nextRank(n){ for(const x of RANKS) if(n<x.min) return x; return null; }

  const PROFILE_FALLBACK_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#2a2620"/><circle cx="24" cy="19" r="9" fill="#FF9D2E"/><ellipse cx="24" cy="42" rx="15" ry="11" fill="#FF9D2E"/></svg>');

  // ---- Inject CSS once ----
  const CSS = `.drawer-bg { display:none; position:fixed; inset:0; background:rgba(8,6,3,0.7); z-index:90; }
  .drawer-bg.show { display:block; }
  .drawer { position:fixed; top:0; right:-420px; width:400px; max-width:90vw; height:100%; background:#211e1a; border-left:2px solid #4a443a; z-index:95; transition:right .25s; overflow-y:auto; padding:24px 30px; }
  .drawer.show { right:0; }
  .drawer-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
  .drawer-id { display:flex; gap:13px; align-items:center; }
  .rank-badge { width:34px; height:34px; border-radius:6px; background:#16140f; border:1px solid #38332b; display:flex; align-items:center; justify-content:center; font-size:18px; line-height:1; flex-shrink:0; }
  .p-avatar { width:48px; height:48px; border-radius:50%; flex-shrink:0; background:#2a2620; border:1px solid #38332b; object-fit:cover; }
  .p-name { font-family:'Bebas Neue',sans-serif; font-size:26px; letter-spacing:0.5px; color:#F5F4F2; line-height:1; }
  .p-handle { font-size:12px; color:#3B9AF8; margin-top:3px; }
  .drawer-x { background:none; border:none; color:#E4E0D8; font-size:26px; cursor:pointer; line-height:1; }
  .p-rank-line { display:flex; align-items:center; gap:10px; background:#16140f; border:1px solid #38332b; padding:11px 14px; margin-bottom:11px; cursor:pointer; transition:border-color .12s; }
  .p-rank-line:hover { border-color:#5f574a; }
  .p-rank-emoji { font-size:20px; line-height:1; }
  .p-rank-name { font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:1px; color:#F5F4F2; }
  .p-rank-tag { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#B6B0A4; margin-left:auto; }
  .p-next { background:#1d2417; border:1px solid #2f3a22; border-left:3px solid #4ADE52; padding:11px 13px; font-size:12px; color:#E4E0D8; line-height:1.6; margin-bottom:11px; cursor:pointer; transition:border-color .12s; }
  .p-next:hover { border-color:#4ADE52; }
  .p-next b { color:#4ADE52; }
  .p-stats { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .p-stat { background:#16140f; border:1px solid #38332b; padding:14px 8px; text-align:center; }
  .p-num { font-family:'Bebas Neue',sans-serif; font-size:34px; line-height:1; color:#F5F4F2; }
  .p-lab { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#B6B0A4; margin-top:6px; }
  .p-hist-label { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:#B6B0A4; margin-bottom:11px; }
  .p-profile-cta { display:flex; align-items:center; justify-content:center; gap:8px; background:#FF9D2E; color:#15130f; font-family:'IBM Plex Mono',monospace; font-weight:600; font-size:13px; letter-spacing:0.5px; text-decoration:none; padding:12px; margin-bottom:22px; transition:background .12s; }
  .p-profile-cta:hover { background:#ffad4e; }
  .p-profile-cta span { font-size:15px; line-height:1; }
  .p-history { display:flex; flex-direction:column; }
  .p-history { display:flex; flex-direction:column; gap:8px; }
  /* Dark cards that pop against the lighter drawer panel. */
  .ph-item { display:flex; align-items:center; gap:12px; padding:13px 14px; background:#16140f; border:1px solid #2a2620; border-radius:9px; cursor:pointer; transition:border-color .12s, background .12s, transform .12s; }
  .ph-item:hover { border-color:#FF9D2E; background:#1b1813; transform:translateX(2px); }
  .ph-item.leg { border-color:rgba(91,217,75,0.35); }
  .ph-item.leg:hover { border-color:#5BD94B; }
  .ph-chip { font-size:16px; flex-shrink:0; width:40px; text-align:center; }
  .ph-body { flex:1; min-width:0; }
  .ph-name { font-size:14px; color:#F5F4F2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ph-name.legendary { color:#5BD94B; }
  .ph-loc { font-size:11px; color:#B6B0A4; margin-top:2px; }
  .ph-arrow { color:#B6B0A4; flex-shrink:0; font-size:13px; transition:color .12s; }
  .ph-item:hover .ph-arrow { color:#FF9D2E; }
  .p-empty { font-size:13px; color:#B6B0A4; padding:20px 0; text-align:center; line-height:1.6; }
  .p-signout { margin-top:26px; padding-top:18px; border-top:1px solid #2a2620; text-align:center; }
  .signout-link { background:none; border:1px solid #38332b; color:#B6B0A4; font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:0.5px; padding:9px 18px; cursor:pointer; transition:border-color .12s, color .12s; }
  .signout-link:hover { border-color:#FF5A4E; color:#FF5A4E; }`;
  if(!document.getElementById('cbdb-drawer-css')){
    const st=document.createElement('style');
    st.id='cbdb-drawer-css';
    st.textContent=CSS;
    document.head.appendChild(st);
  }

  // ---- Inject markup once (if the page hasn't already got it) ----
  const MARKUP = `<div class="drawer-bg" id="drawerBg" onclick="closeProfile()"></div>
<div class="drawer" id="drawer">
  <div class="drawer-head">
    <div class="drawer-id">
      <img class="p-avatar" id="pAvatar" alt="">
      <div><div class="p-name" id="pName">—</div><div class="p-handle" id="pHandle">—</div></div>
    </div>
    <button class="drawer-x" onclick="closeProfile()">×</button>
  </div>
  <div class="p-rank-line" onclick="location.href='ranks.html'">
    <span class="p-rank-emoji" id="pRankEmoji"></span>
    <span class="p-rank-name" id="pRank">—</span>
    <span class="p-rank-tag">Rank</span>
  </div>
  <div class="p-next" id="pNext" onclick="location.href='ranks.html'"></div>
  <div class="p-stats">
    <div class="p-stat"><div class="p-num" id="pCount">0</div><div class="p-lab">Reviews</div></div>
    <div class="p-stat"><div class="p-num" id="pCities">0</div><div class="p-lab">Cities</div></div>
  </div>
  <a class="p-profile-cta" href="profile.html">View full profile <span>&rarr;</span></a>
  <div class="p-signout"><button class="signout-link" onclick="cbdbSignOut()">Sign out</button></div>
</div>`;
  if(!document.getElementById('drawer')){
    const wrap=document.createElement('div');
    wrap.innerHTML=MARKUP;
    while(wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  // ---- Session accessor (auth-bridge.js owns the real session on window) ----
  const state = (window.__cbdb_state = window.__cbdb_state || {signedIn:false,handle:null,displayName:null});

  // ---- Behavior ----
  function openProfile(){
    if(!state.signedIn){ window.cbdbSignInPrompt ? window.cbdbSignInPrompt() : (window.location.href='submit.html'); return; }
    const mine=(typeof myReviews==="function")?myReviews(state):(window.reviews||[]).filter(r=>r.by===state.handle);
    const cities=new Set(mine.map(r=>r.loc)).size;
    const rk=rankFor(mine.length);
    const av=document.getElementById('pAvatar');
    if(av){ av.src = state.avatar || PROFILE_FALLBACK_AVATAR; }
    const emo=document.getElementById('pRankEmoji');
    if(emo){ emo.textContent = rk.badge || '•'; }
    document.getElementById('pName').textContent=state.displayName;
    document.getElementById('pHandle').textContent='@'+state.handle;
    document.getElementById('pCount').textContent=mine.length;
    document.getElementById('pRank').textContent=rk.name;
    document.getElementById('pCities').textContent=cities;
    const nx=nextRank(mine.length);
    document.getElementById('pNext').innerHTML = nx
      ? 'Next: <b>'+nx.name+'</b> at '+nx.min+' reviews. <b>'+(nx.min-mine.length)+'</b> to go.'
      : 'Top rank reached. <b>Burger Master.</b>';
    document.getElementById('drawerBg').classList.add('show');
    document.getElementById('drawer').classList.add('show');
  }

  function closeProfile(){
    document.getElementById('drawerBg').classList.remove('show');
    document.getElementById('drawer').classList.remove('show');
  }

  // ---- Expose the handful of globals pages/markup call via inline onclick ----
  window.openProfile  = openProfile;
  window.closeProfile = closeProfile;
  window.RANKS        = RANKS;      // ranks.html renders its own ladder from this
  window.rankFor      = rankFor;
  window.nextRank     = nextRank;
})();
