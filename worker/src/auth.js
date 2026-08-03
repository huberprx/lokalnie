import { json } from "./http.js";
import { hashToken } from "./oauth.js";

const DEMO_USER_ID = "user-demo-hubert";

/**
 * Auth: sesja OAuth (Authorization: Bearer <token>) albo tryb demo
 * (X-Demo-User: demo / Authorization: Bearer demo).
 */
export async function requireDemoUser(request, env) {
  const demoHeader = (request.headers.get("X-Demo-User") || "").trim().toLowerCase();
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const demoRequested = demoHeader === "demo" || bearer.toLowerCase() === "demo";

  if (bearer && bearer.toLowerCase() !== "demo") {
    const tokenHash = await hashToken(bearer);
    const session = await env.DB.prepare(
      `SELECT s.*, u.id AS uid FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
      .bind(tokenHash)
      .first();

    if (!session) {
      return {
        error: json(
          { error: "unauthorized", message: "Sesja nieważna lub wygasła. Zaloguj się ponownie." },
          401
        ),
      };
    }

    if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
      return {
        error: json({ error: "unauthorized", message: "Sesja wygasła. Zaloguj się ponownie." }, 401),
      };
    }

    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
    if (!user) {
      return { error: json({ error: "unauthorized", message: "Użytkownik nie istnieje." }, 401) };
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

  const admins = new Set(
    String(env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!auth.user.email || !admins.has(String(auth.user.email).trim().toLowerCase())) {
    return {
      error: concealed
        ? json({ error: "not_found" }, 404)
        : json({ error: "admin_required" }, 403),
    };
  }
  return auth;
}

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
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

export function mapProvider(row) {
  if (!row) return null;
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
    phone: row.phone,
    bookingMode: row.booking_mode,
    visibleInSearch: !!row.visible_in_search,
    multiSelect: !!row.multi_select,
    avatarKey: row.avatar_key,
  };
}
