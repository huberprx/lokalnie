import { describe, expect, it, vi } from "vitest";
import { requireAdmin, requireDemoUser } from "../src/auth.js";
import { detectImageType } from "../src/index.js";
import { sessionTokenFromCookie } from "../src/oauth.js";
import {
  bookingOverlapBindArgs,
  bookingOverlapPredicateSql,
  canTransitionBooking,
  computeRescheduleExpiresAt,
  hasCompleteProposedSlot,
  hasOverlap,
  isRescheduleExpired,
} from "../src/bookings.js";
import { sendViaResend } from "../src/email.js";
import { json, withCors } from "../src/http.js";
import { withIdempotency } from "../src/idempotency.js";
import { enforceRateLimit } from "../src/rateLimit.js";
import { renderEmail } from "../src/templates.js";
import { isValidDateISO, validateBookingWindow, validateSlot } from "../src/validate.js";

describe("production authentication", () => {
  it("rejects past slots and enforces minimum lead time in the provider timezone", () => {
    const now = new Date("2026-08-08T00:24:00+02:00");
    expect(
      validateBookingWindow({
        dateISO: "2026-08-08",
        from: "00:15",
        minLeadHours: 0,
        now,
      })
    ).toBe("slot_in_past");
    expect(
      validateBookingWindow({
        dateISO: "2026-08-08",
        from: "01:30",
        minLeadHours: 2,
        now,
      })
    ).toBe("minimum_lead_time");
    expect(
      validateBookingWindow({
        dateISO: "2026-08-08",
        from: "02:30",
        minLeadHours: 2,
        now,
      })
    ).toBeNull();
  });

  it("parses the session cookie without exposing bearer credentials", () => {
    expect(
      sessionTokenFromCookie(new Request("https://api.lokalnie.app/me", {
        headers: { Cookie: "foo=bar; lokalnie_session=abc%2F123" },
      }))
    ).toBe("abc/123");
  });

  it("accepts a session token from the HttpOnly cookie", async () => {
    const first = vi.fn().mockResolvedValue({
      id: "sess_1",
      user_id: "user_1",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const prepare = vi.fn((sql) => ({ bind: vi.fn(() => ({ first })) }));
    const result = await requireDemoUser(
      new Request("https://api.lokalnie.app/me", {
        headers: { Cookie: "lokalnie_session=session-token" },
      }),
      {
        ENVIRONMENT: "production",
        DB: { prepare },
      }
    );
    expect(result.authMode).toBe("session");
    expect(prepare).toHaveBeenCalled();
  });

  it("rejects demo credentials without querying D1", async () => {
    const prepare = vi.fn();
    const result = await requireDemoUser(
      new Request("https://api.lokalnie.app/me", {
        headers: { "X-Demo-User": "demo" },
      }),
      { ENVIRONMENT: "production", DB: { prepare } }
    );
    expect(result.error.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("conceals production admin endpoints from demo users", async () => {
    const result = await requireAdmin(
      new Request("https://api.lokalnie.app/emails/outbox", {
        headers: { Authorization: "Bearer demo" },
      }),
      { ENVIRONMENT: "production", DB: { prepare: vi.fn() } }
    );
    expect(result.error.status).toBe(404);
  });

  it("requires a verified email for configured admins", async () => {
    const session = {
      id: "sess_1",
      user_id: "user_1",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const user = { id: "user_1", email: "admin@example.com", email_verified: 0 };
    const prepare = vi.fn((sql) => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(sql.includes("sessions") ? session : user),
      })),
    }));
    const result = await requireAdmin(
      new Request("https://api.lokalnie.app/debug/tables", {
        headers: { Cookie: "lokalnie_session=session-token" },
      }),
      { ENVIRONMENT: "production", ADMIN_EMAILS: "admin@example.com", DB: { prepare } }
    );
    expect(result.error.status).toBe(404);
  });
});

describe("media validation", () => {
  it("rejects MIME spoofing by checking image signatures", () => {
    expect(detectImageType(new TextEncoder().encode("not an image"))).toBeNull();
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
  });
});

describe("booking validation", () => {
  it("rejects impossible dates and invalid ranges", () => {
    expect(isValidDateISO("2026-02-29")).toBe(false);
    expect(isValidDateISO("2028-02-29")).toBe(true);
    expect(validateSlot({ dateISO: "2026-08-03", from: "10:00", to: "09:00" })).toBe(
      "invalid_time_range"
    );
  });

  it("detects active booking overlap", async () => {
    const first = vi.fn().mockResolvedValue({ id: "bk_existing" });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    await expect(
      hasOverlap(
        { DB: { prepare } },
        {
          providerId: "provider-1",
          dateISO: "2026-08-03",
          from: "10:00",
          to: "11:00",
          nowIso: "2026-08-03T08:00:00.000Z",
        }
      )
    ).resolves.toBe(true);
    expect(prepare.mock.calls[0][0]).toContain("proposed_date_iso");
    expect(bind).toHaveBeenCalledWith(
      "provider-1",
      ...bookingOverlapBindArgs({
        dateISO: "2026-08-03",
        from: "10:00",
        to: "11:00",
        nowIso: "2026-08-03T08:00:00.000Z",
      }),
      null,
      null
    );
  });

  it("centralizes dual-slot overlap SQL and reschedule helpers", () => {
    const sql = bookingOverlapPredicateSql("occupied");
    expect(sql).toContain("occupied.date_iso = ?");
    expect(sql).toContain("occupied.proposed_date_iso = ?");
    expect(sql).toContain("reschedule_expires_at IS NULL OR occupied.reschedule_expires_at > ?");
    expect(
      bookingOverlapBindArgs({
        dateISO: "2026-09-10",
        from: "10:00",
        to: "11:00",
        nowIso: "2026-09-01T00:00:00.000Z",
      })
    ).toEqual([
      "2026-09-10",
      "11:00",
      "10:00",
      "2026-09-10",
      "11:00",
      "10:00",
      "2026-09-01T00:00:00.000Z",
    ]);
    expect(hasCompleteProposedSlot({ proposed_date_iso: "2026-09-11", proposed_time_from: "12:00", proposed_time_to: "13:00" })).toBe(
      true
    );
    expect(hasCompleteProposedSlot({ proposed_date_iso: "2026-09-11" })).toBe(false);
    expect(computeRescheduleExpiresAt(0, new Date("2026-09-01T00:00:00.000Z"))).toBeNull();
    expect(computeRescheduleExpiresAt(undefined, new Date("2026-09-01T00:00:00.000Z"))).toBe(
      "2026-09-02T00:00:00.000Z"
    );
    expect(computeRescheduleExpiresAt(6, new Date("2026-09-01T00:00:00.000Z"))).toBe(
      "2026-09-01T06:00:00.000Z"
    );
    expect(
      isRescheduleExpired(
        {
          proposed_date_iso: "2026-09-11",
          proposed_time_from: "12:00",
          proposed_time_to: "13:00",
          reschedule_expires_at: "2026-09-01T00:00:00.000Z",
        },
        "2026-09-01T01:00:00.000Z"
      )
    ).toBe(true);
    expect(
      isRescheduleExpired(
        {
          proposed_date_iso: "2026-09-11",
          proposed_time_from: "12:00",
          proposed_time_to: "13:00",
          reschedule_expires_at: null,
        },
        "2026-09-01T01:00:00.000Z"
      )
    ).toBe(false);
  });

  it("uses explicit client and provider status matrices", () => {
    expect(canTransitionBooking("client", "proposed", "confirmed")).toBe(true);
    expect(canTransitionBooking("client", "pending", "confirmed")).toBe(false);
    expect(canTransitionBooking("provider", "confirmed", "proposed")).toBe(true);
    expect(canTransitionBooking("provider", "rejected", "confirmed")).toBe(false);
  });
});

describe("idempotency", () => {
  it("replays a completed response without repeating the operation", async () => {
    const state = {};
    const DB = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.startsWith("INSERT INTO idempotency_keys")) {
                  if (state.status) return { meta: { changes: 0 } };
                  state.scope = args[0];
                  state.request_hash = args[1];
                  state.status = "processing";
                  return { meta: { changes: 1 } };
                }
                if (sql.includes("UPDATE idempotency_keys")) {
                  state.response_status = args[0];
                  state.response_json = args[1];
                  state.status = "completed";
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                return { ...state };
              },
            };
          },
        };
      },
    };
    const operation = vi.fn(async () => json({ booking: { id: "bk_1" } }, 201));
    const makeRequest = () =>
      new Request("https://api.lokalnie.app/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "same-key",
        },
        body: JSON.stringify({ providerId: "provider-1" }),
      });

    const first = await withIdempotency(
      makeRequest(),
      { DB },
      { userId: "user-1", endpoint: "/bookings" },
      operation
    );
    const replay = await withIdempotency(
      makeRequest(),
      { DB },
      { userId: "user-1", endpoint: "/bookings" },
      operation
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ booking: { id: "bk_1" } });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("requires a key before running a mutation", async () => {
    const operation = vi.fn(async () => json({ ok: true }));
    const response = await withIdempotency(
      new Request("https://api.lokalnie.app/bookings", { method: "POST" }),
      { DB: { prepare: vi.fn() } },
      { userId: "user-1", endpoint: "/bookings" },
      operation
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
    expect(operation).not.toHaveBeenCalled();
  });
});

describe("email and CORS", () => {
  it("renders branded booking email with Polish status labels", () => {
    const rendered = renderEmail("booking_confirmed", {
      clientName: "Ada <Test>",
      dateISO: "2026-08-03",
      from: "10:00",
      to: "10:20",
      status: "confirmed",
      bookingId: "bk_123",
    });
    expect(rendered.subject).toBe("Rezerwacja potwierdzona");
    expect(rendered.text).toContain("Lokalnie");
    expect(rendered.text).toContain("Status: Potwierdzona");
    expect(rendered.html).toContain("Lokalnie");
    expect(rendered.html).toContain("Otwórz Lokalnie");
    expect(rendered.html).toContain("Ada &lt;Test&gt;");
    expect(rendered.html).not.toContain("Ada <Test>");
  });

  it("renders reschedule proposal and decision templates", () => {
    const proposed = renderEmail("booking_proposed", {
      previousDateISO: "2026-09-10",
      previousFrom: "10:00",
      previousTo: "11:00",
      dateISO: "2026-09-11",
      from: "12:00",
      to: "13:00",
      bookingId: "bk_1",
    });
    expect(proposed.text).toContain("Poprzedni termin: 2026-09-10, 10:00–11:00");
    expect(proposed.text).toContain("Data: 2026-09-11");
    expect(renderEmail("booking_reschedule_accepted", { bookingId: "bk_1" }).subject).toBe(
      "Klient zaakceptował nowy termin"
    );
    expect(renderEmail("booking_reschedule_rejected", { bookingId: "bk_1" }).subject).toBe(
      "Propozycja zmiany terminu odrzucona"
    );
  });

  it("simulates email delivery without a key outside production", async () => {
    await expect(
      sendViaResend(
        { ENVIRONMENT: "development" },
        { id: "em_1", template: "booking_confirmed", payload_json: "{}", to_email: "a@example.com" }
      )
    ).resolves.toEqual({ id: "dev_em_1", simulated: true });
  });

  it("echoes only an allowed origin and varies by Origin", () => {
    const allowedRequest = new Request("https://api.lokalnie.app/health", {
      headers: { Origin: "http://localhost:8080" },
    });
    const blockedRequest = new Request("https://api.lokalnie.app/health", {
      headers: { Origin: "https://evil.example" },
    });
    const allowed = withCors(json({ ok: true }), allowedRequest, {});
    const blocked = withCors(json({ ok: true }), blockedRequest, {});
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8080");
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(allowed.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(allowed.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(allowed.headers.get("Vary")).toContain("Origin");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(blocked.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("always blocks localhost in production", () => {
    const request = new Request("https://api.lokalnie.app/health", {
      headers: { Origin: "http://localhost:8080" },
    });
    const production = withCors(json({ ok: true }), request, {
      ENVIRONMENT: "production",
      APP_ORIGIN: "https://lokalnie.app",
    });
    const localProduction = withCors(json({ ok: true }), request, {
      ENVIRONMENT: "production",
      APP_ORIGIN: "http://localhost:8080",
    });
    expect(production.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(localProduction.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After after the configured limit", async () => {
    const DB = {
      prepare(sql) {
        return {
          bind() {
            return { sql };
          },
        };
      },
      async batch() {
        return [{}, { results: [{ count: 6, expires_at: Date.now() + 20_000 }] }];
      },
    };
    const response = await enforceRateLimit(
      new Request("https://api.lokalnie.app/media", { method: "POST" }),
      { DB },
      "ip:media",
      5
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(20);
    expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(21);
  });
});
