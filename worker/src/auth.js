import { json, parseJsonField } from "./http.js";
import { hashToken, sessionTokenFromCookie } from "./oauth.js";
import { decryptPhone } from "./pii.js";

const DEMO_USER_ID = "user-demo-hubert";

export function adminEmailSet(env) {
  return new Set(
    String(env?.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminUser(user, env) {
  if (!user?.email || !user.email_verified) return false;
  return adminEmailSet(env).has(String(user.email).trim().toLowerCase());
}

function blockedError() {
  return json(
    {
      error: "account_blocked",
      message: "Konto zostało zablokowane. Skontaktuj się z supportem Lokalnie.",
    },
    403
  );
}

/**
 * Auth: sesja OAuth (Authorization: Bearer <token>) albo tryb demo
 * (X-Demo-User: demo / Authorization: Bearer demo).
 */
export async function requireDemoUser(request, env) {
  const demoHeader = (request.headers.get("X-Demo-User") || "").trim().toLowerCase();
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cookieToken = sessionTokenFromCookie(request);
  const demoRequested = demoHeader === "demo" || bearer.toLowerCase() === "demo";
  const sessionToken = bearer && bearer.toLowerCase() !== "demo" ? bearer : cookieToken;

  if (sessionToken) {
    const tokenHash = await hashToken(sessionToken);
    const session = await env.DB.prepare(
      `SELECT s.*, u.id AS uid FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND (s.expires_at IS NULL OR s.expires_at > ?)`
    )
      .bind(tokenHash, new Date().toISOString())
      .first();

    if (!session) {
      return {
        error: json(
          { error: "unauthorized", message: "Sesja nieważna lub wygasła. Zaloguj się ponownie." },
          401
        ),
      };
    }

    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
    if (!user) {
      return { error: json({ error: "unauthorized", message: "Użytkownik nie istnieje." }, 401) };
    }
    if (user.blocked) {
      await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
      return { error: blockedError() };
    }

    const provider = await env.DB.prepare("SELECT * FROM provider_profiles WHERE user_id = ?")
      .bind(user.id)
      .first();

    return { user, provider, authMode: "session" };
  }

  if (!demoRequested) {
    return {
      error: json(
        {
          error: "unauthorized",
          message:
            "Zaloguj się przez Google albo użyj trybu demo: X-Demo-User: demo / Authorization: Bearer demo.",
        },
        401
      ),
    };
  }

  if (env.ENVIRONMENT === "production") {
    return { error: json({ error: "unauthorized" }, 401) };
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(DEMO_USER_ID).first();
  if (!user) {
    return {
      error: json(
        { error: "demo_user_missing", message: "Uruchom migrację 0002 (seed demo)." },
        500
      ),
    };
  }
  if (user.blocked) {
    return { error: blockedError() };
  }

  const provider = await env.DB.prepare("SELECT * FROM provider_profiles WHERE user_id = ?")
    .bind(user.id)
    .first();

  return { user, provider, authMode: "demo" };
}

export async function requireAdmin(request, env) {
  const auth = await requireDemoUser(request, env);
  const concealed = env.ENVIRONMENT === "production";
  if (auth.error) {
    return { error: concealed ? json({ error: "not_found" }, 404) : auth.error };
  }

  if (auth.authMode === "demo") {
    if (concealed) return { error: json({ error: "not_found" }, 404) };
    return auth;
  }

  if (!isAdminUser(auth.user, env)) {
    return {
      error: concealed
        ? json({ error: "not_found" }, 404)
        : json({ error: "admin_required" }, 403),
    };
  }
  return auth;
}

export async function mapUser(row, env) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: await decryptPhone(row.phone, env),
    avatarKey: row.avatar_key,
    createdAt: row.created_at || null,
    roles: {
      client: !!row.role_client,
      provider: !!row.role_provider,
    },
    notifications: {
      booking: !!row.notification_booking,
      reminder: !!row.notification_reminder,
      marketing: !!row.notification_marketing,
    },
  };
}

export async function mapProvider(row, env) {
  if (!row) return null;
  const locations = parseJsonField(row.locations_json, []);
  const socialLinks = parseJsonField(row.social_links_json, []);
  const bookingRules = parseJsonField(row.booking_rules_json, {});
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    city: row.city,
    address: row.address,
    about: row.about,
    email: row.email,
    emailVisible: !!row.email_visible,
    phone: await decryptPhone(row.phone, env),
    bookingMode: row.booking_mode,
    visibleInSearch: !!row.visible_in_search,
    multiSelect: !!row.multi_select,
    avatarKey: row.avatar_key,
    locations: Array.isArray(locations) ? locations : [],
    socialLinks: Array.isArray(socialLinks) ? socialLinks : [],
    bookingRules:
      bookingRules && typeof bookingRules === "object" && !Array.isArray(bookingRules)
        ? bookingRules
        : {},
    deactivated: !!row.deactivated,
  };
}
