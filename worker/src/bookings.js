export const ACTIVE_BOOKING_STATUSES = ["confirmed", "pending", "proposed"];

const CLIENT_TRANSITIONS = {
  pending: new Set(["cancelled"]),
  proposed: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["cancelled"]),
  rejected: new Set(),
  cancelled: new Set(),
};

const PROVIDER_TRANSITIONS = {
  pending: new Set(["pending", "confirmed", "proposed", "rejected", "cancelled"]),
  proposed: new Set(["proposed", "confirmed", "rejected", "cancelled"]),
  confirmed: new Set(["confirmed", "proposed", "cancelled"]),
  rejected: new Set(),
  cancelled: new Set(),
};

export function canTransitionBooking(role, fromStatus, toStatus) {
  const matrix = role === "provider" ? PROVIDER_TRANSITIONS : CLIENT_TRANSITIONS;
  return !!matrix[fromStatus]?.has(toStatus);
}

/** True when a complete reschedule candidate is stored on the row. */
export function hasCompleteProposedSlot(row) {
  return !!(row?.proposed_date_iso && row?.proposed_time_from && row?.proposed_time_to);
}

/** proposeHoldHours=0 → no auto-expiry (NULL). Missing/invalid → default 24h. */
export function computeRescheduleExpiresAt(proposeHoldHours, now = new Date()) {
  const hours = Number(proposeHoldHours);
  const holdHours = Number.isFinite(hours) ? hours : 24;
  if (holdHours <= 0) return null;
  return new Date(now.getTime() + holdHours * 60 * 60 * 1000).toISOString();
}

export function isRescheduleExpired(row, nowIso = new Date().toISOString()) {
  if (!hasCompleteProposedSlot(row)) return false;
  if (row.reschedule_expires_at == null) return false;
  return String(row.reschedule_expires_at) < String(nowIso);
}

/**
 * SQL fragment: candidate (dateISO/from/to) collides with an active current slot
 * OR an unexpired proposed_* slot. Bind via bookingOverlapBindArgs.
 */
export function bookingOverlapPredicateSql(alias = "occupied") {
  return `(
    (
      ${alias}.date_iso = ?
      AND ${alias}.status IN ('confirmed', 'pending', 'proposed')
      AND ${alias}.time_from < ?
      AND ${alias}.time_to > ?
    )
    OR (
      ${alias}.proposed_date_iso = ?
      AND ${alias}.status IN ('confirmed', 'pending', 'proposed')
      AND ${alias}.proposed_time_from < ?
      AND ${alias}.proposed_time_to > ?
      AND (${alias}.reschedule_expires_at IS NULL OR ${alias}.reschedule_expires_at > ?)
    )
  )`;
}

/** Bind order for bookingOverlapPredicateSql: current slot, then proposed slot + now. */
export function bookingOverlapBindArgs({ dateISO, from, to, nowIso }) {
  return [dateISO, to, from, dateISO, to, from, nowIso];
}

export async function hasOverlap(
  env,
  { providerId, dateISO, from, to, excludeBookingId = null, nowIso = new Date().toISOString() }
) {
  const overlap = bookingOverlapPredicateSql("occupied");
  const row = await env.DB.prepare(
    `SELECT occupied.id FROM bookings AS occupied
     WHERE occupied.provider_id = ?
       AND ${overlap}
       AND (? IS NULL OR occupied.id <> ?)
     LIMIT 1`
  )
    .bind(
      providerId,
      ...bookingOverlapBindArgs({ dateISO, from, to, nowIso }),
      excludeBookingId,
      excludeBookingId
    )
    .first();
  return !!row;
}
