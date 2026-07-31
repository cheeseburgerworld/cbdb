// netlify/functions/_badge-issuer.js
//
// A separate, deliberately simple auth path for CBDB's badge-issuer
// account (@cheeseburger.world). NOT the DPoP/OAuth flow in _auth-utils.js
// — that's built for writing on a logged-in REVIEWER's behalf, where a
// human went through consent. This account is CBDB's own; there's no user
// in the loop, so a plain app-password session is the right tool: one
// login call, a bearer token, no DPoP proof-building, no refresh-token
// juggling. Simpler code for a case that doesn't need OAuth's guarantees.
//
// Requires two env vars (set in Netlify):
//   CBDB_ISSUER_HANDLE        — 'cheeseburger.world'
//   CBDB_ISSUER_APP_PASSWORD  — an app password created FOR THAT ACCOUNT
//                                (Bluesky Settings -> App Passwords, while
//                                signed in as @cheeseburger.world, not a
//                                personal account)

let cached = null; // { did, accessJwt, pdsUrl, expiresAt } — reused across warm invocations only; a cold start just logs in again, which is cheap and harmless

function issuerHandle() {
  return typeof Deno !== 'undefined'
    ? Deno.env.get('CBDB_ISSUER_HANDLE')
    : process.env.CBDB_ISSUER_HANDLE;
}
function issuerAppPassword() {
  return typeof Deno !== 'undefined'
    ? Deno.env.get('CBDB_ISSUER_APP_PASSWORD')
    : process.env.CBDB_ISSUER_APP_PASSWORD;
}

// Same PDS-resolution logic as auth-proxy.js's resolvePDS — duplicated
// (not imported) so this file stays fully standalone, per its whole point.
async function resolveIssuerPDS(did) {
  try {
    if (did.startsWith('did:plc:')) {
      const res = await fetch(`https://plc.directory/${did}`);
      if (res.ok) {
        const doc = await res.json();
        const svc = doc.service?.find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
        if (svc?.serviceEndpoint) return svc.serviceEndpoint;
      }
    } else if (did.startsWith('did:web:')) {
      return `https://${did.slice('did:web:'.length)}`;
    }
  } catch {}
  return 'https://bsky.social'; // fallback, not an assumption — most accounts are hosted here anyway
}

async function getIssuerSession() {
  if (cached && cached.expiresAt > Date.now()) return cached;

  const handle = issuerHandle();
  const password = issuerAppPassword();
  if (!handle || !password) {
    throw new Error('CBDB_ISSUER_HANDLE / CBDB_ISSUER_APP_PASSWORD env vars are not set');
  }

  const res = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!res.ok) throw new Error(`Issuer login failed (${res.status}): ${await res.text()}`);
  const data = await res.json(); // { did, accessJwt, refreshJwt, ... }

  const pdsUrl = await resolveIssuerPDS(data.did);

  cached = {
    did:       data.did,
    accessJwt: data.accessJwt,
    pdsUrl,
    expiresAt: Date.now() + 1000 * 60 * 50, // refresh well before the ~2hr token expiry
  };
  return cached;
}

// Simple authenticated request — app-password sessions use a plain Bearer
// token, no DPoP proof needed. `xrpcMethod` is the NSID, e.g.
// 'com.atproto.repo.putRecord'.
export async function issuerRequest(method, xrpcMethod, body, _retried = false) {
  const session = await getIssuerSession();
  const res = await fetch(`${session.pdsUrl}/xrpc/${xrpcMethod}`, {
    method,
    headers: {
      Authorization:  `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // A stale cached token (e.g. revoked, or clock drift past our 50-min
    // guess) shows up as a 401 here. Exactly one retry with a forced fresh
    // login covers that without needing real refresh-token handling — if
    // the retry ALSO 401s, that's a real auth problem, not staleness, so
    // it throws instead of looping.
    if (res.status === 401 && cached && !_retried) {
      cached = null;
      return issuerRequest(method, xrpcMethod, body, true);
    }
    throw new Error(`Issuer request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function getIssuerDid() {
  const session = await getIssuerSession();
  return session.did;
}

// Uploads raw image bytes as a blob, authenticated as the issuer. Mirrors
// auth-proxy.js's doUploadBlob — same com.atproto.repo.uploadBlob call,
// just with a plain Bearer token instead of a DPoP proof. `bytes` must be
// a Uint8Array (or Buffer); returns the blob ref object to embed directly
// as a record's `image` field, e.g. { $type:'blob', ref:{ $link:'bafk...' }, mimeType, size }.
export async function issuerUploadBlob(bytes, mimeType, _retried = false) {
  const session = await getIssuerSession();
  const res = await fetch(`${session.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${session.accessJwt}`,
      'Content-Type': mimeType,
    },
    body: bytes,
  });
  if (!res.ok) {
    if (res.status === 401 && cached && !_retried) {
      cached = null;
      return issuerUploadBlob(bytes, mimeType, true);
    }
    throw new Error(`Issuer blob upload failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.blob; // { $type:'blob', ref:{ $link }, mimeType, size }
}
