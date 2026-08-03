import { describe, expect, it, vi } from "vitest";
import { requireAdmin, requireDemoUser } from "../src/auth.js";
import { canTransitionBooking, hasOverlap } from "../src/bookings.js";
import { sendViaResend } from "../src/email.js";
import { json, withCors } from "../src/http.js";
import { withIdempotency } from "../src/idempotency.js";
import { isValidDateISO, validateSlot } from "../src/validate.js";

describe("production authentication", () => {
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
        }
      )
    ).resolves.toBe(true);
    expect(bind).toHaveBeenCalled();
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
    expect(allowed.headers.get("Vary")).toContain("Origin");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
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
