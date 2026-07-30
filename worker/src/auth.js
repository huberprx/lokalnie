import { json } from "./http.js";

const DEMO_USER_ID = "user-demo-hubert";

/** Tryb demo: X-Demo-User: demo albo Authorization: Bearer demo */
export async function requireDemoUser(request, env) {
  const demoHeader = (request.headers.get("X-Demo-User") || "").trim().toLowerCase();
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim().toLowerCase() : "";

  if (demoHeader !== "demo" && bearer !== "demo") {
    return {
      error: json(
        {
          error: "unauthorized",
          message:
            "Tryb demo: dodaj nagłówek X-Demo-User: demo lub Authorization: Bearer demo. OAuth później.",
        },
        401
      ),
    };
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

  return { user, provider };
}

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    avatarKey: row.avatar_key,
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
