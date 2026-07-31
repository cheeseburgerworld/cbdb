/* ============================================================
   CB⚡DB — Events registry (evergreen)

   How the evergreen part actually works: when a review is created,
   netlify/functions/auth-proxy.js fetches the world.cheeseburger.event
   record from CBDB's own PDS (cached, 5 min TTL) and checks it against
   the review's restaurant + createdAt, stamping a permanent `event`
   column on the Supabase row — e.g. 'PDXBW26'. That happens ONCE,
   at write time.

   Everything in THIS file reads that stored tag, nothing else. No
   date-window checks, no restaurant-name matching, at badge-check
   time — same pattern as the Rank ladder in drawer.js, which just
   counts stored reviews. That's what makes it evergreen: a badge
   earned today is still correctly computed next year even if this
   page has been completely rebuilt for a different event, because
   the tag lives permanently on the reviews table, not on the page.

   SOURCE OF TRUTH for dates + restaurant list is now the PDS record
   (lexicons/world/cheeseburger/event.json), published once via
   scripts/setup-burger-week-event.mjs — not this file and not
   auth-proxy.js's fallback list. The `restaurants` array below is
   DISPLAY DATA ONLY for the grid/chain-grouping on events.html; it's
   a point-in-time copy from setup time, not something the matching
   logic depends on. If you edit the restaurant list after setup,
   edit the PDS record (re-run the setup script) — this file is
   cosmetic from that point on.

   Requires (one-time setup, see each file's header for details):
     - migration-add-event-column.sql        (adds the `event` column)
     - scripts/setup-burger-week-event.mjs    (publishes the PDS record)
     - a signed-in session for the issuer DID (enables badge.award issuance)
   All three should be done before Aug 10.
   ============================================================ */

const EVENTS = {
  PDXBW26: {
    id: 'PDXBW26',
    name: 'Portland Burger Week 2026',
    shortName: 'Burger Week',
    city: 'Portland',
    host: 'Portland Mercury',
    hostUrl: 'https://everout.com/portland/events/the-portland-mercurys-burger-week-2026/e222750/',
    start: '2026-08-10',
    end: '2026-08-16',

    // Three-tier recognition, each a straight count of THIS event's
    // tagged reviews — no distinct-restaurant logic, no rating logic:
    //   BADGE     — 1 review.  "PDX Burger Week 2026"
    //   CHAMPION  — 3 reviews. "PDX Burger Week 2026 Champion"
    //   WINNER    — 7 reviews. "PDX Burger Week 2026 Winner" — ultra rare,
    //               a review a day for the whole week (or doubling up).
    // Display metadata (emoji/overlay/rare/playfulCopy) is presentation
    // only — it doesn't need to be portable, so it's not in the PDS
    // event record, just here for events.html to render.
    badgeThreshold:    1,
    championThreshold: 3,
    winnerThreshold:   7,
    tierDisplay: {
      badge:    { name: 'PDX Burger Week 2026',          emoji: '🏅' },
      champion: { name: 'PDX Burger Week 2026 Champion', emoji: '🏆', overlay: '🍔' },
      winner:   { name: 'PDX Burger Week 2026 Winner',   emoji: '🏆', overlay: '⚡', rare: true,
                  playfulCopy: "A burger a day. You've won Burger Week 2026." },
    },

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
  }

  // Future events go here, each with its own id/dates/restaurant list.
  // The id is what auth-proxy.js stamps on new rows, so pick it there
  // first, then mirror it here. Examples:
  // SEABW26: { id: 'SEABW26', name: 'Seattle Burger Week 2026', ... },
  // PDXBW27: { id: 'PDXBW27', name: 'Portland Burger Week 2027', ... },
};

// Which event events.html currently spotlights. When Burger Week wraps
// and you rebuild this page for the next event, this is the one line to
// swap — every helper below works for any event id without changes.
const ACTIVE_EVENT_ID = 'PDXBW26';

/* ---- Evergreen gamification ----
   Reads ONLY the stored `event` tag on each review row. See the header
   comment above for why that's what makes this evergreen. */

/* This contributor's reviews tagged for a given event. */
function evEntriesFor(st, eventId){
  const mine = (typeof myReviews === 'function') ? myReviews(st) : [];
  return mine.filter(r => r.event === eventId);
}

function evHasBadge(st, eventId){
  const ev = EVENTS[eventId];
  if(!ev) return false;
  return evEntriesFor(st, eventId).length >= ev.badgeThreshold;
}

function evHasChampion(st, eventId){
  const ev = EVENTS[eventId];
  if(!ev) return false;
  return evEntriesFor(st, eventId).length >= ev.championThreshold;
}

function evHasWinner(st, eventId){
  const ev = EVENTS[eventId];
  if(!ev) return false;
  return evEntriesFor(st, eventId).length >= ev.winnerThreshold;
}

/* ---- Restaurant list helpers (DISPLAY ONLY — never used for badge math) ----
   Purely for the "124 spots, here's who's on the list, here's who's been
   reviewed" grid. Matching by name is inherently fuzzier than the stored
   event tag, which is exactly why gamification above never touches these. */

function evGroupedRestaurants(eventId){
  const ev = EVENTS[eventId];
  if(!ev) return [];
  const groups = new Map();
  ev.restaurants.forEach(r => {
    const chainName = (r.chain || r.name).trim();
    const key = chainName.toLowerCase();
    if(!groups.has(key)) groups.set(key, { name: chainName, locations: [] });
    groups.get(key).locations.push({ name: r.name, neighborhood: r.neighborhood || '', entry: r.entry || '' });
  });
  return Array.from(groups.values());
}

function evChainKeyFor(eventId, rawName){
  const ev = EVENTS[eventId];
  if(!ev || !rawName) return '';
  const n = rawName.trim().toLowerCase();
  const hit = ev.restaurants.find(r => r.name.trim().toLowerCase() === n);
  if(hit) return (hit.chain || hit.name).trim().toLowerCase();
  return n;
}
