const { test, expect } = require("@playwright/test");
const { resetAndLogin, goProviderCalendar } = require("./helpers");

test.describe("stable booking reschedule", function () {
  test("maps a server proposal without losing the confirmed slot", async function ({ page }) {
    await resetAndLogin(page, "client");
    const mapped = await page.evaluate(function () {
      return window.LokalnieApi.mapBookingToApp({
        id: "bk-map",
        providerId: "provider-demo-gb",
        status: "proposed",
        dateISO: "2026-08-10",
        from: "10:00",
        to: "10:45",
        locationLabel: "Stare studio",
        proposedDateISO: "2026-08-11",
        proposedFrom: "12:00",
        proposedTo: "12:45",
        proposedLocationLabel: "Nowe studio",
        rescheduleExpiresAt: "2026-08-09T12:00:00.000Z",
        revision: 7,
      });
    });

    expect(mapped).toMatchObject({
      dateISO: "2026-08-11",
      from: "12:00",
      to: "12:45",
      locationLabel: "Nowe studio",
      reschedulePrevDateISO: "2026-08-10",
      reschedulePrevFrom: "10:00",
      reschedulePrevTo: "10:45",
      proposeExpiresAt: "2026-08-09T12:00:00.000Z",
      revision: 7,
      _fromApi: true,
    });
  });

  test("uses dedicated proposal, accept and reject contracts", async function ({ page }) {
    const calls = [];
    await page.route("https://api.lokalnie.app/bookings/**", async function (route) {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataJSON();
      calls.push({ path: url.pathname, method: request.method(), body: body });
      const decision = url.pathname.endsWith("/accept")
        ? "accept"
        : url.pathname.endsWith("/reject")
          ? "reject"
          : "propose";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          booking: {
            id: "bk-contract",
            providerId: "provider-demo-gb",
            status: decision === "propose" ? "proposed" : "confirmed",
            dateISO: decision === "reject" ? "2026-08-10" : "2026-08-11",
            from: decision === "reject" ? "10:00" : "12:00",
            to: decision === "reject" ? "10:45" : "12:45",
            revision: decision === "propose" ? 4 : 5,
            proposedDateISO: decision === "propose" ? "2026-08-11" : null,
            proposedFrom: decision === "propose" ? "12:00" : null,
            proposedTo: decision === "propose" ? "12:45" : null,
          },
          calendar: { synced: true },
        }),
      });
    });
    await resetAndLogin(page, "provider");
    await page.evaluate(async function () {
      localStorage.removeItem("lokalnie.testerMode");
      window.LokalnieApi.setAuthToken("e2e-token");
      const booking = {
        id: "bk-contract",
        revision: 3,
        locationLabel: "Studio",
      };
      await window.LokalnieApi.proposeBookingRescheduleFromApp(booking, {
        dateISO: "2026-08-11",
        from: "12:00",
        to: "12:45",
        locationLabel: "Nowe studio",
      });
      await window.LokalnieApi.acceptBookingRescheduleFromApp(
        Object.assign({}, booking, { revision: 4 })
      );
      await window.LokalnieApi.rejectBookingRescheduleFromApp(
        Object.assign({}, booking, { revision: 4 })
      );
    });

    expect(calls).toEqual([
      {
        path: "/bookings/bk-contract/reschedule",
        method: "POST",
        body: {
          dateISO: "2026-08-11",
          from: "12:00",
          to: "12:45",
          locationLabel: "Nowe studio",
          expectedRevision: 3,
        },
      },
      {
        path: "/bookings/bk-contract/reschedule/accept",
        method: "POST",
        body: { expectedRevision: 4 },
      },
      {
        path: "/bookings/bk-contract/reschedule/reject",
        method: "POST",
        body: { expectedRevision: 4 },
      },
    ]);
  });

  test("edit Zapisz sends proposal immediately and clears badge queue", async function ({ page }) {
    await resetAndLogin(page, "provider");
    await goProviderCalendar(page);
    const result = await page.evaluate(async function () {
      window.LokalnieApi.setAuthToken("e2e-token");
      window.LokalnieApi.enabled = true;
      let patchCalls = 0;
      let proposalCalls = 0;
      window.LokalnieApi.patchBookingFromApp = async function () {
        patchCalls += 1;
        return {};
      };
      window.LokalnieApi.proposeBookingRescheduleFromApp = async function (booking, proposal) {
        proposalCalls += 1;
        if (proposalCalls === 1) throw Object.assign(new Error("offline"), { status: 0 });
        return {
          booking: Object.assign({}, booking, proposal, {
            status: "proposed",
            reschedulePrevDateISO: "2026-07-20",
            reschedulePrevFrom: "17:00",
            reschedulePrevTo: "17:45",
            revision: 2,
            _fromApi: true,
          }),
        };
      };

      const booking = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === "bk-demo-gb-1700";
      });
      booking._fromApi = true;
      booking.clientUserId = "user-client";
      booking.revision = 1;
      window.App.openProvCalEdit(booking.id);
      const draft = window.AppState.provCalAddDraft;
      const provider = window.AppState.myProvider;
      const slots = window.App.computeSlots(provider, draft.dateISO, 45, {
        exceptBookingId: booking.id,
      });
      const next = slots.find(function (slot) {
        return slot.from !== booking.from;
      });
      if (!next) throw new Error("Brak alternatywnego slotu");
      draft.slotId = next.id;
      draft.dateISO = next.dateISO || draft.dateISO;
      window.App.syncProvCalSelectionFromAddDraft();
      window.App.renderAll();
      localStorage.removeItem("lokalnie.testerMode");

      const queuedAfterCarousel = window.AppState.provCalRescheduleQueue.length;
      const queueButtonWhileEdit = !!document.querySelector(
        '[data-action="open-prov-cal-reschedule"]'
      );
      const ctaDisabledAfterChange = !window.App.isProvCalEditTimeDirty
        ? null
        : !window.App.isProvCalEditTimeDirty(draft);

      const first = await window.App.confirmProvCalAdd();
      const queuedAfterFailure = window.AppState.provCalRescheduleQueue.length;
      const panelOpenAfterFailure = !!window.AppState.provCalAddOpen;

      await window.App.confirmProvCalAdd();
      return {
        patchCalls: patchCalls,
        proposalCalls: proposalCalls,
        queuedAfterCarousel: queuedAfterCarousel,
        queueButtonWhileEdit: queueButtonWhileEdit,
        queuedAfterFailure: queuedAfterFailure,
        panelOpenAfterFailure: panelOpenAfterFailure,
        queuedAfterSuccess: window.AppState.provCalRescheduleQueue.length,
        panelOpenAfterSuccess: !!window.AppState.provCalAddOpen,
        status: booking.status,
        revision: booking.revision,
        firstReturned: first,
        ctaDisabledAfterChange: ctaDisabledAfterChange,
      };
    });

    expect(result).toMatchObject({
      patchCalls: 0,
      proposalCalls: 2,
      queuedAfterCarousel: 1,
      queueButtonWhileEdit: true,
      queuedAfterFailure: 1,
      panelOpenAfterFailure: true,
      queuedAfterSuccess: 0,
      panelOpenAfterSuccess: false,
      status: "proposed",
      revision: 2,
    });
  });

  test("drag only queues; list Wyślij sends and clears badge", async function ({ page }) {
    await resetAndLogin(page, "provider");
    await goProviderCalendar(page);
    const result = await page.evaluate(async function () {
      window.LokalnieApi.setAuthToken("e2e-token");
      window.LokalnieApi.enabled = true;
      let proposalCalls = 0;
      window.LokalnieApi.proposeBookingRescheduleFromApp = async function (booking, proposal) {
        proposalCalls += 1;
        return {
          booking: Object.assign({}, booking, proposal, {
            status: "proposed",
            reschedulePrevDateISO: booking.dateISO,
            reschedulePrevFrom: "17:00",
            reschedulePrevTo: "17:45",
            revision: (booking.revision || 0) + 1,
            _fromApi: true,
          }),
        };
      };

      const booking = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === "bk-demo-gb-1700";
      });
      booking._fromApi = true;
      booking.clientUserId = "user-client";
      booking.revision = 1;
      const origDate = booking.dateISO;
      const origFrom = booking.from;
      const origTo = booking.to;

      function toMin(t) {
        const p = String(t).split(":");
        return Number(p[0]) * 60 + Number(p[1] || 0);
      }
      function toTime(m) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
      }
      const dur = toMin(origTo) - toMin(origFrom);
      const newFromMin = toMin(origFrom) + 60;
      const newFrom = toTime(newFromMin);
      const newTo = toTime(newFromMin + dur);
      booking.from = newFrom;
      booking.to = newTo;
      window.AppState.provCalRescheduleQueue = [
        {
          bookingId: booking.id,
          origDateISO: origDate,
          origFrom: origFrom,
          origTo: origTo,
          newDateISO: booking.dateISO,
          newFrom: newFrom,
          newTo: newTo,
        },
      ];
      window.App.saveState();
      window.App.renderAll();
      localStorage.removeItem("lokalnie.testerMode");

      const queuedBefore = window.AppState.provCalRescheduleQueue.length;
      const send = await window.App.sendAllProvCalReschedule();
      return {
        proposalCalls: proposalCalls,
        queuedBefore: queuedBefore,
        queuedAfter: window.AppState.provCalRescheduleQueue.length,
        send: send,
        status: booking.status,
        queueButtonAfterSend: !!document.querySelector(
          '[data-action="open-prov-cal-reschedule"]'
        ),
      };
    });

    expect(result).toMatchObject({
      proposalCalls: 1,
      queuedBefore: 1,
      queuedAfter: 0,
      send: { sent: 1, failed: 0 },
      status: "proposed",
      queueButtonAfterSend: false,
    });
  });
});
