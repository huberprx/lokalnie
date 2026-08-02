const { test, expect } = require("@playwright/test");
const {
  resetAndLogin,
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
});
