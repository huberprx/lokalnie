const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Wspólny zbiór trybów rezerwacji: profil i usługa. */
export const BOOKING_MODES = new Set(["auto", "queue", "approval", "request"]);

export function isValidDateISO(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTime(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

export function validateSlot({ dateISO, from, to }) {
  if (!isValidDateISO(dateISO)) return "invalid_date";
  if (!isValidTime(from) || !isValidTime(to)) return "invalid_time";
  if (from >= to) return "invalid_time_range";
  return null;
}

function zonedNowParts(now = new Date(), timeZone = "Europe/Warsaw") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Nie pozwól zapisać terminu, który już się rozpoczął lub łamie min. wyprzedzenie. */
export function validateBookingWindow({ dateISO, from, minLeadHours = 0, now = new Date() }) {
  const current = zonedNowParts(now);
  const targetMinutes = Number(from.slice(0, 2)) * 60 + Number(from.slice(3, 5));
  const leadMinutes = Math.max(0, Number(minLeadHours) || 0) * 60;
  if (dateISO < current.dateISO || (dateISO === current.dateISO && targetMinutes < current.minutes)) {
    return "slot_in_past";
  }
  if (dateISO === current.dateISO && targetMinutes < current.minutes + leadMinutes) {
    return "minimum_lead_time";
  }
  return null;
}

export function normalizeText(value, maxLength, { required = false } = {}) {
  if (value == null) return required ? { error: "required" } : { value: null };
  const normalized = String(value).trim();
  if (required && !normalized) return { error: "required" };
  if (normalized.length > maxLength) return { error: "too_long" };
  return { value: normalized || null };
}

export function normalizeStringArray(value, maxItems = 50, maxItemLength = 120) {
  if (value == null) return { value: [] };
  if (!Array.isArray(value) || value.length > maxItems) return { error: "invalid_array" };
  const result = [];
  for (const item of value) {
    const text = String(item).trim();
    if (text.length > maxItemLength) return { error: "item_too_long" };
    result.push(text);
  }
  return { value: result };
}
