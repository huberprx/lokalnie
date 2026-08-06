import { mapProvider, requireDemoUser } from "./auth.js";
import { id, json, nowIso, parseJsonField, readJson } from "./http.js";
import { encryptPhone, decryptPhone } from "./pii.js";
import { isValidDateISO, normalizeText, validateSlot } from "./validate.js";

const MAX_LOCATIONS = 20;
const MAX_SOCIAL_LINKS = 8;
const MAX_AVAILABILITY_DAYS = 366;
const MAX_BLOCKS_PER_DAY = 3;
const MAX_AVAILABILITY_BODY_BYTES = 512 * 1024;
const SOCIAL_KINDS = new Set([
  "website",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "pinterest",
  "linkedin",
  "x",
]);
const REPEAT_VALUES = new Set(["none", "weekly", "biweekly"]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function booleanField(value, fallback) {
  if (value == null) return { value: !!fallback };
  return typeof value === "boolean" ? { value } : { error: true };
}

function integerField(value, min, max, fallback) {
  if (value == null) return { value: fallback };
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return { error: true };
  return { value: number };
}

function normalizeLocations(value, fallback = []) {
  if (value == null) return { value: fallback };
  if (!Array.isArray(value) || value.length > MAX_LOCATIONS) return { error: true };
  const result = [];
  const ids = new Set();
  for (const item of value) {
    if (!isPlainObject(item)) return { error: true };
    const itemId = normalizeText(item.id, 100, { required: true });
    const label = normalizeText(item.label, 120, { required: true });
    const address = normalizeText(item.address, 240);
    const toneIndex = integerField(item.toneIndex, 0, 5, result.length % 6);
    if (itemId.error || label.error || address.error || toneIndex.error || ids.has(itemId.value)) {
      return { error: true };
    }
    ids.add(itemId.value);
    result.push({
      id: itemId.value,
      label: label.value,
      address: address.value || "",
      toneIndex: toneIndex.value,
    });
  }
  return { value: result };
}

function normalizeSocialLinks(value, fallback = []) {
  if (value == null) return { value: fallback };
  if (!Array.isArray(value) || value.length > MAX_SOCIAL_LINKS) return { error: true };
  const result = [];
  const ids = new Set();
  for (const item of value) {
    if (!isPlainObject(item)) return { error: true };
    const itemId = normalizeText(item.id, 100, { required: true });
    const kind = normalizeText(item.kind, 30, { required: true });
    const linkValue = normalizeText(item.value, 2048);
    if (
      itemId.error ||
      kind.error ||
      linkValue.error ||
      !SOCIAL_KINDS.has(kind.value) ||
      ids.has(itemId.value)
    ) {
      return { error: true };
    }
    ids.add(itemId.value);
    result.push({ id: itemId.value, kind: kind.value, value: linkValue.value || "" });
  }
  return { value: result };
}

function normalizeBookingRules(value, fallback = {}) {
  if (value == null) return { value: fallback };
  if (!isPlainObject(value)) return { error: true };
  const futureDays = integerField(value.futureDays, 1, 366, 60);
  const minLeadHours = integerField(value.minLeadHours, 0, 8760, 2);
  const cancelHours = integerField(value.cancelHours, 0, 8760, 24);
  const proposeHoldHours = integerField(value.proposeHoldHours, 0, 8760, 24);
  const policy = normalizeText(value.policy, 4000);
  if (
    futureDays.error ||
    minLeadHours.error ||
    cancelHours.error ||
    proposeHoldHours.error ||
    policy.error
  ) {
    return { error: true };
  }
  return {
    value: {
      futureDays: futureDays.value,
      minLeadHours: minLeadHours.value,
      cancelHours: cancelHours.value,
      proposeHoldHours: proposeHoldHours.value,
      policy: policy.value || "",
    },
  };
}

function storedSettings(provider) {
  const locations = parseJsonField(provider?.locations_json, []);
  const socialLinks = parseJsonField(provider?.social_links_json, []);
  const bookingRules = parseJsonField(provider?.booking_rules_json, {});
  return {
    locations: Array.isArray(locations) ? locations : [],
    socialLinks: Array.isArray(socialLinks) ? socialLinks : [],
    bookingRules: isPlainObject(bookingRules) ? bookingRules : {},
  };
}

async function normalizeProfileFields(body, base, env) {
  if (!isPlainObject(body)) return { error: true };
  const settings = storedSettings(base);
  const phone = await decryptPhone(base?.phone, env);
  const text = {
    name: normalizeText(body.name ?? base?.name, 120, { required: true }),
    category: normalizeText(body.category ?? base?.category, 100),
    subcategory: normalizeText(body.subcategory ?? base?.subcategory, 100),
    city: normalizeText(body.city ?? base?.city, 120),
    address: normalizeText(body.address ?? base?.address, 240),
    about: normalizeText(body.about ?? base?.about, 2000),
    email: normalizeText(body.email ?? base?.email, 254),
    phone: normalizeText(body.phone ?? phone, 40),
  };
  const emailVisible = booleanField(body.emailVisible, base?.email_visible);
  const visibleInSearch = booleanField(
    body.visibleInSearch,
    base?.visible_in_search == null ? true : base.visible_in_search
  );
  const multiSelect = booleanField(
    body.multiSelect,
    base?.multi_select == null ? true : base.multi_select
  );
  const deactivated = booleanField(body.deactivated, base?.deactivated);
  const locations = normalizeLocations(body.locations, settings.locations);
  const socialLinks = normalizeSocialLinks(body.socialLinks, settings.socialLinks);
  const bookingRules = normalizeBookingRules(body.bookingRules, settings.bookingRules);
  const bookingMode =
    body.bookingMode == null ? base?.booking_mode || "auto" : String(body.bookingMode);

  if (
    Object.values(text).some((field) => field.error) ||
    emailVisible.error ||
    visibleInSearch.error ||
    multiSelect.error ||
    deactivated.error ||
    locations.error ||
    socialLinks.error ||
    bookingRules.error ||
    !["auto", "approval"].includes(bookingMode)
  ) {
    return { error: true };
  }
  return {
    value: {
      name: text.name.value,
      category: text.category.value,
      subcategory: text.subcategory.value,
      city: text.city.value,
      address: text.address.value,
      about: text.about.value,
      email: text.email.value,
      emailVisible: emailVisible.value ? 1 : 0,
      phone: await encryptPhone(text.phone.value, env),
      bookingMode,
      visibleInSearch: visibleInSearch.value ? 1 : 0,
      multiSelect: multiSelect.value ? 1 : 0,
      locations: locations.value,
      socialLinks: socialLinks.value,
      bookingRules: bookingRules.value,
      deactivated: deactivated.value ? 1 : 0,
    },
  };
}

function normalizeRequestedSlug(value) {
  if (value == null || value === "") return { value: null };
  const slug = String(value).trim().toLowerCase();
  if (slug.length < 3 || slug.length > 80 || !SLUG_RE.test(slug)) return { error: true };
  return { value: slug };
}

function slugBase(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!normalized) return "uslugodawca";
  return normalized.length >= 3 ? normalized : `profil-${normalized}`;
}

async function insertProvider(env, userId, providerId, slug, fields) {
  const ts = nowIso();
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO provider_profiles (
        id, user_id, slug, name, category, subcategory, city, address, about, email,
        email_visible, phone, booking_mode, visible_in_search, multi_select,
        locations_json, social_links_json, booking_rules_json, deactivated, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      providerId,
      userId,
      slug,
      fields.name,
      fields.category,
      fields.subcategory,
      fields.city,
      fields.address,
      fields.about,
      fields.email,
      fields.emailVisible,
      fields.phone,
      fields.bookingMode,
      fields.visibleInSearch,
      fields.multiSelect,
      JSON.stringify(fields.locations),
      JSON.stringify(fields.socialLinks),
      JSON.stringify(fields.bookingRules),
      fields.deactivated,
      ts,
      ts
    ),
    env.DB.prepare(
      `UPDATE users SET role_provider=1, updated_at=?
       WHERE id=? AND EXISTS (SELECT 1 FROM provider_profiles WHERE user_id=?)`
    ).bind(ts, userId, userId),
  ]);
  return !!insert.meta?.changes;
}

export async function createProviderMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (auth.provider) {
    await env.DB.prepare("UPDATE users SET role_provider=1, updated_at=? WHERE id=?")
      .bind(nowIso(), auth.user.id)
      .run();
    return json({ provider: await mapProvider(auth.provider, env), created: false });
  }
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const slugResult = normalizeRequestedSlug(body.slug);
  const fieldsResult = await normalizeProfileFields(
    body,
    { name: auth.user.name, email: auth.user.email },
    env
  );
  if (slugResult.error || fieldsResult.error) {
    return json({ error: "invalid_provider_fields" }, 400);
  }

  const providerId = id("provider");
  let slug = slugResult.value || slugBase(fieldsResult.value.name);
  let created = await insertProvider(
    env,
    auth.user.id,
    providerId,
    slug,
    fieldsResult.value
  );
  let provider = await env.DB.prepare("SELECT * FROM provider_profiles WHERE user_id=?")
    .bind(auth.user.id)
    .first();

  if (!provider) {
    const base = (slugResult.value || slugBase(fieldsResult.value.name)).slice(0, 67);
    for (let attempt = 0; attempt < 3 && !provider; attempt += 1) {
      slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
      created = await insertProvider(env, auth.user.id, providerId, slug, fieldsResult.value);
      provider = await env.DB.prepare("SELECT * FROM provider_profiles WHERE user_id=?")
        .bind(auth.user.id)
        .first();
    }
  }
  if (!provider) return json({ error: "provider_slug_conflict" }, 409);
  return json({ provider: await mapProvider(provider, env), created }, created ? 201 : 200);
}

export async function patchProviderMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_not_found" }, 404);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);
  const result = await normalizeProfileFields(body, auth.provider, env);
  if (result.error) return json({ error: "invalid_provider_fields" }, 400);
  const fields = result.value;
  await env.DB.prepare(
    `UPDATE provider_profiles SET
      name=?, category=?, subcategory=?, city=?, address=?, about=?, email=?,
      email_visible=?, phone=?, booking_mode=?, visible_in_search=?, multi_select=?,
      locations_json=?, social_links_json=?, booking_rules_json=?, deactivated=?, updated_at=?
     WHERE id=? AND user_id=?`
  )
    .bind(
      fields.name,
      fields.category,
      fields.subcategory,
      fields.city,
      fields.address,
      fields.about,
      fields.email,
      fields.emailVisible,
      fields.phone,
      fields.bookingMode,
      fields.visibleInSearch,
      fields.multiSelect,
      JSON.stringify(fields.locations),
      JSON.stringify(fields.socialLinks),
      JSON.stringify(fields.bookingRules),
      fields.deactivated,
      nowIso(),
      auth.provider.id,
      auth.user.id
    )
    .run();
  const provider = await env.DB.prepare(
    "SELECT * FROM provider_profiles WHERE id=? AND user_id=?"
  )
    .bind(auth.provider.id, auth.user.id)
    .first();
  return json({ provider: await mapProvider(provider, env) });
}

function mapAvailabilityRows(rows) {
  const days = [];
  let current = null;
  for (const row of rows || []) {
    if (!current || current.dateISO !== row.date_iso) {
      current = { dateISO: row.date_iso, blocks: [] };
      days.push(current);
    }
    current.blocks.push({
      from: row.time_from,
      to: row.time_to,
      locationId: row.location_id || "",
      repeat: row.repeat,
      recurring: row.repeat !== "none",
    });
  }
  return days;
}

async function readAvailability(env, providerId) {
  const rows = await env.DB.prepare(
    `SELECT date_iso, block_index, time_from, time_to, location_id, repeat
     FROM provider_availability
     WHERE provider_id=?
     ORDER BY date_iso, block_index`
  )
    .bind(providerId)
    .all();
  return mapAvailabilityRows(rows.results || []);
}

export async function getProviderAvailability(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_required" }, 403);
  return json({ availability: await readAvailability(env, auth.provider.id) });
}

function normalizeAvailability(value, locations) {
  if (!Array.isArray(value) || value.length > MAX_AVAILABILITY_DAYS) return { error: true };
  const locationIds = new Set(locations.map((location) => location.id));
  const dates = new Set();
  const days = [];
  for (const day of value) {
    if (
      !isPlainObject(day) ||
      !isValidDateISO(day.dateISO) ||
      dates.has(day.dateISO) ||
      !Array.isArray(day.blocks) ||
      day.blocks.length > MAX_BLOCKS_PER_DAY
    ) {
      return { error: true };
    }
    dates.add(day.dateISO);
    const blocks = [];
    for (const block of day.blocks) {
      if (!isPlainObject(block) || validateSlot({ ...block, dateISO: day.dateISO })) {
        return { error: true };
      }
      const locationId = normalizeText(block.locationId, 100);
      const repeat = block.repeat ?? (block.recurring ? "weekly" : "none");
      if (
        locationId.error ||
        (locationId.value && !locationIds.has(locationId.value)) ||
        !REPEAT_VALUES.has(repeat)
      ) {
        return { error: true };
      }
      blocks.push({
        from: block.from,
        to: block.to,
        locationId: locationId.value || "",
        repeat,
        recurring: repeat !== "none",
      });
    }
    blocks.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    if (blocks.some((block, index) => index > 0 && blocks[index - 1].to > block.from)) {
      return { error: true };
    }
    if (blocks.length) days.push({ dateISO: day.dateISO, blocks });
  }
  days.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return { value: days };
}

export async function putProviderAvailability(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_required" }, 403);
  const body = await readJson(request, MAX_AVAILABILITY_BODY_BYTES);
  if (!isPlainObject(body)) return json({ error: "invalid_json" }, 400);
  const locations = parseJsonField(auth.provider.locations_json, []);
  const normalized = normalizeAvailability(body.availability, Array.isArray(locations) ? locations : []);
  if (normalized.error) return json({ error: "invalid_availability" }, 400);

  const ts = nowIso();
  const statements = [
    env.DB.prepare(
      "DELETE FROM provider_availability WHERE provider_id=?"
    ).bind(auth.provider.id),
  ];
  const rows = [];
  for (const day of normalized.value) {
    day.blocks.forEach((block, blockIndex) => {
      rows.push([
          auth.provider.id,
          day.dateISO,
          blockIndex,
          block.from,
          block.to,
          block.locationId || null,
          block.repeat,
          ts,
          ts,
      ]);
    });
  }
  // D1 Free pozwala na 1000 zapytań do usług wewnętrznych na wywołanie.
  // Pakowanie 10 bloków w jeden INSERT utrzymuje nawet maksymalny harmonogram
  // znacznie poniżej limitu oraz limitu parametrów SQLite.
  for (let offset = 0; offset < rows.length; offset += 10) {
    const chunk = rows.slice(offset, offset + 10);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    statements.push(
      env.DB.prepare(
        `INSERT INTO provider_availability (
          provider_id, date_iso, block_index, time_from, time_to, location_id,
          repeat, created_at, updated_at
        ) VALUES ${placeholders}`
      ).bind(...chunk.flat())
    );
  }
  await env.DB.batch(statements);
  return json({ availability: await readAvailability(env, auth.provider.id) });
}
