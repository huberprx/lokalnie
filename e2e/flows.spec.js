const { test, expect } = require("@playwright/test");
const {
  resetAndLogin,
  gotoApp,
  switchRole,
  goClientMyCalendar,
  goProviderCalendar,
  clickAction,
  seedProposalsAndSend,
} = require("./helpers");

test.describe("Lokalnie — kluczowe przepływy", function () {
  test("prośba → propozycje → rezerwacja (klient + usługodawca)", async function ({ page }) {
    await resetAndLogin(page, "provider");
    await goProviderCalendar(page);

    const requestId = "rq-demo-magda";
    await expect(
      page.locator(`#app-fullscreen [data-action="propose-open"][data-request-id="${requestId}"]`).first()
    ).toBeAttached();

    const proposals = [
      {
        id: "slot-e2e-a",
        dateISO: "2026-07-20",
        from: "10:00",
        to: "10:45",
        locationId: "loc-gb-1",
        locationLabel: "Studio główne",
      },
      {
        id: "slot-e2e-b",
        dateISO: "2026-07-20",
        from: "11:00",
        to: "11:45",
        locationId: "loc-gb-1",
        locationLabel: "Studio główne",
      },
      {
        // Nachodzący na B — nie może blokować akceptacji w tej samej prośbie.
        id: "slot-e2e-c",
        dateISO: "2026-07-20",
        from: "11:15",
        to: "12:00",
        locationId: "loc-gb-1",
        locationLabel: "Studio główne",
      },
    ];
    await seedProposalsAndSend(page, requestId, proposals);

    const sent = await page.evaluate(function (id) {
      const req = (window.AppState.requests || []).find(function (r) {
        return r && r.id === id;
      });
      return {
        status: req && req.status,
        count: req && req.proposals ? req.proposals.length : 0,
        hasExpiry: !!(req && req.proposeExpiresAt),
      };
    }, requestId);
    expect(sent.status).toBe("proposed");
    expect(sent.count).toBe(3);
    expect(sent.hasExpiry).toBe(true);

    await switchRole(page, "client");
    await goClientMyCalendar(page);

    await expect(
      page
        .locator(`#app-fullscreen [data-action="accept-request-proposal"][data-request-id="${requestId}"]`)
        .first()
    ).toBeAttached();

    await clickAction(
      page,
      `[data-action="accept-request-proposal"][data-request-id="${requestId}"][data-proposal-id="slot-e2e-c"]`
    );

    await page.waitForFunction(
      function (id) {
        const req = (window.AppState.requests || []).find(function (r) {
          return r && r.id === id;
        });
        const bk = (window.AppState.bookings || []).find(function (b) {
          return b && b.requestId === id;
        });
        return !!(req && req.status === "confirmed" && bk && bk.status === "confirmed");
      },
      requestId,
      { timeout: 10_000 }
    );

    const after = await page.evaluate(function (id) {
      const req = (window.AppState.requests || []).find(function (r) {
        return r && r.id === id;
      });
      const bk = (window.AppState.bookings || []).find(function (b) {
        return b && b.requestId === id;
      });
      return {
        reqStatus: req && req.status,
        bkStatus: bk && bk.status,
        from: bk && bk.from,
        to: bk && bk.to,
        dateISO: bk && bk.dateISO,
      };
    }, requestId);
    expect(after.reqStatus).toBe("confirmed");
    expect(after.bkStatus).toBe("confirmed");
    expect(after.from).toBe("11:15");
    expect(after.to).toBe("12:00");
    expect(after.dateISO).toBe("2026-07-20");
  });

  test("zmiana terminu: wyślij propozycję → klient akceptuje", async function ({ page }) {
    await resetAndLogin(page, "provider");
    await goProviderCalendar(page);

    // Późna wizyta demo — +60 min nie nachodzi na inne sloty.
    const meta = await page.evaluate(function () {
      const bk = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === "bk-demo-gb-1700";
      });
      if (!bk || bk.status !== "confirmed") {
        throw new Error("Brak confirmed wizyty bk-demo-gb-1700");
      }
      function toMin(t) {
        const p = String(t).split(":");
        return Number(p[0]) * 60 + Number(p[1] || 0);
      }
      function toTime(m) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
      }
      const origDate = bk.dateISO;
      const origFrom = bk.from;
      const origTo = bk.to;
      const dur = toMin(origTo) - toMin(origFrom);
      const newFromMin = toMin(origFrom) + 60;
      const newFrom = toTime(newFromMin);
      const newTo = toTime(newFromMin + dur);
      bk.from = newFrom;
      bk.to = newTo;
      window.AppState.provCalRescheduleQueue = [
        {
          bookingId: bk.id,
          origDateISO: origDate,
          origFrom: origFrom,
          origTo: origTo,
          newDateISO: bk.dateISO,
          newFrom: newFrom,
          newTo: newTo,
        },
      ];
      window.App.saveState();
      window.App.renderAll();
      return { id: bk.id, newFrom: newFrom, newTo: newTo };
    });

    await clickAction(page, '[data-action="open-prov-cal-reschedule"]');
    await clickAction(page, '[data-action="send-all-prov-cal-reschedule"]');

    await page.waitForFunction(
      function (id) {
        const bk = (window.AppState.bookings || []).find(function (b) {
          return b && b.id === id;
        });
        return !!(bk && bk.status === "proposed" && bk.reschedulePrevFrom);
      },
      meta.id,
      { timeout: 10_000 }
    );

    await switchRole(page, "client");
    await goClientMyCalendar(page);

    await expect(
      page.locator(`#app-fullscreen [data-action="accept-proposal"][data-booking-id="${meta.id}"]`).first()
    ).toBeAttached({ timeout: 10_000 });
    await clickAction(page, `[data-action="accept-proposal"][data-booking-id="${meta.id}"]`);

    await page.waitForFunction(
      function (args) {
        const bk = (window.AppState.bookings || []).find(function (b) {
          return b && b.id === args.id;
        });
        return !!(
          bk &&
          bk.status === "confirmed" &&
          !bk.reschedulePrevFrom &&
          bk.from === args.newFrom &&
          bk.to === args.newTo
        );
      },
      { id: meta.id, newFrom: meta.newFrom, newTo: meta.newTo },
      { timeout: 10_000 }
    );

    const value = await page.evaluate(function (id) {
      const bk = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === id;
      });
      return bk
        ? {
            status: bk.status,
            from: bk.from,
            to: bk.to,
            hasPrev: !!(bk.reschedulePrevFrom || bk.reschedulePrevDateISO),
          }
        : null;
    }, meta.id);
    expect(value).toBeTruthy();
    expect(value.status).toBe("confirmed");
    expect(value.from).toBe(meta.newFrom);
    expect(value.to).toBe(meta.newTo);
    expect(value.hasPrev).toBe(false);
  });

  test("kolizja: assertNoBookingOverlap blokuje zajęty termin", async function ({ page }) {
    await resetAndLogin(page, "provider");

    const result = await page.evaluate(function () {
      const bk = (window.AppState.bookings || []).find(function (b) {
        return (
          b &&
          b.providerId === "grzesiu-barber" &&
          b.status === "confirmed" &&
          b.dateISO &&
          b.from &&
          b.to
        );
      });
      if (!bk) throw new Error("Brak confirmed booking");
      const hit = window.App.assertNoBookingOverlap(
        bk.providerId,
        bk.dateISO,
        bk.from,
        bk.to,
        null
      );
      const selfOk = window.App.assertNoBookingOverlap(
        bk.providerId,
        bk.dateISO,
        bk.from,
        bk.to,
        bk.id
      );
      return {
        blocked: !hit.ok,
        selfAllowed: selfOk.ok,
        from: bk.from,
        dateISO: bk.dateISO,
      };
    });

    expect(result.blocked).toBe(true);
    expect(result.selfAllowed).toBe(true);
  });

  test("produkcja startuje bez danych demo, także ze starym localStorage", async function ({ page }) {
    await page.addInitScript(function () {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.register) {
          navigator.serviceWorker.register = function () {
            return Promise.reject(new Error("e2e: service worker disabled"));
          };
        }
      } catch (err) {
        /* ignore */
      }
      localStorage.setItem(
        "lokalnie.state",
        JSON.stringify({
          bookings: [{ id: "legacy-demo-without-flag", status: "confirmed" }],
          requests: [{ id: "legacy-request-without-flag", status: "pending" }],
          loggedIn: false,
        })
      );
      let api;
      Object.defineProperty(window, "LokalnieApi", {
        configurable: true,
        enumerable: true,
        get: function () {
          return api;
        },
        set: function (value) {
          api = value;
          if (!api) return;
          api.enabled = false;
          api.isProductionHostname = function () {
            return true;
          };
          api.syncFromServer = function () {
            return Promise.resolve({ ok: false, skipped: true });
          };
        },
      });
    });
    await page.goto("/index.html?e2e=prod-empty", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return !!(window.App && window.AppState);
    });

    const state = await page.evaluate(function () {
      window.App.renderAll();
      return {
        bookings: window.AppState.bookings.length,
        requests: window.AppState.requests.length,
        testerButtons: document.querySelectorAll('[data-action="test-login"]').length,
      };
    });
    expect(state).toEqual({ bookings: 0, requests: 0, testerButtons: 0 });
  });

  test("edycja booking rollbackuje pola po błędzie PATCH", async function ({ page }) {
    await resetAndLogin(page, "provider");
    const result = await page.evaluate(async function () {
      localStorage.removeItem("lokalnie.testerMode");
      window.LokalnieApi.setAuthToken("e2e-token");
      window.LokalnieApi.enabled = true;
      window.LokalnieApi.upsertClient = function () {
        return Promise.resolve(null);
      };
      let patchCalls = 0;
      window.LokalnieApi.patchBookingFromApp = function () {
        patchCalls += 1;
        const err = new Error("booking_overlap");
        err.status = 409;
        err.data = { error: "booking_overlap" };
        return Promise.reject(err);
      };

      const booking = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === "bk-demo-gb-1700";
      });
      if (!booking) throw new Error("Brak booking do testu rollbacku");
      booking._fromApi = true;
      const before = JSON.parse(JSON.stringify(booking));
      window.App.openProvCalEdit(booking.id);
      window.AppState.provCalAddDraft.clientName = "Zmiana, która ma zostać cofnięta";
      await window.App.confirmProvCalAdd();
      return {
        patchCalls: patchCalls,
        before: before,
        after: JSON.parse(JSON.stringify(booking)),
        panelOpen: window.AppState.provCalAddOpen,
        toast: document.getElementById("app-toast").textContent,
      };
    });

    expect(result.patchCalls).toBe(1);
    expect(result.after).toEqual(result.before);
    expect(result.panelOpen).toBe(true);
    expect(result.toast).toBe("Termin został właśnie zajęty");
  });

  test("cancel i reject czekają na mock decline API", async function ({ page }) {
    await resetAndLogin(page, "client");
    const result = await page.evaluate(async function () {
      localStorage.removeItem("lokalnie.testerMode");
      window.LokalnieApi.setAuthToken("e2e-token");
      window.LokalnieApi.enabled = true;
      const calls = [];
      window.LokalnieApi.declineRequestFromApp = function (id, action) {
        calls.push({ id: id, action: action });
        return Promise.resolve({ id: id, status: "rejected" });
      };

      function request(id, status) {
        return {
          id: id,
          providerId: "grzesiu-barber",
          providerName: "Grzesiu Barber",
          clientName: "Klient E2E",
          serviceIds: ["svc-gb-cut"],
          serviceNames: ["Strzyżenie"],
          proposals: status === "proposed" ? [{ id: "p1" }] : [],
          status: status,
          _fromApi: true,
        };
      }
      const cancelReq = request("rq-e2e-cancel", "pending");
      const rejectReq = request("rq-e2e-reject", "pending");
      const proposalsReq = request("rq-e2e-proposals", "proposed");
      window.AppState.requests.push(cancelReq, rejectReq, proposalsReq);

      await window.App.cancelClientRequest(cancelReq.id);
      await window.App.rejectRequest(rejectReq.id);
      await window.App.declineRequestProposals(proposalsReq.id);
      return {
        calls: calls,
        statuses: [cancelReq.status, rejectReq.status, proposalsReq.status],
        toast: document.getElementById("app-toast").textContent,
      };
    });

    expect(result.calls).toEqual([
      { id: "rq-e2e-cancel", action: "cancel-request" },
      { id: "rq-e2e-reject", action: "reject-request" },
      { id: "rq-e2e-proposals", action: "decline-proposals" },
    ]);
    expect(result.statuses).toEqual(["cancelled", "rejected", "rejected"]);
    expect(result.toast).toContain("Możesz wysłać nową prośbę");
  });

  test("propose, decline i PATCH ponawiają stabilne Idempotency-Key", async function ({ page }) {
    const seen = [];
    await page.route("https://api.lokalnie.app/**", async function (route) {
      const request = route.request();
      seen.push({
        path: new URL(request.url()).pathname,
        key: request.headers()["idempotency-key"],
      });
      const path = new URL(request.url()).pathname;
      const body = path.endsWith("/propose")
        ? {
            request: {
              id: "rq-idem",
              status: "proposed",
              proposals: [
                {
                  id: "p1",
                  dateISO: "2026-08-04",
                  from: "10:00",
                  to: "10:30",
                  locationLabel: null,
                },
              ],
            },
          }
        : path.endsWith("/decline")
          ? { request: { id: "rq-idem", status: "rejected" } }
          : { booking: { id: "bk-idem", status: "confirmed" } };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await gotoApp(page);
    const keys = await page.evaluate(async function () {
      window.LokalnieApi.enabled = true;
      window.LokalnieApi.setAuthToken("e2e-token");
      const req = {
        id: "rq-idem",
        proposals: [{ id: "p1", dateISO: "2026-08-04", from: "10:00", to: "10:30" }],
      };
      const booking = { id: "bk-idem" };
      await window.LokalnieApi.proposeRequestFromApp(req);
      await window.LokalnieApi.proposeRequestFromApp(req);
      await window.LokalnieApi.declineRequestFromApp(req.id, "decline-proposals");
      await window.LokalnieApi.declineRequestFromApp(req.id, "decline-proposals");
      const patch = { status: "confirmed", dateISO: "2026-08-04", from: "10:00", to: "10:30" };
      await window.LokalnieApi.patchBookingFromApp(booking, patch, "edit-booking");
      await window.LokalnieApi.patchBookingFromApp(booking, patch, "edit-booking");
      return true;
    });
    expect(keys).toBe(true);
    expect(seen).toHaveLength(6);
    expect(seen.every(function (entry) { return !!entry.key; })).toBe(true);
    expect(seen[0].key).toBe(seen[1].key);
    expect(seen[2].key).toBe(seen[3].key);
    expect(seen[4].key).toBe(seen[5].key);
  });
});
