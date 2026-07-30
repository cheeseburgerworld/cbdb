/* ============================================================
   CB⚡DB — Burger Week 2026 event config
   SINGLE SOURCE OF TRUTH. events.html reads restaurants, dates,
   and badge/trophy thresholds from this one file.

   List is LIVE as of the Mercury's official announcement — 124
   spots. Matching is by NAME. It must match the "name" field
   contributors type into submit.html exactly (case-insensitive,
   whitespace-trimmed) — that's how a posted review gets counted
   as a Burger Week entry with zero schema changes and zero
   backend work.
   ============================================================ */

const BURGER_WEEK = {
  active: true,                 // flip false to fully hide the nav tab + banner after the event
  year: 2026,
  name: 'Burger Week 2026',
  host: 'Portland Mercury',
  hostUrl: 'https://everout.com/portland/events/the-portland-mercurys-burger-week-2026/e222750/',

  // Event window — reviews posted outside this range don't count toward
  // the leaderboard or badge, even if the restaurant is on the list.
  start: '2026-08-10',          // Aug 10, 2026
  end: '2026-08-16',            // Aug 16, 2026 (inclusive)

  // Two-tier recognition:
  //   BADGE  — post 1 review of a participating restaurant during the window.
  //   TROPHY — review this many DIFFERENT participating restaurants during
  //            the window, OR already be at the top of the site-wide Rank
  //            ladder (Burger Master). Ratings play no part in either tier.
  // Flag: change the 3 if that bar doesn't feel right.
  trophyThreshold: 3,

  // ---- Participating restaurants (124, official as of the Mercury's announcement) ----
  restaurants: [
    {"name": "10 Barrel Brewing", "neighborhood": "Pearl District", "entry": "The Patty Meltdella Effect"},
    {"name": "2NW5", "neighborhood": "Old Town-Chinatown", "entry": "Nacho Burger"},
    {"name": "Abigail Hall", "neighborhood": "Southwest Portland", "entry": "The Ab-Brie Burger"},
    {"name": "Aji Tram Restaurant and Bar", "neighborhood": "Lake Oswego", "entry": "Basil Buckaroo Burger"},
    {"name": "Amaros Table Downtown", "neighborhood": "Vancouver", "entry": "The Pambazo Burger"},
    {"name": "Arch Bridge Taphouse", "neighborhood": "Oregon City", "entry": "Nacho Man Smashy Savage"},
    {"name": "ASL Café (Woodstock Café)", "neighborhood": "Woodstock", "entry": "Jelling Meatloaf Melt"},
    {"name": "Ate-Oh-Ate", "neighborhood": "Buckman", "entry": "Paniolo Burger"},
    {"name": "Ate-Oh-Ate", "neighborhood": "Southeast Portland", "entry": "Paniolo Burger"},
    {"name": "Ate-Oh-Ate", "neighborhood": "Beaverton", "entry": "Paniolo Burger"},
    {"name": "Bacchus Bar", "neighborhood": "Southwest Portland", "entry": "Cascade Heat"},
    {"name": "Bar Bar", "neighborhood": "North Portland", "entry": "Heart and Soul"},
    {"name": "Barbur World Foods", "neighborhood": "Southwest Portland", "entry": "Beirut Smokeshow"},
    {"name": "Bergy's Burgers", "neighborhood": "Sunnyside", "entry": "Maple Barger"},
    {"name": "Besaw's", "neighborhood": "Northwest Portland", "entry": "1903 Burger"},
    {"name": "Big's Chicken", "neighborhood": "North Tabor", "entry": "Smoked Out Smash"},
    {"name": "Binary Brewing", "neighborhood": "Beaverton", "entry": "Teriyakimoto's Shu Mai Sliders"},
    {"name": "Birdie Time Pub", "neighborhood": "Buckman", "entry": "It's alive! Pearenstein Burger"},
    {"name": "Bless Your Heart Burgers", "entry": "The Smoke Show"},
    {"name": "Bless Your Heart Burgers", "neighborhood": "Vancouver", "entry": "The Smoke Show"},
    {"name": "Boke Bowl", "neighborhood": "Buckman", "entry": "Sweet Chile of Mine Burger"},
    {"name": "Botto's BBQ", "neighborhood": "Southeast Portland", "entry": "Mont Dew Burger"},
    {"name": "Breaking Buns @ Alchemy Cider", "neighborhood": "Buckman", "entry": "The Cleveland Steamer"},
    {"name": "Breakside Brewery - Slabtown", "neighborhood": "Northwest Portland", "entry": "The Big Dill"},
    {"name": "Brix Tavern", "neighborhood": "Pearl District", "entry": "Service Mushroom Swiss Burger"},
    {"name": "Bunk Bar", "neighborhood": "Buckman", "entry": "French Onion Juicy Lucy"},
    {"name": "Cecilia", "neighborhood": "Vancouver", "entry": "Aloha, Neighbor"},
    {"name": "Clarklewis", "neighborhood": "Buckman", "entry": "The Cascadian"},
    {"name": "Creepy's", "neighborhood": "Buckman", "entry": "Okely-Dokely"},
    {"name": "Daily Planet", "neighborhood": "Powellhurst-Gilbert", "entry": "The Cherry Bomb Burger"},
    {"name": "DC Vegetarian", "neighborhood": "Richmond", "entry": "The BBQ Chicken Bacon Cheese Burger (It's a Mouthful)"},
    {"name": "Deschutes Brewery & Public House", "neighborhood": "Northwest Portland", "entry": "What the Elk?"},
    {"name": "Dimo's Italian Specialties", "neighborhood": "Kerns", "entry": "Cacio e Pepe Burger"},
    {"name": "Double Barrel Tavern", "neighborhood": "Hosford-Abernethy", "entry": "The Cowboy Vacation"},
    {"name": "Duke's Public House", "neighborhood": "Lake Oswego", "entry": "Let 'Em Hatch"},
    {"name": "Farmer and the Beast", "neighborhood": "Nob Hill", "entry": "Southern Beast"},
    {"name": "Farmer and the Beast @ Breakside Dekum", "neighborhood": "Woodlawn", "entry": "Southern Beast", "chain": "Farmer and the Beast"},
    {"name": "Fresh N' Funky", "neighborhood": "Woodstock", "entry": "My Blue Heaven"},
    {"name": "Fuller's Burger Shack", "neighborhood": "Northeast Portland", "entry": "Backyard BBQ Burger"},
    {"name": "Fuller's Coffee Shop", "neighborhood": "Pearl District", "entry": "Fuller's Breakfast Burger"},
    {"name": "Gift Public House", "neighborhood": "Hawthorne District", "entry": "Flamingo Thrash"},
    {"name": "Gold Dust Meridian", "neighborhood": "Sunnyside", "entry": "Tortitas de Papa Burger"},
    {"name": "Grand Fir Brewing", "neighborhood": "Buckman", "entry": "Out and In Burger"},
    {"name": "Grassa", "neighborhood": "Hawthorne District", "entry": "Meatball Burger"},
    {"name": "Grays Restaurant and Bar", "neighborhood": "Vancouver", "entry": "Wipe Your Mouth Burger"},
    {"name": "Hawker Station PDX", "neighborhood": "Buckman", "entry": "Black Pepper Burger"},
    {"name": "Haymaker", "neighborhood": "Overlook", "entry": "The Ricotta Rocket"},
    {"name": "Hopworks Brewery", "neighborhood": "Creston - Kenilworth", "entry": "Big Kahuna Burger"},
    {"name": "Hunker Down", "neighborhood": "Mount Tabor", "entry": "The Last Jalapeño Burger"},
    {"name": "Hunny Beez", "neighborhood": "Downtown Portland", "entry": "CowboyBeez Burger"},
    {"name": "Iron Strike Smash Burgers at Midtown Beer Garden", "neighborhood": "Downtown Portland", "entry": "Pastrami Thor Smash Burger"},
    {"name": "John's Marketplace", "neighborhood": "Creston - Kenilworth", "entry": "Blackberry Bramble Smash"},
    {"name": "Kelly's Olympian", "neighborhood": "Downtown Portland", "entry": "The Zesty Pomme"},
    {"name": "Killer Burger", "neighborhood": "Southwest Portland", "entry": "Full Meltdown"},
    {"name": "Kingston Bar and Grill", "neighborhood": "Goose Hollow", "entry": "Fiesta Kingston Burger"},
    {"name": "Kooks Sports Bar", "neighborhood": "Boise", "entry": "Sweet n Spicy Burger"},
    {"name": "Lardo", "neighborhood": "Ladd's Addition", "entry": "Piggy Smalls"},
    {"name": "Lariat Lounge", "neighborhood": "Southeast Portland", "entry": "Elote Smash"},
    {"name": "Lay Low Tavern", "neighborhood": "South Tabor", "entry": "Club 21 Juicy Lucy"},
    {"name": "Lazy Days Brewing", "neighborhood": "Eliot", "entry": "But What About Second Breakfast?"},
    {"name": "Lazy Days Brewing - Beaverton", "neighborhood": "Beaverton", "entry": "Watson That Burger"},
    {"name": "Lone Star Burger Bar", "neighborhood": "Vernon", "entry": "Smashburgesa"},
    {"name": "Loowit Brewing - Downtown Pub", "neighborhood": "Vancouver", "entry": "Calimshan Cure"},
    {"name": "Love Eatz SmashBurger", "neighborhood": "Tigard", "entry": "Volcano Burger"},
    {"name": "Loyal Legion", "neighborhood": "Buckman", "entry": "The Loyal Stinger"},
    {"name": "Metropolitan Tavern", "neighborhood": "Lloyd District", "entry": "Roasted Poblano Burger"},
    {"name": "MidCity SmashedBurger @ Level Beer 1", "neighborhood": "Argay", "entry": "The Hatch Green Chile Bacon Burger", "chain": "MidCity SmashedBurger"},
    {"name": "MidCity SmashedBurger @ Level Beer 3", "neighborhood": "Kerns", "entry": "The Hatch Green Chile Bacon Burger", "chain": "MidCity SmashedBurger"},
    {"name": "MidCity SmashedBurger @ Prost! Marketplace", "neighborhood": "Boise", "entry": "The Hatch Green Chile Bacon Burger", "chain": "MidCity SmashedBurger"},
    {"name": "MidCity SmashedBurger @ Uptown Beer", "neighborhood": "Beaverton", "entry": "The Hatch Green Chile Bacon Burger", "chain": "MidCity SmashedBurger"},
    {"name": "Migration Brewing", "neighborhood": "Boise", "entry": "Summer Maxxing Burger"},
    {"name": "Migration Brewing Co.", "neighborhood": "Kerns", "entry": "The Hot Marion"},
    {"name": "Mirisata", "neighborhood": "Buckman", "entry": "The Deviled Burger"},
    {"name": "Moreland Ale House", "neighborhood": "Southeast Portland", "entry": "Yee Haw Burger"},
    {"name": "Next Level Veggie Grill", "neighborhood": "Sunnyside", "entry": "Smoky Mountain BBQ Chik'n Burger", "chain": "Veggie Grill"},
    {"name": "Nicholas Restaurant", "neighborhood": "Buckman", "entry": "Lebanese Lamb Burger"},
    {"name": "Nick's Famous Coney Island", "neighborhood": "Richmond", "entry": "Hamburguesa with Crunch"},
    {"name": "Nom Nom Wings", "neighborhood": "Pearl District", "entry": "Kathmandu Midnight Special"},
    {"name": "Northport", "neighborhood": "Kenton", "entry": "LA CUSQUEÑA"},
    {"name": "Pacific Standard", "neighborhood": "Kerns", "entry": "The French Connection"},
    {"name": "Pambiche", "neighborhood": "Kerns", "entry": "Papi's Chorizo Burger"},
    {"name": "Papa Haydn (East)", "neighborhood": "Southeast Portland", "entry": "Onion Ring BBQ Burger", "chain": "Papa Haydn"},
    {"name": "Papa Haydn (West)", "neighborhood": "Northwest Portland", "entry": "Seoul Burger", "chain": "Papa Haydn"},
    {"name": "Paymaster Lounge", "neighborhood": "Northwest Portland", "entry": "Magic Dust Burger"},
    {"name": "PLS on Sixth", "neighborhood": "Downtown Portland", "entry": "The Shaggy"},
    {"name": "Podnah's Pit Barbecue", "neighborhood": "Vernon", "entry": "Paris Texas"},
    {"name": "Portland Burger", "neighborhood": "Southwest Portland", "entry": "Mambo #5 (A little bit of Mango in my life)"},
    {"name": "Prime Tap House: West End District", "neighborhood": "Beaverton", "entry": "The Bangkok Smash: Thai Peanut Burger"},
    {"name": "Reverend's BBQ", "neighborhood": "Southeast Portland", "entry": "The Dom"},
    {"name": "River Pig Saloon", "neighborhood": "Northwest Portland", "entry": "Notorious P.I.G."},
    {"name": "Sad Valley", "neighborhood": "Humboldt", "entry": "Lord Sourdough"},
    {"name": "Salvador Molly's", "neighborhood": "Southwest Portland", "entry": "Bélé"},
    {"name": "Sandy-O's", "neighborhood": "Parkrose Heights", "entry": "The Filthy Cowboy"},
    {"name": "Say When", "neighborhood": "Nob Hill", "entry": "French Onion Soup Burger"},
    {"name": "Show Bar", "neighborhood": "Buckman", "entry": "Bloody Mary Burger"},
    {"name": "Side Eye", "neighborhood": "Nob Hill", "entry": "El Royale Picante"},
    {"name": "Solo Club", "neighborhood": "Northwest Portland", "entry": "Nutflix and Grill Burger"},
    {"name": "Space Room", "neighborhood": "Richmond", "entry": "Canadian Tuxedo Burger"},
    {"name": "Spoke & Fork", "neighborhood": "Lloyd District", "entry": "The Kimchi Smash Burger"},
    {"name": "Steakadelphia", "neighborhood": "South Tabor", "entry": "Kyler"},
    {"name": "Steely's", "neighborhood": "Hawthorne District", "entry": "Sweet Cowboy"},
    {"name": "Steeplejack Brewing Co.", "neighborhood": "Sullivan's Gulch", "entry": "Thai One On"},
    {"name": "SuperDeluxe", "neighborhood": "Richmond", "entry": "Nacho Deluxe"},
    {"name": "Sweet Home Bar & Grill", "neighborhood": "North Portland", "entry": "Poutine Burger"},
    {"name": "Taylor Street Tavern", "neighborhood": "Downtown Portland", "entry": "Black Angus Burger with Green Chili Pork Chorizo"},
    {"name": "The Bulgarian Job", "neighborhood": "Rose City Park", "entry": "Balkan Dreams Burger"},
    {"name": "The Diner Vancouver", "neighborhood": "Vancouver", "entry": "The Pastrami Burger"},
    {"name": "The Italian Job", "neighborhood": "Richmond", "entry": "Garlic Knot alla Gricia Burger"},
    {"name": "The Oaks Pub", "neighborhood": "Southeast Portland", "entry": "The Bomb Burger"},
    {"name": "The Office Bar", "neighborhood": "Milwaukie", "entry": "The Sweet Heat Burger"},
    {"name": "The Sandy Jug", "neighborhood": "Roseway", "entry": "Summer Sungold Sandy"},
    {"name": "The Secret Pizza Society", "neighborhood": "Montavilla", "entry": "Rhaenyra's Reign"},
    {"name": "Three Mermaids Public House", "neighborhood": "Tigard", "entry": "The Chorizo Guac Burger"},
    {"name": "Urban Farmer", "neighborhood": "Southwest Portland", "entry": "French Onion Smash Burger"},
    {"name": "Veggie Grill by Next Level", "neighborhood": "Southwest Portland", "entry": "Smoky Mountain BBQ Chik'n Burger", "chain": "Veggie Grill"},
    {"name": "Veggie Grill - Cedar Hills Crossing", "neighborhood": "Beaverton", "entry": "Smoky Mountain BBQ Chik'n Burger", "chain": "Veggie Grill"},
    {"name": "Von Ebert Brewing Glendoveer + Kitchen", "neighborhood": "East Portland", "entry": "The Big Popper"},
    {"name": "Wayfinder Beer", "neighborhood": "Buckman", "entry": "The Forbidden Snack"},
    {"name": "White Owl Social Club", "neighborhood": "Buckman", "entry": "Down the Hatch Burger"},
    {"name": "Wolf's Head Portland", "neighborhood": "Central Eastside", "entry": "The Sleepover Burger"},
    {"name": "Wonderboy's Smokestack", "neighborhood": "King", "entry": "Tribute"},
    {"name": "World Foods", "neighborhood": "Northwest Portland", "entry": "The Herban Legend"},
    {"name": "Wow Cow", "neighborhood": "Tigard", "entry": "Tteok Kalbi Korean Philly Burger"},
    {"name": "Ya Hala", "neighborhood": "Montavilla", "entry": "Double Toum Tawook"},
  ]
};

/* ---- Helpers (used by events.html + drawer badge) ---- */

/* Case/whitespace-insensitive match against the participating list. */
/* ---- Chain grouping ----
   Some entries share a `chain` override (set on the entries above) because
   the Mercury's list names the same brand differently per location — e.g.
   four "MidCity SmashedBurger @ <bar>" entries. Entries with no `chain`
   field are their own single-location chain (chain === their own name).
   This is what makes a McDonald's-style chain render as ONE card and
   count as ONE spot toward the trophy, no matter how many locations
   someone actually reviews. */

/* One group per distinct chain, each carrying every location under it. */
function bwGroupedRestaurants(){
  const groups = new Map(); // key: lowercased chain name -> group
  BURGER_WEEK.restaurants.forEach(r => {
    const chainName = (r.chain || r.name).trim();
    const key = chainName.toLowerCase();
    if(!groups.has(key)) groups.set(key, { name: chainName, locations: [] });
    groups.get(key).locations.push({ name: r.name, neighborhood: r.neighborhood || '', entry: r.entry || '' });
  });
  return Array.from(groups.values());
}

/* Canonical (lowercased) chain key for any raw restaurant name from the
   list. Falls back to the name itself if it's not on the list at all —
   bwIsParticipant() is what actually gates whether it counts. */
function bwChainKeyFor(rawName){
  if(!rawName) return '';
  const n = rawName.trim().toLowerCase();
  const hit = BURGER_WEEK.restaurants.find(r => r.name.trim().toLowerCase() === n);
  if(hit) return (hit.chain || hit.name).trim().toLowerCase();
  return n;
}

/* Matches either an exact per-location name from the source list, OR the
   chain's canonical display name directly (so "MidCity SmashedBurger"
   with no venue suffix still counts, even though that exact string never
   appears in the raw list). */
function bwIsParticipant(reviewName){
  if(!reviewName) return false;
  const n = reviewName.trim().toLowerCase();
  const rawHit = BURGER_WEEK.restaurants.some(r => r.name.trim().toLowerCase() === n);
  if(rawHit) return true;
  return bwGroupedRestaurants().some(g => g.name.trim().toLowerCase() === n);
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

/* Distinct CHAINS a given contributor has covered during the window —
   reviewing three different locations of the same chain counts as one
   spot, not three. This is what the badge threshold checks. */
function bwCoverageFor(allReviews, st){
  const mine = (typeof myReviews === 'function') ? myReviews(st) : [];
  const entries = bwEntries(mine);
  return new Set(entries.map(r => bwChainKeyFor(r.name)));
}

function bwHasBadge(allReviews, st){
  return bwCoverageFor(allReviews, st).size >= 1;
}

/* True if the contributor has already reached the top of the site-wide
   Rank ladder (Burger Master — see RANKS in drawer.js). Reaching the top
   rank on its own earns the trophy, no need to also hit the spot count.
   Depends on drawer.js having loaded (rankFor/RANKS on window); safe here
   because this only runs after the page's full script chain has executed. */
function bwHasTopRank(st){
  if(!st || !st.signedIn) return false;
  if(typeof window.rankFor !== 'function' || !window.RANKS || !window.RANKS.length) return false;
  const mine = (typeof myReviews === 'function') ? myReviews(st) : [];
  const top = window.RANKS[window.RANKS.length - 1]; // 'Burger Master'
  const current = window.rankFor(mine.length);
  return !!current && current.name === top.name;
}

function bwHasTrophy(allReviews, st){
  return bwCoverageFor(allReviews, st).size >= BURGER_WEEK.trophyThreshold || bwHasTopRank(st);
}

/* Single source of truth for which case slot to show as earned. */
function bwTier(allReviews, st){
  if(bwHasTrophy(allReviews, st)) return 'trophy';
  if(bwHasBadge(allReviews, st)) return 'badge';
  return 'none';
}
