// simulator.js — logika przełącznika widoków symulatora (§3/§4 CONTRACT.md).
// Wystawia: window.Simulator.{init, setView}
// Reguła „jeden desktop": ustawienie desktop dla jednej strony przełącza drugą na mobile.
// Stan simView zapisywany w AppState (localStorage lokalnie.state).
// Czysta statyka: brak modułów ES, wszystko na window.

(function () {
  "use strict";

  const SIDES = ["client", "provider"];

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

  function otherSide(side) {
    return side === "client" ? "provider" : "client";
  }

  function getFrame(side) {
    return document.querySelector(`.device-frame[data-instance="${side}"]`);
  }

  // Ustawia data-view na ramce + aria-pressed na obu przyciskach danego side + stan.
  function applyView(side, view) {
    const frame = getFrame(side);
    if (frame) frame.setAttribute("data-view", view);

    document
      .querySelectorAll(`.sim-viewtoggle button[data-side="${side}"]`)
      .forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.view === view ? "true" : "false");
      });

    getSimView()[side] = view;
  }

  function setView(side, view) {
    if (!SIDES.includes(side)) return;
    if (view !== "mobile" && view !== "desktop") return;

    // Reguła „jeden desktop": dwa desktopy niedozwolone (dwa mobile OK).
    if (view === "desktop") {
      const other = otherSide(side);
      if (getSimView()[other] === "desktop") {
        applyView(other, "mobile");
      }
    }

    applyView(side, view);
    persist();
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

    // Zastosuj zapisany/domyślny stan widoku do obu ramek.
    const simView = getSimView();
    SIDES.forEach(function (side) {
      applyView(side, simView[side] === "desktop" ? "desktop" : "mobile");
    });
  }

  window.Simulator = {
    init: init,
    setView: setView,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
