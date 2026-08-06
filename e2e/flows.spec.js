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
      let upsertCalls = 0;
      window.LokalnieApi.upsertClient = function () {
        upsertCalls += 1;
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
      const clientsBefore = JSON.parse(JSON.stringify(window.AppState.providerClients || {}));
      window.App.openProvCalEdit(booking.id);
      window.AppState.provCalAddDraft.clientName = "Zmiana, która ma zostać cofnięta";
      await window.App.confirmProvCalAdd();
      return {
        patchCalls: patchCalls,
        before: before,
        after: JSON.parse(JSON.stringify(booking)),
        clientsBefore: clientsBefore,
        clientsAfter: JSON.parse(JSON.stringify(window.AppState.providerClients || {})),
        upsertCalls: upsertCalls,
        panelOpen: window.AppState.provCalAddOpen,
        toast: document.getElementById("app-toast").textContent,
      };
    });

    expect(result.patchCalls).toBe(1);
    expect(result.after).toEqual(result.before);
    expect(result.clientsAfter).toEqual(result.clientsBefore);
    expect(result.upsertCalls).toBe(0);
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
      window.LokalnieApi.requestMoreRequestFromApp = function (id) {
        calls.push({ id: id, action: "request-more" });
        return Promise.resolve({ id: id, status: "pending", proposals: [] });
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
      { id: "rq-e2e-proposals", action: "request-more" },
    ]);
    expect(result.statuses).toEqual(["cancelled", "rejected", "pending"]);
    expect(result.toast).toContain("Poprosiliśmy o inne terminy");
  });

  test("retry zachowuje, a sukces zwalnia Idempotency-Key", async function ({ page }) {
    const seen = [];
    const attempts = Object.create(null);
    await page.route("https://api.lokalnie.app/**", async function (route) {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      attempts[path] = (attempts[path] || 0) + 1;
      seen.push({
        path: path,
        key: request.headers()["idempotency-key"],
      });
      if (attempts[path] === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary_failure" }),
        });
        return;
      }
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
          : path.endsWith("/request-more")
            ? { request: { id: "rq-idem", status: "pending", proposals: [] } }
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
      await window.LokalnieApi.proposeRequestFromApp(req).catch(function () {});
      await window.LokalnieApi.proposeRequestFromApp(req);
      await window.LokalnieApi.proposeRequestFromApp(req);
      await window.LokalnieApi.declineRequestFromApp(req.id, "decline-request").catch(function () {});
      await window.LokalnieApi.declineRequestFromApp(req.id, "decline-request");
      await window.LokalnieApi.declineRequestFromApp(req.id, "decline-request");
      await window.LokalnieApi.requestMoreRequestFromApp(req.id).catch(function () {});
      await window.LokalnieApi.requestMoreRequestFromApp(req.id);
      await window.LokalnieApi.requestMoreRequestFromApp(req.id);
      await Promise.allSettled([
        window.LokalnieApi.acceptRequestFromApp("rq-concurrent", "p1"),
        window.LokalnieApi.acceptRequestFromApp("rq-concurrent", "p1"),
      ]);
      await window.LokalnieApi.acceptRequestFromApp("rq-concurrent", "p1");
      const patch = { status: "confirmed", dateISO: "2026-08-04", from: "10:00", to: "10:30" };
      await window.LokalnieApi.patchBookingFromApp(booking, patch, "edit-booking").catch(function () {});
      await window.LokalnieApi.patchBookingFromApp(booking, patch, "edit-booking");
      await window.LokalnieApi.patchBookingFromApp(booking, patch, "edit-booking");
      return true;
    });
    expect(keys).toBe(true);
    expect(seen).toHaveLength(15);
    expect(seen.every(function (entry) { return !!entry.key; })).toBe(true);
    expect(seen[0].key).toBe(seen[1].key);
    expect(seen[2].key).not.toBe(seen[1].key);
    expect(seen[3].key).toBe(seen[4].key);
    expect(seen[5].key).not.toBe(seen[4].key);
    expect(seen[6].key).toBe(seen[7].key);
    expect(seen[8].key).not.toBe(seen[7].key);
    expect(seen[9].key).toBe(seen[10].key);
    expect(seen[11].key).not.toBe(seen[10].key);
    expect(seen[12].key).toBe(seen[13].key);
    expect(seen[14].key).not.toBe(seen[13].key);
  });

  test("druga pętla propose → request-more → propose dostaje nowe klucze", async function ({ page }) {
    const calls = [];
    await page.route("https://api.lokalnie.app/requests/**", async function (route) {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const key = request.headers()["idempotency-key"];
      calls.push({ path: path, key: key });
      if (path.endsWith("/request-more")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            request: { id: "rq-demo-magda", status: "pending", proposals: [] },
          }),
        });
        return;
      }
      const payload = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          request: {
            id: "rq-demo-magda",
            status: "proposed",
            proposals: payload.proposals || [],
          },
        }),
      });
    });

    await resetAndLogin(page, "provider");
    await page.evaluate(function () {
      localStorage.removeItem("lokalnie.testerMode");
      window.LokalnieApi.setAuthToken("e2e-token");
      window.LokalnieApi.enabled = true;
      const req = (window.AppState.requests || []).find(function (r) {
        return r && r.id === "rq-demo-magda";
      });
      if (!req) throw new Error("Brak rq-demo-magda");
      req._fromApi = true;
    });
    await goProviderCalendar(page);

    const firstProposal = [
      {
        id: "loop-a",
        dateISO: "2026-07-20",
        from: "10:00",
        to: "10:45",
        locationId: "loc-gb-1",
        locationLabel: "Studio główne",
      },
    ];
    await seedProposalsAndSend(page, "rq-demo-magda", firstProposal);
    await switchRole(page, "client");
    await page.evaluate(async function () {
      await window.App.declineRequestProposals("rq-demo-magda");
    });
    const pending = await page.evaluate(function () {
      const req = window.AppState.requests.find(function (r) {
        return r.id === "rq-demo-magda";
      });
      return { status: req.status, proposals: req.proposals.length };
    });
    expect(pending).toEqual({ status: "pending", proposals: 0 });

    await switchRole(page, "provider");
    await goProviderCalendar(page);
    const secondProposal = [
      {
        id: "loop-b",
        dateISO: "2026-07-20",
        from: "11:00",
        to: "11:45",
        locationId: "loc-gb-1",
        locationLabel: "Studio główne",
      },
    ];
    await seedProposalsAndSend(page, "rq-demo-magda", secondProposal);

    const finalState = await page.evaluate(function () {
      const req = window.AppState.requests.find(function (r) {
        return r.id === "rq-demo-magda";
      });
      return { status: req.status, proposalId: req.proposals[0] && req.proposals[0].id };
    });
    expect(finalState).toEqual({ status: "proposed", proposalId: "loop-b" });
    expect(calls.map(function (entry) { return entry.path; })).toEqual([
      "/requests/rq-demo-magda/propose",
      "/requests/rq-demo-magda/request-more",
      "/requests/rq-demo-magda/propose",
    ]);
    expect(calls.every(function (entry) { return !!entry.key; })).toBe(true);
    expect(calls[0].key).not.toBe(calls[2].key);
  });

  test("onboarding czeka na zapis profilu także przy produkcyjnej sesji cookie", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      localStorage.removeItem("lokalnie.testerMode");
      window.__profileWrites = 0;
      window.LokalnieApi.isProductionHostname = function () {
        return true;
      };
      window.LokalnieApi.getAuthToken = function () {
        return "";
      };
      window.LokalnieApi.updateMe = async function (profile) {
        window.__profileWrites += 1;
        return {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          notifications: { booking: true, reminder: true, marketing: false },
        };
      };
    });
    await page.locator('#app-fullscreen [data-role="onb-client-phone"]').fill("+48 500 600 700");
    await page.locator('#app-fullscreen [data-action="onboarding-client-submit"]').click();
    await page.waitForFunction(function () {
      return window.AppState.onboarding === null;
    });
    const result = await page.evaluate(function () {
      return {
        writes: window.__profileWrites,
        phone: window.AppState.clientProfile.phone,
        onboarding: window.AppState.onboarding,
      };
    });
    expect(result).toEqual({
      writes: 1,
      phone: "+48 500 600 700",
      onboarding: null,
    });
  });

  test("sync odtwarza pełny panel usługodawcy, usługi i dostępność", async function ({ page }) {
    await page.addInitScript(function () {
      if (navigator.serviceWorker && navigator.serviceWorker.register) {
        navigator.serviceWorker.register = function () {
          return Promise.reject(new Error("e2e: service worker disabled"));
        };
      }
    });
    await page.route("https://api.lokalnie.app/**", async function (route) {
      const path = new URL(route.request().url()).pathname;
      const payloads = {
        "/me": {
          authenticated: true,
          user: {
            id: "user-returning",
            name: "Anna Studio",
            email: "anna@example.com",
            phone: "+48 500 600 700",
            roles: { client: true, provider: true },
          },
          provider: {
            id: "provider-returning",
            slug: "anna-studio",
            name: "Anna Studio",
            category: "beauty",
            city: "Warszawa",
            address: "Prosta 1",
            about: "Opis",
            email: "anna@example.com",
            emailVisible: true,
            phone: "+48 500 600 700",
            bookingMode: "auto",
            visibleInSearch: true,
            multiSelect: true,
            locations: [{ id: "salon", label: "Salon", address: "Prosta 1", toneIndex: 0 }],
            socialLinks: [{ id: "social-1", kind: "instagram", value: "anna" }],
            bookingRules: {
              futureDays: 60,
              minLeadHours: 2,
              cancelHours: 24,
              proposeHoldHours: 24,
              policy: "",
            },
            deactivated: false,
          },
        },
        "/provider/me/services": {
          services: [
            {
              id: "svc-returning",
              name: "Manicure",
              bookingMode: "auto",
              durationMin: 60,
              price: 120,
              photoIds: [],
              locationIds: ["salon"],
              variants: [],
            },
          ],
        },
        "/provider/me/availability": {
          availability: [
            {
              dateISO: "2026-10-10",
              blocks: [
                {
                  from: "09:00",
                  to: "15:00",
                  locationId: "salon",
                  repeat: "none",
                  recurring: false,
                },
              ],
            },
          ],
        },
        "/provider/me/clients": { clients: [] },
        "/bookings": { bookings: [] },
        "/requests": { requests: [] },
        "/calendar/connections": { connections: [] },
      };
      const body = payloads[path];
      await route.fulfill({
        status: body ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(body || { error: "not_found" }),
      });
    });
    await page.goto("/index.html?e2e=provider-restore", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return !!(window.App && window.LokalnieApi);
    });
    const result = await page.evaluate(async function () {
      window.LokalnieApi.setAuthToken("returning-user-token");
      window.AppState.loggedIn = true;
      const synced = await window.LokalnieApi.syncFromServer();
      const provider = window.AppState.providerProfiles[0];
      return {
        synced: synced.ok,
        name: provider && provider.name,
        category: provider && provider.category,
        locations: provider && provider.locations.length,
        services: provider && provider.services.map(function (service) { return service.name; }),
        availability: provider && provider.availability.map(function (day) { return day.dateISO; }),
      };
    });
    expect(result).toEqual({
      synced: true,
      name: "Anna Studio",
      category: "beauty",
      locations: 1,
      services: ["Manicure"],
      availability: ["2026-10-10"],
    });
  });
});
