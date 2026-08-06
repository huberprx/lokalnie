import { id, json, noContent, nowIso, parseJsonField, readJson } from "./http.js";
import { requireDemoUser } from "./auth.js";
import { withIdempotency } from "./idempotency.js";
import { BOOKING_MODES, normalizeStringArray, normalizeText } from "./validate.js";
const MAX_SERVICES = 200;
const MAX_VARIANTS = 20;
const MAX_PHOTOS = 6;

function moneyToCents(value) {
  if (value == null || value === "") return { value: null };
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
    return { error: "invalid_price" };
  }
  return { value: Math.round(amount * 100) };
}

function centsToMoney(value) {
  return value == null ? null : Number(value) / 100;
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
    return { error: "invalid_duration" };
  }
  return { value: duration };
}

function normalizeVariants(value, serviceId) {
  if (value == null) return { value: [] };
  if (!Array.isArray(value) || value.length > MAX_VARIANTS) {
    return { error: "invalid_variants" };
  }
  const variants = [];
  for (let index = 0; index < value.length; index += 1) {
    const source = value[index];
    if (!source || typeof source !== "object") return { error: "invalid_variants" };
    const duration = normalizeDuration(source.durationMin);
    const price = moneyToCents(source.price);
    const label = normalizeText(source.label, 80);
    if (duration.error || price.error || label.error) return { error: "invalid_variants" };
    variants.push({
      id: `${serviceId}-v${index + 1}`,
      durationMin: duration.value,
      priceCents: price.value,
      label: label.value || "",
    });
  }
  return { value: variants };
}

function mapVariant(variant) {
  return {
    id: variant.id,
    durationMin: variant.durationMin,
    price: centsToMoney(variant.priceCents),
    label: variant.label || "",
  };
}

export function mapService(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    description: row.description || "",
    bookingMode: row.booking_mode,
    durationMin: row.duration_min,
    price: centsToMoney(row.price_cents),
    photoIds: parseJsonField(row.photo_ids_json, []),
    locationIds: parseJsonField(row.location_ids_json, []),
    variants: parseJsonField(row.variants_json, []).map(mapVariant),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function providerAuth(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth;
  if (!auth.provider) return { error: json({ error: "provider_required" }, 403) };
  return auth;
}

async function ownedService(env, providerId, serviceId) {
  return env.DB.prepare("SELECT * FROM provider_services WHERE id=? AND provider_id=?")
    .bind(serviceId, providerId)
    .first();
}

async function validatePhotoOwnership(env, userId, photoIds) {
  if (!photoIds.length) return true;
  const placeholders = photoIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT id FROM media
     WHERE owner_user_id=? AND kind='service' AND id IN (${placeholders})`
  )
    .bind(userId, ...photoIds)
    .all();
  return (result.results || []).length === new Set(photoIds).size;
}

async function normalizeServiceInput(body, serviceId, env, userId, existing = null) {
  const source = body && typeof body === "object" ? body : {};
  const inputValue = (key, fallback) =>
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
  const name = normalizeText(inputValue("name", existing?.name), 120, { required: true });
  const description = normalizeText(inputValue("description", existing?.description), 2000);
  const bookingMode = String(inputValue("bookingMode", existing?.booking_mode ?? "auto"));
  const duration = normalizeDuration(inputValue("durationMin", existing?.duration_min));
  const price = moneyToCents(
    inputValue("price", existing ? centsToMoney(existing.price_cents) : null)
  );
  const photoIds = normalizeStringArray(
    inputValue("photoIds", parseJsonField(existing?.photo_ids_json, [])),
    MAX_PHOTOS,
    80
  );
  const locationIds = normalizeStringArray(
    inputValue("locationIds", parseJsonField(existing?.location_ids_json, [])),
    20,
    120
  );
  const existingVariants = parseJsonField(existing?.variants_json, []).map(mapVariant);
  const variants = normalizeVariants(inputValue("variants", existingVariants), serviceId);

  if (
    name.error ||
    description.error ||
    !BOOKING_MODES.has(bookingMode) ||
    duration.error ||
    price.error ||
    photoIds.error ||
    locationIds.error ||
    variants.error
  ) {
    return { error: "invalid_service" };
  }
  if (!(await validatePhotoOwnership(env, userId, photoIds.value))) {
    return { error: "invalid_service_photos" };
  }
  return {
    value: {
      name: name.value,
      description: description.value,
      bookingMode,
      durationMin: duration.value,
      priceCents: price.value,
      photoIds: [...new Set(photoIds.value)],
      locationIds: [...new Set(locationIds.value)],
      variants: variants.value,
    },
  };
}

export async function listProviderServices(request, env) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare(
    "SELECT * FROM provider_services WHERE provider_id=? ORDER BY sort_order, created_at"
  )
    .bind(auth.provider.id)
    .all();
  return json({ services: (rows.results || []).map(mapService) });
}

export async function createProviderService(request, env) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "/provider/me/services" },
    () => createProviderServiceMutation(request, env, auth)
  );
}

async function createProviderServiceMutation(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM provider_services WHERE provider_id=?"
  )
    .bind(auth.provider.id)
    .first();
  if (Number(count?.count || 0) >= MAX_SERVICES) {
    return json({ error: "service_limit_reached" }, 409);
  }

  const serviceId = id("svc");
  const input = await normalizeServiceInput(body, serviceId, env, auth.user.id);
  if (input.error) return json({ error: input.error }, 400);
  const value = input.value;
  const orderRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM provider_services WHERE provider_id=?"
  )
    .bind(auth.provider.id)
    .first();
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO provider_services (
      id, provider_id, name, description, booking_mode, duration_min, price_cents,
      photo_ids_json, location_ids_json, variants_json, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      serviceId,
      auth.provider.id,
      value.name,
      value.description,
      value.bookingMode,
      value.durationMin,
      value.priceCents,
      JSON.stringify(value.photoIds),
      JSON.stringify(value.locationIds),
      JSON.stringify(value.variants),
      Number(orderRow?.next_order || 0),
      timestamp,
      timestamp
    )
    .run();
  const created = await ownedService(env, auth.provider.id, serviceId);
  return json({ service: mapService(created) }, 201);
}

export async function updateProviderService(request, env, serviceId) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/provider/me/services/${serviceId}` },
    () => updateProviderServiceMutation(request, env, auth, serviceId)
  );
}

async function updateProviderServiceMutation(request, env, auth, serviceId) {
  const existing = await ownedService(env, auth.provider.id, serviceId);
  if (!existing) return json({ error: "not_found" }, 404);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const input = await normalizeServiceInput(body, serviceId, env, auth.user.id, existing);
  if (input.error) return json({ error: input.error }, 400);
  const value = input.value;
  await env.DB.prepare(
    `UPDATE provider_services
     SET name=?, description=?, booking_mode=?, duration_min=?, price_cents=?,
         photo_ids_json=?, location_ids_json=?, variants_json=?, updated_at=?
     WHERE id=? AND provider_id=?`
  )
    .bind(
      value.name,
      value.description,
      value.bookingMode,
      value.durationMin,
      value.priceCents,
      JSON.stringify(value.photoIds),
      JSON.stringify(value.locationIds),
      JSON.stringify(value.variants),
      nowIso(),
      serviceId,
      auth.provider.id
    )
    .run();
  const updated = await ownedService(env, auth.provider.id, serviceId);
  return json({ service: mapService(updated) });
}

export async function deleteProviderService(request, env, serviceId) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/provider/me/services/${serviceId}` },
    () => deleteProviderServiceMutation(env, auth, serviceId)
  );
}

async function deleteProviderServiceMutation(env, auth, serviceId) {
  const result = await env.DB.prepare(
    "DELETE FROM provider_services WHERE id=? AND provider_id=?"
  )
    .bind(serviceId, auth.provider.id)
    .run();
  if (!result.meta?.changes) return json({ error: "not_found" }, 404);
  return noContent();
}

function normalizeServiceIds(value) {
  const result = normalizeStringArray(value, MAX_SERVICES, 80);
  if (result.error) return result;
  const ids = [...new Set(result.value.filter(Boolean))];
  return ids.length ? { value: ids } : { error: "invalid_service_ids" };
}

export async function updateProviderServicesBookingMode(request, env) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "/provider/me/services/booking-mode" },
    () => updateProviderServicesBookingModeMutation(request, env, auth)
  );
}

async function updateProviderServicesBookingModeMutation(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const ids = normalizeServiceIds(body.serviceIds);
  const bookingMode = String(body.bookingMode || "");
  if (ids.error || !BOOKING_MODES.has(bookingMode)) {
    return json({ error: "invalid_service_group_update" }, 400);
  }
  const placeholders = ids.value.map(() => "?").join(",");
  const owned = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM provider_services
     WHERE provider_id=? AND id IN (${placeholders})`
  )
    .bind(auth.provider.id, ...ids.value)
    .first();
  if (Number(owned?.count || 0) !== ids.value.length) {
    return json({ error: "service_not_found" }, 404);
  }
  await env.DB.prepare(
    `UPDATE provider_services SET booking_mode=?, updated_at=?
     WHERE provider_id=? AND id IN (${placeholders})`
  )
    .bind(bookingMode, nowIso(), auth.provider.id, ...ids.value)
    .run();
  return json({ updated: ids.value.length, bookingMode });
}

export async function deleteProviderServices(request, env) {
  const auth = await providerAuth(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "/provider/me/services" },
    () => deleteProviderServicesMutation(request, env, auth)
  );
}

async function deleteProviderServicesMutation(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const ids = normalizeServiceIds(body.serviceIds);
  if (ids.error) return json({ error: ids.error }, 400);
  const placeholders = ids.value.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `DELETE FROM provider_services WHERE provider_id=? AND id IN (${placeholders})`
  )
    .bind(auth.provider.id, ...ids.value)
    .run();
  return json({ deleted: Number(result.meta?.changes || 0), serviceIds: ids.value });
}
