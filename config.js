// ── CB⚡DB CONFIG ─────────────────────────────────────────────────────────────
// Single source of truth. Update handles here — takes effect everywhere.
// Format: lowercase, no @, exact handle as it appears on Bluesky.

const APPROVED = new Set([
    'cheeseburger.world',
    'ash.cheeseburger.world',
    'ratbrigade.bsky.social',
    'alleyhector.bsky.social',
    'hacer.bsky.social',
    'burgernotomato.bsky.social',
    // add new approved contributors above this line
]);

const BSKY_API    = 'https://public.api.bsky.app/xrpc';
const FETCH_LIMIT = 100;
