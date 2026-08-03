import { id, nowIso } from "./http.js";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TIME_ZONE = "Europe/Warsaw";

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - String(value).length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret) {
  if (!secret) throw new Error("calendar_token_key_missing");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(secret)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(String(token))
  );
  const payload = new Uint8Array(iv.length + encrypted.byteLength);
  payload.set(iv);
  payload.set(new Uint8Array(encrypted), iv.length);
  return base64UrlEncode(payload);
}

export async function decryptToken(payload, secret) {
  if (!payload) return "";
  const bytes = base64UrlDecode(payload);
  const iv = bytes.slice(0, 12);
  const encrypted = bytes.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    encrypted
  );
  return new TextDecoder().decode(plain);
}

function localDateTimeToUtc(dateISO, time) {
  const [year, month, day] = String(dateISO).split("-").map(Number);
  const [hour, minute] = String(time || "00:00").slice(0, 5).split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayed = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return new Date(target - (displayed - target)).toISOString();
}

function googleDateTime(dateISO, time) {
  return {
    dateTime: localDateTimeToUtc(dateISO, time),
    timeZone: TIME_ZONE,
  };
}

function eventBody(booking, provider) {
  let serviceNames = [];
  try {
    serviceNames = JSON.parse(booking.service_names_json || "[]");
  } catch {
    serviceNames = [];
  }
  const services = Array.isArray(serviceNames) && serviceNames.length
    ? serviceNames.join(", ")
    : "Wizyta";
  const providerName = provider?.name || "Lokalnie";
  const location = booking.location_label || provider?.address || "";
  return {
    summary: `${services} · ${providerName}`,
    description: [
      `Usługodawca: ${providerName}`,
      services ? `Usługa: ${services}` : "",
      `Rezerwacja Lokalnie: ${booking.id}`,
    ].filter(Boolean).join("\n"),
    ...(location ? { location } : {}),
    start: googleDateTime(booking.date_iso, booking.time_from),
    end: googleDateTime(booking.date_iso, booking.time_to || booking.time_from),
    visibility: "private",
    reminders: { useDefault: true },
    extendedProperties: { private: { lokalnieBookingId: booking.id } },
  };
}

async function exchangeRefreshToken(refreshToken, env) {
  const body = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID || ""),
    client_secret: String(env.GOOGLE_CLIENT_SECRET || ""),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "google_token_refresh_failed");
  }
  return data;
}

async function getAccessToken(connection, env) {
  const expiresAt = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (connection.encrypted_access_token && expiresAt > Date.now() + 60_000) {
    return decryptToken(connection.encrypted_access_token, env.GOOGLE_CALENDAR_TOKEN_KEY);
  }

  const refreshToken = await decryptToken(connection.encrypted_refresh_token, env.GOOGLE_CALENDAR_TOKEN_KEY);
  const tokens = await exchangeRefreshToken(refreshToken, env);
  const expires = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE calendar_connections
     SET encrypted_access_token=?, token_expires_at=?, status='connected', last_error=NULL, updated_at=?
     WHERE id=?`
  ).bind(
    await encryptToken(tokens.access_token, env.GOOGLE_CALENDAR_TOKEN_KEY),
    expires,
    nowIso(),
    connection.id
  ).run();
  return tokens.access_token;
}

async function googleRequest(connection, env, path, options = {}, retry = true) {
  const accessToken = await getAccessToken(connection, env);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && retry) {
    connection.token_expires_at = new Date(0).toISOString();
    await env.DB.prepare(
      "UPDATE calendar_connections SET token_expires_at=?, updated_at=? WHERE id=?"
    ).bind(new Date(0).toISOString(), nowIso(), connection.id).run();
    return googleRequest(connection, env, path, options, false);
  }
  return response;
}

async function markConnectionError(env, connectionId, error) {
  await env.DB.prepare(
    `UPDATE calendar_connections
     SET status='error', last_error=?, updated_at=?
     WHERE id=?`
  ).bind(String(error?.message || error).slice(0, 500), nowIso(), connectionId).run();
}

export async function listCalendarConnections(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT id, provider, calendar_id, status, last_error, connected_at, updated_at
     FROM calendar_connections WHERE user_id=? ORDER BY connected_at`
  ).bind(userId).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    provider: row.provider,
    calendarId: row.calendar_id,
    status: row.status,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  }));
}

export async function disconnectCalendar(env, userId, connectionId) {
  const connection = await env.DB.prepare(
    "SELECT * FROM calendar_connections WHERE id=? AND user_id=?"
  ).bind(connectionId, userId).first();
  if (!connection) return false;
  await env.DB.prepare("DELETE FROM calendar_connections WHERE id=?").bind(connection.id).run();
  return true;
}

export async function syncBookingToGoogle(env, bookingId) {
  const row = await env.DB.prepare(
    `SELECT b.*, p.name AS provider_name, p.address AS provider_address
     FROM bookings b
     LEFT JOIN provider_profiles p ON p.id=b.provider_id
     WHERE b.id=?`
  ).bind(bookingId).first();
  if (!row || !row.client_user_id) return { connected: false, skipped: true };

  const connection = await env.DB.prepare(
    `SELECT * FROM calendar_connections
     WHERE user_id=? AND provider='google' AND status <> 'revoked'`
  ).bind(row.client_user_id).first();
  if (!connection) return { connected: false, synced: false };

  const existing = await env.DB.prepare(
    "SELECT * FROM calendar_events WHERE booking_id=? AND connection_id=?"
  ).bind(bookingId, connection.id).first();

  try {
    if (["cancelled", "rejected"].includes(row.status)) {
      if (existing) {
        const response = await googleRequest(
          connection,
          env,
          `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(existing.external_event_id)}`,
          { method: "DELETE" }
        );
        if (!response.ok && response.status !== 404) throw new Error(`google_delete_${response.status}`);
        await env.DB.prepare(
          `UPDATE calendar_events SET status='cancelled', last_error=NULL, updated_at=? WHERE id=?`
        ).bind(nowIso(), existing.id).run();
      }
      return { connected: true, synced: true, cancelled: true };
    }

    if (row.status !== "confirmed" || !row.date_iso || !row.time_from) {
      return { connected: true, synced: false, skipped: true };
    }

    const provider = { name: row.provider_name, address: row.provider_address };
    let response;
    let eventId = existing?.external_event_id;
    if (eventId) {
      response = await googleRequest(
        connection,
        env,
        `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify(eventBody(row, provider)) }
      );
      if (response.status === 404) eventId = null;
    }
    if (!eventId) {
      response = await googleRequest(
        connection,
        env,
        `/calendars/${encodeURIComponent(connection.calendar_id)}/events`,
        { method: "POST", body: JSON.stringify(eventBody(row, provider)) }
      );
    }
    const payload = await response.json();
    if (!response.ok || !payload.id) throw new Error(payload.error?.message || `google_event_${response.status}`);

    const eventRecordId = existing?.id || id("cal_evt");
    await env.DB.prepare(
      `INSERT INTO calendar_events
       (id, connection_id, booking_id, external_event_id, external_etag, status, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, 'synced', NULL, ?)
       ON CONFLICT(booking_id) DO UPDATE SET
         connection_id=excluded.connection_id,
         external_event_id=excluded.external_event_id,
         external_etag=excluded.external_etag,
         status='synced',
         last_error=NULL,
         updated_at=excluded.updated_at`
    ).bind(
      eventRecordId,
      connection.id,
      bookingId,
      payload.id,
      payload.etag || null,
      nowIso()
    ).run();
    await env.DB.prepare(
      "UPDATE calendar_connections SET status='connected', last_error=NULL, updated_at=? WHERE id=?"
    ).bind(nowIso(), connection.id).run();
    return { connected: true, synced: true, eventId: payload.id };
  } catch (error) {
    await markConnectionError(env, connection.id, error);
    if (existing) {
      await env.DB.prepare(
        "UPDATE calendar_events SET status='error', last_error=?, updated_at=? WHERE id=?"
      ).bind(String(error?.message || error).slice(0, 500), nowIso(), existing.id).run();
    }
    return { connected: true, synced: false, error: "calendar_sync_failed" };
  }
}
