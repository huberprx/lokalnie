/**
 * Weryfikacja Google ID Token (OIDC): podpis JWKS + claimy.
 */

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: null, fetchedAt: 0 };

function base64UrlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToText(str) {
  return new TextDecoder().decode(base64UrlToBytes(str));
}

function parseJwtParts(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("invalid_id_token_format");
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlToText(parts[0]));
    payload = JSON.parse(base64UrlToText(parts[1]));
  } catch {
    throw new Error("invalid_id_token_json");
  }
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

/** Walidacja claimów (bez podpisu) — eksportowana pod testy. */
export function assertGoogleIdTokenClaims(payload, { clientId, nonce, nowMs = Date.now() } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_id_token_payload");
  if (!payload.sub) throw new Error("missing_sub");
  if (!GOOGLE_ISSUERS.has(String(payload.iss || ""))) throw new Error("invalid_iss");

  const audience = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud || "")];
  if (!clientId || !audience.includes(String(clientId))) throw new Error("invalid_aud");

  const expMs = Number(payload.exp) * 1000;
  if (!Number.isFinite(expMs) || expMs <= nowMs) throw new Error("id_token_expired");

  if (nonce != null && nonce !== "") {
    if (String(payload.nonce || "") !== String(nonce)) throw new Error("invalid_nonce");
  }

  return payload;
}

async function fetchGoogleJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("jwks_fetch_failed");
  const data = await res.json();
  if (!data || !Array.isArray(data.keys)) throw new Error("jwks_invalid");
  jwksCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

/** Reset cache JWKS (testy). */
export function resetGoogleJwksCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
}

async function importRsaKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifyJwtSignature(header, signingInput, signatureB64, keys) {
  if (header.alg !== "RS256") throw new Error("unsupported_id_token_alg");
  const kid = header.kid;
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  if (!candidates.length) throw new Error("jwks_key_missing");

  const data = new TextEncoder().encode(signingInput);
  const signature = base64UrlToBytes(signatureB64);
  for (const jwk of candidates) {
    try {
      const key = await importRsaKey(jwk);
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
      if (ok) return true;
    } catch {
      /* try next key */
    }
  }
  throw new Error("invalid_id_token_signature");
}

/**
 * Pełna weryfikacja Google ID Token.
 * @returns {Promise<object>} zweryfikowany payload
 */
export async function verifyGoogleIdToken(idToken, { clientId, nonce, nowMs = Date.now() } = {}) {
  const { header, payload, signingInput, signature } = parseJwtParts(idToken);
  assertGoogleIdTokenClaims(payload, { clientId, nonce, nowMs });
  const keys = await fetchGoogleJwks();
  await verifyJwtSignature(header, signingInput, signature, keys);
  return payload;
}
