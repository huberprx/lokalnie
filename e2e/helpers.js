/**
 * Helpery E2E dla Lokalnie — reset demo, logowanie, przełączanie ról.
 * Ważne: selektory w `#app-fullscreen` (nie w ukrytym symulatorze na landingu).
 * @param {import('@playwright/test').Page} page
 */

const APP = "#app-fullscreen";

/**
 * Guardy E2E przed skryptami strony:
 * - sync API nie nadpisuje demo bookings
 * - Service Worker nie robi location.reload() (controllerchange)
 */
async function installE2eGuards(page) {
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

    var api = undefined;
    Object.defineProperty(window, "LokalnieApi", {
      configurable: true,
      enumerable: true,
      get: function () {
        return api;
      },
      set: function (value) {
        api = value;
        if (!api || typeof api !== "object") return;
        api.enabled = false;
        api.syncFromServer = function () {
          return Promise.resolve({ ok: false, skipped: true, reason: "e2e" });
        };
        api.loadCatalog = function () {
          return Promise.resolve({ ok: false, skipped: true, reason: "e2e" });
        };
        api.fetchProviderBySlug = function () {
          return Promise.resolve(null);
        };
      },
    });
  });
}

async function gotoApp(page) {
  await installE2eGuards(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () {
    return !!(window.App && window.AppState && typeof window.App.renderAll === "function");
  });
}

async function resetAndLogin(page, role) {
  await gotoApp(page);
  await page.evaluate(function (startRole) {
    try {
      localStorage.clear();
    } catch (err) {
      /* ignore */
    }
    if (window.LokalnieApi) {
      window.LokalnieApi.enabled = false;
      window.LokalnieApi.syncFromServer = function () {
        return Promise.resolve({ ok: false, skipped: true, reason: "e2e" });
      };
    }
    window.App.resetDemo();
    window.App.testLogin(startRole || "client");
  }, role || "client");
  await page.waitForSelector("#page-app:not([hidden])");
  await page.waitForSelector(APP + " .app-screen");
}

async function switchRole(page, role) {
  await page.evaluate(function (nextRole) {
    window.AppState.appMenuOpen = false;
    window.App.switchRole(nextRole);
  }, role);
  await page.waitForFunction(
    function (nextRole) {
      return window.AppState && window.AppState.activeRole === nextRole;
    },
    role
  );
}

async function goClientMyCalendar(page) {
  await page.evaluate(function () {
    window.AppState.activeRole = "client";
    window.AppState.screen.client = "myCalendar";
    window.AppState.myCalStatusFilters = ["pending"];
    window.App.saveState();
    window.App.renderAll();
  });
  await page.waitForSelector(APP + " .app-screen--my-cal");
}

async function goProviderCalendar(page) {
  await page.evaluate(function () {
    window.AppState.activeRole = "provider";
    window.AppState.screen.provider = "calendar";
    window.AppState.dashListMode = "requests";
    window.App.saveState();
    window.App.renderAll();
  });
  await page.waitForSelector(APP + " .app-screen--prov-cal");
}

/** Native click w #app-fullscreen — omija ukryty symulator i karuzele. */
async function clickAction(page, selector) {
  const full = selector.startsWith(APP) ? selector : APP + " " + selector;
  await page.waitForFunction(
    function (sel) {
      return !!document.querySelector(sel);
    },
    full,
    { timeout: 15_000 }
  );
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("Brak elementu: " + sel);
    el.click();
  }, full);
}

/**
 * Seeduje propozycje w panelu odpowiedzi i wysyła.
 * @param {import('@playwright/test').Page} page
 * @param {string} requestId
 * @param {Array<object>} proposals
 */
async function seedProposalsAndSend(page, requestId, proposals) {
  await clickAction(page, `[data-action="propose-open"][data-request-id="${requestId}"]`);
  await page.waitForFunction(
    function (id) {
      return !!(
        window.AppState.provCalAddOpen &&
        window.AppState.provCalAddDraft &&
        window.AppState.provCalAddDraft.requestId === id
      );
    },
    requestId
  );
  await page.evaluate(
    function (args) {
      const draft = window.AppState.provCalAddDraft;
      if (!draft || draft.requestId !== args.requestId) {
        throw new Error("Brak draftu odpowiedzi na prośbę " + args.requestId);
      }
      draft.proposals = args.proposals.map(function (p) {
        return Object.assign({}, p);
      });
      window.App.saveState();
      window.App.renderAll();
    },
    { requestId: requestId, proposals: proposals }
  );
  await page.waitForFunction(
    function (id) {
      const cta = document.querySelector(
        "#app-fullscreen [data-role='prov-cal-add-cta'][data-action='propose-confirm'][data-request-id='" +
          id +
          "']"
      );
      return !!(cta && !cta.disabled);
    },
    requestId
  );
  await clickAction(
    page,
    `[data-role="prov-cal-add-cta"][data-action="propose-confirm"][data-request-id="${requestId}"]`
  );
  await page.waitForFunction(
    function (id) {
      const req = (window.AppState.requests || []).find(function (r) {
        return r && r.id === id;
      });
      return !!(req && req.status === "proposed" && (req.proposals || []).length);
    },
    requestId
  );
}

module.exports = {
  APP,
  gotoApp,
  resetAndLogin,
  switchRole,
  goClientMyCalendar,
  goProviderCalendar,
  clickAction,
  seedProposalsAndSend,
};
