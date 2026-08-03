const STATIC_ORIGINS = new Set([
  "https://lokalnie.app",
  "https://www.lokalnie.app",
]);
const LOCAL_ORIGINS = new Set(["http://localhost:8080", "http://127.0.0.1:8080"]);
export const MAX_JSON_BYTES = 64 * 1024;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers });
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = new Set(STATIC_ORIGINS);
  const appOrigin = String(env?.APP_ORIGIN || "").replace(/\/+$/, "");
  if (appOrigin) allowed.add(appOrigin);
  if (env?.ENVIRONMENT !== "production" || LOCAL_ORIGINS.has(appOrigin)) {
    for (const localOrigin of LOCAL_ORIGINS) allowed.add(localOrigin);
  }
  return allowed.has(origin);
}

export function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  headers.set("Vary", appendVary(headers.get("Vary"), "Origin"));
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Demo-User, Idempotency-Key"
  );
  if (isAllowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function preflight(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin, env)) {
    return withCors(json({ error: "origin_not_allowed" }, 403), request, env);
  }
  return withCors(noContent(), request, env);
}

function appendVary(current, value) {
  const values = new Set(
    String(current || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  values.add(value);
  return [...values].join(", ");
}

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "body_too_large");
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new HttpError(413, "body_too_large");
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return null;
  }
}

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function parseJsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
