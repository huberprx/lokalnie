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

export async function hasOverlap(
  env,
  { providerId, dateISO, from, to, excludeBookingId = null }
) {
  const placeholders = ACTIVE_BOOKING_STATUSES.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT id FROM bookings
     WHERE provider_id = ?
       AND date_iso = ?
       AND status IN (${placeholders})
       AND time_from < ?
       AND time_to > ?
       AND (? IS NULL OR id <> ?)
     LIMIT 1`
  )
    .bind(
      providerId,
      dateISO,
      ...ACTIVE_BOOKING_STATUSES,
      to,
      from,
      excludeBookingId,
      excludeBookingId
    )
    .first();
  return !!row;
}
