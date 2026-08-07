const { test, expect } = require("@playwright/test");
const { gotoApp, resetAndLogin, clickAction } = require("./helpers");

async function waitForApp(page) {
  await page.waitForFunction(function () {
    return !!(window.App && window.AppState && document.querySelector("#page-app:not([hidden])"));
  });
}

test.describe("Lokalnie — routing URL", function () {
  test("URL wyszukiwania odtwarza wyłącznie dozwolone filtry", async function ({ page }) {
    await gotoApp(page);
    await page.goto(
      "/?q=barber&kategoria=beauty&podkategoria=hair&miejsce=Gdańsk&promien=25" +
        "&data=2026-08-10&pora=morning&obce=pole",
      { waitUntil: "domcontentloaded" }
    );
    await waitForApp(page);

    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            screen: window.AppState.screen.client,
            role: window.AppState.activeRole,
            q: window.AppState.searchQuery,
            category: window.AppState.searchCategory,
            subcategory: window.AppState.searchSubcategory,
            location: window.AppState.searchLocation,
            radius: window.AppState.searchRadiusKm,
            dates: window.AppState.searchFilterDates,
            periods: window.AppState.searchFilterPeriods,
          };
        });
      })
      .toEqual({
        screen: "search",
        role: "client",
        q: "barber",
        category: "beauty",
        subcategory: "hair",
        location: "Gdańsk",
        radius: 25,
        dates: ["2026-08-10"],
        periods: ["morning"],
      });
    await expect(page).toHaveURL(
      /\/\?q=barber&kategoria=beauty&podkategoria=hair&miejsce=Gda%C5%84sk&promien=25&data=2026-08-10&pora=morning$/
    );
  });

  test("bezpośrednie logowanie wraca przez bezpieczne powrot i bez niego opuszcza /logowanie", async function ({ page }) {
    await gotoApp(page);
    await page.goto("/logowanie?powrot=%2Fulubione", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page).toHaveURL(/\/logowanie\?powrot=%2Fulubione$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.screen.client;
        });
      })
      .toBe("auth");

    await page.evaluate(function () {
      window.App.testLogin("client");
    });
    await expect(page).toHaveURL(/\/ulubione$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.activeRole + ":" + window.AppState.screen.client;
        });
      })
      .toBe("client:favorites");

    await page.goto("/logowanie", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.evaluate(function () {
      window.App.testLogin("client");
    });
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.screen.client;
        });
      })
      .toBe("search");
  });

  test("złośliwe powrot jest odrzucane i usuwane z URL", async function ({ page }) {
    await gotoApp(page);
    const malicious = [
      "%2F%2Fevil.example",
      "%2F%5C%5Cevil.example",
      "https%3A%2F%2Fevil.example",
      "%2Fhttps%3A%2F%2Fevil.example",
    ];
    for (const value of malicious) {
      await page.goto("/logowanie?powrot=" + value, { waitUntil: "domcontentloaded" });
      await waitForApp(page);
      await expect(page).toHaveURL(/\/logowanie$/);
    }
  });

  test("asynchroniczne odtworzenie sesji nie nadpisuje jawnej trasy", async function ({ page }) {
    await resetAndLogin(page, "provider");
    await page.evaluate(function () {
      history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.activeRole + ":" + window.AppState.screen.client;
        });
      })
      .toBe("client:search");

    const historyBefore = await page.evaluate(function () {
      return history.length;
    });
    await page.evaluate(async function () {
      const me = {
        authenticated: true,
        isAdmin: false,
        user: {
          id: "user-cookie-route",
          name: "Anna Studio",
          email: "anna@example.com",
          phone: "+48 500 600 700",
          roles: { client: true, provider: true },
        },
        provider: {
          id: "provider-cookie-route",
          slug: "anna-studio",
          name: "Anna Studio",
          category: "beauty",
          city: "Warszawa",
          phone: "+48 500 600 700",
        },
      };
      window.LokalnieApi.isProductionHostname = function () {
        return true;
      };
      window.LokalnieApi.request = async function (path) {
        if (path === "/me") return me;
        return {};
      };
      window.LokalnieApi.syncFromServer = async function () {
        // Symuluje wcześniejszy błąd: sync przywracał ostatnią rolę usługodawcy.
        window.AppState.activeRole = "provider";
        window.AppState.screen.provider = "dashboard";
        return { ok: true };
      };
      await window.App.restoreCookieSession();
    });
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.activeRole + ":" + window.AppState.screen.client;
        });
      })
      .toBe("client:search");
    expect(
      await page.evaluate(function () {
        return history.length;
      })
    ).toBe(historyBefore);
  });

  test("profil przyjmuje tylko istniejącą preselekcję usługi", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.goto("/grzesiu-barber?usluga=svc-gb-1&usluga=brak&obce=1", {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            screen: window.AppState.screen.client,
            slug: window.AppState.params.client.slug,
            services: window.AppState.draft && window.AppState.draft.serviceIds,
          };
        });
      })
      .toEqual({
        screen: "booking",
        slug: "grzesiu-barber",
        services: ["svc-gb-1"],
      });
    await expect(page).toHaveURL(/\/grzesiu-barber\?usluga=svc-gb-1$/);
  });

  test("kalendarze odtwarzają stabilne query i rolę", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.goto("/kalendarz?status=pending&data=2026-08-12", {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            role: window.AppState.activeRole,
            screen: window.AppState.screen.client,
            status: window.AppState.myCalStatusFilters[0],
            date: window.AppState.myCalDate,
          };
        });
      })
      .toEqual({
        role: "client",
        screen: "myCalendar",
        status: "pending",
        date: "2026-08-12",
      });

    await resetAndLogin(page, "provider");
    await page.evaluate(function () {
      history.replaceState(null, "", "/panel/kalendarz?widok=3&data=2026-08-13");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            role: window.AppState.activeRole,
            screen: window.AppState.screen.provider,
            days: window.AppState.provCalVisibleDays,
            date: window.AppState.provCalDate,
          };
        });
      })
      .toEqual({
        role: "provider",
        screen: "calendar",
        days: 3,
        date: "2026-08-13",
      });

    await page.evaluate(function () {
      history.replaceState(null, "", "/panel/prosby");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.screen.provider + ":" + window.AppState.dashListMode;
        });
      })
      .toBe("dashboard:requests");
  });

  test("/konto, /admin i wszystkie trasy panelu ustawiają właściwy ekran", async function ({ page }) {
    await gotoApp(page);
    await page.goto("/konto/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/konto$/);
    expect(
      await page.evaluate(function () {
        return window.AppState.activeRole + ":" + window.AppState.screen.client;
      })
    ).toBe("client:account");

    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.isAdmin = true;
      window.LokalnieApi.request = async function () {
        return { users: [] };
      };
      history.replaceState(null, "", "/admin?tab=users");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\?tab=users$/);
    expect(
      await page.evaluate(function () {
        return window.AppState.screen.client + ":" + window.AppState.admin.tab;
      })
    ).toBe("admin:users");

    await resetAndLogin(page, "provider");
    const routes = [
      ["/panel", "dashboard:visits"],
      ["/panel/kalendarz", "calendar:visits"],
      ["/panel/prosby", "dashboard:requests"],
      ["/panel/uslugi", "services:visits"],
      ["/panel/dostepnosc", "availability:visits"],
      ["/panel/ustawienia", "settings:visits"],
    ];
    for (const [path, expected] of routes) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response && response.status()).toBe(200);
      await waitForApp(page);
      await expect
        .poll(async function () {
          return page.evaluate(function () {
            return window.AppState.screen.provider + ":" + window.AppState.dashListMode;
          });
        })
        .toBe(expected);
    }

    const rootAssetsLoaded = await page.evaluate(function () {
      const scripts = Array.from(document.scripts).map(function (script) {
        return script.src ? new URL(script.src).pathname : "";
      });
      const styles = Array.from(document.styleSheets).map(function (sheet) {
        return sheet.href ? new URL(sheet.href).pathname : "";
      });
      return scripts.indexOf("/app.js") !== -1 && styles.indexOf("/styles.css") !== -1;
    });
    expect(rootAssetsLoaded).toBe(true);
  });

  test("embed i legacy hash zachowują działanie i kanonikalizują URL", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.goto("/embed/grzesiu-barber?usluga=svc-gb-1", {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            embed: document.documentElement.classList.contains("embed-mode"),
            screen: window.AppState.screen.client,
            slug: window.AppState.params.client.slug,
          };
        });
      })
      .toEqual({ embed: true, screen: "booking", slug: "grzesiu-barber" });

    await page.goto("/#provider/grzesiu-barber", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/grzesiu-barber$/);
    await page.goto("/#simulator", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/$/);
  });

  test("/embed/:slug/panel otwiera rezerwację bez paska profilu", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.goto("/embed/grzesiu-barber/panel", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return {
            embed: document.documentElement.classList.contains("embed-mode"),
            panel: document.documentElement.classList.contains("embed-mode--panel"),
            screen: window.AppState.screen.client,
            slug: window.AppState.params.client && window.AppState.params.client.slug,
            hasProviderCard: !!document.querySelector(
              "#app-fullscreen .app-screen--booking .booking__provider-card"
            ),
            hasProviderName: /Grzesiu Barber/i.test(
              (document.querySelector("#app-fullscreen .app-screen--booking") || {}).textContent ||
                ""
            ),
          };
        });
      })
      .toEqual({
        embed: true,
        panel: true,
        screen: "booking",
        slug: "grzesiu-barber",
        hasProviderCard: false,
        hasProviderName: false,
      });
    await expect(page).toHaveURL(/\/embed\/grzesiu-barber\/panel/);
  });

  test("popstate odtwarza ekran bez dopisywania historii", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.App.renderAll();
    });
    await clickAction(page, '[data-action="go-screen"][data-screen="favorites"]');
    await expect(page).toHaveURL(/\/ulubione$/);
    await clickAction(page, '[data-action="go-screen"][data-screen="myCalendar"]');
    await expect(page).toHaveURL(/\/kalendarz/);

    const before = await page.evaluate(function () {
      return history.length;
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/ulubione$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.screen.client;
        });
      })
      .toBe("favorites");
    expect(
      await page.evaluate(function () {
        return history.length;
      })
    ).toBe(before);
  });

  test("częsty filtr używa replaceState i nie zwiększa history.length", async function ({ page }) {
    await gotoApp(page);
    const before = await page.evaluate(function () {
      return history.length;
    });
    await page.evaluate(function () {
      const input = document.querySelector('#app-fullscreen [data-role="search-input"]');
      if (!input) throw new Error("Brak pola wyszukiwania");
      input.value = "fryzjer";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page).toHaveURL(/\/\?q=fryzjer$/, { timeout: 3_000 });
    expect(
      await page.evaluate(function () {
        return history.length;
      })
    ).toBe(before);
  });

  test("usunięcie konta wraca do marketplace i kanonikalizuje URL", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.AppState.activeRole = "client";
      window.AppState.screen.client = "account";
      window.LokalnieApi.deleteAccount = async function () {
        return { ok: true };
      };
      window.confirm = function () {
        return true;
      };
      window.App.renderAll();
      history.replaceState(null, "", "/konto");
    });
    await clickAction(page, '[data-action="delete-account"]');
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.loggedIn + ":" + window.AppState.screen.client;
        });
      })
      .toBe("false:search");
  });

  test("/index.html i trailing slash są kanonikalizowane", async function ({ page }) {
    await gotoApp(page);
    await page.goto("/index.html?obce=1", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/konto/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/konto$/);
  });

  test("nieznana ścieżka jest kanonikalizowana do strony głównej", async function ({ page }) {
    await gotoApp(page);
    await page.goto("/nieznana-strona?obce=1", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(async function () {
        return page.evaluate(function () {
          return window.AppState.screen.client;
        });
      })
      .toBe("search");
  });

  test("odświeżenie /:slug nie miga marketplace i zostaje na rezerwacji", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.App.saveState();
    });

    await page.goto("/grzesiu-barber", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return (
        window.AppState &&
        window.AppState.screen.client === "booking" &&
        !!document.querySelector(".app-screen--booking .booking__provider-card")
      );
    });

    await page.addInitScript(function () {
      window.__seenClientScreens = [];
      const push = function () {
        if (window.AppState && window.AppState.screen) {
          window.__seenClientScreens.push(window.AppState.screen.client);
        }
      };
      document.addEventListener("DOMContentLoaded", function () {
        const start = Date.now();
        const timer = setInterval(function () {
          push();
          if (Date.now() - start > 2500) clearInterval(timer);
        }, 50);
      });
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return (
        window.AppState &&
        window.AppState.screen.client === "booking" &&
        !!document.querySelector(".app-screen--booking .booking__provider-card")
      );
    });
    await page.waitForTimeout(300);

    const seen = await page.evaluate(function () {
      return window.__seenClientScreens || [];
    });
    await expect(page).toHaveURL(/\/grzesiu-barber$/);
    await expect(page.locator(".app-screen--booking .booking__provider-card")).toContainText(
      "Grzesiu Barber"
    );
    expect(seen.indexOf("search")).toBe(-1);
    expect(await page.locator("#app-fullscreen .app-screen--booking").count()).toBe(1);
  });

  test("loadCatalog nie wyciera detailsLoaded z profilu /:slug", async function ({ page }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.App.saveState();
    });
    await page.goto("/grzesiu-barber", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      const provider = window.App.getProviderBySlug("grzesiu-barber");
      return (
        window.AppState.screen.client === "booking" &&
        !!document.querySelector(".app-screen--booking .booking__provider-card") &&
        !!provider &&
        ((provider.services && provider.services.length > 0) || provider._detailsLoaded)
      );
    });

    const before = await page.evaluate(function () {
      const p = window.App.getProviderBySlug("grzesiu-barber");
      return {
        services: (p && p.services && p.services.length) || 0,
        avail: (p && p.availability && p.availability.length) || 0,
        details: !!(p && p._detailsLoaded),
      };
    });
    expect(before.services).toBeGreaterThan(0);

    const catalogErr = await page.evaluate(async function () {
      const detailed = window.App.getProviderBySlug("grzesiu-barber");
      // Trzymaj szczegóły w katalogu przed stubem z listy.
      window.AppState.catalogProviders = [
        Object.assign({}, detailed, {
          _detailsLoaded: true,
          _fromApi: true,
          _mine: false,
          services: (detailed.services || []).slice(),
          availability: (detailed.availability || []).slice(),
        }),
      ];
      window.LokalnieApi.listProviders = async function () {
        return {
          providers: [
            Object.assign({}, detailed, {
              services: [],
              availability: [],
              _detailsLoaded: false,
              _fromApi: true,
              _mine: false,
            }),
          ],
          total: 1,
          limit: 50,
          offset: 0,
        };
      };
      if (typeof window.LokalnieApi._origLoadCatalog === "function") {
        window.LokalnieApi.loadCatalog = window.LokalnieApi._origLoadCatalog;
      }
      const result = await window.LokalnieApi.loadCatalog({ limit: 50 });
      if (!result || !result.ok) {
        return String((result && result.error) || "loadCatalog failed");
      }
      return null;
    });
    expect(catalogErr).toBeNull();

    const after = await page.evaluate(function () {
      const catalog = (window.AppState.catalogProviders || []).find(function (x) {
        return x && x.slug === "grzesiu-barber";
      });
      const p = window.App.getProviderBySlug("grzesiu-barber");
      const emptyNotes = Array.from(
        document.querySelectorAll(".app-screen--booking .empty-note")
      ).map(function (el) {
        return (el.textContent || "").trim();
      });
      return {
        services: (catalog && catalog.services && catalog.services.length) || 0,
        avail: (catalog && catalog.availability && catalog.availability.length) || 0,
        details: !!(catalog && catalog._detailsLoaded),
        hasServices: !!(catalog && catalog.services && catalog.services.length),
        emptyNotes: emptyNotes,
        hasProviderCard: !!document.querySelector(".app-screen--booking .booking__provider-card"),
        fromSlugServices: (p && p.services && p.services.length) || 0,
      };
    });
    expect(after.services).toBe(before.services);
    expect(after.avail).toBe(before.avail);
    expect(after.hasServices).toBe(true);
    expect(after.details || after.hasServices).toBe(true);
    expect(after.hasProviderCard).toBe(true);
    expect(after.emptyNotes.indexOf("Brak dostępnych terminów.")).toBe(-1);
  });

  test("zalogowany user na /:slug nie powtarza openProvider po restoreCookieSession", async function ({
    page,
  }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.App.saveState();
    });
    await page.goto("/grzesiu-barber", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return (
        window.AppState.screen.client === "booking" &&
        !!document.querySelector(".app-screen--booking .booking__provider-card")
      );
    });

    const counts = await page.evaluate(async function () {
      let openCalls = 0;
      let renderCalls = 0;
      const origOpen = window.App.openProvider;
      const origRender = window.App.renderAll;
      window.App.openProvider = function () {
        openCalls += 1;
        return origOpen.apply(this, arguments);
      };
      window.App.renderAll = function () {
        renderCalls += 1;
        return origRender.apply(this, arguments);
      };

      // Po setTesterMode(false) w restoreCookieSession demo data znika — trzymaj profil w katalogu.
      const current = window.App.getProviderBySlug("grzesiu-barber");
      window.AppState.catalogProviders = [
        Object.assign({}, current, { _fromApi: true, _detailsLoaded: true }),
      ];

      const me = {
        authenticated: true,
        isAdmin: false,
        user: {
          id: "user-booking-route",
          name: "Klient Test",
          email: "klient@example.com",
          phone: "+48 500 100 200",
          roles: { client: true, provider: true },
        },
        provider: {
          id: "provider-booking-route",
          slug: "anna-studio",
          name: "Anna Studio",
          category: "beauty",
          city: "Warszawa",
          phone: "+48 500 600 700",
        },
      };
      window.LokalnieApi.isProductionHostname = function () {
        return true;
      };
      window.LokalnieApi.request = async function (path) {
        if (path === "/me") return me;
        return {};
      };
      window.LokalnieApi.syncFromServer = async function () {
        return { ok: true };
      };
      await window.App.restoreCookieSession();
      return {
        openCalls: openCalls,
        renderCalls: renderCalls,
        role: window.AppState.activeRole,
        screen: window.AppState.screen.client,
        slug: window.AppState.params.client && window.AppState.params.client.slug,
      };
    });

    expect(counts.role).toBe("client");
    expect(counts.screen).toBe("booking");
    expect(counts.slug).toBe("grzesiu-barber");
    expect(counts.openCalls).toBe(0);
    expect(counts.renderCalls).toBe(0);
    await expect(page).toHaveURL(/\/grzesiu-barber$/);
  });

  test("race stub→detail i detail→stub nie pokazuje Brak terminów po pełnych danych", async function ({
    page,
  }) {
    await resetAndLogin(page, "client");
    await page.evaluate(function () {
      window.AppState.onboarding = null;
      window.App.saveState();
    });
    await page.goto("/grzesiu-barber", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () {
      return !!document.querySelector(".app-screen--booking .booking__provider-card");
    });

    const result = await page.evaluate(async function () {
      const detailed = window.App.getProviderBySlug("grzesiu-barber");
      if (!detailed || !(detailed.services || []).length) {
        throw new Error("Brak szczegółów grzesiu-barber");
      }

      // Wymuś ścieżkę katalogu (nie owned / data.js).
      const full = Object.assign({}, detailed, {
        _detailsLoaded: true,
        _fromApi: true,
        _mine: false,
      });
      const stub = Object.assign({}, full, {
        services: [],
        availability: [],
        _detailsLoaded: false,
        _fromApi: true,
        _mine: false,
      });

      window.AppState.providerProfiles = [];
      window.AppState.myProvider = null;
      window.AppState.catalogProviders = [JSON.parse(JSON.stringify(full))];
      window.LokalnieApi.listProviders = async function () {
        return { providers: [stub], total: 1, limit: 50, offset: 0 };
      };
      if (typeof window.LokalnieApi._origLoadCatalog === "function") {
        window.LokalnieApi.loadCatalog = window.LokalnieApi._origLoadCatalog;
      }
      const catalogResult = await window.LokalnieApi.loadCatalog({ limit: 50 });
      if (!catalogResult || !catalogResult.ok) {
        throw new Error("loadCatalog failed: " + ((catalogResult && catalogResult.error) || "unknown"));
      }
      const afterClobber = window.App.getProviderBySlug("grzesiu-barber");
      const keptDetails =
        !!(afterClobber && afterClobber._detailsLoaded) &&
        (afterClobber.services || []).length > 0 &&
        (afterClobber.availability || []).length === (full.availability || []).length;

      window.AppState.catalogProviders = [stub];
      window.AppState.draft = { slug: "grzesiu-barber", serviceIds: [] };
      window.AppState.screen.client = "booking";
      window.AppState.params.client = { slug: "grzesiu-barber" };
      window.App.renderAll();
      const notes = Array.from(
        document.querySelectorAll(".app-screen--booking .empty-note")
      ).map(function (el) {
        return (el.textContent || "").trim();
      });
      const pendingNote = notes.some(function (t) {
        return /Ładowanie terminów/i.test(t);
      });

      window.AppState.catalogProviders = [full];
      window.App.refreshBookingDraftUI();
      const emptyAfterDetail = Array.from(
        document.querySelectorAll(".app-screen--booking .empty-note")
      ).map(function (el) {
        return (el.textContent || "").trim();
      });

      return {
        keptDetails: keptDetails,
        pendingNote: pendingNote,
        notes: notes,
        emptyAfterDetail: emptyAfterDetail,
      };
    });

    expect(result.keptDetails).toBe(true);
    expect(result.pendingNote).toBe(true);
    expect(result.emptyAfterDetail.indexOf("Brak dostępnych terminów.")).toBe(-1);
  });
});
