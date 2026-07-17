// simulator.js — logika przełącznika widoków symulatora (§3/§4 CONTRACT.md).
// Wystawia: window.Simulator.{init, setView, syncViewsToViewport}
// Reguła „jeden desktop": ustawienie desktop dla jednej strony przełącza drugą na mobile.
// Stan simView zapisywany w AppState (localStorage lokalnie.state).
// Szerokość okna < 900px wymusza mobile wszędzie (symulator = lustro aplikacji).
// Czysta statyka: brak modułów ES, wszystko na window.

(function () {
  "use strict";

  const SIDES = ["client", "provider"];
  const DESKTOP_MQ = window.matchMedia("(min-width: 900px)");

  // Fallback, gdyby app.js nie było załadowane (nie powinno się zdarzyć wg kolejności skryptów).
  const fallbackSimView = { client: "mobile", provider: "mobile" };

  function getSimView() {
    if (window.AppState && window.AppState.simView) return window.AppState.simView;
    return fallbackSimView;
  }

  function persist() {
    if (window.App && typeof window.App.saveState === "function") {
      window.App.saveState();
    }
  }

  function viewportForcesMobile() {
    if (window.App && typeof window.App.usesDesktopLayout === "function") {
      return !window.App.usesDesktopLayout();
    }
    return !DESKTOP_MQ.matches;
  }

  function otherSide(side) {
    return side === "client" ? "provider" : "client";
  }

  function getFrame(side) {
    return document.querySelector(`.device-frame[data-instance="${side}"]`);
  }

  function applyViewToDom(side, view) {
    const frame = getFrame(side);
    if (frame) frame.setAttribute("data-view", view);

    document
      .querySelectorAll(`.sim-viewtoggle button[data-side="${side}"]`)
      .forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.view === view ? "true" : "false");
      });
  }

  function updateToggleAvailability() {
    const forcedMobile = viewportForcesMobile();
    document.querySelectorAll(".sim-viewtoggle button[data-side][data-view]").forEach(function (btn) {
      btn.disabled = forcedMobile;
      btn.setAttribute("aria-disabled", forcedMobile ? "true" : "false");
    });
    document.querySelectorAll(".sim-viewtoggle").forEach(function (group) {
      group.classList.toggle("sim-viewtoggle--locked", forcedMobile);
    });
  }

  function syncViewsToViewport() {
    const forcedMobile = viewportForcesMobile();
    const simView = getSimView();

    SIDES.forEach(function (side) {
      const view = forcedMobile ? "mobile" : simView[side] === "desktop" ? "desktop" : "mobile";
      applyViewToDom(side, view);
    });

    updateToggleAvailability();

    if (window.App && typeof window.App.renderAll === "function") {
      window.App.renderAll();
    }
  }

  function setView(side, view) {
    if (!SIDES.includes(side)) return;
    if (view !== "mobile" && view !== "desktop") return;
    if (viewportForcesMobile()) return;

    const simView = getSimView();

    // Reguła „jeden desktop": dwa desktopy niedozwolone (dwa mobile OK).
    if (view === "desktop") {
      const other = otherSide(side);
      if (simView[other] === "desktop") {
        simView[other] = "mobile";
        applyViewToDom(other, "mobile");
      }
    }

    simView[side] = view;
    applyViewToDom(side, view);
    persist();

    if (window.App && typeof window.App.renderAll === "function") {
      window.App.renderAll();
    }
  }

  function bindToggles() {
    document
      .querySelectorAll(".sim-viewtoggle button[data-side][data-view]")
      .forEach(function (btn) {
        btn.addEventListener("click", function () {
          setView(btn.dataset.side, btn.dataset.view);
        });
      });
  }

  function init() {
    bindToggles();
    syncViewsToViewport();
    DESKTOP_MQ.addEventListener("change", syncViewsToViewport);
  }

  window.Simulator = {
    init: init,
    setView: setView,
    syncViewsToViewport: syncViewsToViewport,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
