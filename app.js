// app.js — warstwa stanu + prosty router ekranów (§5/§6 CONTRACT.md).
// Wystawia: window.AppState oraz window.App.{navigate,render,renderAll,setRole,loadState,saveState,resetDemo}
// Ten etap renderuje MINIMALNE placeholdery ekranów — pełne ekrany dodadzą kolejne etapy.
// Czysta statyka: brak modułów ES, wszystko na window.

(function () {
  "use strict";

  const STATE_KEY = "lokalnie.state";
  const INSTANCES = ["client", "provider"];

  // Domyślne ekrany per instancja.
  const DEFAULT_SCREEN = { client: "search", provider: "providerPanel" };

  // Etykiety pomocnicze dla placeholderów.
  const ROLE_LABEL = { client: "Klient", provider: "Usługodawca" };
  const SCREEN_LABEL = {
    search: "Szukaj",
    profile: "Profil",
    booking: "Rezerwacja",
    login: "Logowanie",
    myCalendar: "Mój kalendarz",
    favorites: "Ulubione",
    providerPanel: "Panel usługodawcy",
    home: "Start",
  };

  function defaultState() {
    return {
      role: { client: "client", provider: "provider" },
      screen: { client: DEFAULT_SCREEN.client, provider: DEFAULT_SCREEN.provider },
      params: { client: {}, provider: {} },
      favorites: [],
      bookings: [],
      requests: [],
      notifications: [],
      simView: { client: "mobile", provider: "mobile" },
    };
  }

  // Stan globalny (źródło prawdy dla obu instancji).
  window.AppState = defaultState();

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(window.AppState));
    } catch (err) {
      // Statyka bez backendu — brak localStorage nie może wywalić prototypu.
    }
  }

  // Scala zapisany stan z domyślnym (odporne na starsze/niepełne zapisy).
  function loadState() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY));
    } catch (err) {
      stored = null;
    }

    const base = defaultState();
    if (stored && typeof stored === "object") {
      window.AppState = {
        role: Object.assign({}, base.role, stored.role),
        screen: Object.assign({}, base.screen, stored.screen),
        params: Object.assign({}, base.params, stored.params),
        favorites: Array.isArray(stored.favorites) ? stored.favorites : base.favorites,
        bookings: Array.isArray(stored.bookings) ? stored.bookings : base.bookings,
        requests: Array.isArray(stored.requests) ? stored.requests : base.requests,
        notifications: Array.isArray(stored.notifications) ? stored.notifications : base.notifications,
        simView: Object.assign({}, base.simView, stored.simView),
      };
    } else {
      window.AppState = base;
    }
    return window.AppState;
  }

  function navigate(instance, screen, params) {
    if (!INSTANCES.includes(instance)) return;
    window.AppState.screen[instance] = screen;
    window.AppState.params[instance] = params || {};
    saveState();
    renderAll();
  }

  function setRole(instance, role) {
    if (!INSTANCES.includes(instance)) return;
    window.AppState.role[instance] = role;
    window.AppState.screen[instance] = DEFAULT_SCREEN[role] || window.AppState.screen[instance];
    saveState();
    renderAll();
  }

  // Placeholder ekranu — pełne widoki dostarczą kolejne etapy.
  function renderPlaceholder(instance) {
    const role = window.AppState.role[instance] || instance;
    const screen = window.AppState.screen[instance] || "";
    return `
      <div class="app-shell" data-role="${escapeHtml(role)}">
        <div class="app-placeholder">
          <span class="app-placeholder__role">${escapeHtml(ROLE_LABEL[role] || role)}</span>
          <span class="app-placeholder__screen">${escapeHtml(SCREEN_LABEL[screen] || screen)}</span>
          <button type="button" class="btn btn--ghost" data-action="reset-demo">Zresetuj demo</button>
        </div>
      </div>
    `;
  }

  function render(instance) {
    const el = document.getElementById(`app-${instance}`);
    if (!el) return;
    el.innerHTML = renderPlaceholder(instance);
  }

  function renderAll() {
    INSTANCES.forEach(render);
  }

  function resetDemo() {
    try {
      localStorage.removeItem(STATE_KEY);
    } catch (err) {
      // ignore
    }
    window.AppState = defaultState();
    saveState();
    renderAll();
  }

  window.App = {
    navigate: navigate,
    render: render,
    renderAll: renderAll,
    setRole: setRole,
    loadState: loadState,
    saveState: saveState,
    resetDemo: resetDemo,
  };

  // Delegacja: przycisk „Zresetuj demo" działa dla obu instancji.
  document.addEventListener("click", function (event) {
    const resetBtn = event.target.closest("[data-action=\"reset-demo\"]");
    if (resetBtn) {
      resetDemo();
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    loadState();
    renderAll();
  });
})();
