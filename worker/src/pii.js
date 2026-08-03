/**
 * Field-level encryption for phone numbers (AES-GCM).
 * Stored form: enc:v1:<base64url(iv || ciphertext)>
 * Legacy plaintext (no prefix) is still readable until rewritten.
 */

const PREFIX = "enc:v1:";

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded =
    String(value).replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (String(value).length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function piiSecret(env) {
  return String(env?.PII_ENCRYPTION_KEY || "").trim();
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(secret)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedPhone(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt plaintext phone for D1 storage. No-op when key unset or value empty. */
export async function encryptPhone(plain, env) {
  if (plain == null || plain === "") return null;
  const text = String(plain);
  if (isEncryptedPhone(text)) return text;
  const secret = piiSecret(env);
  if (!secret) return text;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(text)
  );
  const payload = new Uint8Array(iv.length + encrypted.byteLength);
  payload.set(iv);
  payload.set(new Uint8Array(encrypted), iv.length);
  return PREFIX + base64UrlEncode(payload);
}

/** Decrypt stored phone for API responses. Legacy plaintext passes through. */
export async function decryptPhone(stored, env) {
  if (stored == null || stored === "") return stored ?? null;
  const value = String(stored);
  if (!isEncryptedPhone(value)) return value;

  const secret = piiSecret(env);
  if (!secret) return null;

  try {
    const bytes = base64UrlDecode(value.slice(PREFIX.length));
    const iv = bytes.slice(0, 12);
    const encrypted = bytes.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(secret),
      encrypted
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
