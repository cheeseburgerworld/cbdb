/* ============================================================
   CB⚡DB — Burger Week 2026 event config
   SINGLE SOURCE OF TRUTH. Edit this file only — events.html,
   the nav badge, and the profile drawer all read from it.

   TOMORROW: paste the finalized restaurant list into
   BURGER_WEEK.restaurants below. That's the only edit needed —
   the page, counters, and badge all update automatically.

   Matching is by NAME. It must match the "name" field contributors
   type into submit.html exactly (case-insensitive, whitespace-
   trimmed) — that's how a posted review gets counted as a Burger
   Week entry with zero schema changes and zero backend work.
   ============================================================ */

const BURGER_WEEK = {
  active: true,                 // flip false to fully hide the nav tab + banner after the event
  year: 2026,
  name: 'Burger Week 2026',
  host: 'Portland Mercury',
  hostUrl: 'https://www.portlandmercury.com/category/burger-week/',

  // Event window — reviews posted outside this range don't count toward
  // the leaderboard or badge, even if the restaurant is on the list.
  start: '2026-08-10',          // Aug 10, 2026
  end: '2026-08-16',            // Aug 16, 2026 (inclusive)

  // How many DIFFERENT participating restaurants a contributor must
  // review during the window to earn the Burger Week badge.
  // 3 felt like the right bar: attainable in a week, not a gimme.
  // Flag: change this number if that doesn't feel right.
  badgeThreshold: 3,

  // ---- Participating restaurants ----
  // EMPTY UNTIL THE LIST IS FINALIZED. The page shows a
  // "list drops tomorrow" state until this array has entries.
  //
  // Fill in exactly like this (name must match what contributors
  // type into the "Restaurant" field on submit.html):
  // { name: 'Tulip Shop Tavern', neighborhood: 'Buckman', entry: 'The Firecracker' },
  restaurants: [
    // { name: '', neighborhood: '', entry: '' },
  ]
};

/* ---- Helpers (used by events.html + drawer badge) ---- */

/* Case/whitespace-insensitive match against the participating list. */
function bwIsParticipant(reviewName){
  if(!reviewName) return false;
  const n = reviewName.trim().toLowerCase();
  return BURGER_WEEK.restaurants.some(r => r.name.trim().toLowerCase() === n);
}

/* True if an ISO createdAt timestamp falls inside the event window. */
function bwInWindow(iso){
  if(!iso) return false;
  const d = new Date(iso);
  if(isNaN(d)) return false;
  const start = new Date(BURGER_WEEK.start + 'T00:00:00');
  const end   = new Date(BURGER_WEEK.end + 'T23:59:59');
  return d >= start && d <= end;
}

/* Filter the global `reviews` array down to counted Burger Week entries. */
function bwEntries(allReviews){
  return (allReviews || []).filter(r => bwIsParticipant(r.name) && bwInWindow(r.createdAt));
}

/* Distinct participating restaurants a given contributor has covered
   during the window — this count is what the badge threshold checks. */
function bwCoverageFor(allReviews, st){
  const mine = (typeof myReviews === 'function') ? myReviews(st) : [];
  const entries = bwEntries(mine);
  return new Set(entries.map(r => r.name.trim().toLowerCase()));
}

function bwHasBadge(allReviews, st){
  return bwCoverageFor(allReviews, st).size >= BURGER_WEEK.badgeThreshold;
}
