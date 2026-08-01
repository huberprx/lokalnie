// app.js — warstwa stanu + router ekranów + renderowanie widoków klienta/usługodawcy.
// Wystawia: window.AppState oraz window.App.{...}
// Te same ekrany renderują się w podglądach symulatora (#app-client/#app-provider)
// oraz w trybie pełnoekranowym (#app-fullscreen) i współdzielą jeden stan.
// Czysta statyka: brak modułów ES, wszystko na window.

(function () {
  "use strict";

  const STATE_KEY = "lokalnie.state";
  const INSTANCES = ["client", "provider"];

  // Biznes zalogowanego usługodawcy (panel usługodawcy pokazuje jego dane).
  const MY_PROVIDER_ID = "grzesiu-barber";

  const DEFAULT_SCREEN = { client: "search", provider: "dashboard" };

  const ROLE_LABEL = { client: "Klient", provider: "Usługodawca" };

  const WEEKDAYS = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
  const CAL_WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
  const MONTHS = [
    "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
    "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
  ];
  const MONTHS_NOM = [
    "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
    "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
  ];
  const WEEKDAYS_NOM = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];

  const STATUS_LABEL = {
    confirmed: "Potwierdzona",
    pending: "Oczekująca",
    proposed: "Zaproponowany termin",
    rejected: "Odrzucona",
    cancelled: "Odwołana",
  };

  // Zapytanie o termin: klient podaje dni + porę dnia, usługodawca odsyła kilka konkretnych godzin.
  const DAY_PARTS = ["am", "pm", "any"];
  const DAY_PART_LABEL = { am: "Przed południem", pm: "Po południu", any: "Dowolna pora" };
  const DAY_PART_SHORT = { am: "przed poł.", pm: "po poł.", any: "dowolnie" };
  const DAY_PART_SPLIT_MIN = 12 * 60;

  const APP_VERSION = "1.0.178";

  const PWA = {
    registration: null,
    waitingWorker: null,
    updateAvailable: false,
    updateNotified: false,
    deferredInstall: null,
  };

  function data() {
    return window.LOKALNIE_DATA || { PROVIDERS: [], CATEGORIES: [], HOLIDAYS_2026: [], CURRENT_USER: {} };
  }

  function defaultState() {
    return {
      role: { client: "client", provider: "provider" },
      screen: { client: DEFAULT_SCREEN.client, provider: DEFAULT_SCREEN.provider },
      params: { client: {}, provider: {} },
      favorites: [],
      bookings: (data().DEMO_BOOKINGS || []).map(function (b) {
        return Object.assign({}, b);
      }),
      requests: (data().DEMO_REQUESTS || []).map(function (r) {
        return Object.assign({}, r, {
          days: Array.isArray(r.days) ? r.days.map(function (d) { return Object.assign({}, d); }) : [],
          proposals: Array.isArray(r.proposals) ? r.proposals.map(function (p) { return Object.assign({}, p); }) : [],
          serviceIds: Array.isArray(r.serviceIds) ? r.serviceIds.slice() : [],
          serviceNames: Array.isArray(r.serviceNames) ? r.serviceNames.slice() : [],
        });
      }),
      notifications: [],
      simView: { client: "mobile", provider: "mobile" },
      loggedIn: false,
      activeRole: null,
      draft: null, // { slug, serviceIds:[], dateISO, slotId }
      searchQuery: "",
      searchCategory: "",
      searchSubcategory: "",
      searchFiltersOpen: false,
      searchFilterDates: [],
      searchFilterPeriods: [],
      searchLocation: "",
      searchUseCurrentLocation: true,
      searchRadiusKm: 15,
      searchOpenSlug: null,
      myCalMonth: null,
      myCalDate: null,
      myCalMonthOpen: false,
      /** Filtr statusu wizyt w Mój kalendarz (tab): upcoming|past|confirmed|pending|cancelled|rejected. */
      myCalStatusFilters: ["upcoming"],
      provCalDate: null,
      /** Pierwszy widoczny dzień okna (2–6 dni); przy 7 = poniedziałek tygodnia. */
      provCalWindowStart: null,
      provCalHourH: 60,
      provCalView: "week",
      /** Ile kolumn dni widać (1–7); zoom poziomy. Domyślnie pełny tydzień. */
      provCalVisibleDays: 7,
      provCalMonthOpen: false,
      provCalPickerMonth: null,
      provCalSearchOpen: false,
      provCalSearchQ: "",
      provCalSelection: null,
      /** Panel „+” → nowy termin z kalendarza usługodawcy. */
      provCalAddOpen: false,
      /** Panel „+” zwinięty (tylko pasek) — draft zostaje. */
      provCalAddMinimized: false,
      provCalAddDraft: null,
      /** Zakładka panelu „+”: "new" | "requests". */
      provCalAddTab: "new",
      /** Odpowiedź na zapytanie o termin w kalendarzu (panel „+” w trybie propozycji). */
      provCalReplyRequestId: null,
      /** false = fokusienie na dniach klienta; true = pełny kontekst kalendarza. */
      provCalReplyShowAll: false,
      /** Pulpit: pokazywać karty wolnych luk między wizytami (domyślnie nie). */
      dashShowFreeSlots: false,
      /** Pulpit: "visits" | "requests" | "rejected" — lista wizyt, próśb albo odrzuconych. */
      dashListMode: "visits",
      /** Pulpit: wyszukiwarka klienta / usługi na liście. */
      dashSearchOpen: false,
      dashSearchQ: "",
      /** Zapisani klienci usługodawcy: { [providerId]: [{ id, name, phone, email, address }] } */
      providerClients: {},
      availWeekStart: null,
      availStripScrollLeft: null,
      availPickerMonth: null,
      availMonthOpen: true,
      availListOnlySet: true,
      availFocusDate: null,
      availEditDate: null,
      availEditDraft: null,
      availEditDrafts: {},
      appMenuOpen: false,
      clientAvatarUrl: null,
      /** Rozwinięta sekcja godzin/lokalizacji w panelu info karty usługodawcy. */
      providerCardInfoExpanded: false,
      /** Profil klienta (Booksy-like): imię, telefon, e-mail, powiadomienia. */
      clientProfile: null,
    };
  }

  const CURRENT_LOCATION_LABEL = "Obecna lokalizacja";
  const SEARCH_RADIUS_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50];

  window.AppState = defaultState();

  // ─────────────────────────────────────────────────────────
  // Helpery
  // ─────────────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatPrice(price) {
    return price == null ? "wycena indyw." : `${price} zł`;
  }

  function formatDuration(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function timeToMin(hhmm) {
    const parts = String(hhmm).split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function minToTime(min) {
    return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  }

  function minFromISO(iso) {
    return timeToMin(String(iso).slice(11, 16));
  }

  function monthLabelFromISO(dateISO) {
    if (!dateISO) return "";
    const d = new Date(dateISO + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return MONTHS_NOM[d.getMonth()];
  }

  /** Najbardziej wysunięty w lewo widoczny kafelek z data-date. */
  function leftmostDatedChild(strip, selector) {
    if (!strip) return null;
    const items = strip.querySelectorAll(selector);
    if (!items.length) return null;
    const stripRect = strip.getBoundingClientRect();
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (r.right >= stripRect.left + 4) return items[i];
    }
    return items[0];
  }

  // Aktualizuje nazwę miesiąca w wierszu „Dzień" na podstawie
  // najbardziej wysuniętego w lewo widocznego kafelka daty.
  function updateBookingMonthLabel(strip) {
    if (!strip) return;
    const schedule =
      strip.closest(".booking__schedule") || strip.closest(".prov-cal-add__schedule") || strip.closest(".prov-cal-add");
    const label =
      (schedule && schedule.querySelector('[data-role="booking-mobile-month"]')) ||
      (schedule && schedule.querySelector('[data-role="prov-cal-add-month"]'));
    if (!label) return;
    const chosen = leftmostDatedChild(strip, ".date-chip[data-date]");
    if (!chosen) return;
    const text = monthLabelFromISO(chosen.getAttribute("data-date"));
    if (text && label.textContent !== text) label.textContent = text;
  }

  function updateAvailMonthLabel(grid) {
    if (!grid) return null;
    const screen = grid.closest(".app-screen--avail") || document;
    const label = screen.querySelector('[data-role="avail-week-month"]');
    const chosen = leftmostDatedChild(grid, ".avail-week__col[data-date]");
    if (!chosen) return null;
    const iso = chosen.getAttribute("data-date");
    const text = monthLabelFromISO(iso);
    if (label && text && label.textContent !== text) label.textContent = text;
    const monthBtn = label && label.closest('[data-action="avail-month-start"]');
    if (monthBtn && text) monthBtn.setAttribute("aria-label", text);
    return iso;
  }

  function formatDateLong(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function isHoliday(dateISO) {
    return (data().HOLIDAYS_2026 || []).indexOf(dateISO) !== -1;
  }

  function isSunday(dateISO) {
    const d = new Date(dateISO + "T12:00:00");
    return !isNaN(d.getTime()) && d.getDay() === 0;
  }

  /** Niedziela lub święto — czerwony numer w kalendarzach / paskach dat. */
  function isRedCalendarDay(dateISO) {
    return isSunday(dateISO) || isHoliday(dateISO);
  }

  function getProviderBySlug(slug) {
    return (data().PROVIDERS || []).find((p) => p.slug === slug) || null;
  }

  function getProviderById(id) {
    return (data().PROVIDERS || []).find((p) => p.id === id) || null;
  }

  function categoryLabel(catId) {
    const c = (data().CATEGORIES || []).find((x) => x.id === catId);
    return c ? c.label : catId;
  }

  function subcategoriesFor(catId) {
    const c = (data().CATEGORIES || []).find((x) => x.id === catId);
    return c && Array.isArray(c.subcategories) ? c.subcategories : [];
  }

  function subcategoryLabel(catId, subId) {
    const subs = subcategoriesFor(catId);
    const s = subs.find((x) => x.id === subId);
    return s ? s.label : subId;
  }

  function providerCategoryLine(p) {
    let line = categoryLabel(p.category);
    if (p.subcategory) line += " · " + subcategoryLabel(p.category, p.subcategory);
    return line;
  }

  function matchesSearchLocation(p) {
    const radius = Number(window.AppState.searchRadiusKm) || 15;
    const useCurrent = window.AppState.searchUseCurrentLocation;
    const loc = (window.AppState.searchLocation || "").trim().toLowerCase();

    if (!p.address) return true;

    if (useCurrent || !loc) {
      return p.distanceKm <= radius;
    }

    const inPlace =
      (p.city && p.city.toLowerCase().indexOf(loc) !== -1) ||
      (p.address && p.address.toLowerCase().indexOf(loc) !== -1);
    return inPlace && p.distanceKm <= radius;
  }

  const SEARCH_PERIODS = [
    { id: "morning", label: "Przedpołudnie", from: "06:00", to: "12:00" },
    { id: "afternoon", label: "Popołudnie", from: "12:00", to: "17:00" },
    { id: "evening", label: "Wieczór", from: "17:00", to: "22:00" },
  ];

  function demoTodayISO() {
    return (data().DEMO_TODAY_ISO || "2026-07-16");
  }

  function addDaysISO(iso, days) {
    const parts = String(iso || demoTodayISO())
      .split("-")
      .map(Number);
    const t = Date.UTC(parts[0], parts[1] - 1, parts[2]) + Number(days || 0) * 86400000;
    const d = new Date(t);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function ensureClientProfile() {
    const u = data().CURRENT_USER || {};
    let cp = window.AppState.clientProfile;
    if (!cp || typeof cp !== "object") {
      const srcNotes = (u.notifications && typeof u.notifications === "object" && u.notifications) || {};
      cp = {
        name: String(u.name || ""),
        phone: String(u.phone || ""),
        email: String(u.email || ""),
        notifications: {
          visitReminders: srcNotes.visitReminders !== false,
          statusChanges: srcNotes.statusChanges !== false,
          marketing: !!srcNotes.marketing,
        },
      };
      window.AppState.clientProfile = cp;
    }
    if (typeof cp.name !== "string") cp.name = String(u.name || "");
    if (typeof cp.phone !== "string") cp.phone = String(cp.phone || u.phone || "");
    if (typeof cp.email !== "string") cp.email = String(cp.email || u.email || "");
    if (!cp.notifications || typeof cp.notifications !== "object") {
      cp.notifications = { visitReminders: true, statusChanges: true, marketing: false };
    }
    return cp;
  }

  const BOOKING_FUTURE_OPTS = [
    { v: 7, label: "7 dni" },
    { v: 14, label: "14 dni" },
    { v: 30, label: "30 dni" },
    { v: 60, label: "60 dni" },
    { v: 90, label: "90 dni" },
  ];
  const BOOKING_LEAD_OPTS = [
    { v: 0, label: "Bez limitu" },
    { v: 1, label: "1 godzina" },
    { v: 2, label: "2 godziny" },
    { v: 4, label: "4 godziny" },
    { v: 12, label: "12 godzin" },
    { v: 24, label: "24 godziny" },
  ];
  const BOOKING_CANCEL_OPTS = [
    { v: 0, label: "Bez limitu" },
    { v: 2, label: "2 godziny przed" },
    { v: 12, label: "12 godzin przed" },
    { v: 24, label: "24 godziny przed" },
    { v: 48, label: "48 godzin przed" },
  ];

  function ensureProviderBookingRules(provider) {
    if (!provider) return { futureDays: 60, minLeadHours: 2, cancelHours: 24, policy: "" };
    if (!provider.bookingRules || typeof provider.bookingRules !== "object") provider.bookingRules = {};
    const r = provider.bookingRules;
    if (!isFinite(Number(r.futureDays))) r.futureDays = 60;
    else r.futureDays = Math.max(1, Math.floor(Number(r.futureDays)));
    if (!isFinite(Number(r.minLeadHours))) r.minLeadHours = 2;
    else r.minLeadHours = Math.max(0, Math.floor(Number(r.minLeadHours)));
    if (!isFinite(Number(r.cancelHours))) r.cancelHours = 24;
    else r.cancelHours = Math.max(0, Math.floor(Number(r.cancelHours)));
    if (typeof r.policy !== "string") r.policy = r.policy ? String(r.policy) : "";
    if (typeof provider.about !== "string") provider.about = provider.about ? String(provider.about) : "";
    if (typeof provider.website !== "string") provider.website = provider.website ? String(provider.website) : "";
    return r;
  }

  function providerCancelPolicyText(provider) {
    if (!provider) return "";
    const r = ensureProviderBookingRules(provider);
    if (r.policy && String(r.policy).trim()) return String(r.policy).trim();
    if (!r.cancelHours) return "";
    return "Anulowanie lub przełożenie wizyty możliwe najpóźniej " + r.cancelHours + " h przed terminem.";
  }

  function timeToMinutes(hhmm) {
    const parts = String(hhmm || "0:0").split(":");
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    return timeToMinutes(aFrom) < timeToMinutes(bTo) && timeToMinutes(bFrom) < timeToMinutes(aTo);
  }

  const SEARCH_FILTER_DATE_CHUNK = 60;
  const SEARCH_FILTER_DATE_MAX = 366;

  function searchFilterDateOptions(count) {
    const n = Math.max(1, count || SEARCH_FILTER_DATE_CHUNK);
    const start = demoTodayISO();
    const parts = start.split("-").map(Number);
    const t0 = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(t0 + i * 86400000);
      out.push(d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()));
    }
    return out;
  }

  function addDaysISO(dateISO, days) {
    const parts = String(dateISO || "")
      .split("-")
      .map(Number);
    if (parts.length < 3 || parts.some(function (x) { return !Number.isFinite(x); })) return "";
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function renderSearchFilterDateChip(dateISO, selectedDates, todayISO) {
    const dt = new Date(dateISO + "T12:00:00");
    const on = (selectedDates || []).indexOf(dateISO) !== -1;
    const red = isRedCalendarDay(dateISO);
    const isToday = dateISO === todayISO;
    return `
          <button type="button" class="date-chip${on ? " date-chip--active" : ""}${isToday ? " date-chip--today" : ""}${red ? " date-chip--holiday" : ""}"
            data-action="toggle-filter-date" data-date="${escapeHtml(dateISO)}" aria-pressed="${on ? "true" : "false"}">
            <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
            <span class="date-chip__day">${dt.getDate()}</span>
          </button>`;
  }

  function updateSearchFilterMonthLabel(scrollEl) {
    if (!scrollEl) return;
    const section = scrollEl.closest(".search-filters__section");
    const label = section && section.querySelector('[data-role="search-filter-month"]');
    if (!label) return;
    const chosen = leftmostDatedChild(scrollEl, ".date-chip[data-date]");
    if (!chosen) return;
    const text = monthLabelFromISO(chosen.getAttribute("data-date"));
    if (text && label.textContent !== text) label.textContent = text;
  }

  function ensureSearchFilterDatesExtended(scrollEl) {
    if (!scrollEl || !scrollEl.classList.contains("filter-scroll--dates")) return;
    const track = scrollEl.querySelector(".filter-scroll__track");
    if (!track) return;
    if (scrollEl.scrollLeft + scrollEl.clientWidth < scrollEl.scrollWidth - 96) return;
    const chips = track.querySelectorAll(".date-chip[data-date]");
    if (chips.length >= SEARCH_FILTER_DATE_MAX) return;
    const last = chips[chips.length - 1];
    const lastISO = last && last.getAttribute("data-date");
    if (!lastISO) return;
    const selectedDates = window.AppState.searchFilterDates || [];
    const todayISO = demoTodayISO();
    const add = Math.min(SEARCH_FILTER_DATE_CHUNK, SEARCH_FILTER_DATE_MAX - chips.length);
    let html = "";
    for (let i = 1; i <= add; i++) {
      const iso = addDaysISO(lastISO, i);
      if (!iso) break;
      html += renderSearchFilterDateChip(iso, selectedDates, todayISO);
    }
    if (html) track.insertAdjacentHTML("beforeend", html);
  }

  function providerMatchesScheduleFilters(p) {
    const dates = window.AppState.searchFilterDates || [];
    const periods = window.AppState.searchFilterPeriods || [];
    if (!dates.length && !periods.length) return true;

    const avail = p.availability || [];
    const days = dates.length
      ? avail.filter(function (d) {
          return dates.indexOf(d.dateISO) !== -1;
        })
      : avail;
    if (!days.length) return false;
    if (!periods.length) return true;

    return days.some(function (day) {
      return (day.blocks || []).some(function (block) {
        return periods.some(function (periodId) {
          const period = SEARCH_PERIODS.find(function (x) {
            return x.id === periodId;
          });
          return period && rangesOverlap(block.from, block.to, period.from, period.to);
        });
      });
    });
  }

  function filterProviders() {
    const q = (window.AppState.searchQuery || "").toLowerCase();
    const cat = window.AppState.searchCategory || "";
    const sub = window.AppState.searchSubcategory || "";
    return (data().PROVIDERS || []).filter((p) => {
      if (!p.visibleInSearch) return false;
      if (cat && p.category !== cat) return false;
      if (sub && p.subcategory !== sub) return false;
      if (!matchesSearchLocation(p)) return false;
      if (!providerMatchesScheduleFilters(p)) return false;
      if (
        q &&
        p.name.toLowerCase().indexOf(q) === -1 &&
        categoryLabel(p.category).toLowerCase().indexOf(q) === -1 &&
        (!p.subcategory || subcategoryLabel(p.category, p.subcategory).toLowerCase().indexOf(q) === -1)
      ) {
        return false;
      }
      return true;
    });
  }

  function updateProviderLists() {
    const openSlug = window.AppState.searchOpenSlug;
    const isFavorites = window.AppState.screen.client === "favorites";
    const providers = isFavorites
      ? window.AppState.favorites.map(getProviderBySlug).filter(Boolean)
      : filterProviders();
    document.querySelectorAll(".app-screen--client .provider-list").forEach(function (listEl) {
      listEl.innerHTML = providers.length
        ? providers.map(function (p) {
            return renderProviderListItem(p, p.slug === openSlug);
          }).join("")
        : `<p class="empty-note">${isFavorites ? "Nie masz jeszcze ulubionych. Dodaj ich sercem w profilu." : "Brak wyników dla wybranych filtrów."}</p>`;
    });
  }

  function renderServicesPanelHead(p, draft, opts) {
    opts = opts || {};
    const mobile = !!opts.mobile;
    const labelClass = mobile ? "booking__label booking__label--caps" : "booking__panel-label";
    return `
      <div class="booking__panel-head${mobile ? " booking__panel-head--mobile" : ""}">
        <h3 class="${labelClass}">Oferta</h3>
      </div>`;
  }

  function restoreScrollTop(el, top) {
    if (!el || !(top > 0)) return;
    el.scrollTop = top;
    requestAnimationFrame(function () {
      el.scrollTop = top;
    });
  }

  function refreshBookingPanelElement(panel, p, ctx) {
    const mode = draftBookingMode(p);
    const isRequestStyle = isOfferRequestMode(mode);
    panel.setAttribute("data-booking-mode", isRequestStyle ? mode : "auto");
    panel.classList.toggle("provider-booking-panel--approval", isRequestStyle);
    const layout = panel.querySelector(".booking-layout");
    if (layout) {
      layout.outerHTML = renderBookingLayoutBlock(p, ctx);
    }

    const servicesList = panel.querySelector(".booking__services-list");
    const svcScroll = servicesList ? servicesList.scrollTop : 0;
    if (servicesList) {
      servicesList.innerHTML = ctx.services;
      restoreScrollTop(servicesList, svcScroll);
    }

    const summary = panel.querySelector(".selection-summary--inline");
    if (summary) summary.remove();
    panel.insertAdjacentHTML("beforeend", renderSelectionSummaryBar(p, ctx, mode));
  }

  // Ciągły zakres dat (włącznie) — bez „dziur” między dostępnymi dniami.
  function eachDateISO(fromISO, toISO) {
    const out = [];
    if (!fromISO || !toISO) return out;
    const from = fromISO.split("-").map(Number);
    const to = toISO.split("-").map(Number);
    let t = Date.UTC(from[0], from[1] - 1, from[2]);
    const end = Date.UTC(to[0], to[1] - 1, to[2]);
    while (t <= end) {
      const d = new Date(t);
      out.push(d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()));
      t += 86400000;
    }
    return out;
  }

  function normalizeDayPart(part) {
    return part === "am" || part === "pm" ? part : "any";
  }

  function slotMatchesDayPart(slot, part) {
    const p = normalizeDayPart(part);
    if (p === "any") return true;
    const startMin = timeToMin(slot.from);
    return p === "am" ? startMin < DAY_PART_SPLIT_MIN : startMin >= DAY_PART_SPLIT_MIN;
  }

  /** „pt 14 sierpnia” — krótki opis dnia w kartach zapytań i propozycji. */
  function formatDayWithDow(dateISO) {
    const d = new Date(String(dateISO) + "T12:00:00");
    if (isNaN(d.getTime())) return String(dateISO || "");
    return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  /** Dni zapytania: unikalne, posortowane, z porą dnia; opcjonalnie ograniczone do listy dat. */
  function normalizeRequestDays(days, allowedDates) {
    const allowed = allowedDates ? new Set(allowedDates) : null;
    const seen = Object.create(null);
    const out = [];
    (Array.isArray(days) ? days : []).forEach(function (entry) {
      const dateISO = entry && typeof entry === "object" ? entry.dateISO : entry;
      if (!dateISO || seen[dateISO]) return;
      if (allowed && !allowed.has(dateISO)) return;
      seen[dateISO] = true;
      out.push({ dateISO: dateISO, part: normalizeDayPart(entry && entry.part) });
    });
    return out.sort(function (a, b) {
      return String(a.dateISO).localeCompare(String(b.dateISO));
    });
  }

  function pushNotification(role, text) {
    if (!Array.isArray(window.AppState.notifications)) window.AppState.notifications = [];
    window.AppState.notifications.unshift({
      id: "nt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      role: role,
      text: String(text || ""),
      createdAt: new Date().toISOString(),
      read: false,
    });
    if (window.AppState.notifications.length > 20) window.AppState.notifications.length = 20;
  }

  function roleNotifications(role) {
    return (window.AppState.notifications || []).filter(function (n) {
      return n && n.role === role;
    });
  }

  function renderNotificationsBlock(role, title) {
    const items = roleNotifications(role);
    if (!items.length) return "";
    return `
      <section class="notif-block" aria-label="${escapeHtml(title)}">
        <div class="notif-block__head">
          <h3 class="prov-section">${escapeHtml(title)}</h3>
          <button type="button" class="btn btn--ghost btn--sm" data-action="clear-notifications" data-notif-role="${escapeHtml(role)}">Wyczyść</button>
        </div>
        <ul class="notif-list">
          ${items
            .map(function (n) {
              return `<li class="notif-item${n.read ? "" : " notif-item--unread"}">${escapeHtml(n.text)}</li>`;
            })
            .join("")}
        </ul>
      </section>`;
  }

  function renderDateStripHtml(availDates, activeDate, opts) {
    opts = opts || {};
    const action = opts.action || "pick-date";
    const multi = opts.selectedDates instanceof Set ? opts.selectedDates : null;
    const highlight = opts.highlightDates instanceof Set ? opts.highlightDates : null;
    if (!availDates.length) return `<p class="empty-note">Brak dostępnych terminów.</p>`;
    const availSet = new Set(availDates);
    const today = demoTodayISO();
    const stripDates = eachDateISO(availDates[0], availDates[availDates.length - 1]);
    return stripDates
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T12:00:00");
        const on = multi ? multi.has(dateISO) : dateISO === activeDate;
        const marked = !!(highlight && highlight.has(dateISO));
        const red = isRedCalendarDay(dateISO);
        const open = availSet.has(dateISO);
        // Wyszarzanie tylko dla dni przeszłych (już nie da się rezerwować).
        // Dni wolne / bez slotów w przyszłości wyglądają jak zwykłe, ale są nieklikalne.
        const past = dateISO < today;
        const bookable = open && !past;
        const isToday = dateISO === today;
        const badge =
          opts.badgeCounts && opts.badgeCounts[dateISO]
            ? `<span class="date-chip__badge" aria-hidden="true">${opts.badgeCounts[dateISO]}</span>`
            : "";
        return `
        <button type="button" class="date-chip${on ? " date-chip--active" : ""}${marked ? " date-chip--request" : ""}${isToday ? " date-chip--today" : ""}${red ? " date-chip--holiday" : ""}${past ? " date-chip--closed" : ""}${!bookable && !past ? " date-chip--unavailable" : ""}"
          data-date="${escapeHtml(dateISO)}"${multi ? ` aria-pressed="${on ? "true" : "false"}"` : ""}${bookable ? ` data-action="${escapeHtml(action)}"` : " disabled aria-disabled=\"true\""}>
          <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
          <span class="date-chip__day">${dt.getDate()}</span>
          ${badge}
        </button>`;
      })
      .join("");
  }

  function refreshBookingServiceLists(screen, ctx) {
    const html = ctx.services;
    const mobile =
      screen.querySelector('[data-role="booking-mobile-services"]') ||
      screen.querySelector(".booking-mobile .booking__services-list");
    if (mobile) {
      const scrollTop = mobile.scrollTop;
      mobile.innerHTML = html;
      restoreScrollTop(mobile, scrollTop);
    }
    const layoutList = screen.querySelector(".booking-layout .booking__services-list");
    if (layoutList) {
      const scrollTop = layoutList.scrollTop;
      layoutList.innerHTML = html;
      restoreScrollTop(layoutList, scrollTop);
    }
  }

  function refreshMobileBookingScreen(screen, p, ctx) {
    const mode = draftBookingMode(p);
    const scheduleKind = mode === "approval" ? "days" : mode === "request" ? "open" : "slots";
    screen.setAttribute("data-booking-mode", isOfferRequestMode(mode) ? mode : "auto");

    const providerWrap = screen.querySelector(".booking__provider-card");
    if (providerWrap) {
      const infoOpen = !!ctx.draft.providerInfoOpen;
      providerWrap.classList.toggle("booking__provider-card--info-open", infoOpen);
      providerWrap.innerHTML =
        renderProviderCard(p, false, { staticMain: true, bookingHeader: true, showBack: true }) +
        (infoOpen ? renderProviderInfoPopover(p) : "");
    }

    const mobileMain = screen.querySelector(".booking-mobile .booking__main");
    if (mobileMain) {
      const head = mobileMain.querySelector(".booking__panel-head");
      const headHtml = renderServicesPanelHead(p, ctx.draft, { mobile: true });
      if (head) head.outerHTML = headHtml;
      else {
        const list = mobileMain.querySelector('[data-role="booking-mobile-services"]');
        if (list) list.insertAdjacentHTML("beforebegin", headHtml);
      }
    }

    refreshBookingServiceLists(screen, ctx);

    const split = screen.querySelector(".booking--mobile-split");
    const schedule = split && split.querySelector(".booking__schedule, .booking__schedule--request");
    if (split && schedule) {
      const currentKind = schedule.getAttribute("data-schedule-kind") ||
        (schedule.classList.contains("booking__schedule--request-open")
          ? "open"
          : schedule.classList.contains("booking__schedule--request")
            ? "days"
            : "slots");
      if (currentKind !== scheduleKind) {
        schedule.outerHTML =
          scheduleKind === "days"
            ? renderRequestSchedule(ctx)
            : scheduleKind === "open"
              ? renderOpenRequestSchedule()
              : `<div class="booking__schedule" data-role="booking-mobile-schedule" data-schedule-kind="slots">
              <div class="booking__label-row">
                <h3 class="booking__label booking__label--caps">Wybierz datę</h3>
                <span class="booking__month" data-role="booking-mobile-month">${escapeHtml(monthLabelFromISO(ctx.activeDate || ctx.availDates[0]))}</span>
              </div>
              <div class="date-strip date-strip--booking" data-role="booking-date-strip">${renderDateStripHtml(ctx.availDates, ctx.activeDate)}</div>
              <h3 class="booking__label booking__label--caps" data-role="booking-mobile-time-label"${ctx.activeDate ? "" : " hidden"}>Wolne terminy</h3>
              <div class="time-list time-list--horizontal" data-role="booking-mobile-times"${ctx.activeDate ? "" : " hidden"}>${
                ctx.activeDate
                  ? ctx.timeListMobile || `<p class="empty-note">${escapeHtml(bookingTimesEmptyNote(p))}</p>`
                  : ""
              }</div>
            </div>`;
        updateBookingBottomNav(screen, ctx.draft);
        return;
      }
    }

    if (isOfferRequestMode(mode)) {
      updateBookingBottomNav(screen, ctx.draft);
      return;
    }

    const dateStripEl = screen.querySelector(".booking-mobile .date-strip");
    const dateScrollLeft = dateStripEl ? dateStripEl.scrollLeft : 0;
    const timeListEl = screen.querySelector('[data-role="booking-mobile-times"]');
    const timeScrollLeft = timeListEl ? timeListEl.scrollLeft : 0;

    if (dateStripEl) {
      dateStripEl.innerHTML = renderDateStripHtml(ctx.availDates, ctx.activeDate);
      dateStripEl.scrollLeft = dateScrollLeft;
      updateBookingMonthLabel(dateStripEl);
    }

    const timeLabel = screen.querySelector('[data-role="booking-mobile-time-label"]');
    const timeList = screen.querySelector('[data-role="booking-mobile-times"]');
    if (ctx.activeDate) {
      if (timeLabel) {
        timeLabel.hidden = false;
        timeLabel.textContent = "Wolne terminy";
      }
      if (timeList) {
        timeList.hidden = false;
        timeList.innerHTML =
          ctx.timeListMobile || `<p class="empty-note">${escapeHtml(bookingTimesEmptyNote(p))}</p>`;
        timeList.scrollLeft = timeScrollLeft;
      }
    } else {
      if (timeLabel) timeLabel.hidden = true;
      if (timeList) {
        timeList.hidden = true;
        timeList.innerHTML = "";
      }
    }

    updateBookingBottomNav(screen, ctx.draft);
  }

  function refreshBookingDraftUI() {
    const draft = window.AppState.draft;
    if (!draft) return false;

    const p = getProviderBySlug(draft.slug);
    if (!p) return false;

    const ctx = buildBookingContext(p);
    if (!ctx) return false;

    const mode = draftBookingMode(p);
    const appScrolls = Array.prototype.map.call(
      document.querySelectorAll(".app-screen--client > .app-scroll, #app-fullscreen > .app-screen--client > .app-scroll"),
      function (el) {
        return { el: el, top: el.scrollTop };
      }
    );

    let updated = false;

    document.querySelectorAll(".provider-item--open .provider-booking-panel").forEach(function (panel) {
      refreshBookingPanelElement(panel, p, ctx);
      updated = true;
    });

    if (window.AppState.screen.client === "booking") {
      document.querySelectorAll(".app-screen--booking").forEach(function (bookingScreen) {
        bookingScreen.setAttribute("data-booking-mode", isOfferRequestMode(mode) ? mode : "auto");
        if (clientUsesDesktopBookingLayout()) {
          const layout = bookingScreen.querySelector(".booking-layout");
          if (layout) {
            const svcList = layout.querySelector(".booking__services-list");
            const partsList = layout.querySelector(".request-day-list");
            const timesList = layout.querySelector(".time-list--vertical");
            const svcScroll = svcList ? svcList.scrollTop : 0;
            const partsScroll = partsList ? partsList.scrollTop : 0;
            const timesScroll = timesList ? timesList.scrollTop : 0;
            layout.outerHTML = renderBookingLayoutBlock(p, ctx);
            const nextLayout = bookingScreen.querySelector(".booking-layout");
            const nextSvc = nextLayout && nextLayout.querySelector(".booking__services-list");
            const nextParts = nextLayout && nextLayout.querySelector(".request-day-list");
            const nextTimes = nextLayout && nextLayout.querySelector(".time-list--vertical");
            restoreScrollTop(nextSvc, svcScroll);
            restoreScrollTop(nextParts, partsScroll);
            restoreScrollTop(nextTimes, timesScroll);
            updated = true;
          }
        }
        if (bookingScreen.querySelector(".booking-mobile")) {
          refreshMobileBookingScreen(bookingScreen, p, ctx);
          updated = true;
        }
      });
    }

    const profileServices = document.querySelector(".app-screen--client .profile .service-list");
    if (profileServices && window.AppState.screen.client === "profile") {
      profileServices.innerHTML = renderBookingServiceRows(p, draft.serviceIds || []);
      updated = true;
    }

    document.querySelectorAll('[data-role="booking-request-days"]').forEach(function (el) {
      const scrollLeft = el.scrollLeft;
      el.innerHTML = renderRequestDaysBody(ctx);
      el.scrollLeft = scrollLeft;
      updated = true;
    });
    document.querySelectorAll('[data-role="booking-request-parts"]').forEach(function (el) {
      el.innerHTML = renderRequestPartsBody(ctx);
      updated = true;
    });

    appScrolls.forEach(function (s) {
      restoreScrollTop(s.el, s.top);
    });

    return updated;
  }

  function animateServiceDescClip(row, expanded) {
    const clip = row.querySelector('[data-role="service-desc-clip"]');
    const sub = clip && clip.querySelector(".service-row__sub");
    if (!clip || !sub) return false;

    if (prefersReducedMotion()) {
      clip.style.maxHeight = "";
      clip.style.transition = "";
      return false;
    }

    const from = Math.max(0, Math.round(clip.getBoundingClientRect().height));

    // Zmierz docelową wysokość bez animacji.
    clip.style.transition = "none";
    row.classList.toggle("service-row--expanded", expanded);
    clip.style.maxHeight = "none";
    const to = Math.max(1, Math.ceil(clip.getBoundingClientRect().height || sub.scrollHeight));

    clip.style.maxHeight = from + "px";
    void clip.offsetHeight;
    clip.style.transition = "";
    clip.style.maxHeight = to + "px";

    function clearInline() {
      clip.style.maxHeight = "";
      clip.style.transition = "";
      clip.removeEventListener("transitionend", onEnd);
    }
    function onEnd(event) {
      if (event.target !== clip || event.propertyName !== "max-height") return;
      clearInline();
    }
    clip.addEventListener("transitionend", onEnd);
    window.setTimeout(clearInline, 360);
    return true;
  }

  function applyServiceRowExpanded(serviceId, expanded) {
    document.querySelectorAll('.service-row[data-service-id="' + serviceId + '"]').forEach(function (row) {
      if (!animateServiceDescClip(row, expanded)) {
        row.classList.toggle("service-row--expanded", expanded);
      }
      row.querySelectorAll('[data-action="toggle-service-desc"]').forEach(function (btn) {
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (btn.classList.contains("service-row__static-main--btn")) {
          const nameEl = row.querySelector(".service-row__name");
          const name = nameEl ? nameEl.textContent.trim() : "usługa";
          const expandLabel = (expanded ? "Zwiń" : "Rozwiń") + " szczegóły: " + name;
          btn.setAttribute("aria-label", expandLabel);
          btn.setAttribute("title", expandLabel);
        }
      });
      const label = row.querySelector(".service-row__more-label");
      if (label) label.textContent = expanded ? "Mniej" : "Więcej";
      const detail = row.querySelector(".service-row__detail");
      if (detail) detail.hidden = !expanded;
    });
  }

  function defaultServiceIds(p) {
    return [];
  }

  function initDraftForProvider(p) {
    window.AppState.draft = {
      slug: p.slug,
      serviceIds: defaultServiceIds(p),
      serviceVariants: {},
      expandedServiceIds: [],
      dateISO: null,
      slotId: null,
      calMonth: null,
      multiSelectMode: false,
      providerInfoOpen: false,
      requestDays: [],
    };
  }

  /** Pełny opis oferty (description; stary subtitle tylko jako fallback). */
  function serviceOfferText(s) {
    return String((s && (s.description || s.subtitle)) || "").trim();
  }

  /** Pierwsza linia opisu na liście. */
  function serviceListSummary(s) {
    const full = serviceOfferText(s);
    if (!full) return "";
    const line = full.split(/\r?\n/)[0].trim();
    return line || full;
  }

  function serviceVariants(s) {
    return Array.isArray(s && s.variants) ? s.variants.filter(Boolean) : [];
  }

  function defaultServiceVariantId(s) {
    const list = serviceVariants(s);
    return list.length ? list[0].id : null;
  }

  function resolveServiceVariant(s, variantId) {
    const list = serviceVariants(s);
    if (!list.length) {
      return { id: null, durationMin: s.durationMin, price: s.price, label: "" };
    }
    const found = list.find(function (v) {
      return v.id === variantId;
    });
    const v = found || list.find(function (x) {
      return x.id === defaultServiceVariantId(s);
    }) || list[0];
    return {
      id: v.id,
      durationMin: v.durationMin,
      price: v.price,
      label: v.label || "",
    };
  }

  function ensureDraftServiceVariants(draft) {
    if (!draft) return;
    if (!draft.serviceVariants || typeof draft.serviceVariants !== "object") {
      draft.serviceVariants = {};
    }
  }

  function selectedVariantIdForService(draft, service) {
    ensureDraftServiceVariants(draft);
    const map = draft.serviceVariants;
    const current = map[service.id];
    if (current) return current;
    const def = defaultServiceVariantId(service);
    if (def) map[service.id] = def;
    return def;
  }

  function variantChipLabel(v) {
    const dur = formatDuration(v.durationMin);
    const price = formatPrice(v.price);
    return dur + " · " + price;
  }

  function serviceDetailText(s) {
    return serviceOfferText(s);
  }

  function servicePhotos(s) {
    return Array.isArray(s && s.photos) ? s.photos.filter(Boolean) : [];
  }

  function serviceHasDetail(s) {
    return !!serviceOfferText(s) || servicePhotos(s).length > 0;
  }

  function renderServicePhotoStrip(s) {
    const photos = servicePhotos(s);
    if (!photos.length) return "";
    return `
      <div class="service-row__photos">
        ${photos
          .map(function (url, i) {
            return `<img class="service-row__photo" src="${escapeHtml(url)}" alt="${escapeHtml((s.name || "Usługa") + " — zdjęcie " + (i + 1))}" loading="lazy" />`;
          })
          .join("")}
      </div>`;
  }

  function buildBookingContext(p) {
    const draft = window.AppState.draft;
    if (!draft || draft.slug !== p.slug) return null;

    const totals = draftTotals(p);
    const slotOpts = slotOptsForServiceIds(p, draft.serviceIds || []);
    const availDates = resolveAvailDates(p, totals.duration || 15, slotOpts);
    ensureDraftCalendar(draft, availDates);

    const activeDate =
      draft.dateISO && availDates.indexOf(draft.dateISO) !== -1 ? draft.dateISO : availDates[0] || null;
    if (activeDate && draft.dateISO !== activeDate) draft.dateISO = activeDate;

    const calMonth = draft.calMonth || (activeDate ? activeDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
    const slots = activeDate ? computeSlots(p, activeDate, totals.duration || 15, slotOpts) : [];
    if (draft.slotId && !slots.some(function (s) { return s.id === draft.slotId; })) {
      draft.slotId = null;
    }

    draft.requestDays = normalizeRequestDays(draft.requestDays, availDates);

    return {
      draft: draft,
      totals: totals,
      availDates: availDates,
      activeDate: activeDate,
      calMonth: calMonth,
      slots: slots,
      requestDays: draft.requestDays,
      canSendRequest: !!(
        totals.count &&
        (draftBookingMode(p) === "request" || (draft.requestDays && draft.requestDays.length))
      ),
      timeList: renderTimeSlots(slots, draft),
      timeListMobile: renderTimeSlots(slots, draft, { mobile: true }),
      services: renderBookingServiceRows(p, draft.serviceIds || []),
      calendarGrid: renderCalendarGrid(p, activeDate, calMonth, availDates, totals),
      requestCalendarGrid: renderCalendarGrid(p, activeDate, calMonth, availDates, totals, {
        multiSelect: true,
        selectedDates: (draft.requestDays || []).map(function (d) {
          return d.dateISO;
        }),
        action: "request-toggle-day",
      }),
      svcNames: draftServices(p).map((s) => s.name).join(", "),
      canConfirm: !!draft.slotId,
    };
  }

  function renderRequestDaysBody(ctx) {
    if (!ctx.availDates.length) return `<p class="empty-note">Brak wolnych dni w grafiku.</p>`;
    const selected = new Set(
      ctx.requestDays.map(function (d) {
        return d.dateISO;
      })
    );
    return renderDateStripHtml(ctx.availDates, null, {
      action: "request-toggle-day",
      selectedDates: selected,
    });
  }

  function renderRequestPartsBody(ctx) {
    if (!ctx.requestDays.length) return `<p class="empty-note">Zaznacz dzień, żeby wybrać porę.</p>`;
    return ctx.requestDays
      .map(function (d) {
        const part = normalizeDayPart(d.part);
        const dayLabel = formatDayWithDow(d.dateISO);
        return `
        <div class="request-day" data-date="${escapeHtml(d.dateISO)}">
          <div class="request-day__head">
            <span class="request-day__label">${escapeHtml(dayLabel)}</span>
            <button type="button" class="request-day__remove" data-action="request-toggle-day" data-date="${escapeHtml(d.dateISO)}"
              aria-label="Usuń dzień ${escapeHtml(dayLabel)}" title="Usuń dzień">×</button>
          </div>
          <div class="day-part-chips" role="group" aria-label="Pora dnia — ${escapeHtml(dayLabel)}">
            ${DAY_PARTS.map(function (key) {
              const on = key === part;
              return `<button type="button" class="day-part-chip${on ? " day-part-chip--active" : ""}" data-action="request-day-part"
                data-date="${escapeHtml(d.dateISO)}" data-part="${escapeHtml(key)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(DAY_PART_LABEL[key])}</button>`;
            }).join("")}
          </div>
        </div>`;
      })
      .join("");
  }

  /** Desktop: ten sam kalendarz miesięczny co przy auto + pora dnia (multi-select dni). */
  function renderRequestDaysSections(ctx) {
    return `
      <section class="booking__calendar booking__request-days">
        <h3 class="booking__panel-label">Wybierz dni</h3>
        ${
          ctx.availDates.length
            ? ctx.requestCalendarGrid
            : `<p class="empty-note">Brak dostępnych terminów.</p>`
        }
        <p class="booking__request-hint">Zaznacz jeden lub kilka pasujących dni — usługodawca odeśle konkretne godziny.</p>
      </section>

      <aside class="booking__times booking__request-parts">
        <h3 class="booking__panel-label">Pora dnia</h3>
        <div class="request-day-list" data-role="booking-request-parts">${renderRequestPartsBody(ctx)}</div>
      </aside>`;
  }

  /** Ten sam wybór dni/pory w układzie mobilnym. */
  function renderRequestSchedule(ctx) {
    return `
      <div class="booking__schedule booking__schedule--request" data-schedule-kind="days">
        <h3 class="booking__label booking__label--caps">Wybierz dni</h3>
        <div class="date-strip date-strip--booking" data-role="booking-request-days">${renderRequestDaysBody(ctx)}</div>
        <h3 class="booking__label booking__label--caps">Pora dnia</h3>
        <div class="request-day-list" data-role="booking-request-parts">${renderRequestPartsBody(ctx)}</div>
      </div>`;
  }

  /** Prośba bez wyboru dnia/pory — tylko informacja + CTA. */
  function renderOpenRequestSections() {
    return `
      <section class="booking__calendar booking__request-days booking__request-open">
        <h3 class="booking__panel-label">Prośba o termin</h3>
        <p class="booking__request-hint">Wyślij prośbę — usługodawca zaproponuje wolne terminy. Nie wybierasz dnia ani pory.</p>
      </section>`;
  }

  function renderOpenRequestSchedule() {
    return `
      <div class="booking__schedule booking__schedule--request booking__schedule--request-open" data-schedule-kind="open">
        <h3 class="booking__label booking__label--caps">Prośba o termin</h3>
        <p class="booking__request-hint">Wyślij prośbę — usługodawca zaproponuje wolne terminy. Nie wybierasz dnia ani pory.</p>
      </div>`;
  }

  function renderSelectionSummaryBar(p, ctx, mode) {
    const totals = ctx.totals;
    const hasSelection = !!totals.count;
    const durationText = hasSelection ? formatDuration(totals.duration) : "—";
    const priceText = !hasSelection
      ? "—"
      : totals.hasNullPrice
        ? "wycena indyw."
        : totals.price + " zł";

    if (isOfferRequestMode(mode)) {
      return `
        <div class="selection-summary selection-summary--inline${hasSelection ? "" : " selection-summary--empty"}">
          <div class="selection-summary__info">
            <span class="selection-summary__duration">${escapeHtml(durationText)}</span>
            <span class="selection-summary__price">${escapeHtml(priceText)}</span>
          </div>
          <button type="button" class="btn btn--primary selection-summary__cta" data-action="send-request" data-slug="${escapeHtml(p.slug)}"${ctx.canSendRequest ? "" : " disabled"}>Wyślij prośbę o termin</button>
        </div>`;
    }

    return `
      <div class="selection-summary selection-summary--inline selection-summary--info${hasSelection ? "" : " selection-summary--empty"}">
        <div class="selection-summary__info">
          <span class="selection-summary__duration">${escapeHtml(durationText)}</span>
          <span class="selection-summary__price">${escapeHtml(priceText)}</span>
        </div>
      </div>`;
  }

  function renderBookingLayoutBlock(p, ctx) {
    const mode = draftBookingMode(p);
    const isRequestStyle = isOfferRequestMode(mode);
    return `
      <div class="booking-layout${isRequestStyle ? " booking-layout--approval" : ""}">
        <aside class="booking__services">
          ${renderServicesPanelHead(p, ctx.draft)}
          <div class="booking__services-list service-list">${ctx.services}</div>
        </aside>

        ${
          mode === "approval"
            ? renderRequestDaysSections(ctx)
            : mode === "request"
              ? renderOpenRequestSections()
              : `<section class="booking__calendar">
          <h3 class="booking__panel-label">Wybierz dzień</h3>
          ${ctx.availDates.length ? ctx.calendarGrid : `<p class="empty-note">Brak dostępnych terminów.</p>`}
        </section>

        <aside class="booking__times">
          <h3 class="booking__panel-label">${escapeHtml(bookingTimesPanelTitle(p, ctx.activeDate))}</h3>
          <div class="time-list time-list--vertical">
            ${
              ctx.activeDate
                ? ctx.timeList || `<p class="empty-note">${escapeHtml(bookingTimesEmptyNote(p))}</p>`
                : `<p class="empty-note">Wybierz dzień w kalendarzu.</p>`
            }
          </div>
        </aside>`
        }
      </div>`;
  }

  function renderInlineBookingPanel(p) {
    const ctx = buildBookingContext(p);
    if (!ctx) return "";

    const mode = draftBookingMode(p);
    const isRequestStyle = isOfferRequestMode(mode);
    return `
      <div class="provider-booking-panel${isRequestStyle ? " provider-booking-panel--approval" : ""}${window.AppState.bookingPanelEnterSlug === p.slug ? " provider-booking-panel--enter" : ""}" data-booking-mode="${isRequestStyle ? mode : "auto"}">
        ${renderBookingLayoutBlock(p, ctx)}
        ${renderSelectionSummaryBar(p, ctx, mode)}
      </div>`;
  }

  function mapsSearchUrl(address) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  }

  /** Adres do nawigacji: główny adres firmy albo pierwsza lokalizacja z adresem. */
  function providerNavAddress(p) {
    if (!p) return "";
    if (p.address) return String(p.address);
    const locs = Array.isArray(p.locations) ? p.locations : [];
    for (let i = 0; i < locs.length; i++) {
      if (locs[i] && locs[i].address) return String(locs[i].address);
    }
    return "";
  }

  function providerShareUrl(slug) {
    return location.origin + location.pathname + "#provider/" + slug;
  }

  function providerEmbedUrl(slug) {
    return location.origin + location.pathname + "#embed/" + slug;
  }

  function providerEmbedSnippet(slug) {
    const p = getProviderBySlug(slug);
    const title = (p && p.name) || "Lokalnie";
    const src = providerEmbedUrl(slug);
    return (
      '<iframe src="' +
      src +
      '" title="Rezerwacja — ' +
      title.replace(/"/g, "&quot;") +
      '" style="width:100%;min-height:720px;border:0;border-radius:12px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>'
    );
  }

  function copyTextOrToast(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast(okMsg || "Skopiowano ✓");
        },
        function () {
          showToast(text);
        }
      );
      return;
    }
    showToast(text);
  }

  function shareProvider(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;

    const url = providerShareUrl(slug);
    const text = p.name + (p.address ? " · " + p.address : "");

    if (navigator.share) {
      navigator.share({ title: p.name, text: text, url: url }).catch(function () {
        /* anulowano */
      });
      return;
    }

    copyTextOrToast(url, "Link do profilu skopiowany ✓");
  }

  function copyProviderEmbed(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    copyTextOrToast(providerEmbedSnippet(slug), "Kod osadzenia skopiowany ✓");
  }

  function setEmbedMode(on) {
    document.documentElement.classList.toggle("embed-mode", !!on);
    document.body.classList.toggle("embed-mode", !!on);
  }

  function reportProvider(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    showToast("Dziękujemy — zgłoszenie dotyczące „" + p.name + "” zostało przyjęte.");
  }

  function openProviderInfo(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    initDraftForProvider(p);
    window.AppState.params.client = { slug: slug };
    window.AppState.searchOpenSlug = null;
    window.AppState.screen.client = "profile";
    saveState();
    renderAll();
  }

  function callProvider(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    const phone = p.phone ? String(p.phone).replace(/\s/g, "") : "";
    if (phone) {
      window.location.href = "tel:" + phone;
      return;
    }
    showToast("Brak numeru telefonu dla „" + p.name + "”.");
  }

  let providerCardMenuTrigger = null;

  function ensureProviderCardPopover() {
    let el = document.getElementById("provider-card-popover");
    if (!el) {
      el = document.createElement("div");
      el.id = "provider-card-popover";
      el.className = "provider-card-popover";
      el.hidden = true;
      el.setAttribute("role", "menu");
      document.body.appendChild(el);
    }
    return el;
  }

  function positionProviderCardPopover(popover, trigger) {
    popover.style.visibility = "hidden";
    popover.hidden = false;

    const triggerRect = trigger.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const gap = 6;
    let top = triggerRect.bottom + gap;
    let left = triggerRect.right - popRect.width;

    if (left < 8) left = 8;
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popRect.width - 8;
    }
    if (top + popRect.height > window.innerHeight - 8) {
      top = triggerRect.top - popRect.height - gap;
    }

    popover.style.top = Math.max(8, top) + "px";
    popover.style.left = Math.max(8, left) + "px";
    popover.style.visibility = "visible";
  }

  function closeProviderCardMenu() {
    const popover = document.getElementById("provider-card-popover");
    if (popover) {
      popover.hidden = true;
      popover.innerHTML = "";
      popover.style.visibility = "";
    }
    if (providerCardMenuTrigger) {
      providerCardMenuTrigger.classList.remove("provider-card__menu--open", "provider-card__info--open");
      providerCardMenuTrigger.setAttribute("aria-expanded", "false");
      providerCardMenuTrigger = null;
    }
  }

  function renderAvatarFace(p, opts) {
    opts = opts || {};
    const initials = escapeHtml(p.avatarInitials || "?");
    if (p.avatarUrl) {
      return `<img class="avatar-preview__img${opts.large ? " avatar-preview__img--large" : ""}" src="${escapeHtml(p.avatarUrl)}" alt="${escapeHtml(p.name)}" />`;
    }
    return `<span class="avatar-preview__initials${opts.large ? " avatar-preview__initials--large" : ""}">${initials}</span>`;
  }

  function renderAvatarTrigger(p, className) {
    return `<button type="button" class="${className} avatar-trigger" data-action="preview-avatar" data-slug="${escapeHtml(p.slug)}" aria-label="Podgląd zdjęcia profilu: ${escapeHtml(p.name)}" title="Podgląd zdjęcia">
      ${renderAvatarFace(p)}
    </button>`;
  }

  function ensureAvatarPreview() {
    let el = document.getElementById("avatar-preview");
    if (!el) {
      el = document.createElement("div");
      el.id = "avatar-preview";
      el.className = "avatar-preview";
      el.hidden = true;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Podgląd zdjęcia profilu");
      document.body.appendChild(el);
    }
    return el;
  }

  function closeAvatarPreview() {
    const el = document.getElementById("avatar-preview");
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    document.body.classList.remove("avatar-preview-open");
  }

  function renderAvatarPreviewServiceCard(s) {
    const photos = servicePhotos(s);
    const thumb = photos[0] || "";
    return `
      <article class="avatar-preview__card">
        ${
          thumb
            ? `<img class="avatar-preview__card-img" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
            : `<span class="avatar-preview__card-img avatar-preview__card-img--empty" aria-hidden="true"></span>`
        }
        <span class="avatar-preview__card-meta">
          <span class="avatar-preview__card-dur">${escapeHtml(formatDuration(s.durationMin))}</span>
          <span class="avatar-preview__card-price">${escapeHtml(formatPrice(s.price))}</span>
        </span>
      </article>`;
  }

  function renderAvatarPreviewCarousel(itemsHtml) {
    if (!itemsHtml) return `<p class="avatar-preview__empty">Brak usług</p>`;
    return `
      <div class="avatar-preview__carousel" role="list">
        ${itemsHtml}
      </div>`;
  }

  function renderAvatarPreviewServices(p) {
    const services = p.services || [];
    if (!services.length) {
      return `<p class="avatar-preview__empty">Brak usług w ofercie.</p>`;
    }

    // Każda usługa: nazwa + pozioma karuzela (zdjęcia usługi; gdy brak — karta meta).
    return services
      .map(function (s) {
        const photos = servicePhotos(s);
        let slides;
        if (photos.length) {
          slides = photos
            .map(function (url, i) {
              return `
              <article class="avatar-preview__card" role="listitem">
                <img class="avatar-preview__card-img" src="${escapeHtml(url)}" alt="${escapeHtml(s.name + " — zdjęcie " + (i + 1))}" loading="lazy" />
                <span class="avatar-preview__card-meta">
                  <span class="avatar-preview__card-dur">${escapeHtml(formatDuration(s.durationMin))}</span>
                  <span class="avatar-preview__card-price">${escapeHtml(formatPrice(s.price))}</span>
                </span>
              </article>`;
            })
            .join("");
        } else {
          slides = `<div role="listitem">${renderAvatarPreviewServiceCard(s)}</div>`;
        }
        return `
        <section class="avatar-preview__section">
          <h3 class="avatar-preview__section-title">${escapeHtml(s.name)}</h3>
          ${renderAvatarPreviewCarousel(slides)}
        </section>`;
      })
      .join("");
  }

  function openAvatarPreview(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    closeProviderCardMenu();
    const el = ensureAvatarPreview();
    el.setAttribute("aria-label", "Profil: " + (p.name || ""));
    el.innerHTML = `
      <button type="button" class="avatar-preview__backdrop" data-action="close-avatar-preview" aria-label="Zamknij podgląd"></button>
      <div class="avatar-preview__dialog">
        <button type="button" class="avatar-preview__close" data-action="close-avatar-preview" aria-label="Zamknij">
          <span class="avatar-preview__close-icon" aria-hidden="true"></span>
        </button>
        <div class="avatar-preview__hero">
          <div class="avatar-preview__frame">
            ${renderAvatarFace(p, { large: true })}
          </div>
          <p class="avatar-preview__name">${escapeHtml(p.name)}</p>
          <p class="avatar-preview__cat">${escapeHtml(providerCategoryLine(p))}</p>
        </div>
        <div class="avatar-preview__body">
          ${renderAvatarPreviewServices(p)}
        </div>
      </div>`;
    el.hidden = false;
    document.body.classList.add("avatar-preview-open");
  }

  /**
   * Godziny otwarcia liczone z realnej dostępności usługodawcy, dzięki czemu
   * edycja w ekranie „Dostępności” jest od razu widoczna po stronie klienta.
   * Każda kolumna pn–nd pokazuje najbliższe wystąpienie tego dnia (dziś lub
   * dalej), więc nigdy nie pokazujemy „Zamknięte” dla dnia, który już minął.
   * Statyczny grafik z data.js działa tylko jako fallback dla usługodawców
   * bez żadnej dostępności.
   */
  function providerWeekHoursDays(provider) {
    const todayISO = demoTodayISO();
    const todayDow = new Date(todayISO + "T12:00:00").getDay();
    const seed =
      (data().WEEKLY_HOURS &&
        provider &&
        (data().WEEKLY_HOURS[provider.id] || data().WEEKLY_HOURS[provider.slug])) ||
      {};
    const hasAvail = !!(
      provider &&
      Array.isArray(provider.availability) &&
      provider.availability.length
    );
    return [1, 2, 3, 4, 5, 6, 0].map(function (dow) {
      const dateISO = addDaysISO(todayISO, (dow - todayDow + 7) % 7);
      return {
        dateISO: dateISO,
        dow: dow,
        blocks: hasAvail ? providerDayAvailBlocks(provider, dateISO) : seed[dow] || [],
      };
    });
  }

  function providerWeeklyHours(provider) {
    const weekly = {};
    providerWeekHoursDays(provider).forEach(function (d) {
      weekly[d.dow] = d.blocks;
    });
    return weekly;
  }

  /** „Godziny dziś” z aktualnej dostępności; seed z data.js tylko jako fallback. */
  function providerTodayHoursLabel(p) {
    if (!p) return "";
    if (!Array.isArray(p.availability) || !p.availability.length) {
      return p.openHoursToday || "Brak grafiku";
    }
    const blocks = providerDayAvailBlocks(p, demoTodayISO());
    if (!blocks.length) return "Zamknięte dziś";
    return blocks
      .slice()
      .sort(function (a, b) {
        return timeToMin(a.from) - timeToMin(b.from);
      })
      .map(function (b) {
        return b.from + "–" + b.to;
      })
      .join(", ");
  }

  function providerDayAvailBlocks(provider, dateISO) {
    if (!provider || !dateISO || !Array.isArray(provider.availability)) return [];
    const day = provider.availability.find(function (d) {
      return d && d.dateISO === dateISO;
    });
    return day && Array.isArray(day.blocks) ? day.blocks : [];
  }

  function renderProviderActionItems(p, opts) {
    opts = opts || {};
    const itemClass = opts.itemClass || "provider-card-popover__item";
    const iconClass = opts.iconClass || "provider-card-popover__item-icon";
    const role = opts.role || "menuitem";
    ensureProviderContact(p);

    const navItem = p.address
      ? `<a href="${escapeHtml(mapsSearchUrl(p.address))}" class="${itemClass}" role="${role}" target="_blank" rel="noopener noreferrer">
          <span class="${iconClass} ${iconClass}--nav" aria-hidden="true"></span>
          Nawiguj
        </a>`
      : "";

    const phone = String(p.phone || "").replace(/\s/g, "");
    const callItem = phone
      ? `<a href="tel:${escapeHtml(phone)}" class="${itemClass}" role="${role}">
          <span class="${iconClass} ${iconClass}--call" aria-hidden="true"></span>
          Zadzwoń
        </a>`
      : `<button type="button" class="${itemClass}" role="${role}" data-action="call-provider" data-slug="${escapeHtml(p.slug)}">
          <span class="${iconClass} ${iconClass}--call" aria-hidden="true"></span>
          Zadzwoń
        </button>`;

    const email = providerPublicEmail(p);
    const mailItem = email
      ? `<a href="mailto:${escapeHtml(email)}" class="${itemClass}" role="${role}">
          <span class="${iconClass} ${iconClass}--mail" aria-hidden="true"></span>
          Napisz e-mail
        </a>`
      : "";

    const socialItems = providerSocialLinks(p)
      .map(function (s) {
        return `<a href="${escapeHtml(s.href)}" class="${itemClass}" role="${role}" target="_blank" rel="noopener noreferrer">
          <span class="${iconClass} ${iconClass}--social ${iconClass}--${escapeHtml(s.key)}" aria-hidden="true"></span>
          ${escapeHtml(s.label)}
        </a>`;
      })
      .join("");

    return `
      <button type="button" class="${itemClass}" role="${role}" data-action="toggle-provider-card-info" data-slug="${escapeHtml(p.slug)}">
        <span class="${iconClass} ${iconClass}--info" aria-hidden="true"></span>
        Więcej informacji
      </button>
      ${callItem}
      ${mailItem}
      ${socialItems}
      <button type="button" class="${itemClass}" role="${role}" data-action="share-provider" data-slug="${escapeHtml(p.slug)}">
        <span class="${iconClass} ${iconClass}--share" aria-hidden="true"></span>
        Udostępnij
      </button>
      ${navItem}
      <button type="button" class="${itemClass} ${itemClass}--report" role="${role}" data-action="report-provider" data-slug="${escapeHtml(p.slug)}">
        <span class="${iconClass} ${iconClass}--report" aria-hidden="true"></span>
        Zgłoś
      </button>`;
  }

  function renderProviderContactTiles(p, opts) {
    opts = opts || {};
    ensureProviderContact(p);
    const phone = String(p.phone || "").replace(/\s/g, "");
    const navAddr = providerNavAddress(p);
    const tiles = [];

    if (opts.actions !== false) {
      tiles.push(`<button type="button" class="provider-tile" data-action="provider-info-profile" data-slug="${escapeHtml(p.slug)}" title="Profil">
        <span class="provider-tile__icon provider-tile__icon--profile" aria-hidden="true"></span><span class="provider-tile__label">Profil</span></button>`);
      tiles.push(
        phone
          ? `<a class="provider-tile" href="tel:${escapeHtml(phone)}" title="Zadzwoń: ${escapeHtml(String(p.phone || ""))}">
        <span class="provider-tile__icon provider-tile__icon--call" aria-hidden="true"></span><span class="provider-tile__label">Zadzwoń</span></a>`
          : `<span class="provider-tile provider-tile--disabled" aria-disabled="true">
        <span class="provider-tile__icon provider-tile__icon--call" aria-hidden="true"></span><span class="provider-tile__label">Zadzwoń</span></span>`
      );
      tiles.push(
        navAddr
          ? `<a class="provider-tile" href="${escapeHtml(mapsSearchUrl(navAddr))}" target="_blank" rel="noopener noreferrer" title="Nawiguj: ${escapeHtml(navAddr)}">
        <span class="provider-tile__icon provider-tile__icon--nav" aria-hidden="true"></span><span class="provider-tile__label">Nawiguj</span></a>`
          : `<span class="provider-tile provider-tile--disabled" aria-disabled="true">
        <span class="provider-tile__icon provider-tile__icon--nav" aria-hidden="true"></span><span class="provider-tile__label">Nawiguj</span></span>`
      );
    }

    providerSocialLinks(p).forEach(function (s) {
      tiles.push(`<a class="provider-tile" href="${escapeHtml(s.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.label)}">
        <span class="provider-tile__icon provider-tile__icon--${escapeHtml(s.key)}" aria-hidden="true"></span><span class="provider-tile__label">${escapeHtml(s.label)}</span></a>`);
    });

    if (opts.share) {
      tiles.push(`<button type="button" class="provider-tile" data-action="share-provider" data-slug="${escapeHtml(p.slug)}" title="Udostępnij profil">
        <span class="provider-tile__icon provider-tile__icon--share" aria-hidden="true"></span><span class="provider-tile__label">Udostępnij</span></button>`);
    }

    return `<div class="provider-tiles" role="group" aria-label="Kontakt i linki">${tiles.join("")}</div>`;
  }

  function renderProviderHoursSection(p) {
    const weekly = providerWeeklyHours(p);
    const locs = Array.isArray(p.locations) ? p.locations : [];
    const expanded = !!window.AppState.providerCardInfoExpanded;
    const todayISO = demoTodayISO();
    const todayDow = new Date(todayISO + "T12:00:00").getDay();
    const order = [1, 2, 3, 4, 5, 6, 0];

    const body = expanded
      ? `<div class="provider-hours__list">${order
          .map(function (dow) {
            const blocks = weekly[dow] || [];
            const dateISO = addDaysISO(todayISO, ((dow - todayDow) % 7 + 7) % 7);
            const dayBlocks = providerDayAvailBlocks(p, dateISO);
            const locBits = [];
            if (locs.length > 1) {
              const seen = Object.create(null);
              blocks.concat(dayBlocks).forEach(function (b) {
                const loc = b && b.locationId ? locs.find(function (l) { return l.id === b.locationId; }) : null;
                if (loc && loc.label && !seen[loc.id]) {
                  seen[loc.id] = true;
                  locBits.push(`<span class="provider-hours__loc"><span class="provider-hours__loc-dot ${locationToneClass(p, loc.id)}" aria-hidden="true"></span>${escapeHtml(loc.label)}</span>`);
                }
              });
            }
            const hoursHtml = blocks.length
              ? `<span class="provider-hours__time">${escapeHtml(blocks.map(function (b) { return b.from + "–" + b.to; }).join(" · "))}</span>`
              : `<span class="provider-hours__closed">Zamknięte</span>`;
            const isToday = dow === todayDow;
            return `<div class="provider-hours__row${isToday ? " provider-hours__row--today" : ""}">
              <span class="provider-hours__day">${escapeHtml(WEEKDAYS_NOM[dow])}${isToday ? '<span class="provider-hours__today">· dziś</span>' : ""}</span>
              ${hoursHtml}${locBits.length ? `<span class="provider-hours__locs">${locBits.join("")}</span>` : ""}
            </div>`;
          })
          .join("")}</div>`
      : `<p class="provider-hours__today-line">${escapeHtml(providerTodayHoursLabel(p) || "Brak grafiku")}</p>`;

    const locsSection =
      expanded && locs.length > 1
        ? `<div class="provider-info__locs">
             <h4 class="provider-info__sub">Lokalizacje</h4>
             <ul class="provider-info__locs-list">
               ${locs
                 .map(function (loc) {
                   return `<li class="provider-info__loc">
                     <span class="provider-hours__loc-dot ${locationToneClass(p, loc.id)}" aria-hidden="true"></span>
                     <span class="provider-info__loc-label">${escapeHtml(loc.label)}</span>
                     ${loc.address ? `<span class="provider-info__loc-addr">${escapeHtml(loc.address)}</span>` : ""}
                   </li>`;
                 })
                 .join("")}
             </ul>
           </div>`
        : "";

    return `<div class="provider-hours">
      <button type="button" class="provider-hours__toggle" data-action="toggle-provider-card-hours" aria-expanded="${expanded ? "true" : "false"}">
        <span class="provider-hours__label">Godziny otwarcia</span>
        <span class="provider-hours__chev" aria-hidden="true"></span>
      </button>
      ${body}
    </div>${locsSection}`;
  }

  function renderBookingProviderInfoPanel(p) {
    return `
      <div class="provider-card__info-panel" id="booking-provider-info" role="region" aria-label="Informacje o ${escapeHtml(p.name)}">
        <div class="provider-card__info-panel-actions">
          ${renderProviderContactTiles(p)}
          ${renderProviderHoursSection(p)}
        </div>
      </div>`;
  }

  /** Pływające okno informacji o usługodawcy (wzorowane na karcie miejsca Google Maps). */
  /**
   * Tygodniowy grafik jako kolumny dni ze slotami rozłożonymi na wspólnej osi czasu —
   * dzięki temu widać, że w danym dniu praca zaczyna się wcześniej / kończy później.
   */
  /** Miesiąc (lub zakres miesięcy) obejmowany przez pokazywane dni. */
  function providerHoursMonthLabel(days) {
    const isos = (days || [])
      .map(function (d) {
        return d && d.dateISO;
      })
      .filter(Boolean)
      .sort();
    if (!isos.length) return "";
    const a = new Date(isos[0] + "T12:00:00");
    const b = new Date(isos[isos.length - 1] + "T12:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return "";
    const aM = MONTHS_NOM[a.getMonth()];
    const bM = MONTHS_NOM[b.getMonth()];
    if (a.getFullYear() !== b.getFullYear())
      return aM + " " + a.getFullYear() + " – " + bM + " " + b.getFullYear();
    if (a.getMonth() !== b.getMonth()) return aM + " – " + bM + " " + b.getFullYear();
    return aM + " " + a.getFullYear();
  }

  /** Timer peeka krótkiego slotu w podglądzie tygodnia — jeden naraz. */
  let hoursWeekPeekTimer = null;

  function collapseHoursWeekSlotPeek(slot) {
    if (!slot) return;
    slot.classList.remove("is-peek");
    slot.setAttribute("aria-expanded", "false");
  }

  /** Klik w krótki slot: na chwilę pokaż godzinę końca, potem zwiń. */
  function peekHoursWeekSlot(slot) {
    if (!slot || !slot.classList.contains("provider-hours-week__slot--short")) return;
    document.querySelectorAll(".provider-hours-week__slot.is-peek").forEach(function (el) {
      if (el !== slot) collapseHoursWeekSlotPeek(el);
    });
    if (hoursWeekPeekTimer) {
      clearTimeout(hoursWeekPeekTimer);
      hoursWeekPeekTimer = null;
    }
    // Ponowny klik w otwarty — zwiń od razu.
    if (slot.classList.contains("is-peek")) {
      collapseHoursWeekSlotPeek(slot);
      return;
    }
    slot.classList.add("is-peek");
    slot.setAttribute("aria-expanded", "true");
    const holdMs = prefersReducedMotion() ? 1600 : 2200;
    hoursWeekPeekTimer = window.setTimeout(function () {
      collapseHoursWeekSlotPeek(slot);
      hoursWeekPeekTimer = null;
    }, holdMs);
  }

  /**
   * Oś tygodnia godzin: stałe okno dnia (jak w schedulerach), żeby blok 9–17
   * nie wypełniał 100% kolumny. Poza oknem — rozszerzamy, by 4–6 też było widać.
   */
  const HOURS_WEEK_AXIS_START = 6 * 60;
  const HOURS_WEEK_AXIS_END = 22 * 60;
  const HOURS_WEEK_MIN_SPAN = 12 * 60;

  function hoursWeekAxisRange(minMin, maxMin) {
    let axisStart = HOURS_WEEK_AXIS_START;
    let axisEnd = HOURS_WEEK_AXIS_END;
    if (isFinite(minMin) && minMin < axisStart) {
      axisStart = Math.floor(minMin / 60) * 60;
    }
    if (isFinite(maxMin) && maxMin > axisEnd) {
      axisEnd = Math.ceil(maxMin / 60) * 60;
    }
    // Margines 30–60 min przy „wystających” blokach, żeby nie kleiły się do krawędzi.
    if (isFinite(minMin) && minMin - axisStart < 30 && axisStart > 0) {
      axisStart = Math.max(0, axisStart - 60);
    }
    if (isFinite(maxMin) && axisEnd - maxMin < 30 && axisEnd < 24 * 60) {
      axisEnd = Math.min(24 * 60, axisEnd + 60);
    }
    if (axisEnd - axisStart < HOURS_WEEK_MIN_SPAN) {
      const mid = (axisStart + axisEnd) / 2;
      axisStart = Math.max(0, Math.floor((mid - HOURS_WEEK_MIN_SPAN / 2) / 60) * 60);
      axisEnd = Math.min(24 * 60, axisStart + HOURS_WEEK_MIN_SPAN);
      if (axisEnd - axisStart < HOURS_WEEK_MIN_SPAN) {
        axisStart = Math.max(0, axisEnd - HOURS_WEEK_MIN_SPAN);
      }
    }
    return { axisStart: axisStart, axisEnd: axisEnd, span: Math.max(60, axisEnd - axisStart) };
  }

  function renderProviderHoursWeekHtml(p, days, todayDow) {
    const dayBlocks = days.map(function (day) {
      const dow = day.dow;
      const blocks = (day.blocks || [])
        .map(function (b) {
          return { from: timeToMin(b.from), to: timeToMin(b.to), locationId: b.locationId || null, raw: b };
        })
        .filter(function (b) {
          return !isNaN(b.from) && !isNaN(b.to) && b.to > b.from;
        })
        .sort(function (a, b) {
          return a.from - b.from;
        });
      return { dow: dow, blocks: blocks };
    });

    let minMin = Infinity;
    let maxMin = -Infinity;
    dayBlocks.forEach(function (d) {
      d.blocks.forEach(function (b) {
        if (b.from < minMin) minMin = b.from;
        if (b.to > maxMin) maxMin = b.to;
      });
    });
    if (!isFinite(minMin) || !isFinite(maxMin)) {
      return `<p class="empty-note">Brak godzin otwarcia.</p>`;
    }

    const axis = hoursWeekAxisRange(minMin, maxMin);
    const axisStart = axis.axisStart;
    const axisEnd = axis.axisEnd;
    const span = axis.span;
    const spanHours = span / 60;
    const tickStep = spanHours <= 8 ? 2 : spanHours <= 14 ? 2 : 4;

    let lines = "";
    let axisLabels = "";
    for (let m = axisStart; m <= axisEnd; m += tickStep * 60) {
      const pct = ((m - axisStart) / span) * 100;
      if (m > axisStart && m < axisEnd) {
        lines += `<span class="provider-hours-week__line" style="top:${pct.toFixed(3)}%"></span>`;
      }
      const hour = Math.floor(m / 60) % 24;
      const label = String(hour);
      // Unikaj kolizji etykiet na samym dole/górze — lekki inset.
      const labelTop = m === axisStart ? 0 : m === axisEnd ? 100 : pct;
      axisLabels += `<span class="provider-hours-week__axis-label" style="top:${labelTop.toFixed(
        3
      )}%">${escapeHtml(label)}</span>`;
    }

    const cols = dayBlocks
      .map(function (d) {
        const isToday = d.dow === todayDow;
        const label = WEEKDAYS[d.dow] || "";
        const rangeText = d.blocks.length
          ? d.blocks
              .map(function (b) {
                return minToTime(b.from) + "–" + minToTime(b.to);
              })
              .join(", ")
          : "Zamknięte";
        const slots = d.blocks
          .map(function (b) {
            const dur = b.to - b.from;
            const top = ((b.from - axisStart) / span) * 100;
            const height = Math.max(2.2, (dur / span) * 100);
            const tone = b.locationId ? " " + locationToneClass(p, b.locationId) : "";
            const fromLabel = minToTime(b.from);
            const toLabel = minToTime(b.to);
            const range = fromLabel + "–" + toLabel;
            // Krótki blok na osi dnia: mało miejsca na dwie linie — peek po kliknięciu.
            const isShort = height < 11 || dur < 50;
            const timesHtml = isShort
              ? `<span class="provider-hours-week__slot-time">${escapeHtml(fromLabel)}</span>
              <span class="provider-hours-week__slot-time provider-hours-week__slot-time--end">${escapeHtml(
                toLabel
              )}</span>`
              : `<span class="provider-hours-week__slot-time">${escapeHtml(fromLabel)}</span>
              <span class="provider-hours-week__slot-time">${escapeHtml(toLabel)}</span>`;
            if (isShort) {
              return `<button type="button" class="provider-hours-week__slot provider-hours-week__slot--short${tone}" style="top:${top.toFixed(
                3
              )}%;height:${height.toFixed(3)}%" title="${escapeHtml(range)}" aria-label="${escapeHtml(
                range
              )}. Kliknij, aby zobaczyć godzinę zakończenia" data-action="peek-hours-week-slot" aria-expanded="false">
              ${timesHtml}
            </button>`;
            }
            return `<span class="provider-hours-week__slot${tone}" style="top:${top.toFixed(3)}%;height:${height.toFixed(
              3
            )}%" title="${escapeHtml(range)}" aria-label="${escapeHtml(range)}">
              ${timesHtml}
            </span>`;
          })
          .join("");
        return `<div class="provider-hours-week__col${isToday ? " provider-hours-week__col--today" : ""}${
          d.blocks.length ? "" : " provider-hours-week__col--closed"
        }">
          <span class="provider-hours-week__dow">${escapeHtml(label)}</span>
          <span class="provider-hours-week__track" role="img"
            aria-label="${escapeHtml((WEEKDAYS_NOM[d.dow] || "") + (isToday ? " (dziś)" : "") + ": " + rangeText)}">
            ${lines}
            ${slots || `<span class="provider-hours-week__closed-mark" aria-hidden="true"></span>`}
          </span>
        </div>`;
      })
      .join("");

    const monthLabel = providerHoursMonthLabel(days);
    const axisAria =
      "Oś czasu od " + minToTime(axisStart) + " do " + (axisEnd >= 24 * 60 ? "24:00" : minToTime(axisEnd));
    return `<div class="provider-hours-week">
      ${monthLabel ? `<p class="provider-hours-week__month">${escapeHtml(monthLabel)}</p>` : ""}
      <div class="provider-hours-week__frame">
        <div class="provider-hours-week__axis" aria-hidden="true">
          <span class="provider-hours-week__axis-spacer"></span>
          <span class="provider-hours-week__axis-track">${axisLabels}</span>
        </div>
        <div class="provider-hours-week__cols" aria-label="${escapeHtml(axisAria)}">${cols}</div>
      </div>
    </div>`;
  }

  function renderProviderInfoPopover(p) {
    ensureProviderContact(p);
    const phone = String(p.phone || "").replace(/\s/g, "");
    const email = providerPublicEmail(p);
    const locs = (Array.isArray(p.locations) ? p.locations : []).filter(function (l) {
      return l && (l.address || l.label);
    });
    const hoursDays = providerWeekHoursDays(p);
    const todayDow = new Date(demoTodayISO() + "T12:00:00").getDay();
    const closeAttrs = `data-action="toggle-booking-provider-info" data-slug="${escapeHtml(p.slug)}"`;

    let addrRows = "";
    if (locs.length) {
      addrRows = locs
        .map(function (l) {
          const addr = String(l.address || "").trim();
          const label = String(l.label || "Lokalizacja").trim();
          const inner = `
          <span class="provider-info-pop__loc-dot ${locationToneClass(p, l.id)}" aria-hidden="true"></span>
          <span class="provider-info-pop__loc-text">
            <span class="provider-info-pop__loc-label">${escapeHtml(label)}</span>
            <span class="provider-info-pop__loc-addr">${escapeHtml(addr || "Adres wkrótce")}</span>
          </span>`;
          return addr
            ? `<a class="provider-info-pop__loc" href="${escapeHtml(mapsSearchUrl(addr))}" target="_blank" rel="noopener noreferrer" title="Otwórz w Mapach Google: ${escapeHtml(addr)}">${inner}<span class="provider-info-pop__loc-go" aria-hidden="true"></span></a>`
            : `<div class="provider-info-pop__loc provider-info-pop__loc--static">${inner}</div>`;
        })
        .join("");
    } else if (p.address) {
      const addr = String(p.address);
      addrRows = `<a class="provider-info-pop__loc" href="${escapeHtml(mapsSearchUrl(addr))}" target="_blank" rel="noopener noreferrer" title="Otwórz w Mapach Google: ${escapeHtml(addr)}">
          <span class="provider-info-pop__loc-text">
            <span class="provider-info-pop__loc-addr">${escapeHtml(addr)}</span>
          </span>
          <span class="provider-info-pop__loc-go" aria-hidden="true"></span>
        </a>`;
    }
    const addrSection = addrRows
      ? `<div class="provider-info-pop__section">
        <span class="provider-info-pop__ic provider-info-pop__ic--pin" aria-hidden="true"></span>
        <div class="provider-info-pop__section-body">${addrRows}</div>
      </div>`
      : "";

    const phoneSection = phone
      ? `<div class="provider-info-pop__section">
        <span class="provider-info-pop__ic provider-info-pop__ic--phone" aria-hidden="true"></span>
        <a class="provider-info-pop__line provider-info-pop__line--link" href="tel:${escapeHtml(phone)}">${escapeHtml(String(p.phone))}</a>
      </div>`
      : "";

    const emailSection = email
      ? `<div class="provider-info-pop__section">
        <span class="provider-info-pop__ic provider-info-pop__ic--mail" aria-hidden="true"></span>
        <a class="provider-info-pop__line provider-info-pop__line--link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
      </div>`
      : "";

    const hoursWeek = renderProviderHoursWeekHtml(p, hoursDays, todayDow);

    const shareUrl = providerShareUrl(p.slug);
    const shareSection = `<div class="provider-info-pop__section provider-info-pop__section--share">
        <span class="provider-info-pop__ic provider-info-pop__ic--link" aria-hidden="true"></span>
        <button type="button" class="provider-info-pop__line provider-info-pop__line--link provider-info-pop__line--url"
          data-action="share-provider" data-slug="${escapeHtml(p.slug)}" title="Udostępnij profil">${escapeHtml(shareUrl)}</button>
      </div>`;

    return `
    <div class="provider-info-pop" role="dialog" aria-label="Informacje o ${escapeHtml(p.name)}">
      <button type="button" class="provider-info-pop__backdrop" ${closeAttrs} tabindex="-1" aria-label="Zamknij informacje"></button>
      <div class="provider-info-pop__card">
        <div class="provider-info-pop__head">
          <div class="provider-info-pop__title">
            <p class="provider-info-pop__name">${escapeHtml(p.name)}</p>
          </div>
          <button type="button" class="provider-info-pop__close" ${closeAttrs} aria-label="Zamknij informacje" title="Zamknij"><span class="provider-info-pop__close-ic" aria-hidden="true"></span></button>
        </div>
        ${shareSection}
        ${renderProviderContactTiles(p, { share: false, actions: false })}
        <div class="provider-info-pop__body">
          ${addrSection}
          ${phoneSection}
          ${emailSection}
          <div class="provider-info-pop__section provider-info-pop__section--hours">
            <div class="provider-info-pop__section-body provider-info-pop__hours">${hoursWeek}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function closeBookingProviderInfo(opts) {
    opts = opts || {};
    const draft = window.AppState.draft;
    if (!draft || !draft.providerInfoOpen) return false;
    draft.providerInfoOpen = false;
    saveState();
    if (opts.render) {
      if (!refreshBookingDraftUI()) renderAll();
    }
    return true;
  }

  function toggleProviderCardInfo(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return;
    closeProviderCardMenu();
    // Na liście i w inline — panel info w bieżącym widoku, bez przejścia do bookingu.
    const sameDraft = window.AppState.draft && window.AppState.draft.slug === p.slug;
    if (sameDraft) {
      window.AppState.draft.providerInfoOpen = !window.AppState.draft.providerInfoOpen;
    } else {
      initDraftForProvider(p);
      window.AppState.draft.providerInfoOpen = true;
    }
    saveState();
    renderAll();
  }

  function toggleProviderCardHoursExpanded() {
    window.AppState.providerCardInfoExpanded = !window.AppState.providerCardInfoExpanded;
    saveState();
    renderAll();
  }

  function toggleBookingProviderInfo(slug) {
    const draft = window.AppState.draft;
    const p = getProviderBySlug(slug);
    if (!p) return;
    closeProviderCardMenu();
    // Zamykanie/otwieranie tego samego panelu co na liście (provider-info-pop).
    if (!draft || draft.slug !== p.slug) {
      initDraftForProvider(p);
      window.AppState.draft.providerInfoOpen = true;
    } else {
      draft.providerInfoOpen = !draft.providerInfoOpen;
    }
    saveState();
    if (window.AppState.screen.client === "booking" && refreshBookingDraftUI()) return;
    renderAll();
  }

  function openProviderCardMenu(slug, trigger) {
    const p = getProviderBySlug(slug);
    if (!p || !trigger) return;

    const popover = ensureProviderCardPopover();
    if (trigger === providerCardMenuTrigger && !popover.hidden) {
      closeProviderCardMenu();
      return;
    }

    closeProviderCardMenu();
    closeBookingProviderInfo();

    popover.innerHTML = renderProviderActionItems(p);

    positionProviderCardPopover(popover, trigger);
    trigger.classList.add(trigger.classList.contains("provider-card__info") ? "provider-card__info--open" : "provider-card__menu--open");
    trigger.setAttribute("aria-expanded", "true");
    providerCardMenuTrigger = trigger;
  }

  function formatDayShortLabel(dateISO) {
    const d = new Date((dateISO || demoTodayISO()) + "T12:00:00");
    const w = WEEKDAYS[d.getDay()] || "";
    return w ? String(w).toUpperCase() : "";
  }

  function formatProviderCardHours(hours) {
    return String(hours || "")
      .split(/\s*,\s*/)
      .filter(Boolean)
      .join(" · ");
  }

  function renderProviderCardHoursMeta(p) {
    const hours = providerTodayHoursLabel(p);
    if (!hours) return "";
    if (hours === "Brak grafiku" || hours === "Zamknięte dziś") {
      return `<span class="provider-card__meta">${escapeHtml(hours)}</span>`;
    }
    const day = formatDayShortLabel(demoTodayISO());
    const hoursLabel = formatProviderCardHours(hours);
    return `<span class="provider-card__meta">
              ${day ? `<span class="provider-card__dow">${escapeHtml(day)}</span><span class="provider-card__meta-sep" aria-hidden="true">·</span>` : ""}
              <span class="provider-card__hours">${escapeHtml(hoursLabel)}</span>
            </span>`;
  }

  function renderProviderCard(p, isOpen, opts) {
    opts = opts || {};
    const fav = window.AppState.favorites.indexOf(p.slug) !== -1;
    const dist = p.address ? p.distanceKm.toFixed(1) + " km" : "Online";
    const addrLine = p.address ? p.address + " · " + dist : dist;

    const nameHtml = opts.staticMain
      ? `<span class="provider-card__name">${escapeHtml(p.name)}</span>`
      : `<button type="button" class="provider-card__name" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">${escapeHtml(p.name)}</button>`;

    const detailsInner = `
            <span class="provider-card__cat">${escapeHtml(providerCategoryLine(p))}</span>
            ${renderProviderCardHoursMeta(p)}
            <span class="provider-card__addr">${escapeHtml(addrLine)}</span>`;

    const detailsBlock = opts.staticMain
      ? `<div class="provider-card__details">${detailsInner}</div>`
      : `<button type="button" class="provider-card__details" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">${detailsInner}</button>`;

    const backHtml = opts.showBack
      ? `<button type="button" class="provider-card__back" data-action="close-provider" aria-label="Wróć"><span class="provider-card__back-icon" aria-hidden="true"></span></button>`
      : "";

    const infoOpen = !!(
      window.AppState.draft &&
      window.AppState.draft.providerInfoOpen &&
      window.AppState.draft.slug === p.slug
    );
    const favBtn = `<button type="button" class="provider-card__action provider-card__fav${fav ? " provider-card__fav--on" : ""}" data-action="toggle-fav" data-slug="${escapeHtml(p.slug)}" aria-label="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}" aria-pressed="${fav ? "true" : "false"}" title="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}"><span class="provider-card__action-icon provider-card__fav-icon" aria-hidden="true"></span></button>`;
    const infoAction = opts.bookingHeader ? "toggle-booking-provider-info" : "toggle-provider-card-info";
    const infoBtn = `<button type="button" class="provider-card__action provider-card__info${infoOpen ? " provider-card__info--open" : ""}" data-action="${infoAction}" data-slug="${escapeHtml(p.slug)}" aria-expanded="${infoOpen ? "true" : "false"}" aria-controls="booking-provider-info" aria-label="Informacje o ${escapeHtml(p.name)}" title="Informacje"><span class="provider-card__action-icon provider-card__info-icon" aria-hidden="true"></span></button>`;
    const menuBtn = `<button type="button" class="provider-card__action provider-card__menu" data-action="open-provider-menu" data-slug="${escapeHtml(p.slug)}" aria-haspopup="menu" aria-expanded="false" aria-label="Więcej opcji dla ${escapeHtml(p.name)}" title="Więcej opcji"><span class="provider-card__action-icon provider-card__menu-icon" aria-hidden="true"></span></button>`;
    // ⓘ otwiera panel info w bieżącym widoku; na otwartej karcie dodatkowo ⋯ z menu.
    const menuSlotHtml = opts.bookingHeader
      ? infoBtn
      : isOpen
        ? infoBtn + menuBtn
        : infoBtn;
    const openAttrs =
      opts.staticMain || opts.bookingHeader
        ? ""
        : ` data-action="open-provider" data-slug="${escapeHtml(p.slug)}" role="link" tabindex="0"`;

    return `
      <div class="provider-card${isOpen ? " provider-card--open" : ""}${opts.bookingHeader ? " provider-card--booking-header" : ""}${opts.staticMain ? " provider-card--static" : ""}${opts.showBack ? " provider-card--with-back" : ""}${infoOpen ? " provider-card--info-open" : ""}${openAttrs ? " provider-card--clickable" : ""}"${openAttrs}>
        ${opts.bookingHeader ? backHtml : ""}
        <div class="provider-card__head">
          ${opts.bookingHeader ? "" : backHtml}
          ${nameHtml}
          <div class="provider-card__toolbar">
            ${favBtn}
          </div>
        </div>
        ${renderAvatarTrigger(p, "provider-card__avatar")}
        ${detailsBlock}
        <div class="provider-card__menu-slot">
          ${menuSlotHtml}
        </div>
      </div>`;
  }

  function renderProviderListItem(p, isOpen) {
    const infoOpen = !!(
      window.AppState.draft &&
      window.AppState.draft.providerInfoOpen &&
      window.AppState.draft.slug === p.slug
    );
    return `
      <div class="provider-item${isOpen ? " provider-item--open" : ""}${infoOpen ? " provider-item--info-open" : ""}">
        ${renderProviderCard(p, isOpen)}
        ${isOpen ? renderInlineBookingPanel(p) : ""}
        ${infoOpen ? renderProviderInfoPopover(p) : ""}
      </div>`;
  }

  function renderSearchRadiusOptions() {
    const radius = Number(window.AppState.searchRadiusKm) || 15;
    return SEARCH_RADIUS_OPTIONS.map(function (km) {
      return `<option value="${km}"${radius === km ? " selected" : ""}>+${km} km</option>`;
    }).join("");
  }

  function searchLocationFieldHtml() {
    const locVal = window.AppState.searchUseCurrentLocation ? "" : (window.AppState.searchLocation || "");
    const showClear = !window.AppState.searchUseCurrentLocation && !!window.AppState.searchLocation;
    return `
          <span class="search-bar__icon" aria-hidden="true">⌖</span>
          <input type="text" class="search-bar__input" placeholder="${escapeHtml(CURRENT_LOCATION_LABEL)}"
            value="${escapeHtml(locVal)}" data-role="search-location" autocomplete="off" spellcheck="false" />
          ${
            showClear
              ? `<button type="button" class="search-bar__clear" data-action="clear-location" aria-label="Użyj obecnej lokalizacji">×</button>`
              : ""
          }`;
  }

  function renderSearchDesktopBar() {
    return `
      <div class="search-bar search-bar--desktop">
        <label class="search-bar__segment search-bar__segment--query">
          <span class="search-bar__icon" aria-hidden="true">⌕</span>
          <input type="search" class="search-bar__input" placeholder="Znajdź coś dla siebie"
            value="${escapeHtml(window.AppState.searchQuery || "")}" data-role="search-input" />
        </label>
        <label class="search-bar__segment search-bar__segment--location">${searchLocationFieldHtml()}</label>
        <label class="search-bar__segment search-bar__segment--radius">
          <select class="search-bar__select" data-role="search-radius" aria-label="Promień wyszukiwania">${renderSearchRadiusOptions()}</select>
        </label>
        <button type="button" class="search-bar__submit btn btn--primary" data-action="run-search">Szukaj</button>
      </div>`;
  }

  function renderSearchMobileBar() {
    return `
      <div class="search-bar search-bar--mobile">
        <div class="search-bar__row search-bar__row--query">
          <button type="button" class="search-bar__logo" data-action="go-home" aria-label="Lokalnie — marketplace">
            <img class="search-bar__logo-img" src="assets/icons/logo-1024.png" alt="" width="40" height="40" />
          </button>
          <label class="search-bar__segment search-bar__segment--query search-bar__segment--block">
            <span class="search-bar__icon" aria-hidden="true">⌕</span>
            <input type="search" class="search-bar__input" placeholder="Znajdź coś dla siebie"
              value="${escapeHtml(window.AppState.searchQuery || "")}" data-role="search-input" />
          </label>
        </div>
        <div class="search-bar__row search-bar__row--meta">
          <label class="search-bar__segment search-bar__segment--location search-bar__segment--block">${searchLocationFieldHtml()}</label>
          <label class="search-bar__segment search-bar__segment--radius search-bar__segment--block">
            <select class="search-bar__select" data-role="search-radius" aria-label="Promień wyszukiwania">${renderSearchRadiusOptions()}</select>
          </label>
        </div>
      </div>`;
  }

  function locationLabel(provider, locId) {
    const loc = (provider.locations || []).find((l) => l.id === locId);
    return loc ? loc.label : "";
  }

  /** Stały indeks koloru miejsca (0–5): z pola toneIndex albo kolejność w profilu. */
  function locationToneIndex(provider, locId) {
    const locs = (provider && provider.locations) || [];
    const loc = locs.find(function (l) {
      return l.id === locId;
    });
    if (loc && typeof loc.toneIndex === "number" && isFinite(loc.toneIndex)) {
      return ((Math.floor(loc.toneIndex) % 6) + 6) % 6;
    }
    const idx = locs.findIndex(function (l) {
      return l.id === locId;
    });
    return (idx < 0 ? 0 : idx) % 6;
  }

  function locationToneClass(provider, locId) {
    return "loc-tone-" + locationToneIndex(provider, locId);
  }

  /** Normalizuje tryb oferty: auto | approval | queue | request. */
  function normalizeBookingMode(mode) {
    if (mode === "approval" || mode === "queue" || mode === "request") return mode;
    return "auto";
  }

  /** Prośba o termin (z wyborem dnia albo bez) — wspólny flow CTA / grupowania. */
  function isOfferRequestMode(mode) {
    return mode === "approval" || mode === "request";
  }

  /** Rodzina trybu do koszyka multi-select: auto | queue | request. */
  function bookingModeFamily(mode) {
    if (mode === "approval" || mode === "request") return "request";
    if (mode === "queue") return "queue";
    return "auto";
  }

  /** Tryb rezerwacji oferty: auto | approval | queue | request (fallback: stary bookingMode profilu). */
  function serviceBookingMode(service, provider) {
    if (
      service &&
      (service.bookingMode === "approval" ||
        service.bookingMode === "queue" ||
        service.bookingMode === "request" ||
        service.bookingMode === "auto")
    ) {
      return service.bookingMode;
    }
    return provider && provider.bookingMode === "approval" ? "approval" : "auto";
  }

  /** Tryb na liście usług — uwzględnia niezatwierdzony draft edycji (podgląd przeniesienia między grupami). */
  function listServiceBookingMode(service, provider) {
    const params = window.AppState.params.provider || {};
    if (
      service &&
      params.editServiceId &&
      params.editServiceId === service.id &&
      params.editServiceDraft &&
      params.editServiceDraft.bookingMode
    ) {
      return normalizeBookingMode(params.editServiceDraft.bookingMode);
    }
    return serviceBookingMode(service, provider);
  }

  function ensureServicesBookingMode(provider) {
    if (!provider || !Array.isArray(provider.services)) return;
    const fallback = provider.bookingMode === "approval" ? "approval" : "auto";
    provider.services.forEach(function (s) {
      if (!s || typeof s !== "object") return;
      if (
        s.bookingMode !== "auto" &&
        s.bookingMode !== "approval" &&
        s.bookingMode !== "queue" &&
        s.bookingMode !== "request"
      ) {
        s.bookingMode = fallback;
      }
    });
    // W jednym koszyku (confirm|ask) tylko jeden wariant — mieszane stany ujednolicamy.
    unifyBookingModesInGroups(provider);
  }

  /** Wybiera wspólny wariant w koszyku (większość; remis → auto / approval). */
  function pickUnifiedModeForGroup(modes, group) {
    const counts = {};
    modes.forEach(function (m) {
      counts[m] = (counts[m] || 0) + 1;
    });
    const preferred = group === "ask" ? "approval" : "auto";
    let winner = preferred;
    let best = -1;
    Object.keys(counts).forEach(function (m) {
      const n = counts[m];
      if (n > best || (n === best && m === preferred)) {
        best = n;
        winner = m;
      }
    });
    return winner;
  }

  function unifyBookingModesInGroups(provider) {
    if (!provider || !Array.isArray(provider.services)) return;
    ["confirm", "ask"].forEach(function (group) {
      const list = provider.services.filter(function (s) {
        return s && bookingModeGroup(serviceBookingMode(s, provider)) === group;
      });
      if (list.length < 2) {
        if (list.length === 1 && !list[0].bookingMode) {
          list[0].bookingMode = serviceBookingMode(list[0], provider);
        }
        return;
      }
      const modes = list.map(function (s) {
        return serviceBookingMode(s, provider);
      });
      const winner = pickUnifiedModeForGroup(modes, group);
      list.forEach(function (s) {
        if (s.bookingMode !== winner) s.bookingMode = winner;
      });
    });
  }

  function draftBookingMode(provider) {
    const draft = window.AppState.draft;
    const ids = (draft && draft.serviceIds) || [];
    if (!provider || !ids.length) return "auto";
    ensureServicesBookingMode(provider);
    let sawQueue = false;
    let sawRequest = false;
    for (let i = 0; i < ids.length; i++) {
      const svc = (provider.services || []).find(function (s) {
        return s && s.id === ids[i];
      });
      if (!svc) continue;
      const mode = serviceBookingMode(svc, provider);
      if (mode === "approval") return "approval";
      if (mode === "request") sawRequest = true;
      if (mode === "queue") sawQueue = true;
    }
    if (sawRequest) return "request";
    return sawQueue ? "queue" : "auto";
  }

  function bookingModeLabel(mode) {
    if (mode === "approval") return "Prośba o termin z możliwością wyboru dnia";
    if (mode === "request") return "Prośba o termin";
    if (mode === "queue") return "Kolejny wolny termin";
    return "Wybór terminu";
  }

  function bookingModeDescription(mode) {
    if (mode === "approval") {
      return "Klient zaznacza pasujące dni i porę dnia → Ty proponujesz godziny w jego dostępności → klient wybiera jedną → wizyta ląduje w kalendarzu";
    }
    if (mode === "request") {
      return "Klient tylko pyta o ofertę — bez wyboru dnia i pory → Ty podajesz wolne terminy → klient wybiera jeden";
    }
    if (mode === "queue") {
      return "Klient widzi tylko pierwszy wolny termin — a jeśli masz kilka dostępności w dniu, po jednym na każdą";
    }
    return "Klient sam wybiera godzinę — po rezerwacji wizyta zapisuje się u Ciebie i u niego w kalendarzu";
  }

  /** Koszyk listy ofert: confirm = klient potwierdza, ask = klient pyta. */
  function bookingModeGroup(mode) {
    return isOfferRequestMode(mode) ? "ask" : "confirm";
  }

  function servicesInBookingGroup(provider, group) {
    ensureServicesBookingMode(provider);
    return ((provider && provider.services) || []).filter(function (s) {
      return bookingModeGroup(serviceBookingMode(s, provider)) === group;
    });
  }

  /** Jednolity tryb w grupie albo null, gdy oferty mają różne warianty. */
  function uniformBookingModeInGroup(provider, group) {
    const list = servicesInBookingGroup(provider, group);
    if (!list.length) return null;
    const first = serviceBookingMode(list[0], provider);
    for (let i = 1; i < list.length; i++) {
      if (serviceBookingMode(list[i], provider) !== first) return null;
    }
    return first;
  }

  function defaultModeForBookingGroup(provider, group) {
    const uniform = uniformBookingModeInGroup(provider, group);
    if (uniform) return uniform;
    return group === "ask" ? "approval" : "auto";
  }

  /** Aktywny wariant segmentu — zawsze konkretny (pusty koszyk → domyślny). */
  function activeModeForBookingGroup(provider, group) {
    return defaultModeForBookingGroup(provider, group);
  }

  /** Ustawia wariant rezerwacji dla wszystkich ofert w koszyku (confirm|ask). */
  function setProviderServicesGroupMode(group, mode) {
    const p = myProvider();
    if (!p || !Array.isArray(p.services)) return;
    mode = normalizeBookingMode(mode);
    if (bookingModeGroup(mode) !== group) return;
    let changed = 0;
    p.services.forEach(function (s) {
      if (!s) return;
      if (bookingModeGroup(serviceBookingMode(s, p)) !== group) return;
      if (s.bookingMode !== mode) {
        s.bookingMode = mode;
        changed += 1;
      }
    });
    const params = window.AppState.params.provider || {};
    if (params.editServiceDraft && params.editServiceId && params.editServiceId !== "__new__") {
      const editing = getProviderService(params.editServiceId);
      if (editing && bookingModeGroup(serviceBookingMode(editing, p)) === group) {
        params.editServiceDraft.bookingMode = mode;
      }
    }
    window.AppState.params.provider = params;
    saveState();
    if (!changed) {
      showToast("Wszystkie oferty w grupie mają już ten tryb.");
      return;
    }
    // Bez pełnego renderAll — inaczej lista/edycja skacze do góry.
    if (!refreshProviderServicesListInPlace()) renderAll();
    showToast(
      group === "ask"
        ? mode === "approval"
          ? "Na prośbę: z wyborem dnia."
          : "Na prośbę: bez wyboru dnia."
        : mode === "queue"
          ? "Klient wybiera termin: kolejka."
          : "Klient wybiera termin: dowolny wybór."
    );
    hapticTap(12);
  }

  function bookingTimesPanelTitle(provider, activeDate) {
    return activeDate ? "Wolne terminy · " + formatDateLong(activeDate) : "Wolne terminy";
  }

  function bookingTimesEmptyNote(provider) {
    return "Brak wolnych godzin tego dnia.";
  }

  /** Brak locationIds / pusta lista = usługa we wszystkich lokalizacjach. */
  function serviceAllowsAllLocations(service) {
    return !service || !Array.isArray(service.locationIds) || !service.locationIds.length;
  }

  /** null = bez ograniczeń; Set = dozwolone locationId (może być puste). */
  function allowedLocationIdsForServices(provider, serviceIds) {
    if (!provider) return null;
    const valid = {};
    ensureProviderLocations(provider).forEach(function (loc) {
      if (loc && loc.id) valid[loc.id] = true;
    });
    let allowed = null;
    (serviceIds || []).forEach(function (sid) {
      const svc = (provider.services || []).find(function (s) {
        return s && s.id === sid;
      });
      if (!svc || serviceAllowsAllLocations(svc)) return;
      const ids = (svc.locationIds || []).filter(function (lid) {
        return !!valid[lid];
      });
      if (allowed === null) {
        allowed = {};
        ids.forEach(function (lid) {
          allowed[lid] = true;
        });
        return;
      }
      const next = {};
      ids.forEach(function (lid) {
        if (allowed[lid]) next[lid] = true;
      });
      allowed = next;
    });
    if (allowed === null) return null;
    return new Set(Object.keys(allowed));
  }

  function slotOptsForServiceIds(provider, serviceIds, extra) {
    const opts = Object.assign({}, extra || {});
    const allowed = allowedLocationIdsForServices(provider, serviceIds);
    if (allowed) opts.allowedLocationIds = allowed;
    if (draftBookingMode(provider) === "queue") opts.mode = "queue";
    return opts;
  }

  function serviceLocationSummary(service, provider) {
    if (serviceAllowsAllLocations(service)) return "Wszystkie miejsca";
    const locs = ensureProviderLocations(provider);
    const labels = (service.locationIds || [])
      .map(function (id) {
        const loc = locs.find(function (l) {
          return l && l.id === id;
        });
        return loc ? loc.label : "";
      })
      .filter(Boolean);
    return labels.length ? labels.join(", ") : "Brak miejsc";
  }

  const SETTINGS_LOC_MAX = 3;
  const SETTINGS_LOC_TONES = [0, 1, 2, 3, 4, 5];

  function nextLocationToneIndex(provider) {
    const used = {};
    ((provider && provider.locations) || []).forEach(function (l) {
      used[locationToneIndex(provider, l.id)] = true;
    });
    for (let i = 0; i < SETTINGS_LOC_TONES.length; i++) {
      if (!used[SETTINGS_LOC_TONES[i]]) return SETTINGS_LOC_TONES[i];
    }
    return ((provider.locations || []).length) % 6;
  }

  function ensureProviderLocations(provider) {
    if (!provider) return [];
    if (!Array.isArray(provider.locations)) provider.locations = [];
    provider.locations.forEach(function (loc, i) {
      if (!loc || typeof loc !== "object") return;
      if (typeof loc.toneIndex !== "number" || !isFinite(loc.toneIndex)) {
        loc.toneIndex = i % 6;
      } else {
        loc.toneIndex = ((Math.floor(loc.toneIndex) % 6) + 6) % 6;
      }
      if (typeof loc.label !== "string") loc.label = String(loc.label || "Miejsce");
      if (loc.address == null) loc.address = "";
    });
    return provider.locations;
  }

  const SETTINGS_SOCIAL_KINDS = [
    { key: "website", label: "WWW", placeholder: "https://" },
    { key: "instagram", label: "Instagram", placeholder: "@nazwa lub link" },
    { key: "facebook", label: "Facebook", placeholder: "nazwa strony lub link" },
    { key: "tiktok", label: "TikTok", placeholder: "@nazwa lub link" },
    { key: "youtube", label: "YouTube", placeholder: "@kanał lub link" },
    { key: "pinterest", label: "Pinterest", placeholder: "nazwa lub link" },
    { key: "linkedin", label: "LinkedIn", placeholder: "nazwa firmy lub link" },
    { key: "x", label: "X", placeholder: "@nazwa lub link" },
  ];
  const SETTINGS_SOCIAL_MAX = 8;

  function socialKindMeta(kind) {
    return (
      SETTINGS_SOCIAL_KINDS.find(function (s) {
        return s.key === kind;
      }) || SETTINGS_SOCIAL_KINDS[0]
    );
  }

  function ensureProviderContact(provider) {
    if (!provider) return null;
    if (typeof provider.phone !== "string") provider.phone = provider.phone ? String(provider.phone) : "";
    if (typeof provider.email !== "string") provider.email = provider.email ? String(provider.email) : "";
    if (typeof provider.emailVisible !== "boolean") provider.emailVisible = !!provider.email;
    ensureProviderSocialLinks(provider);
    return provider;
  }

  function ensureProviderSocialLinks(provider) {
    if (!provider) return [];
    if (!Array.isArray(provider.socialLinks)) {
      const migrated = [];
      const website = String(provider.website || "").trim();
      if (website) {
        migrated.push({ id: "sl-web", kind: "website", value: website });
      }
      const legacy = provider.socials && typeof provider.socials === "object" ? provider.socials : {};
      SETTINGS_SOCIAL_KINDS.forEach(function (s) {
        if (s.key === "website") return;
        const val = String(legacy[s.key] || "").trim();
        if (val) migrated.push({ id: "sl-" + s.key, kind: s.key, value: val });
      });
      provider.socialLinks = migrated.length
        ? migrated
        : [{ id: "sl-" + Date.now(), kind: "instagram", value: "" }];
    }
    provider.socialLinks = provider.socialLinks
      .filter(function (l) {
        return l && typeof l === "object";
      })
      .map(function (l, i) {
        const kind = socialKindMeta(l.kind).key;
        return {
          id: l.id || "sl-" + i + "-" + Date.now(),
          kind: kind,
          value: typeof l.value === "string" ? l.value : String(l.value || ""),
        };
      });
    if (!provider.socialLinks.length) {
      provider.socialLinks.push({ id: "sl-" + Date.now(), kind: "instagram", value: "" });
    }
    // website jako lustro z socialLinks (kanoniczne jest socialLinks).
    const web = provider.socialLinks.find(function (l) {
      return l.kind === "website" && l.value;
    });
    provider.website = web ? web.value : provider.website || "";
    return provider.socialLinks;
  }

  function normalizeSocialUrl(kind, value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    const handle = v.replace(/^@/, "").replace(/^\/+/, "");
    if (!handle) return "";
    if (kind === "website") return "https://" + handle;
    if (kind === "instagram") return "https://instagram.com/" + encodeURIComponent(handle);
    if (kind === "facebook") return "https://facebook.com/" + encodeURIComponent(handle);
    if (kind === "tiktok") return "https://www.tiktok.com/@" + encodeURIComponent(handle);
    if (kind === "youtube") return "https://www.youtube.com/@" + encodeURIComponent(handle);
    if (kind === "pinterest") return "https://www.pinterest.com/" + encodeURIComponent(handle);
    if (kind === "linkedin") return "https://www.linkedin.com/company/" + encodeURIComponent(handle);
    if (kind === "x") return "https://x.com/" + encodeURIComponent(handle);
    return v;
  }

  function providerPublicEmail(provider) {
    if (!provider) return "";
    ensureProviderContact(provider);
    if (!provider.emailVisible) return "";
    return String(provider.email || "").trim();
  }

  function providerSocialLinks(provider) {
    if (!provider) return [];
    ensureProviderSocialLinks(provider);
    return provider.socialLinks
      .map(function (l) {
        const meta = socialKindMeta(l.kind);
        const href = normalizeSocialUrl(l.kind, l.value);
        return href ? { key: l.kind, label: meta.label, href: href } : null;
      })
      .filter(Boolean);
  }

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(window.AppState));
    } catch (err) {
      // brak localStorage nie może wywalić prototypu
    }
  }

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
        loggedIn: typeof stored.loggedIn === "boolean" ? stored.loggedIn : base.loggedIn,
        activeRole: INSTANCES.indexOf(stored.activeRole) !== -1 ? stored.activeRole : base.activeRole,
        draft: stored.draft && typeof stored.draft === "object" ? stored.draft : base.draft,
        searchQuery: typeof stored.searchQuery === "string" ? stored.searchQuery : base.searchQuery,
        searchCategory: typeof stored.searchCategory === "string" ? stored.searchCategory : base.searchCategory,
        searchSubcategory: typeof stored.searchSubcategory === "string" ? stored.searchSubcategory : base.searchSubcategory,
        // Zaawansowane filtry zawsze startują schowane (nie przywracaj z localStorage).
        searchFiltersOpen: false,
        searchFilterDates: Array.isArray(stored.searchFilterDates) ? stored.searchFilterDates.filter(Boolean) : base.searchFilterDates,
        searchFilterPeriods: Array.isArray(stored.searchFilterPeriods)
          ? stored.searchFilterPeriods.filter(function (p) {
              return p === "morning" || p === "afternoon" || p === "evening";
            })
          : base.searchFilterPeriods,
        searchLocation: typeof stored.searchLocation === "string" ? stored.searchLocation : base.searchLocation,
        searchUseCurrentLocation:
          typeof stored.searchUseCurrentLocation === "boolean"
            ? stored.searchUseCurrentLocation
            : base.searchUseCurrentLocation,
        searchRadiusKm:
          typeof stored.searchRadiusKm === "number" && stored.searchRadiusKm > 0
            ? stored.searchRadiusKm
            : base.searchRadiusKm,
        searchOpenSlug: typeof stored.searchOpenSlug === "string" ? stored.searchOpenSlug : base.searchOpenSlug,
        myCalMonth: typeof stored.myCalMonth === "string" ? stored.myCalMonth : base.myCalMonth,
        myCalDate: typeof stored.myCalDate === "string" ? stored.myCalDate : base.myCalDate,
        myCalMonthOpen: typeof stored.myCalMonthOpen === "boolean" ? stored.myCalMonthOpen : base.myCalMonthOpen,
        myCalStatusFilters: (function () {
          const raw = Array.isArray(stored.myCalStatusFilters) ? stored.myCalStatusFilters : null;
          if (!raw || !raw.length) return base.myCalStatusFilters.slice();
          const next = raw.filter(function (s) {
            return (
              s === "upcoming" ||
              s === "past" ||
              s === "pending" ||
              s === "cancelled" ||
              s === "rejected"
            );
          });
          return next.length ? next : base.myCalStatusFilters.slice();
        })(),
        provCalDate: typeof stored.provCalDate === "string" ? stored.provCalDate : base.provCalDate,
        provCalWindowStart:
          typeof stored.provCalWindowStart === "string" ? stored.provCalWindowStart : base.provCalWindowStart,
        provCalHourH:
          typeof stored.provCalHourH === "number" && stored.provCalHourH > 0
            ? clampProvCalHourH(stored.provCalHourH)
            : base.provCalHourH,
        provCalVisibleDays: (function () {
          if (typeof stored.provCalVisibleDays === "number") {
            return clampProvCalVisibleDays(stored.provCalVisibleDays);
          }
          // Migracja: stary zapis „dzień” → 1 kolumna; inaczej domyślny tydzień.
          if (stored.provCalView === "day") return 1;
          return base.provCalVisibleDays;
        })(),
        provCalView: (function () {
          const days =
            typeof stored.provCalVisibleDays === "number"
              ? clampProvCalVisibleDays(stored.provCalVisibleDays)
              : stored.provCalView === "day"
                ? 1
                : base.provCalVisibleDays;
          return days <= 1 ? "day" : "week";
        })(),
        provCalMonthOpen: !!stored.provCalMonthOpen,
        provCalPickerMonth:
          typeof stored.provCalPickerMonth === "string" ? stored.provCalPickerMonth : base.provCalPickerMonth,
        provCalSearchOpen: !!stored.provCalSearchOpen,
        provCalSearchQ: typeof stored.provCalSearchQ === "string" ? stored.provCalSearchQ : base.provCalSearchQ,
        provCalAddOpen: false,
        provCalAddMinimized: false,
        provCalAddDraft: null,
        provCalAddTab: "new",
        provCalReplyRequestId: null,
        provCalReplyShowAll: false,
        dashShowFreeSlots: stored.dashShowFreeSlots === true,
        dashListMode:
          stored.dashListMode === "requests" || stored.dashListMode === "rejected"
            ? stored.dashListMode
            : "visits",
        dashSearchOpen: stored.dashSearchOpen === true,
        dashSearchQ: typeof stored.dashSearchQ === "string" ? stored.dashSearchQ : "",
        providerClients:
          stored.providerClients && typeof stored.providerClients === "object" ? stored.providerClients : base.providerClients,
        provCalSelection: normalizeProvCalSelection(
          stored.provCalSelection ||
            (typeof stored.provCalSelectedBookingId === "string"
              ? { kind: "booking", bookingId: stored.provCalSelectedBookingId }
              : null)
        ),
        availWeekStart: typeof stored.availWeekStart === "string" ? stored.availWeekStart : base.availWeekStart,
        availStripScrollLeft:
          typeof stored.availStripScrollLeft === "number" ? stored.availStripScrollLeft : base.availStripScrollLeft,
        availPickerMonth:
          typeof stored.availPickerMonth === "string" ? stored.availPickerMonth : base.availPickerMonth,
        availMonthOpen:
          typeof stored.availMonthOpen === "boolean" ? stored.availMonthOpen : base.availMonthOpen,
        availListOnlySet:
          typeof stored.availListOnlySet === "boolean" ? stored.availListOnlySet : base.availListOnlySet,
        availFocusDate: typeof stored.availFocusDate === "string" ? stored.availFocusDate : base.availFocusDate,
        availEditDate: typeof stored.availEditDate === "string" ? stored.availEditDate : base.availEditDate,
        availEditDraft:
          stored.availEditDraft && typeof stored.availEditDraft === "object"
            ? stored.availEditDraft
            : base.availEditDraft,
        availEditDrafts:
          stored.availEditDrafts && typeof stored.availEditDrafts === "object"
            ? stored.availEditDrafts
            : base.availEditDrafts,
        appMenuOpen: !!stored.appMenuOpen,
        clientAvatarUrl: typeof stored.clientAvatarUrl === "string" ? stored.clientAvatarUrl : base.clientAvatarUrl,
        clientProfile:
          stored.clientProfile && typeof stored.clientProfile === "object"
            ? stored.clientProfile
            : base.clientProfile,
      };
    } else {
      window.AppState = base;
    }

    // Dopnij brakujące wizyty demo (np. po starym localStorage).
    const demoBookings = data().DEMO_BOOKINGS || [];
    if (demoBookings.length) {
      const existingById = Object.create(null);
      (window.AppState.bookings || []).forEach(function (b) {
        if (b && b.id) existingById[b.id] = b;
      });
      demoBookings.forEach(function (b) {
        if (!b || !b.id) return;
        const cur = existingById[b.id];
        if (!cur) {
          window.AppState.bookings.push(Object.assign({}, b));
          return;
        }
        // Uzupełnij brakujące dane kontaktu z demo (bez nadpisywania edycji użytkownika).
        ["clientPhone", "clientEmail", "clientAddress"].forEach(function (key) {
          if (!String(cur[key] || "").trim() && String(b[key] || "").trim()) cur[key] = b[key];
        });
      });
    }

    // Dopnij brakujące prośby o termin z demo (+ uzupełnij telefon / e-mail).
    const demoRequests = data().DEMO_REQUESTS || [];
    if (demoRequests.length) {
      if (!Array.isArray(window.AppState.requests)) window.AppState.requests = [];
      const existingReq = Object.create(null);
      window.AppState.requests.forEach(function (r) {
        if (r && r.id) existingReq[r.id] = r;
      });
      demoRequests.forEach(function (r) {
        if (!r || !r.id) return;
        const cur = existingReq[r.id];
        if (!cur) {
          window.AppState.requests.push(
            Object.assign({}, r, {
              days: Array.isArray(r.days) ? r.days.map(function (d) { return Object.assign({}, d); }) : [],
              proposals: Array.isArray(r.proposals) ? r.proposals.map(function (p) { return Object.assign({}, p); }) : [],
              serviceIds: Array.isArray(r.serviceIds) ? r.serviceIds.slice() : [],
              serviceNames: Array.isArray(r.serviceNames) ? r.serviceNames.slice() : [],
            })
          );
          return;
        }
        ["clientPhone", "clientEmail", "clientAddress"].forEach(function (key) {
          if (!String(cur[key] || "").trim() && String(r[key] || "").trim()) cur[key] = r[key];
        });
      });
    }

    const hasProposedClientVisit = (window.AppState.bookings || []).some(function (b) {
      return b.side === "client" && b.status === "proposed";
    });
    if (
      hasProposedClientVisit &&
      (window.AppState.screen.client === "myCalendar" || window.AppState.screen.client === "profile")
    ) {
      window.AppState.screen.client = "search";
    }

    return window.AppState;
  }

  // ─────────────────────────────────────────────────────────
  // Sloty rezerwacji
  // ─────────────────────────────────────────────────────────
  function computeSlots(provider, dateISO, totalDurationMin, opts) {
    opts = opts || {};
    const exceptBookingId = opts.exceptBookingId || null;
    const ignoreLead = !!opts.ignoreLead;
    const queueMode = opts.mode === "queue";
    const allowedLocs = opts.allowedLocationIds
      ? opts.allowedLocationIds instanceof Set
        ? opts.allowedLocationIds
        : new Set(opts.allowedLocationIds)
      : null;
    const day = (provider.availability || []).find((d) => d.dateISO === dateISO);
    if (!day) return [];

    const rules = ensureProviderBookingRules(provider);
    const today = demoTodayISO();
    const minLeadMin = ignoreLead ? 0 : rules.minLeadHours * 60;
    // Prototyp: „teraz” = DEMO_TODAY 09:00 — reguła min. wyprzedzenia odcina poranne sloty tego dnia.
    const nowMin = dateISO === today ? 9 * 60 + minLeadMin : dateISO < today ? Number.POSITIVE_INFINITY : 0;

    const busy = [];
    (provider.busy || []).forEach((b) => {
      if (String(b.startISO).slice(0, 10) === dateISO) {
        busy.push([minFromISO(b.startISO), minFromISO(b.endISO)]);
      }
    });
    (window.AppState.bookings || []).forEach((bk) => {
      if (exceptBookingId && bk.id === exceptBookingId) return;
      if (
        bk.providerId === provider.id &&
        bk.dateISO === dateISO &&
        (bk.status === "confirmed" || bk.status === "proposed")
      ) {
        busy.push([timeToMin(bk.from), timeToMin(bk.to)]);
      }
    });

    const slots = [];
    (day.blocks || []).forEach((block) => {
      if (allowedLocs && !allowedLocs.has(block.locationId)) return;
      const bStart = timeToMin(block.from);
      const bEnd = timeToMin(block.to);
      const locKey = block.locationId || "na";

      // Kolejka bez luk: w każdym bloku dostępności tylko następny termin zaraz po
      // ostatniej zajętości od początku bloku (osobna kolejka na przerwę w grafiku).
      if (queueMode) {
        const blockBusy = busy
          .map(function (iv) {
            return [Math.max(iv[0], bStart), Math.min(iv[1], bEnd)];
          })
          .filter(function (iv) {
            return iv[0] < iv[1];
          })
          .sort(function (a, b) {
            return a[0] - b[0];
          });
        let cursor = bStart;
        function advanceQueueCursor(fromMin) {
          let c = fromMin;
          let moved = true;
          while (moved) {
            moved = false;
            for (let i = 0; i < blockBusy.length; i++) {
              const iv = blockBusy[i];
              if (iv[0] <= c && iv[1] > c) {
                c = iv[1];
                moved = true;
              } else if (iv[0] > c) {
                break;
              }
            }
          }
          return c;
        }
        // Najpierw zapełnij od początku bloku, potem uwzględnij min. wyprzedzenie.
        cursor = advanceQueueCursor(cursor);
        if (cursor < nowMin) cursor = advanceQueueCursor(nowMin);
        if (cursor + totalDurationMin <= bEnd) {
          const e = cursor + totalDurationMin;
          const overlaps = busy.some(function (iv) {
            return cursor < iv[1] && e > iv[0];
          });
          if (!overlaps) {
            slots.push({
              id: "slot-" + dateISO + "-" + cursor + "-" + locKey,
              from: minToTime(cursor),
              to: minToTime(e),
              locationId: block.locationId,
              locationLabel: locationLabel(provider, block.locationId),
              queue: true,
            });
          }
        }
        return;
      }

      for (let s = bStart; s + totalDurationMin <= bEnd; s += 15) {
        if (s < nowMin) continue;
        const e = s + totalDurationMin;
        const overlaps = busy.some((iv) => s < iv[1] && e > iv[0]);
        if (!overlaps) {
          slots.push({
            id: `slot-${dateISO}-${s}-${locKey}`,
            from: minToTime(s),
            to: minToTime(e),
            locationId: block.locationId,
            locationLabel: locationLabel(provider, block.locationId),
          });
        }
      }
    });
    return slots;
  }

  function draftServices(provider) {
    const d = window.AppState.draft;
    if (!d || !provider) return [];
    return (provider.services || []).filter((s) => (d.serviceIds || []).indexOf(s.id) !== -1);
  }

  function draftServiceResolved(provider) {
    const d = window.AppState.draft;
    return draftServices(provider).map(function (s) {
      const variantId = selectedVariantIdForService(d, s);
      const v = resolveServiceVariant(s, variantId);
      return {
        service: s,
        variantId: v.id,
        durationMin: v.durationMin,
        price: v.price,
      };
    });
  }

  function draftTotals(provider) {
    const rows = draftServiceResolved(provider);
    const duration = rows.reduce(function (a, r) {
      return a + (r.durationMin || 0);
    }, 0);
    const hasNullPrice = rows.some(function (r) {
      return r.price == null;
    });
    const price = rows.reduce(function (a, r) {
      return a + (r.price || 0);
    }, 0);
    return { duration, price, hasNullPrice, count: rows.length };
  }

  // ─────────────────────────────────────────────────────────
  // KLIENT — ekrany
  // ─────────────────────────────────────────────────────────
  function renderBottomNavMenuLayer(active, opts) {
    opts = opts || {};
    const backOnSearch = !!opts.backOnSearch;
    const withHome = !!opts.withHome || backOnSearch;
    const items = [
      { tab: "search", label: "Szukaj", icon: "search" },
      { tab: "favorites", label: "Ulubione", icon: "heart" },
      { tab: "myCalendar", label: "Kalendarz", icon: "calendar" },
      { tab: "account", label: "Menu", icon: "profile", menu: true },
    ];
    const menuOpen = !!window.AppState.appMenuOpen;
    const homeButton = withHome
      ? `<button type="button" class="bottom-nav__item${backOnSearch || active === "search" ? " bottom-nav__item--active" : ""}"
          data-action="${backOnSearch ? "close-provider" : "go-screen"}" data-screen="search" aria-label="${backOnSearch ? "Wróć" : "Strona główna"}" ${backOnSearch || active === "search" ? 'aria-current="page"' : ""}>
          <span class="bottom-nav__icon bottom-nav__icon--home" aria-hidden="true"></span>
        </button>`
      : "";
    return `
        <span class="bottom-nav__indicator" aria-hidden="true"></span>
        ${homeButton}${items
          .map(function (it) {
            if (it.menu) {
              return `
          <button type="button" class="bottom-nav__item${menuOpen ? " bottom-nav__item--active" : ""}"
            data-action="toggle-app-menu" aria-label="Menu" aria-expanded="${menuOpen ? "true" : "false"}" aria-controls="app-menu-panel">
            <span class="bottom-nav__icon bottom-nav__icon--${it.icon}" aria-hidden="true"></span>
          </button>`;
            }
            const isActive = active === it.tab && !(withHome && it.tab === "search") && !menuOpen;
            const pendingCount = it.tab === "myCalendar" ? clientPendingAttentionCount() : 0;
            const badge = renderCountBadge(pendingCount, "count-badge bottom-nav__badge");
            const aria =
              pendingCount > 0
                ? `${it.label}, ${pendingCount} oczekując${pendingCount === 1 ? "e" : "ych"}`
                : it.label;
            return `
          <button type="button" class="bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}"
            data-action="go-screen" data-screen="${it.tab}" aria-label="${escapeHtml(aria)}" ${isActive ? 'aria-current="page"' : ""}>
            <span class="bottom-nav__icon bottom-nav__icon--${it.icon}" aria-hidden="true"></span>
            ${badge}
          </button>`;
          })
          .join("")}`;
  }

  function renderClientMenuAvatar() {
    const cp = ensureClientProfile();
    const url = window.AppState.clientAvatarUrl;
    if (url) {
      return `<img class="app-menu__avatar-img" src="${escapeHtml(url)}" alt="" />`;
    }
    return `<span class="app-menu__avatar-initials">${escapeHtml(accountInitials(cp.name))}</span>`;
  }

  function renderAppMenu() {
    const user = data().CURRENT_USER || {};
    const cp = ensureClientProfile();
    const activeRole = window.AppState.activeRole || "client";
    const clientActive = activeRole === "client";
    const providerActive = activeRole === "provider";
    const hasProvider = !!(user.providerRole && user.providerRole.active);
    const provider = hasProvider ? myProvider() : null;
    const editIcon = `<span class="app-menu__profile-edit-icon" aria-hidden="true"></span>`;

    const providerBlock = provider
      ? `<div class="app-menu__profile-group">
           <p class="app-menu__profiles-label">Profil usługodawcy</p>
           <div class="app-menu__profile app-menu__profile--provider${providerActive ? " app-menu__profile--active" : ""}">
             <button type="button" class="app-menu__profile-main" data-action="switch-role" data-role="provider" aria-pressed="${providerActive ? "true" : "false"}">
               <span class="app-menu__avatar app-menu__avatar--provider">${
                 provider.avatarUrl
                   ? `<img class="app-menu__avatar-img" src="${escapeHtml(provider.avatarUrl)}" alt="" />`
                   : `<span class="app-menu__avatar-initials">${escapeHtml(provider.avatarInitials || "?")}</span>`
               }</span>
               <span class="app-menu__profile-text">
                 <span class="app-menu__profile-name">${escapeHtml(provider.name)}</span>
               </span>
             </button>
             <button type="button" class="app-menu__profile-edit" data-action="edit-provider-profile"
               aria-label="Edytuj profil usługodawcy" title="Edytuj profil">${editIcon}</button>
           </div>
         </div>`
      : `<div class="app-menu__profile-group">
           <p class="app-menu__profiles-label">Profil usługodawcy</p>
           <button type="button" class="app-menu__profile app-menu__profile--add" data-action="add-provider-profile">
             <span class="app-menu__avatar app-menu__avatar--add" aria-hidden="true">+</span>
             <span class="app-menu__profile-text">
               <span class="app-menu__profile-name">Dodaj profil</span>
             </span>
           </button>
         </div>`;

    // Markup zawsze w stanie „zamknięty” — klasę --open dokładamy w JS,
    // żeby zadziałała animacja wysuwania z boku.
    return `
      <div class="app-menu" aria-hidden="true">
        <button type="button" class="app-menu__backdrop" data-action="close-app-menu" tabindex="-1" aria-label="Zamknij menu"></button>
        <aside class="app-menu__panel" id="app-menu-panel" role="dialog" aria-modal="true" aria-label="Menu konta">
          <div class="app-menu__head">
            <div class="app-menu__brand">
              <img class="app-menu__logo" src="assets/icons/logo-1024.png" alt="" width="40" height="40" />
              <div class="app-menu__brand-text">
                <p class="app-menu__brand-name">Lokalnie</p>
                <h2 class="app-menu__title">Menu</h2>
              </div>
            </div>
            <button type="button" class="app-menu__close" data-action="close-app-menu" aria-label="Zamknij">
              <span class="app-menu__close-icon" aria-hidden="true"></span>
            </button>
          </div>

          <div class="app-menu__profiles" role="group" aria-label="Przełącz profil">
            <div class="app-menu__profile-group">
              <p class="app-menu__profiles-label">Profil klienta</p>
              <div class="app-menu__profile app-menu__profile--client${clientActive ? " app-menu__profile--active" : ""}">
                <button type="button" class="app-menu__profile-main" data-action="switch-role" data-role="client" aria-pressed="${clientActive ? "true" : "false"}">
                  <span class="app-menu__avatar app-menu__avatar--client">${renderClientMenuAvatar()}</span>
                  <span class="app-menu__profile-text">
                    <span class="app-menu__profile-name">${escapeHtml(cp.name || "Użytkownik")}</span>
                  </span>
                </button>
                <button type="button" class="app-menu__profile-edit" data-action="edit-client-profile"
                  aria-label="Edytuj profil klienta" title="Edytuj profil">${editIcon}</button>
              </div>
            </div>
            ${providerBlock}
          </div>

          <nav class="app-menu__links" aria-label="Informacje">
            ${
              isPwaInstalled()
                ? ""
                : `<button type="button" class="app-menu__link" data-action="install-pwa">Pobierz aplikację</button>`
            }
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="privacy">Polityka prywatności</button>
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="terms">Regulamin</button>
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="contact">Kontakt</button>
          </nav>

          <div class="app-menu__version" data-role="app-version">
            <button type="button" class="app-menu__link app-menu__link--version${
              PWA.updateAvailable ? " has-update" : ""
            }" data-action="check-pwa-update" title="${
              PWA.updateAvailable ? "Zainstaluj aktualizację" : "Sprawdź aktualizacje"
            }">
              <span>Wersja aplikacji${
                PWA.updateAvailable ? `<span class="app-menu__update-badge">Nowa</span>` : ""
              }</span>
              <span class="app-menu__version-num">${escapeHtml(APP_VERSION)}</span>
            </button>
          </div>

          <div class="app-menu__footer">
            <button type="button" class="app-menu__link app-menu__link--logout" data-action="logout">Wyloguj</button>
          </div>
        </aside>
      </div>`;
  }

  function syncAppMenuNavButtons(open) {
    if (window.AppState.loggedIn && window.AppState.activeRole) {
      renderAppHeaderNav(window.AppState.activeRole);
    }
    syncAppHeaderMenuBtn(open);
    document.querySelectorAll('.bottom-nav [data-action="toggle-app-menu"]').forEach(function (btn) {
      btn.classList.toggle("bottom-nav__item--active", !!open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    syncBottomNavIndicators(null);
  }

  function setAppMenuOpenClass(open) {
    document.querySelectorAll(".app-menu").forEach(function (menu) {
      menu.classList.toggle("app-menu--open", !!open);
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      const backdrop = menu.querySelector(".app-menu__backdrop");
      if (backdrop) backdrop.tabIndex = open ? 0 : -1;
    });
  }

  function openAppMenu() {
    window.AppState.appMenuOpen = true;
    saveState();
    syncAppMenus({ animateOpen: true });
    syncAppMenuNavButtons(true);
  }

  function closeAppMenu() {
    if (!window.AppState.appMenuOpen && !document.querySelector(".app-menu--open")) return;
    window.AppState.appMenuOpen = false;
    saveState();
    setAppMenuOpenClass(false);
    syncAppMenuNavButtons(false);
  }

  function toggleAppMenu() {
    if (window.AppState.appMenuOpen) closeAppMenu();
    else openAppMenu();
  }

  function bottomNav(active, opts) {
    opts = opts || {};
    const withHome = !!opts.withHome || !!opts.backOnSearch;
    return `
      <nav class="bottom-nav${withHome ? " bottom-nav--with-back" : ""}" aria-label="Menu klienta">
        ${renderBottomNavMenuLayer(active, opts)}
      </nav>`;
  }

  function syncAppMenus(opts) {
    opts = opts || {};
    const wantOpen = !!window.AppState.appMenuOpen;
    const animateOpen = !!opts.animateOpen;
    document.querySelectorAll(".app-screen--client, .app-screen--provider").forEach(function (screen) {
      const existing = screen.querySelector(":scope > .app-menu");
      const html = renderAppMenu();
      if (existing) existing.outerHTML = html;
      else screen.insertAdjacentHTML("beforeend", html);
      if (!wantOpen) return;
      const menu = screen.querySelector(":scope > .app-menu");
      if (!menu) return;
      function applyOpen() {
        if (!window.AppState.appMenuOpen) return;
        menu.classList.add("app-menu--open");
        menu.setAttribute("aria-hidden", "false");
        const backdrop = menu.querySelector(".app-menu__backdrop");
        if (backdrop) backdrop.tabIndex = 0;
      }
      if (animateOpen) {
        // Dwa razy rAF: paint w stanie zamkniętym, potem --open → slide-in.
        requestAnimationFrame(function () {
          requestAnimationFrame(applyOpen);
        });
      } else {
        applyOpen();
      }
    });
  }

  function activateWaitingWorker(worker) {
    if (!worker) return false;
    PWA.waitingWorker = worker;
    worker.postMessage({ type: "SKIP_WAITING" });
    return true;
  }

  function syncPwaUpdateButtons() {
    document.querySelectorAll('[data-action="check-pwa-update"]').forEach(function (btn) {
      btn.classList.toggle("has-update", !!PWA.updateAvailable);
      btn.title = PWA.updateAvailable ? "Zainstaluj aktualizację" : "Sprawdź aktualizacje";
      const label = btn.querySelector("span:first-child");
      if (!label) return;
      let badge = label.querySelector(".app-menu__update-badge");
      if (PWA.updateAvailable) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "app-menu__update-badge";
          badge.textContent = "Nowa";
          label.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }

  /** Nowa wersja SW jest gotowa — komunikat + badge; użytkownik klika „Wersja aplikacji”. */
  function notifyPwaUpdateAvailable(worker) {
    if (!worker) return;
    PWA.waitingWorker = worker;
    PWA.updateAvailable = true;
    syncPwaUpdateButtons();
    if (PWA.updateNotified) return;
    PWA.updateNotified = true;
    showToast("Dostępna aktualizacja — kliknij „Wersja aplikacji”, aby zainstalować.");
  }

  function applyPwaUpdateNow(worker) {
    const w = worker || PWA.waitingWorker;
    if (!w) return false;
    showToast("Aktualizuję aplikację…");
    PWA.updateAvailable = false;
    activateWaitingWorker(w);
    return true;
  }

  function trackServiceWorker(reg) {
    if (!reg || reg._lokalnieTracked) return;
    reg._lokalnieTracked = true;
    PWA.registration = reg;

    reg.addEventListener("updatefound", function () {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", function () {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          applyPwaUpdateNow(installing);
        }
      });
    });
  }

  /** Przy starcie: wykryj update i od razu wgraj (PWA inaczej potrafi trzymać stary UI). */
  function checkPwaUpdateOnLaunch(reg) {
    if (!reg) return;
    if (reg.waiting) {
      applyPwaUpdateNow(reg.waiting);
      return;
    }
    reg
      .update()
      .then(function () {
        if (reg.waiting) applyPwaUpdateNow(reg.waiting);
      })
      .catch(function () {});
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("./sw.js?v=" + encodeURIComponent(APP_VERSION))
      .then(function (reg) {
        trackServiceWorker(reg);
        checkPwaUpdateOnLaunch(reg);
        setInterval(function () {
          reg.update().then(function () {
            if (reg.waiting) applyPwaUpdateNow(reg.waiting);
          }).catch(function () {});
        }, 60 * 60 * 1000);
      })
      .catch(function () {});

    var refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function isPwaInstalled() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIosDevice() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function pwaInstallHelpSteps() {
    if (isIosDevice()) {
      return {
        title: "Dodaj do ekranu początkowego",
        steps: [
          "Otwórz menu Udostępnij (ikona kwadratu ze strzałką w górę).",
          "Przewiń i wybierz „Do ekranu początkowego”.",
          "Potwierdź „Dodaj” — ikona Lokalnie pojawi się na pulpicie.",
        ],
      };
    }
    if (/Android/i.test(navigator.userAgent)) {
      return {
        title: "Zainstaluj aplikację",
        steps: [
          "Otwórz menu przeglądarki (⋮ w prawym górnym rogu).",
          "Wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.",
          "Potwierdź — Lokalnie pojawi się jak zwykła aplikacja.",
        ],
      };
    }
    return {
      title: "Zainstaluj aplikację",
      steps: [
        "W pasku adresu kliknij ikonę instalacji (lub +).",
        "Albo otwórz menu przeglądarki → „Zainstaluj Lokalnie”.",
        "Po instalacji otwieraj aplikację z pulpitu / menu Start.",
      ],
    };
  }

  function ensurePwaInstallHelp() {
    let el = document.getElementById("pwa-install-help");
    if (el) return el;
    el = document.createElement("div");
    el.id = "pwa-install-help";
    el.className = "pwa-install-help";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "pwa-install-help-title");
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closePwaInstallHelp() {
    const el = document.getElementById("pwa-install-help");
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    document.body.classList.remove("pwa-install-help-open");
  }

  function openPwaInstallHelp() {
    const help = pwaInstallHelpSteps();
    const el = ensurePwaInstallHelp();
    const stepsHtml = help.steps
      .map(function (step, i) {
        return `<li class="pwa-install-help__step"><span class="pwa-install-help__num">${i + 1}</span><span>${escapeHtml(step)}</span></li>`;
      })
      .join("");
    el.innerHTML = `
      <button type="button" class="pwa-install-help__backdrop" data-action="close-pwa-install-help" aria-label="Zamknij"></button>
      <div class="pwa-install-help__dialog">
        <button type="button" class="pwa-install-help__close" data-action="close-pwa-install-help" aria-label="Zamknij">
          <span class="pwa-install-help__close-icon" aria-hidden="true"></span>
        </button>
        <h2 class="pwa-install-help__title" id="pwa-install-help-title">${escapeHtml(help.title)}</h2>
        <p class="pwa-install-help__lead">Twoja przeglądarka nie pokazuje automatycznego okna instalacji. Dodaj Lokalnie ręcznie:</p>
        <ol class="pwa-install-help__steps">${stepsHtml}</ol>
        <button type="button" class="btn btn--primary pwa-install-help__ok" data-action="close-pwa-install-help">Rozumiem</button>
      </div>`;
    el.hidden = false;
    document.body.classList.add("pwa-install-help-open");
  }

  function handlePwaInstallClick() {
    closeAppMenu();
    if (isPwaInstalled()) {
      showToast("Aplikacja jest już zainstalowana.");
      return;
    }
    if (PWA.deferredInstall) {
      const deferred = PWA.deferredInstall;
      deferred
        .prompt()
        .then(function () {
          return deferred.userChoice;
        })
        .then(function (choice) {
          PWA.deferredInstall = null;
          if (choice && choice.outcome === "accepted") {
            showToast("Aplikacja dodana ✓");
          }
        })
        .catch(function () {
          openPwaInstallHelp();
        });
      return;
    }
    openPwaInstallHelp();
  }

  function bindPwaInstallPrompt() {
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      PWA.deferredInstall = event;
    });
    window.addEventListener("appinstalled", function () {
      PWA.deferredInstall = null;
      closePwaInstallHelp();
      if (window.AppState && window.AppState.appMenuOpen) {
        syncAppMenus();
      }
    });
  }

  /** Tap w „Wersja aplikacji”: wymuś sprawdzenie (auto-wdrożenie jeśli jest update). */
  function checkPwaUpdate() {
    if (!("serviceWorker" in navigator)) {
      showToast("Aktualizacje PWA niedostępne w tej przeglądarce.");
      return;
    }

    // Już jest gotowa nowa wersja — zainstaluj po kliknięciu.
    if (PWA.updateAvailable && (PWA.waitingWorker || (PWA.registration && PWA.registration.waiting))) {
      applyPwaUpdateNow(PWA.waitingWorker || PWA.registration.waiting);
      return;
    }

    showToast("Sprawdzam aktualizacje…");
    navigator.serviceWorker.getRegistration("./").then(function (reg) {
      if (!reg) {
        registerServiceWorker();
        showToast("Brak Service Workera — spróbuj ponownie za chwilę.");
        return;
      }
      trackServiceWorker(reg);
      PWA.registration = reg;

      if (reg.waiting) {
        notifyPwaUpdateAvailable(reg.waiting);
        applyPwaUpdateNow(reg.waiting);
        return;
      }

      var settled = false;
      function finishNoUpdate() {
        if (settled) return;
        settled = true;
        PWA.updateAvailable = false;
        syncPwaUpdateButtons();
        showToast("Masz aktualną wersję " + APP_VERSION);
      }

      function watchInstalling(worker) {
        if (!worker) return false;
        worker.addEventListener("statechange", function () {
          if (worker.state === "installed") {
            if (navigator.serviceWorker.controller) {
              settled = true;
              notifyPwaUpdateAvailable(worker);
              applyPwaUpdateNow(worker);
            } else {
              finishNoUpdate();
            }
          }
        });
        return true;
      }

      if (watchInstalling(reg.installing)) return;

      reg
        .update()
        .then(function () {
          if (reg.waiting) {
            settled = true;
            notifyPwaUpdateAvailable(reg.waiting);
            applyPwaUpdateNow(reg.waiting);
            return;
          }
          if (watchInstalling(reg.installing)) return;
          // Daj chwilę na updatefound → installing → installed.
          window.setTimeout(function () {
            if (reg.waiting) {
              settled = true;
              notifyPwaUpdateAvailable(reg.waiting);
              applyPwaUpdateNow(reg.waiting);
              return;
            }
            if (watchInstalling(reg.installing)) return;
            finishNoUpdate();
          }, 1200);
        })
        .catch(function () {
          showToast("Nie udało się sprawdzić aktualizacji.");
        });
    });
  }

  function renderBookingConfirmSummary(p, totals, draft) {
    const empty = !totals || !totals.count;
    const priceText = empty ? "—" : totals.hasNullPrice ? "wycena indyw." : formatPrice(totals.price);
    const durText = empty ? "—" : formatDuration(totals.duration);
    return `
      <div class="bottom-nav__summary${empty ? " bottom-nav__summary--empty" : ""}">
        <span class="bottom-nav__summary-label">Suma:</span>
        <div class="bottom-nav__summary-meta">
          <span class="bottom-nav__summary-dur">${escapeHtml(durText)}</span>
          <span class="bottom-nav__summary-price">${escapeHtml(priceText)}</span>
        </div>
      </div>`;
  }

  function bookingConfirmCTA(p, draft, totals) {
    const mode = draftBookingMode(p);
    if (isOfferRequestMode(mode)) {
      const days = (draft && draft.requestDays) || [];
      return {
        action: "send-request",
        label: "Wyślij prośbę",
        enabled: !!(totals && totals.count && (mode === "request" || days.length)),
        slugAttr: p ? ` data-slug="${escapeHtml(p.slug)}"` : "",
      };
    }
    return {
      action: "confirm-booking",
      label: "Rezerwuj",
      enabled: !!(draft && draft.slotId && totals && totals.count),
      slugAttr: "",
    };
  }

  function renderBookingConfirmBar(draft) {
    if (!draft) return "";
    const hasServices = !!(draft.serviceIds && draft.serviceIds.length);
    const p = draft.slug ? getProviderBySlug(draft.slug) : null;
    const totals = p ? draftTotals(p) : { count: 0, duration: 0, price: 0 };
    const cta = bookingConfirmCTA(p, draft, totals);
    const clearBtn = hasServices
      ? `<button type="button" class="bottom-nav__clear" data-action="cancel-booking-selection" aria-label="Anuluj wybór usług">
          <span class="bottom-nav__icon bottom-nav__icon--close" aria-hidden="true"></span>
        </button>`
      : "";
    return `
      <div class="booking-confirm-bar" data-role="booking-confirm-bar">
        ${renderBookingConfirmSummary(p, totals, draft)}
        <button type="button" class="bottom-nav__book" data-action="${cta.action}"${cta.slugAttr}${cta.enabled ? "" : " disabled"}>${cta.label}</button>
        ${clearBtn}
      </div>`;
  }

  function updateBookingBottomNav(screenOrNav, draft) {
    const screen =
      screenOrNav && screenOrNav.classList && screenOrNav.classList.contains("app-screen--booking")
        ? screenOrNav
        : screenOrNav && screenOrNav.closest
          ? screenOrNav.closest(".app-screen--booking")
          : null;
    if (!screen) return;
    let bar = screen.querySelector('[data-role="booking-confirm-bar"]');
    const html = renderBookingConfirmBar(draft);
    if (html) {
      if (bar) bar.outerHTML = html;
      else screen.insertAdjacentHTML("beforeend", html);
    } else if (bar) {
      bar.remove();
    }
  }

  function bookingBottomNav(draft) {
    return renderBookingConfirmBar(draft);
  }

  function captureBottomNavTab() {
    const active = document.querySelector(".bottom-nav .bottom-nav__item--active");
    return active ? active.getAttribute("data-screen") : null;
  }

  function syncBottomNavIndicators(prevTab) {
    document.querySelectorAll(".bottom-nav").forEach(function (nav) {
      const indicator = nav.querySelector(".bottom-nav__indicator");
      const items = Array.from(nav.querySelectorAll(".bottom-nav__item"));
      const activeIndex = items.findIndex(function (item) {
        return item.classList.contains("bottom-nav__item--active");
      });
      if (!indicator || activeIndex === -1) return;

      // Ukryte menu (desktop / display:none) — nie mierz, zostaw w spokoju.
      const navRect = nav.getBoundingClientRect();
      if (navRect.width < 1 || getComputedStyle(nav).display === "none") return;

      const prevIndex = prevTab
        ? items.findIndex(function (item) {
            return item.getAttribute("data-screen") === prevTab;
          })
        : activeIndex;

      const indicatorSize = 44;

      // Pozycja względem nav (padding edge), nie offsetLeft — przy flex/width:0
      // offsetWidth bywa 0 i wychodzi translateX(-22px) poza lewą krawędź.
      function indicatorLeft(item) {
        const itemRect = item.getBoundingClientRect();
        if (itemRect.width < 1) return null;
        indicator.style.width = indicatorSize + "px";
        indicator.style.height = indicatorSize + "px";
        return itemRect.left - navRect.left - nav.clientLeft + (itemRect.width - indicatorSize) / 2;
      }

      const fromItem = items[prevIndex >= 0 ? prevIndex : activeIndex];
      const toItem = items[activeIndex];
      const fromLeft = indicatorLeft(fromItem);
      const toLeft = indicatorLeft(toItem);
      if (toLeft == null) return;
      const shouldAnimate =
        prevTab && prevIndex >= 0 && prevIndex !== activeIndex && fromLeft != null;

      indicator.style.transition = "none";
      indicator.style.transform = "translateX(" + (shouldAnimate ? fromLeft : toLeft) + "px)";
      indicator.offsetHeight;

      if (shouldAnimate) {
        indicator.style.transition = "";
        indicator.style.transform = "translateX(" + toLeft + "px)";
      }
    });
  }

  function accountInitials(name) {
    const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function captureClientAccountFields() {
    const cp = ensureClientProfile();
    const nameEl = document.querySelector('[data-role="account-name"]');
    const phoneEl = document.querySelector('[data-role="account-phone"]');
    const emailEl = document.querySelector('[data-role="account-email"]');
    if (nameEl) {
      const n = String(nameEl.value || "").trim();
      cp.name = n || cp.name || "Użytkownik";
    }
    if (phoneEl) cp.phone = String(phoneEl.value || "").trim();
    if (emailEl) cp.email = String(emailEl.value || "").trim();
    const rem = document.querySelector('[data-role="account-notif-reminders"]');
    const status = document.querySelector('[data-role="account-notif-status"]');
    const marketing = document.querySelector('[data-role="account-notif-marketing"]');
    if (rem) cp.notifications.visitReminders = !!rem.checked;
    if (status) cp.notifications.statusChanges = !!status.checked;
    if (marketing) cp.notifications.marketing = !!marketing.checked;
    ensureClientProfile();
  }

  function renderAccount() {
    const user = data().CURRENT_USER || {};
    const cp = ensureClientProfile();
    const notes = cp.notifications;
    const hasProvider = user.providerRole && user.providerRole.active;

    return `
      <div class="app-screen app-screen--client app-screen--account">
        <div class="app-scroll">
          <header class="screen-head screen-head--with-back">
            <button type="button" class="screen-head__back" data-action="go-screen" data-screen="search" aria-label="Wróć">
              <span class="screen-head__back-icon" aria-hidden="true"></span>
            </button>
            <div class="screen-head__text">
              <h2 class="screen-head__title">Konto i ustawienia</h2>
              <p class="screen-head__sub">Dane klienta i powiadomienia.</p>
            </div>
          </header>
          <div class="settings settings--client">
            <div class="settings__row settings__row--account-card">
              <span class="account-card__avatar">${
                window.AppState.clientAvatarUrl
                  ? `<img class="account-card__avatar-img" src="${escapeHtml(window.AppState.clientAvatarUrl)}" alt="" />`
                  : escapeHtml(accountInitials(cp.name))
              }</span>
              <div class="settings__toggle-text">
                <span class="settings__key">Zdjęcie profilu</span>
                <span class="settings__hint">${escapeHtml(cp.name || "Użytkownik")}</span>
              </div>
              <label class="settings-account__photo-btn">
                Zmień
                <input type="file" class="app-menu__file" accept="image/*" data-action="change-client-avatar" tabindex="-1" />
              </label>
            </div>
            <div class="settings__row settings__row--contact" data-field="account-details">
              <span class="settings__key">Dane konta</span>
              <p class="settings__help">Widoczne dla usługodawcy przy rezerwacji wizyty.</p>
              ${renderSettingsFloatField({
                label: "Imię i nazwisko",
                role: "account-name",
                value: cp.name || "",
                attrs: 'maxlength="60" autocomplete="name"',
              })}
              ${renderSettingsFloatField({
                label: "Telefon",
                role: "account-phone",
                type: "tel",
                value: cp.phone || "",
                attrs: 'autocomplete="tel" inputmode="tel"',
              })}
              ${renderSettingsFloatField({
                label: "E-mail",
                role: "account-email",
                type: "email",
                value: cp.email || "",
                attrs: 'autocomplete="email" inputmode="email"',
              })}
            </div>
            <div class="settings__row" data-field="account-notifications">
              <span class="settings__key">Powiadomienia</span>
              <p class="settings__help">Przypomnienia i zmiany statusu wizyt.</p>
              <div class="settings-contact__toggle">
                <div class="settings__toggle-text">
                  <span class="settings__hint">Przypomnienia o wizytach</span>
                  <span class="settings-contact__toggle-hint">Dzień przed i przed terminem</span>
                </div>
                <label class="settings__toggle">
                  <input type="checkbox" class="avail-edit__switch" data-role="account-notif-reminders"
                    ${notes.visitReminders ? "checked" : ""} aria-label="Przypomnienia o wizytach" />
                </label>
              </div>
              <div class="settings-contact__toggle">
                <div class="settings__toggle-text">
                  <span class="settings__hint">Zmiany statusu</span>
                  <span class="settings-contact__toggle-hint">Potwierdzenia, odwołania, propozycje</span>
                </div>
                <label class="settings__toggle">
                  <input type="checkbox" class="avail-edit__switch" data-role="account-notif-status"
                    ${notes.statusChanges ? "checked" : ""} aria-label="Zmiany statusu wizyt" />
                </label>
              </div>
              <div class="settings-contact__toggle">
                <div class="settings__toggle-text">
                  <span class="settings__hint">Oferty i nowości</span>
                  <span class="settings-contact__toggle-hint">Opcjonalne wiadomości marketingowe</span>
                </div>
                <label class="settings__toggle">
                  <input type="checkbox" class="avail-edit__switch" data-role="account-notif-marketing"
                    ${notes.marketing ? "checked" : ""} aria-label="Oferty i nowości" />
                </label>
              </div>
            </div>
            ${
              hasProvider
                ? `<div class="settings__row settings__row--actions">
                    <button type="button" class="btn btn--ghost account-actions__btn" data-action="switch-role" data-role="provider">Przełącz na usługodawcę</button>
                  </div>`
                : ""
            }
            <div class="settings__row settings__row--actions">
              <button type="button" class="btn btn--ghost account-actions__btn account-actions__btn--logout" data-action="logout">Wyloguj</button>
            </div>
          </div>
        </div>
        ${bottomNav("account")}
      </div>`;
  }

  function searchFiltersActive() {
    return (
      !!(window.AppState.searchSubcategory || "") ||
      !!(window.AppState.searchFilterDates || []).length ||
      !!(window.AppState.searchFilterPeriods || []).length
    );
  }

  function renderSearchExtraFilters() {
    const cat = window.AppState.searchCategory || "";
    const sub = window.AppState.searchSubcategory || "";
    const open = !!window.AppState.searchFiltersOpen;
    const selectedDates = window.AppState.searchFilterDates || [];
    const selectedPeriods = window.AppState.searchFilterPeriods || [];

    const subs = cat
      ? subcategoriesFor(cat)
      : (data().CATEGORIES || []).reduce(function (acc, c) {
          (c.subcategories || []).forEach(function (s) {
            if (!acc.some(function (x) { return x.id === s.id; })) acc.push(s);
          });
          return acc;
        }, []);

    const subRow = subs.length
      ? `
        <div class="search-filters__section">
          <div class="filter-scroll filter-scroll--sub" data-filter-scroll>
            <div class="filter-scroll__track subcategory-chips">
              <button type="button" class="subcategory-chip${sub === "" ? " subcategory-chip--active" : ""}"
                data-action="filter-subcategory" data-subcategory="">Wszystkie</button>
              ${subs
                .map(function (s) {
                  return `
              <button type="button" class="subcategory-chip${sub === s.id ? " subcategory-chip--active" : ""}"
                data-action="filter-subcategory" data-subcategory="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`;
                })
                .join("")}
            </div>
          </div>
        </div>`
      : `
        <div class="search-filters__section">
          <p class="search-filters__empty">Wybierz kategorię z podkategoriami (np. Uroda).</p>
        </div>`;

    const todayISO = demoTodayISO();
    const filterDates = searchFilterDateOptions();
    const dateChips = filterDates
      .map(function (dateISO) {
        return renderSearchFilterDateChip(dateISO, selectedDates, todayISO);
      })
      .join("");
    const filterMonth = monthLabelFromISO(filterDates[0] || todayISO) || "";

    const periodChips = SEARCH_PERIODS.map(function (period) {
      const on = selectedPeriods.indexOf(period.id) !== -1;
      return `
        <button type="button" class="period-chip${on ? " period-chip--active" : ""}"
          data-action="toggle-filter-period" data-period="${escapeHtml(period.id)}" aria-pressed="${on ? "true" : "false"}">
          ${escapeHtml(period.label)}
        </button>`;
    }).join("");

    return `
      <div class="search-filters${open ? " search-filters--open" : ""}" data-role="search-filters"
        aria-hidden="${open ? "false" : "true"}"${open ? "" : " inert"}>
        <div class="search-filters__inner">
          ${subRow}
          <div class="search-filters__section">
            <div class="search-filters__label-row">
              <p class="search-filters__label">Dzień</p>
              <span class="search-filters__month" data-role="search-filter-month">${escapeHtml(filterMonth)}</span>
            </div>
            <div class="filter-scroll filter-scroll--dates" data-filter-scroll>
              <div class="filter-scroll__track date-strip date-strip--filters">${dateChips}</div>
            </div>
          </div>
          <div class="search-filters__section">
            <p class="search-filters__label">Pora dnia</p>
            <div class="period-chips">${periodChips}</div>
          </div>
        </div>
      </div>`;
  }

  function applySearchFiltersOpen(open, trigger) {
    const clickedWrap = trigger && trigger.closest(".filters-wrap");
    const wraps = clickedWrap
      ? [clickedWrap].concat(
          Array.from(document.querySelectorAll(".filters-wrap")).filter(function (wrap) {
            return wrap !== clickedWrap;
          })
        )
      : Array.from(document.querySelectorAll(".filters-wrap"));
    if (!wraps.length) {
      renderAll();
      return;
    }
    wraps.forEach(function (wrap) {
      const panel = wrap.querySelector('[data-role="search-filters"]');
      const btn = wrap.querySelector('[data-action="toggle-search-filters"]');
      if (!panel || !btn) return;
      panel.classList.toggle("search-filters--open", !!open);
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open) panel.removeAttribute("inert");
      else panel.setAttribute("inert", "");
      btn.classList.toggle("filter-toggle--open", !!open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function syncSearchFilterControlIds() {
    document.querySelectorAll(".filters-wrap").forEach(function (wrap, index) {
      const panel = wrap.querySelector('[data-role="search-filters"]');
      const btn = wrap.querySelector('[data-action="toggle-search-filters"]');
      if (!panel || !btn) return;
      const panelId = "search-filters-panel-" + (index + 1);
      panel.id = panelId;
      btn.setAttribute("aria-controls", panelId);
    });
  }

  function renderSearch() {
    const cat = window.AppState.searchCategory || "";
    const providers = filterProviders();
    const openSlug = window.AppState.searchOpenSlug;
    const filtersOpen = !!window.AppState.searchFiltersOpen;
    const filtersOn = searchFiltersActive();

    const chips = (data().CATEGORIES || [])
      .map(
        (c) => `
        <button type="button" class="category-chip${cat === c.id ? " category-chip--active" : ""}"
          data-action="filter-category" data-category="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`
      )
      .join("");

    const mainChipsHtml = `
            <button type="button" class="category-chip${cat === "" ? " category-chip--active" : ""}"
              data-action="filter-category" data-category="" aria-label="Wszystkie">
              <span class="chip-label chip-label--full">Wszystkie</span>
              <span class="chip-label chip-label--short" aria-hidden="true">Wsz.</span>
            </button>
            ${chips}`;

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <div class="search-wrap">
            ${renderSearchDesktopBar()}
            ${renderSearchMobileBar()}
          </div>
          <div class="filters-wrap">
            <div class="category-filter-row">
              <div class="filter-scroll filter-scroll--main" data-filter-scroll>
                <div class="filter-scroll__track category-chips">${mainChipsHtml}</div>
              </div>
              <button type="button" class="filter-toggle${filtersOpen ? " filter-toggle--open" : ""}${filtersOn ? " filter-toggle--active" : ""}"
                data-action="toggle-search-filters" aria-label="Filtry" title="Filtry"
                aria-expanded="${filtersOpen ? "true" : "false"}">
                <span class="filter-toggle__icon" aria-hidden="true"></span>
              </button>
            </div>
            ${renderSearchExtraFilters()}
          </div>
          <div class="provider-list">
            ${providers.length ? providers.map(function (p) { return renderProviderListItem(p, p.slug === openSlug); }).join("") : `<p class="empty-note">Brak wyników dla wybranych filtrów.</p>`}
          </div>
        </div>
        ${bottomNav("search")}
      </div>`;
  }

  function renderFavorites() {
    const favs = window.AppState.favorites
      .map(getProviderBySlug)
      .filter(Boolean);
    const openSlug = window.AppState.searchOpenSlug;
    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Ulubione</h2>
            <p class="screen-head__sub">Twoi zapisani usługodawcy.</p>
          </header>
          <div class="provider-list">
            ${favs.length ? favs.map(function (p) { return renderProviderListItem(p, p.slug === openSlug); }).join("") : `<p class="empty-note">Nie masz jeszcze ulubionych. Dodaj ich sercem w profilu.</p>`}
          </div>
        </div>
        ${bottomNav("favorites")}
      </div>`;
  }

  function clientVisits() {
    return (window.AppState.bookings || [])
      .filter(function (b) {
        return b.side === "client" && b.dateISO;
      })
      .slice()
      .sort(function (a, b) {
        return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
      });
  }

  function ensureMyCalDate() {
    if (window.AppState.myCalDate) return window.AppState.myCalDate;
    const today = demoTodayISO();
    window.AppState.myCalDate = today;
    window.AppState.myCalMonth = today.slice(0, 7);
    return today;
  }

  function ensureMyCalMonth() {
    if (window.AppState.myCalMonth) return window.AppState.myCalMonth;
    const selected = ensureMyCalDate();
    window.AppState.myCalMonth = selected.slice(0, 7);
    return window.AppState.myCalMonth;
  }

  function renderMyCalDayHead(dateISO, selectedISO, visitSet) {
    const d = new Date(dateISO + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    const isToday = dateISO === demoTodayISO();
    const isSel = dateISO === selectedISO;
    const sun = d.getDay() === 0;
    const hasVisit = visitSet && visitSet.has(dateISO);
    return `
      <button type="button" class="gcal-week__dayhead${isToday ? " gcal-week__dayhead--today" : ""}${
        isSel ? " gcal-week__dayhead--sel" : ""
      }${sun ? " gcal-week__dayhead--sun" : ""}${hasVisit ? " gcal-week__dayhead--busy" : ""}"
        data-action="my-cal-pick-date" data-date="${escapeHtml(dateISO)}"
        aria-label="${escapeHtml(PROV_CAL_DOW_SHORT[d.getDay()] + " " + d.getDate())}${hasVisit ? ", wizyty" : ""}"
        aria-pressed="${isSel ? "true" : "false"}">
        <span class="gcal-week__dow">${PROV_CAL_DOW_SHORT[d.getDay()]}</span>
        <span class="gcal-week__num">${d.getDate()}</span>
      </button>`;
  }

  function renderMyCalWeekStrip(selectedISO, visitSet) {
    const weekStart = mondayISOFrom(selectedISO);
    const underMonth = !!window.AppState.myCalMonthOpen;
    let days = "";
    for (let i = 0; i < 7; i++) {
      days += renderMyCalDayHead(addDaysISO(weekStart, i), selectedISO, visitSet);
    }
    return `
      <div class="gcal-week__sticky my-cal-week${underMonth ? " gcal-week__sticky--under-month" : ""}"${
        underMonth ? ' aria-hidden="true"' : ""
      }>
        <div class="gcal-week__head my-cal-week__head">
          <div class="gcal-week__days-clip">
            <div class="gcal-week__days">${days}</div>
          </div>
        </div>
      </div>`;
  }

  function renderMyCalMonthPanel(selectedISO, visitSet, opts) {
    opts = opts || {};
    if (!opts.force && !window.AppState.myCalMonthOpen) return "";
    const pickerMonth = ensureMyCalMonth();
    const parts = pickerMonth.split("-");
    const year = Number(parts[0]) || 2026;
    const month = Number(parts[1]) || 1;
    const today = demoTodayISO();
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;
    const totalCells = 42;
    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="gcal-month__day gcal-month__day--pad" aria-hidden="true"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = year + "-" + pad(month) + "-" + pad(day);
      const selected = dateISO === selectedISO;
      const isToday = dateISO === today;
      const hasVisit = visitSet.has(dateISO);
      const red = isSunday(dateISO) || isRedCalendarDay(dateISO);
      cells += `
        <button type="button"
          class="gcal-month__day${selected ? " gcal-month__day--on" : ""}${isToday ? " gcal-month__day--today" : ""}${hasVisit ? " gcal-month__day--busy" : ""}${red ? " gcal-month__day--red" : ""}"
          data-action="my-cal-pick-date" data-date="${escapeHtml(dateISO)}"
          aria-pressed="${selected ? "true" : "false"}"
          aria-label="${day}${hasVisit ? ", wizyty" : ""}">
          <span class="gcal-month__day-num">${day}</span>
          ${hasVisit ? `<span class="gcal-month__day-dot" aria-hidden="true"></span>` : ""}
        </button>`;
    }
    const filled = startPad + daysInMonth;
    for (let i = filled; i < totalCells; i++) {
      cells += `<span class="gcal-month__day gcal-month__day--pad" aria-hidden="true"></span>`;
    }

    const side = !!opts.side;
    const reveal = !side && !!window._myCalMonthAnimateReveal;
    return `
      <div class="gcal-month${reveal ? "" : " gcal-month--instant"}${side ? " gcal-month--side" : ""}" data-role="${
        side ? "my-cal-month-side" : "my-cal-month-panel"
      }">
        <div class="gcal-month__cal" data-role="my-cal-month-swipe">
          <div class="gcal-month__weekdays">${CAL_WEEKDAYS.map(function (w) {
            return `<span>${w}</span>`;
          }).join("")}</div>
          <div class="gcal-month__grid">${cells}</div>
        </div>
      </div>`;
  }

  function myCalMonthPanels() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-role="my-cal-month-panel"]'));
  }

  function setMyCalMonthOpen(wantOpen, opts) {
    opts = opts || {};
    const cur = !!window.AppState.myCalMonthOpen;
    if (!!wantOpen === cur && !opts.force) return;

    if (wantOpen) {
      window._myCalMonthClosing = false;
      window.AppState.myCalMonthOpen = true;
      window.AppState.myCalMonth = ensureMyCalDate().slice(0, 7);
      window._myCalMonthAnimateReveal = opts.animate !== false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      window._myCalMonthAnimateReveal = false;
      return;
    }

    if (opts.animate === false) {
      window._myCalMonthClosing = false;
      window.AppState.myCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      return;
    }

    const panels = myCalMonthPanels().filter(function (panel) {
      return panel.offsetWidth > 8;
    });
    if (!panels.length) {
      window.AppState.myCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      return;
    }
    if (window._myCalMonthClosing) return;
    window._myCalMonthClosing = true;
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      window._myCalMonthClosing = false;
      window.AppState.myCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
    }
    document.querySelectorAll(".app-screen--my-cal .gcal-week__sticky--under-month").forEach(function (el) {
      el.classList.add("gcal-week__sticky--revealing");
      el.removeAttribute("aria-hidden");
    });
    panels.forEach(function (panel) {
      const h = Math.max(panel.offsetHeight, panel.scrollHeight);
      panel.style.maxHeight = h + "px";
      panel.style.opacity = "1";
      panel.style.transform = "translateY(0)";
      panel.classList.add("gcal-month--closing");
      void panel.offsetHeight;
      panel.style.maxHeight = "0px";
      panel.style.opacity = "0";
      panel.style.transform = "translateY(-0.35rem)";
      panel.style.paddingTop = "0";
      panel.style.paddingBottom = "0";
    });
    window.setTimeout(finish, 340);
  }

  function toggleMyCalMonthPanel() {
    if (usesDesktopLayout()) return;
    setMyCalMonthOpen(!window.AppState.myCalMonthOpen);
  }

  function shiftMyCalMonth(delta) {
    const ref = ensureMyCalMonth();
    const parts = ref.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    window.AppState.myCalMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    window.AppState.myCalMonthOpen = true;
    saveState();
    renderAll();
  }

  function pickMyCalDate(dateISO) {
    if (!dateISO) return;
    window.AppState.myCalDate = dateISO;
    window.AppState.myCalMonth = dateISO.slice(0, 7);
    saveState();
    renderAll();
  }

  function goMyCalToday() {
    const today = demoTodayISO();
    window.AppState.myCalDate = today;
    window.AppState.myCalMonth = today.slice(0, 7);
    saveState();
    renderAll();
  }

  function setMyCalStatusFilter(status) {
    const allowed = { upcoming: 1, past: 1, pending: 1, cancelled: 1, rejected: 1 };
    if (!allowed[status]) return;
    window.AppState.myCalStatusFilters = [status];
    saveState();
    renderAll();
  }

  /** Filtr „Czekające na potwierdzenie” obejmuje pending i proposed. */
  function visitMatchesMyCalStatusFilters(b, statusFilters) {
    if (!statusFilters || !statusFilters.length) return true;
    return statusFilters.some(function (f) {
      if (f === "pending") return b.status === "pending" || b.status === "proposed";
      if (f === "upcoming") {
        const today = demoTodayISO();
        if (!b.dateISO || b.dateISO < today) return false;
        return b.status === "confirmed" || b.status === "pending" || b.status === "proposed";
      }
      if (f === "past") {
        const today = demoTodayISO();
        if (!b.dateISO || b.dateISO >= today) return false;
        return b.status === "confirmed";
      }
      return b.status === f;
    });
  }

  function renderMyCalStatusFilters() {
    const active = Array.isArray(window.AppState.myCalStatusFilters)
      ? window.AppState.myCalStatusFilters
      : [];
    const current = active.length === 1 ? active[0] : "upcoming";
    const pendingCount = clientPendingAttentionCount();
    // Hierarchia wartości dla klienta: przyszłość → akcja → historia → negatywne.
    const tabs = [
      { id: "upcoming", label: "Nadchodzące" },
      { id: "pending", label: "Czekające na potwierdzenie", count: pendingCount },
      { id: "past", label: "Odbyte" },
      { id: "cancelled", label: "Odwołane" },
      { id: "rejected", label: "Odrzucone" },
    ];
    return `
      <div class="my-cal-status-rail" data-my-cal-status-rail>
        <button type="button" class="my-cal-status-rail__btn my-cal-status-rail__btn--prev"
          data-action="my-cal-status-scroll" data-dir="-1" aria-label="Przewiń w lewo" hidden>‹</button>
        <div class="my-cal-status-tabs" role="tablist" aria-label="Filtr statusów wizyt" data-my-cal-status-scroll>
          ${tabs
            .map(function (tab) {
              const on = current === tab.id;
              const badge = renderCountBadge(tab.count, "count-badge my-cal-status-tab__badge");
              const aria =
                tab.count > 0
                  ? `${tab.label}, ${tab.count} oczekując${tab.count === 1 ? "e" : "ych"}`
                  : tab.label;
              return `<button type="button" class="my-cal-status-tab${on ? " is-active" : ""}"
                role="tab" data-action="my-cal-status-filter" data-status="${tab.id}"
                aria-selected="${on ? "true" : "false"}" aria-label="${escapeHtml(aria)}">${escapeHtml(tab.label)}${badge}</button>`;
            })
            .join("")}
        </div>
        <button type="button" class="my-cal-status-rail__btn my-cal-status-rail__btn--next"
          data-action="my-cal-status-scroll" data-dir="1" aria-label="Przewiń w prawo" hidden>›</button>
      </div>`;
  }

  function syncMyCalStatusRail(rail) {
    if (!rail) return;
    const scroller = rail.querySelector("[data-my-cal-status-scroll]");
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const left = scroller.scrollLeft;
    const canLeft = max > 2 && left > 2;
    const canRight = max > 2 && left < max - 2;
    rail.classList.toggle("can-scroll-left", canLeft);
    rail.classList.toggle("can-scroll-right", canRight);
    rail.classList.toggle("is-overflowing", max > 2);
    const prev = rail.querySelector(".my-cal-status-rail__btn--prev");
    const next = rail.querySelector(".my-cal-status-rail__btn--next");
    if (prev) {
      prev.hidden = !canLeft;
      prev.disabled = !canLeft;
    }
    if (next) {
      next.hidden = !canRight;
      next.disabled = !canRight;
    }
  }

  function ensureMyCalStatusActiveVisible(scroller) {
    if (!scroller) return;
    const active = scroller.querySelector(".my-cal-status-tab.is-active");
    if (!active) return;
    const pad = 28;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const viewL = scroller.scrollLeft;
    const viewR = viewL + scroller.clientWidth;
    if (left < viewL + pad) {
      scroller.scrollLeft = Math.max(0, left - pad);
    } else if (right > viewR - pad) {
      scroller.scrollLeft = Math.max(0, right - scroller.clientWidth + pad);
    }
  }

  function syncAllMyCalStatusRails(opts) {
    const bringActive = !!(opts && opts.bringActive);
    document.querySelectorAll("[data-my-cal-status-rail]").forEach(function (rail) {
      const scroller = rail.querySelector("[data-my-cal-status-scroll]");
      if (bringActive) ensureMyCalStatusActiveVisible(scroller);
      syncMyCalStatusRail(rail);
    });
  }

  function scrollMyCalStatusRail(dir, fromEl) {
    const rail = fromEl && fromEl.closest("[data-my-cal-status-rail]");
    const scroller = rail && rail.querySelector("[data-my-cal-status-scroll]");
    if (!scroller) return;
    const amount = Math.max(160, Math.floor(scroller.clientWidth * 0.65));
    const step = (Number(dir) || 1) >= 0 ? amount : -amount;
    if (typeof scroller.scrollBy === "function") {
      scroller.scrollBy({ left: step, behavior: "smooth" });
    } else {
      scroller.scrollLeft += step;
    }
    window.setTimeout(function () {
      syncMyCalStatusRail(rail);
    }, 220);
  }

  function bindMyCalStatusRail() {
    if (bindMyCalStatusRail.done) return;
    bindMyCalStatusRail.done = true;
    document.addEventListener(
      "scroll",
      function (event) {
        const t = event.target;
        if (!t || !t.getAttribute || t.getAttribute("data-my-cal-status-scroll") == null) return;
        const rail = t.closest("[data-my-cal-status-rail]");
        if (rail) syncMyCalStatusRail(rail);
      },
      true
    );
    window.addEventListener("resize", function () {
      syncAllMyCalStatusRails();
    });
    // iOS: gest na poziomej karuzeli nie może „bujnąć” pionowo rodzica (rubber-band).
    const axis = { el: null, x: 0, y: 0, scrollLeft: 0, dir: null };
    function hScrollTarget(from) {
      // Tylko zakładki statusów — karuzela pulpitu (.stat-row) zostaje na natywnym pan-x.
      return from && from.closest && from.closest("[data-my-cal-status-scroll]");
    }
    document.addEventListener(
      "touchstart",
      function (event) {
        const scroller = hScrollTarget(event.target);
        if (!scroller || !event.touches || !event.touches[0]) {
          axis.el = null;
          return;
        }
        axis.el = scroller;
        axis.x = event.touches[0].clientX;
        axis.y = event.touches[0].clientY;
        axis.scrollLeft = scroller.scrollLeft;
        axis.dir = null;
      },
      { capture: true, passive: true }
    );
    document.addEventListener(
      "touchmove",
      function (event) {
        if (!axis.el || !event.touches || !event.touches[0]) return;
        const dx = event.touches[0].clientX - axis.x;
        const dy = event.touches[0].clientY - axis.y;
        if (axis.dir == null) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          axis.dir = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }
        if (axis.dir !== "x") {
          axis.el = null;
          return;
        }
        if (event.cancelable) event.preventDefault();
        axis.el.scrollLeft = axis.scrollLeft - dx;
        const rail = axis.el.closest("[data-my-cal-status-rail]");
        if (rail) syncMyCalStatusRail(rail);
      },
      { capture: true, passive: false }
    );
    document.addEventListener(
      "touchend",
      function () {
        axis.el = null;
        axis.dir = null;
      },
      { capture: true, passive: true }
    );
    document.addEventListener(
      "touchcancel",
      function () {
        axis.el = null;
        axis.dir = null;
      },
      { capture: true, passive: true }
    );
  }

  function clientOpenRequests() {
    return (window.AppState.requests || []).filter(function (r) {
      return r && (r.status === "pending" || r.status === "proposed");
    });
  }

  /** Wizyty klienta czekające na potwierdzenie / akceptację propozycji. */
  function clientPendingVisits() {
    return (window.AppState.bookings || []).filter(function (b) {
      return b && b.side === "client" && (b.status === "pending" || b.status === "proposed");
    });
  }

  /** Licznik oczekujących: zapytania o termin + wizyty niepotwierdzone. */
  function clientPendingAttentionCount() {
    return clientOpenRequests().length + clientPendingVisits().length;
  }

  function renderCountBadge(count, className) {
    const n = Number(count) || 0;
    if (n < 1) return "";
    const label = n > 99 ? "99+" : String(n);
    return `<span class="${className}" aria-hidden="true">${escapeHtml(label)}</span>`;
  }

  function renderVisitCardDateBlock(dateISO) {
    const day = dateISO ? new Date(String(dateISO).slice(0, 10) + "T12:00:00") : null;
    const dayOk = day && !isNaN(day.getTime());
    if (!dayOk) {
      return `<div class="visit-card__date visit-card__date--empty" aria-hidden="true">
          <span class="visit-card__dow">—</span>
          <span class="visit-card__daynum">·</span>
          <span class="visit-card__month">termin</span>
        </div>`;
    }
    const dow =
      typeof PROV_CAL_DOW_SHORT !== "undefined" ? PROV_CAL_DOW_SHORT[day.getDay()] : "";
    return `<div class="visit-card__date" aria-label="${escapeHtml(formatDateLong(dateISO))}">
        <span class="visit-card__dow">${escapeHtml(dow)}</span>
        <span class="visit-card__daynum">${escapeHtml(String(day.getDate()))}</span>
        <span class="visit-card__month">${escapeHtml(MONTHS[day.getMonth()])}</span>
      </div>`;
  }

  function renderClientVisitQuickActions(opts) {
    const o = opts || {};
    const address = o.address || "";
    const phone = o.phone || "";
    const slug = o.slug || "";
    const bookingId = o.bookingId || "";
    const canAddToCalendar = !!(o.canAddToCalendar && bookingId);
    const showRebook = o.showRebook !== false && !!slug;
    const calendarChip = canAddToCalendar
      ? `<button type="button" class="visit-card__chip" data-action="add-visit-calendar" data-booking-id="${escapeHtml(bookingId)}">
            <span class="visit-card__chip-icon visit-card__chip-icon--calendar" aria-hidden="true"></span>
            Dodaj do kalendarza
          </button>`
      : "";
    const rebookChip = showRebook
      ? `<button type="button" class="visit-card__chip" data-action="${
          bookingId ? "rebook-visit" : "open-profile"
        }" ${bookingId ? `data-booking-id="${escapeHtml(bookingId)}"` : `data-slug="${escapeHtml(slug)}"`}>
            <span class="visit-card__chip-icon visit-card__chip-icon--rebook" aria-hidden="true"></span>
            Umów ponownie
          </button>`
      : "";
    if (!address && !phone && !calendarChip && !rebookChip && !slug) return "";
    return `<div class="visit-card__quick" role="group" aria-label="Szybkie akcje">
            ${
              address
                ? `<a class="visit-card__chip" href="${escapeHtml(mapsSearchUrl(address))}" target="_blank" rel="noopener noreferrer">
                    <span class="visit-card__chip-icon visit-card__chip-icon--nav" aria-hidden="true"></span>
                    Nawiguj
                  </a>`
                : ""
            }
            ${
              phone
                ? `<a class="visit-card__chip" href="tel:${escapeHtml(phone)}">
                    <span class="visit-card__chip-icon visit-card__chip-icon--call" aria-hidden="true"></span>
                    Zadzwoń
                  </a>`
                : slug
                  ? `<button type="button" class="visit-card__chip" data-action="call-provider" data-slug="${escapeHtml(slug)}">
                      <span class="visit-card__chip-icon visit-card__chip-icon--call" aria-hidden="true"></span>
                      Zadzwoń
                    </button>`
                  : ""
            }
            ${calendarChip}
            ${rebookChip}
          </div>`;
  }

  function renderClientRequestCard(r) {
    const days = normalizeRequestDays(r.days);
    const proposals = Array.isArray(r.proposals) ? r.proposals : [];
    const waiting = r.status !== "proposed" || !proposals.length;
    const provider = getProviderById(r.providerId);
    const slug = provider ? provider.slug : "";
    const address = providerNavAddress(provider);
    const phone = provider && provider.phone ? String(provider.phone).replace(/\s/g, "") : "";
    const firstDay = days[0] || null;
    const dateISO = firstDay ? firstDay.dateISO : "";
    const timeLabel = firstDay
      ? DAY_PART_LABEL[normalizeDayPart(firstDay.part)] || "Do ustalenia"
      : "Do ustalenia";
    const statusKey = waiting ? "pending" : "proposed";
    const statusLabel = waiting ? "Czeka na propozycje" : "Wybierz termin";
    const servicesLabel = (r.serviceNames || []).join(", ");
    const placeLine = (provider && provider.locations && provider.locations[0] && provider.locations[0].label) || "";
    const cancelBtn = `<button type="button" class="btn btn--ghost btn--sm" data-action="cancel-client-request" data-request-id="${escapeHtml(r.id)}">Anuluj prośbę</button>`;
    const extra = waiting
      ? `${days.length ? renderRequestDayBadges(days) : ""}
         <p class="request-card__note">Usługodawca odeśle konkretne godziny do wyboru.</p>`
      : `<p class="request-card__note">Wybierz jeden termin — pozostałe propozycje przepadną.</p>
         <ul class="proposal-list proposal-list--pick">
           ${proposals
             .map(function (c) {
               return `<li>
                 <button type="button" class="proposal-pick" data-action="accept-request-proposal"
                   data-request-id="${escapeHtml(r.id)}" data-proposal-id="${escapeHtml(c.id)}">
                   <span class="proposal-pick__range">${escapeHtml(proposalRangeLabel(c))}</span>
                   ${c.locationLabel ? `<span class="proposal-pick__place">${escapeHtml(c.locationLabel)}</span>` : ""}
                   <span class="proposal-pick__cta">Rezerwuj</span>
                 </button>
               </li>`;
             })
             .join("")}
         </ul>`;
    const actions = waiting
      ? `<div class="visit-card__actions">${cancelBtn}</div>`
      : `<div class="visit-card__actions">
           <button type="button" class="btn btn--ghost btn--sm" data-action="decline-request-proposals" data-request-id="${escapeHtml(r.id)}">Poproś o inne terminy</button>
           ${cancelBtn}
         </div>`;
    return `
      <div class="visit-card visit-card--client visit-card--request" data-request-id="${escapeHtml(r.id)}" data-status="${statusKey}">
        <div class="visit-card__main">
          ${renderVisitCardDateBlock(dateISO)}
          <div class="visit-card__body">
            <div class="visit-card__time-row">
              <span class="visit-card__hours visit-card__hours--soft">${escapeHtml(timeLabel)}</span>
              <span class="status-badge" data-status="${statusKey}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="visit-card__name">${escapeHtml(r.providerName || "")}</div>
            ${servicesLabel ? `<div class="visit-card__svc">${escapeHtml(servicesLabel)}</div>` : ""}
            ${placeLine ? `<div class="visit-card__place">${escapeHtml(placeLine)}</div>` : ""}
          </div>
        </div>
        ${renderClientVisitQuickActions({
          address: address,
          phone: phone,
          slug: slug,
          showRebook: false,
        })}
        <div class="visit-card__extra">${extra}</div>
        ${actions}
      </div>`;
  }

  function renderClientRequestsSection() {
    const list = clientOpenRequests();
    if (!list.length) return "";
    return `
      <section class="client-requests" aria-label="Zapytania o termin">
        <h3 class="booking__label booking__label--caps">Zapytania o termin</h3>
        <div class="request-list">${list.map(renderClientRequestCard).join("")}</div>
      </section>`;
  }

  function renderMyCalendar() {
    const list = clientVisits();
    const visitSet = new Set(
      list.map(function (b) {
        return b.dateISO;
      })
    );
    const selectedDate = ensureMyCalDate();
    const pickerMonth = ensureMyCalMonth();
    const monthOpen = !!window.AppState.myCalMonthOpen;
    const desktop = usesDesktopLayout();
    const monthLabel = monthLabelFromISO(pickerMonth + "-01") || "Miesiąc";
    const statusFilters = Array.isArray(window.AppState.myCalStatusFilters)
      ? window.AppState.myCalStatusFilters
      : [];
    const waitingOnly =
      statusFilters.length === 1 && statusFilters[0] === "pending";
    const upcomingOnly =
      statusFilters.length === 1 && statusFilters[0] === "upcoming";
    const pastOnly = statusFilters.length === 1 && statusFilters[0] === "past";
    const cancelledOnly =
      statusFilters.length === 1 && statusFilters[0] === "cancelled";
    const rejectedOnly =
      statusFilters.length === 1 && statusFilters[0] === "rejected";
    const rangeOnly = upcomingOnly || pastOnly || cancelledOnly || rejectedOnly;
    // Oczekujące bez daty (prośba o termin) — przy filtrze „Czekające na potwierdzenie”.
    const waitingUndated = waitingOnly
      ? (window.AppState.bookings || []).filter(function (b) {
          return (
            b &&
            b.side === "client" &&
            !b.dateISO &&
            (b.status === "pending" || b.status === "proposed")
          );
        })
      : [];
    const filtered = list
      .filter(function (b) {
        if (!rangeOnly && b.dateISO !== selectedDate) return false;
        return visitMatchesMyCalStatusFilters(b, statusFilters);
      })
      .concat(waitingUndated);
    const listTitle = upcomingOnly
      ? "Nadchodzące wizyty"
      : pastOnly
        ? "Odbyte wizyty"
        : cancelledOnly
          ? "Odwołane wizyty"
          : rejectedOnly
            ? "Odrzucone wizyty"
            : waitingOnly
              ? "Wizyty oczekujące"
              : `Wizyty · ${formatDateLong(selectedDate)}`;
    const requestsHtml = waitingOnly ? renderClientRequestsSection() : "";
    // Na „Czekające…” pusta lista wizyt jest zbędna, gdy widać już zapytania o termin.
    const showVisitsSection = filtered.length > 0 || !(waitingOnly && requestsHtml);
    const monthSide = desktop
      ? renderMyCalMonthPanel(selectedDate, visitSet, { force: true, side: true })
      : "";

    return `
      <div class="app-screen app-screen--client app-screen--my-cal${desktop ? " app-screen--my-cal-desktop" : ""}">
        <div class="my-cal-top">
          <header class="screen-head screen-head--prov-cal">
            <div class="prov-cal-head">
              <div class="prov-cal-head__title-row">
                <button type="button" class="screen-head__back" data-action="go-screen" data-screen="search" aria-label="Wróć">
                  <span class="screen-head__back-icon" aria-hidden="true"></span>
                </button>
                <h2 class="screen-head__title">Mój kalendarz</h2>
              </div>
              <div class="prov-cal-head__actions">
                <div class="prov-cal__tools" role="toolbar" aria-label="Narzędzia kalendarza">
                  <button type="button" class="prov-cal__tool prov-cal__tool--month-label${
                    monthOpen || desktop ? " is-on" : ""
                  }"
                    data-action="my-cal-month-toggle"
                    aria-label="${escapeHtml(monthLabel)}" aria-pressed="${monthOpen || desktop ? "true" : "false"}">
                    <span class="prov-cal__month-name">${escapeHtml(monthLabel)}</span>
                    <span class="prov-cal__month-chevron" aria-hidden="true"></span>
                  </button>
                </div>
                <button type="button" class="prov-cal__today-btn" data-action="my-cal-today">Dzisiaj</button>
              </div>
            </div>
          </header>
          <div class="my-cal-top__anchor">
            ${renderMyCalMonthPanel(selectedDate, visitSet)}
          </div>
        </div>
        <div class="my-cal-body app-scroll">
          <div class="my-cal-layout">
            <aside class="my-cal-layout__side" aria-label="Kalendarz miesiąca">
              ${monthSide}
            </aside>
            <div class="my-cal-layout__main">
              ${renderMyCalWeekStrip(selectedDate, visitSet)}
              ${desktop ? "" : renderMyCalStatusFilters()}
              ${renderNotificationsBlock("client", "Powiadomienia")}
              ${desktop ? renderMyCalStatusFilters() : ""}
              ${requestsHtml}
              ${
                showVisitsSection
                  ? `<section class="my-cal-visits" aria-label="${escapeHtml(listTitle)}">
                <h3 class="booking__label booking__label--caps">${escapeHtml(listTitle)}</h3>
                <div class="visit-list">
                  ${
                    filtered.length
                      ? filtered.map(renderClientVisitCard).join("")
                      : `<p class="empty-note">${
                          upcomingOnly
                            ? "Brak nadchodzących wizyt."
                            : pastOnly
                              ? "Brak odbytych wizyt."
                              : cancelledOnly
                                ? "Brak odwołanych wizyt."
                                : rejectedOnly
                                  ? "Brak odrzuconych wizyt."
                                  : waitingOnly
                                    ? "Brak wizyt czekających na potwierdzenie."
                                    : statusFilters.length
                                      ? "Brak wizyt o wybranym statusie w tym dniu."
                                      : "Brak wizyt w tym dniu."
                        }</p>`
                  }
                </div>
              </section>`
                  : ""
              }
            </div>
          </div>
        </div>
        ${bottomNav("myCalendar")}
      </div>`;
  }

  function resolveAvailDates(p, durationMin, slotOpts) {
    const dur = durationMin || 15;
    const rules = ensureProviderBookingRules(p);
    const today = demoTodayISO();
    const maxISO = addDaysISO(today, rules.futureDays);
    return (p.availability || [])
      .filter(function (d) {
        if (d.dateISO < today || d.dateISO > maxISO) return false;
        return computeSlots(p, d.dateISO, dur, slotOpts).length;
      })
      .map((d) => d.dateISO)
      .sort();
  }

  function ensureDraftCalendar(draft, availDates) {
    if (!draft.dateISO && availDates.length) draft.dateISO = availDates[0];
    if (!draft.calMonth) {
      const ref = draft.dateISO || availDates[0] || new Date().toISOString().slice(0, 10);
      draft.calMonth = ref.slice(0, 7);
    }
  }

  function renderServiceVariantCarousel(s, selectedVariantId, opts) {
    opts = opts || {};
    const interactive = !!opts.interactive;
    const variants = serviceVariants(s);
    if (!variants.length) return "";
    const chips = variants
      .map(function (v) {
        const on = v.id === selectedVariantId;
        const label = variantChipLabel(v);
        const aria = (v.label ? v.label + ", " : "") + label;
        if (!interactive) {
          return `<span class="service-variant-chip${on ? " service-variant-chip--on" : ""}" aria-hidden="true">${escapeHtml(label)}</span>`;
        }
        return `
          <button type="button" class="service-variant-chip${on ? " service-variant-chip--on" : ""}"
            data-action="pick-service-variant" data-service-id="${escapeHtml(s.id)}" data-variant-id="${escapeHtml(v.id)}"
            aria-pressed="${on ? "true" : "false"}" aria-label="${escapeHtml(aria)}">
            ${escapeHtml(label)}
          </button>`;
      })
      .join("");
    return `
      <div class="service-variant-carousel" data-role="service-variants" data-service-id="${escapeHtml(s.id)}"${interactive ? ` role="group" aria-label="Warianty: ${escapeHtml(s.name)}"` : " aria-hidden=\"true\""}>
        <div class="service-variant-carousel__track">${chips}</div>
      </div>`;
  }

  function renderBookingServiceRow(p, s, selectedIds, draft, expandedIds) {
    const on = selectedIds.indexOf(s.id) !== -1;
    const expanded = expandedIds.indexOf(s.id) !== -1;
    const detail = serviceOfferText(s);
    const summary = serviceListSummary(s);
    const photos = servicePhotos(s);
    const hasDesc = !!detail;
    const thumb = photos[0] || "";
    const variants = serviceVariants(s);
    const mode = serviceBookingMode(s, p);
    const variantId = on ? selectedVariantIdForService(draft, s) : defaultServiceVariantId(s);
    const resolved = resolveServiceVariant(s, variantId);
    const selectLabel = (on ? "Odznacz" : "Wybierz") + " " + s.name;
    const expandLabel = (expanded ? "Zwiń" : "Rozwiń") + " szczegóły: " + s.name;
    const thumbHtml = thumb
      ? `<button type="button" class="service-row__thumb service-row__thumb--btn" data-action="preview-service-photos" data-service-id="${escapeHtml(s.id)}" aria-label="Zdjęcia: ${escapeHtml(s.name)}" title="Zdjęcia">
          <img class="service-row__thumb-img" src="${escapeHtml(thumb)}" alt="" loading="lazy" />
        </button>`
      : `<span class="service-row__thumb service-row__thumb--empty" aria-hidden="true"></span>`;

    return `
      <article class="service-row service-row--booking-b${on ? " service-row--selected" : ""}${expanded ? " service-row--expanded" : ""}${variants.length ? " service-row--has-variants" : ""}" data-service-id="${escapeHtml(s.id)}" data-booking-mode="${escapeHtml(mode)}">
        <div class="service-row__top">
          ${thumbHtml}
          <button type="button" class="service-row__static-main service-row__static-main--btn"${hasDesc ? ` data-action="toggle-service-desc" data-service-id="${escapeHtml(s.id)}" aria-expanded="${expanded ? "true" : "false"}"` : " disabled aria-disabled=\"true\""} aria-label="${escapeHtml(hasDesc ? expandLabel : s.name)}" title="${escapeHtml(hasDesc ? expandLabel : s.name)}">
            <span class="service-row__body">
              <span class="service-row__name">${escapeHtml(s.name)}</span>
              ${
                detail
                  ? `<span class="service-row__sub-clip" data-role="service-desc-clip">
                      <span class="service-row__sub">${escapeHtml(detail)}</span>
                    </span>`
                  : summary
                    ? `<span class="service-row__sub">${escapeHtml(summary)}</span>`
                    : ""
              }
            </span>
            <span class="service-row__meta">
              <span class="service-row__dur">${escapeHtml(formatDuration(resolved.durationMin))}</span>
              <span class="service-row__price">${escapeHtml(formatPrice(resolved.price))}</span>
            </span>
          </button>
          <button type="button" class="service-row__check service-row__check--radio${on ? " service-row__check--on" : ""}" data-action="toggle-service-check" data-service-id="${escapeHtml(s.id)}" aria-pressed="${on ? "true" : "false"}" aria-label="${escapeHtml(selectLabel)}" title="${escapeHtml(selectLabel)}">
            <span class="service-row__check-visual" aria-hidden="true"></span>
          </button>
        </div>
        ${renderServiceVariantCarousel(s, on ? resolved.id : null, { interactive: true })}
      </article>`;
  }

  /** Lista ofert — grupy: auto / kolejka / na prośbę. */
  function renderBookingServiceRows(p, selectedIds) {
    const draft = window.AppState.draft;
    const expandedIds = (draft && draft.expandedServiceIds) || [];
    ensureDraftServiceVariants(draft);
    ensureServicesBookingMode(p);

    // Klient: kolejka jak wybór terminu; osobno prośby (z dniem i bez).
    const openBook = [];
    const requests = [];
    (p.services || []).forEach(function (s) {
      if (isOfferRequestMode(serviceBookingMode(s, p))) requests.push(s);
      else openBook.push(s);
    });

    function rowsHtml(list) {
      return list
        .map(function (s) {
          return renderBookingServiceRow(p, s, selectedIds, draft, expandedIds);
        })
        .join("");
    }

    // Jedna płaska lista — bez osobnych flex-grup, które rozpychają wolne miejsce.
    let html = "";
    if (openBook.length) {
      html += `<div class="service-list__group-head">
          <h4 class="service-list__group-title">Wybór terminu</h4>
        </div>${rowsHtml(openBook)}`;
    }
    if (requests.length) {
      html += `<div class="service-list__sep${openBook.length ? " service-list__sep--divider" : ""}">
          <h4 class="service-list__group-title">Na prośbę</h4>
        </div>${rowsHtml(requests)}`;
    }
    return html || `<p class="empty-note">Brak usług w ofercie.</p>`;
  }

  function ensureServicePhotoPreview() {
    let el = document.getElementById("service-photo-preview");
    if (!el) {
      el = document.createElement("div");
      el.id = "service-photo-preview";
      el.className = "service-photo-preview";
      el.hidden = true;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Zdjęcia usługi");
      document.body.appendChild(el);
    }
    return el;
  }

  function closeServicePhotoPreview() {
    const el = document.getElementById("service-photo-preview");
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    document.body.classList.remove("service-photo-preview-open");
  }

  function renderServicePhotoPreview(serviceName, photos, index) {
    const total = photos.length;
    const safeIndex = total ? ((index % total) + total) % total : 0;
    const url = total ? photos[safeIndex] : "";
    const canNav = total > 1;
    return `
      <button type="button" class="service-photo-preview__backdrop" data-action="close-service-photo-preview" aria-label="Zamknij"></button>
      <div class="service-photo-preview__dialog">
        <button type="button" class="service-photo-preview__close" data-action="close-service-photo-preview" aria-label="Zamknij">
          <span class="service-photo-preview__close-icon" aria-hidden="true"></span>
        </button>
        <p class="service-photo-preview__title">${escapeHtml(serviceName || "Zdjęcia")}</p>
        <div class="service-photo-preview__stage" data-role="service-photo-stage" data-index="${safeIndex}">
          ${
            canNav
              ? `<button type="button" class="service-photo-preview__nav service-photo-preview__nav--prev" data-action="service-photo-prev" aria-label="Poprzednie zdjęcie"></button>`
              : ""
          }
          ${
            url
              ? `<img class="service-photo-preview__img" src="${escapeHtml(url)}" alt="${escapeHtml((serviceName || "Usługa") + " — zdjęcie " + (safeIndex + 1))}" />`
              : `<span class="service-photo-preview__empty">Brak zdjęć</span>`
          }
          ${
            canNav
              ? `<button type="button" class="service-photo-preview__nav service-photo-preview__nav--next" data-action="service-photo-next" aria-label="Następne zdjęcie"></button>`
              : ""
          }
        </div>
        ${
          total > 1
            ? `<p class="service-photo-preview__counter" data-role="service-photo-counter">${safeIndex + 1} / ${total}</p>`
            : ""
        }
      </div>`;
  }

  function openServicePhotoPreview(serviceId, startIndex) {
    const draft = window.AppState.draft;
    const p = draft && draft.slug ? getProviderBySlug(draft.slug) : null;
    if (!p) return;
    const service = (p.services || []).find(function (s) {
      return s.id === serviceId;
    });
    if (!service) return;
    const photos = servicePhotos(service);
    if (!photos.length) {
      showToast("Brak zdjęć tej usługi.");
      return;
    }
    closeAvatarPreview();
    const el = ensureServicePhotoPreview();
    el.dataset.serviceId = serviceId;
    el.dataset.photos = JSON.stringify(photos);
    el.dataset.serviceName = service.name || "";
    const index = typeof startIndex === "number" ? startIndex : 0;
    el.setAttribute("aria-label", "Zdjęcia: " + (service.name || "usługa"));
    el.innerHTML = renderServicePhotoPreview(service.name, photos, index);
    el.hidden = false;
    document.body.classList.add("service-photo-preview-open");
  }

  function shiftServicePhotoPreview(delta) {
    const el = document.getElementById("service-photo-preview");
    if (!el || el.hidden) return;
    let photos = [];
    try {
      photos = JSON.parse(el.dataset.photos || "[]");
    } catch (err) {
      photos = [];
    }
    if (photos.length < 2) return;
    const stage = el.querySelector('[data-role="service-photo-stage"]');
    const current = stage ? Number(stage.getAttribute("data-index")) || 0 : 0;
    const next = current + delta;
    el.innerHTML = renderServicePhotoPreview(el.dataset.serviceName || "", photos, next);
  }

  function renderCalendarGrid(p, activeDate, calMonth, availDates, totals, opts) {
    opts = opts || {};
    const multi = !!opts.multiSelect;
    const selectedSet = multi ? new Set(opts.selectedDates || []) : null;
    const dayAction = opts.action || "pick-date";
    const availSet = new Set(availDates);
    const parts = String(calMonth || "").split("-");
    const year = Number(parts[0]) || new Date().getFullYear();
    const month = Number(parts[1]) || new Date().getMonth() + 1;
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;
    const todayISO = demoTodayISO();

    const totalCells = 7 * 6;
    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${pad(month)}-${pad(day)}`;
      const available = availSet.has(dateISO);
      const selected = multi ? selectedSet.has(dateISO) : dateISO === activeDate;
      const isToday = dateISO === todayISO;
      const red = isRedCalendarDay(dateISO);
      cells += `
        <button type="button"
          class="cal__day${selected ? " cal__day--selected" : ""}${isToday ? " cal__day--today" : ""}${red ? " cal__day--holiday" : ""}${available ? " cal__day--available" : " cal__day--disabled"}"
          data-action="${available ? escapeHtml(dayAction) : ""}" data-date="${escapeHtml(dateISO)}"${
            available && multi ? ` aria-pressed="${selected ? "true" : "false"}"` : ""
          } ${available ? "" : "disabled"}>
          <span class="cal__day-num">${day}</span>
        </button>`;
    }
    const filled = startPad + daysInMonth;
    for (let i = filled; i < totalCells; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }

    return `
      <div class="cal cal--booking${multi ? " cal--booking-multi" : ""}">
        <div class="cal__nav">
          <button type="button" class="cal__nav-btn" data-action="cal-prev" aria-label="Poprzedni miesiąc">‹</button>
          <span class="cal__title">${escapeHtml(MONTHS[month - 1])} ${year}</span>
          <button type="button" class="cal__nav-btn" data-action="cal-next" aria-label="Następny miesiąc">›</button>
        </div>
        <div class="cal__weekdays">${CAL_WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="cal__grid">${cells}</div>
      </div>`;
  }

  function renderTimeSlotPlace(provider, slot) {
    const place = escapeHtml((slot && slot.locationLabel) || "—");
    const tone = slot && slot.locationId ? locationToneClass(provider, slot.locationId) : "";
    return `<span class="time-row__place${tone ? " " + tone : ""}"><span class="time-row__loc-dot" aria-hidden="true"></span>${place}</span>`;
  }

  function renderTimeSlots(slots, draft, opts) {
    opts = opts || {};
    const mobile = !!opts.mobile;
    const provider = draft && draft.slug ? getProviderBySlug(draft.slug) : null;
    return slots
      .map(function (s) {
        const range = `${escapeHtml(s.from)}→${escapeHtml(s.to)}`;
        const placeHtml = renderTimeSlotPlace(provider, s);
        if (mobile) {
          const selected = draft && draft.slotId === s.id;
          return `
        <button type="button" class="time-row time-row--chip${selected ? " time-row--selected" : ""}" data-action="pick-slot" data-slot="${escapeHtml(s.id)}"
          aria-label="Wybierz ${escapeHtml(s.from)}–${escapeHtml(s.to)}" aria-pressed="${selected ? "true" : "false"}">
          <span class="time-row__info">
            <span class="time-row__range">${range}</span>
            ${placeHtml}
          </span>
        </button>`;
        }
        return `
        <div class="time-row">
          <div class="time-row__info">
            <span class="time-row__range">${range}</span>
            ${placeHtml}
          </div>
          <button type="button" class="btn btn--primary btn--sm time-row__btn" data-action="book-slot" data-slot="${escapeHtml(s.id)}">Rezeruj</button>
        </div>`;
      })
      .join("");
  }

  function resolveVisitNavAddress(b, provider) {
    if (!provider) return "";
    if (b && b.locationId && Array.isArray(provider.locations)) {
      const loc = provider.locations.find(function (l) {
        return l && l.id === b.locationId;
      });
      if (loc && loc.address) return String(loc.address);
    }
    if (b && b.locationLabel && Array.isArray(provider.locations)) {
      const loc = provider.locations.find(function (l) {
        return l && l.label === b.locationLabel && l.address;
      });
      if (loc && loc.address) return String(loc.address);
    }
    return provider.address ? String(provider.address) : "";
  }

  function resolveClientVisitDisplayDate(b) {
    if (b && b.dateISO) return String(b.dateISO).slice(0, 10);
    if (b && b.requestId) {
      const req = (window.AppState.requests || []).find(function (r) {
        return r && r.id === b.requestId;
      });
      const days = req ? normalizeRequestDays(req.days) : [];
      if (days[0] && days[0].dateISO) return String(days[0].dateISO).slice(0, 10);
    }
    return "";
  }

  function renderClientVisitCard(b) {
    const canReschedule = b.status === "rejected" || b.status === "cancelled";
    const canAccept = b.status === "proposed";
    const provider = getProviderById(b.providerId);
    const slug = provider ? provider.slug : "";
    const address = resolveVisitNavAddress(b, provider);
    const phone = provider && provider.phone ? String(provider.phone).replace(/\s/g, "") : "";
    const placeLine = b.locationLabel || address || "";
    const displayDate = resolveClientVisitDisplayDate(b);
    const timeRange = b.from && b.to ? `${b.from}–${b.to}` : b.from || "";
    const timeLabel = timeRange || (b.status === "pending" || b.status === "proposed" ? "Do ustalenia" : "");
    const servicesLabel = (b.serviceNames || []).join(", ");
    const statusLabel = STATUS_LABEL[b.status] || b.status;

    return `
      <div class="visit-card visit-card--client" data-booking-id="${escapeHtml(b.id)}" data-status="${escapeHtml(b.status)}">
        <div class="visit-card__main">
          ${renderVisitCardDateBlock(displayDate)}
          <div class="visit-card__body">
            <div class="visit-card__time-row">
              ${
                timeRange
                  ? `<time class="visit-card__hours" datetime="${escapeHtml(
                      (b.dateISO || "") + (b.from ? "T" + b.from : "")
                    )}">${escapeHtml(timeRange)}</time>`
                  : timeLabel
                    ? `<span class="visit-card__hours visit-card__hours--soft">${escapeHtml(timeLabel)}</span>`
                    : `<span class="visit-card__hours visit-card__hours--soft">—</span>`
              }
              <span class="status-badge" data-status="${escapeHtml(b.status)}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="visit-card__name">${escapeHtml(b.providerName)}</div>
            ${servicesLabel ? `<div class="visit-card__svc">${escapeHtml(servicesLabel)}</div>` : ""}
            ${placeLine ? `<div class="visit-card__place">${escapeHtml(placeLine)}</div>` : ""}
          </div>
        </div>
        ${renderClientVisitQuickActions({
          address: address,
          phone: phone,
          slug: slug,
          bookingId: b.id,
          canAddToCalendar: !!(b.dateISO && b.from),
          showRebook: !!slug,
        })}
        ${
          canAccept
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--primary btn--sm" data-action="accept-proposal" data-booking-id="${escapeHtml(b.id)}">Akceptuj termin</button>
                 <button type="button" class="btn btn--ghost btn--sm" data-action="reject-proposal" data-booking-id="${escapeHtml(b.id)}">Odrzuć</button>
               </div>`
            : ""
        }
        ${
          b.status === "confirmed"
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--ghost btn--sm" data-action="cancel-visit" data-booking-id="${escapeHtml(b.id)}">Odwołaj</button>
               </div>`
            : ""
        }
        ${
          canReschedule
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--ghost btn--sm" data-action="open-profile" data-slug="${escapeHtml(slug)}">Wybierz inny termin</button>
               </div>`
            : ""
        }
      </div>`;
  }

  function renderProfileContact(p) {
    ensureProviderContact(p);
    ensureProviderBookingRules(p);
    const phone = String(p.phone || "").trim();
    const phoneHref = phone.replace(/\s/g, "");
    const email = providerPublicEmail(p);
    const socials = providerSocialLinks(p);
    if (!phone && !email && !socials.length) return "";
    const links = [];
    if (phoneHref) {
      links.push(
        `<a class="profile__contact-link" href="tel:${escapeHtml(phoneHref)}">
          <span class="profile__contact-label">Telefon</span>
          <span class="profile__contact-val">${escapeHtml(phone)}</span>
        </a>`
      );
    }
    if (email) {
      links.push(
        `<a class="profile__contact-link" href="mailto:${escapeHtml(email)}">
          <span class="profile__contact-label">E-mail</span>
          <span class="profile__contact-val">${escapeHtml(email)}</span>
        </a>`
      );
    }
    socials.forEach(function (s) {
      links.push(
        `<a class="profile__contact-link" href="${escapeHtml(s.href)}" target="_blank" rel="noopener noreferrer">
          <span class="profile__contact-label">${escapeHtml(s.label)}</span>
          <span class="profile__contact-val">Otwórz</span>
        </a>`
      );
    });
    return `<div class="profile__contact" aria-label="Kontakt">${links.join("")}</div>`;
  }

  function renderProfile(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return renderSearch();

    const fav = window.AppState.favorites.indexOf(p.slug) !== -1;
    const totals = draftTotals(p);
    const selectedIds = (window.AppState.draft && window.AppState.draft.serviceIds) || [];
    const services = renderBookingServiceRows(p, selectedIds);

    const isRequestStyle = isOfferRequestMode(draftBookingMode(p));
    // W trybie prośby przechodzimy do ekranu rezerwacji (z wyborem dni albo od razu do wysyłki).
    const ctaLabel = isRequestStyle ? "Poproś o termin" : "Rezerwuj termin";
    const ctaAction = "start-booking";

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <div class="topbar">
            <span class="topbar__title">Profil</span>
            <button type="button" class="fav-btn${fav ? " fav-btn--on" : ""}" data-action="toggle-fav" data-slug="${escapeHtml(p.slug)}"
              aria-pressed="${fav ? "true" : "false"}" aria-label="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}" title="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}"><span class="fav-btn__icon" aria-hidden="true"></span></button>
          </div>

          <div class="profile">
            <div class="profile__header">
              ${renderAvatarTrigger(p, "profile__avatar")}
              <div class="profile__info">
                <h2 class="profile__name">${escapeHtml(p.name)}</h2>
                <p class="profile__cat">${escapeHtml(providerCategoryLine(p))}</p>
                <p class="profile__addr">${escapeHtml(p.address || "Usługa online")}${p.address ? " · " + p.distanceKm.toFixed(1) + " km" : ""}</p>
              </div>
            </div>
            ${p.about ? `<p class="profile__about">${escapeHtml(p.about)}</p>` : ""}
            ${renderProfileContact(p)}
            ${
              providerCancelPolicyText(p)
                ? `<p class="profile__policy"><span class="profile__policy-label">Zasady anulowania</span>${escapeHtml(providerCancelPolicyText(p))}</p>`
                : ""
            }

            <h3 class="profile__section">Oferta ${p.multiSelect ? '<span class="profile__hint">(możesz wybrać kilka z tej samej grupy)</span>' : ""}</h3>
            <div class="service-list">${services}</div>
          </div>
        </div>

        ${
          totals.count
            ? `<div class="selection-summary">
                 <div class="selection-summary__info">
                   <span class="selection-summary__duration">${escapeHtml(formatDuration(totals.duration))}</span>
                   <span class="selection-summary__price">${totals.hasNullPrice ? "wycena indyw." : escapeHtml(totals.price + " zł")}</span>
                 </div>
                 <button type="button" class="btn btn--primary selection-summary__cta" data-action="${ctaAction}" data-slug="${escapeHtml(p.slug)}">${ctaLabel}</button>
               </div>`
            : ""
        }
        ${bottomNav("search", { backOnSearch: true })}
      </div>`;
  }

  function renderBooking(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return renderSearch();

    const ctx = buildBookingContext(p);
    if (!ctx) return renderSearch();
    const mode = draftBookingMode(p);
    // Nagłówek poza .booking-mobile — na desktopie ten blok jest ukrywany,
    // a bez karty usługodawcy ekran rezerwacji wygląda na „pusty”.
    const providerHead = `
        <div class="booking__provider-card${ctx.draft.providerInfoOpen ? " booking__provider-card--info-open" : ""}">
          ${renderProviderCard(p, false, { staticMain: true, bookingHeader: true, showBack: true })}
          ${ctx.draft.providerInfoOpen ? renderProviderInfoPopover(p) : ""}
        </div>`;
    const mobileSchedule =
      mode === "approval"
        ? renderRequestSchedule(ctx)
        : mode === "request"
          ? renderOpenRequestSchedule()
          : `<div class="booking__schedule" data-role="booking-mobile-schedule" data-schedule-kind="slots">
              <div class="booking__label-row">
                <h3 class="booking__label booking__label--caps">Wybierz datę</h3>
                <span class="booking__month" data-role="booking-mobile-month">${escapeHtml(monthLabelFromISO(ctx.activeDate || ctx.availDates[0]))}</span>
              </div>
              <div class="date-strip date-strip--booking" data-role="booking-date-strip">${renderDateStripHtml(ctx.availDates, ctx.activeDate)}</div>

              <h3 class="booking__label booking__label--caps" data-role="booking-mobile-time-label"${ctx.activeDate ? "" : " hidden"}>Wolne terminy</h3>
              <div class="time-list time-list--horizontal" data-role="booking-mobile-times"${ctx.activeDate ? "" : " hidden"}>${
                ctx.activeDate
                  ? ctx.timeListMobile || `<p class="empty-note">${escapeHtml(bookingTimesEmptyNote(p))}</p>`
                  : ""
              }</div>
            </div>`;

    return `
      <div class="app-screen app-screen--client app-screen--booking" data-booking-mode="${isOfferRequestMode(mode) ? mode : "auto"}">
        ${providerHead}
        <div class="booking-mobile">
          <div class="booking booking--mobile-split">
            <div class="booking__main">
              ${renderServicesPanelHead(p, ctx.draft, { mobile: true })}
              <div class="booking__services-list service-list" data-role="booking-mobile-services">${ctx.services}</div>
            </div>

            ${mobileSchedule}
          </div>
        </div>

        ${renderBookingLayoutBlock(p, ctx)}

        ${bookingBottomNav(ctx.draft)}
      </div>`;
  }

  function renderClient(screen) {
    switch (screen) {
      case "favorites":
        return renderFavorites();
      case "myCalendar":
        return renderMyCalendar();
      case "account":
        return renderAccount();
      case "profile":
        return renderProfile(window.AppState.params.client && window.AppState.params.client.slug);
      case "booking":
        return renderBooking(window.AppState.draft && window.AppState.draft.slug);
      case "search":
      default:
        return renderSearch();
    }
  }

  // ─────────────────────────────────────────────────────────
  // USŁUGODAWCA — ekrany
  // ─────────────────────────────────────────────────────────
  function providerBottomNav(active) {
    const menuOpen = !!window.AppState.appMenuOpen;
    const tabs = [
      { tab: "dashboard", label: "Pulpit", icon: "home" },
      { tab: "calendar", label: "Kalendarz", icon: "calendar" },
      { tab: "services", label: "Usługi", icon: "services" },
      { tab: "availability", label: "Dostępność", icon: "slots" },
    ];
    return `
      <nav class="bottom-nav bottom-nav--provider bottom-nav--with-back" aria-label="Menu usługodawcy">
        <span class="bottom-nav__indicator" aria-hidden="true"></span>
        ${tabs
          .map(function (t) {
            const isActive = !menuOpen && active === t.tab;
            return `
          <button type="button" class="bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}"
            data-action="provider-tab" data-tab="${t.tab}" data-screen="${t.tab}" aria-label="${t.label}" ${isActive ? 'aria-current="page"' : ""}>
            <span class="bottom-nav__icon bottom-nav__icon--${t.icon}" aria-hidden="true"></span>
          </button>`;
          })
          .join("")}
        <button type="button" class="bottom-nav__item${menuOpen ? " bottom-nav__item--active" : ""}"
          data-action="toggle-app-menu" aria-label="Menu" aria-expanded="${menuOpen ? "true" : "false"}" aria-controls="app-menu-panel">
          <span class="bottom-nav__icon bottom-nav__icon--profile" aria-hidden="true"></span>
        </button>
      </nav>`;
  }

  function myProvider() {
    return getProviderById(MY_PROVIDER_ID);
  }

  function providerOpenRequests() {
    return (window.AppState.requests || [])
      .filter(function (r) {
        return r && r.providerId === MY_PROVIDER_ID && (r.status === "pending" || r.status === "proposed");
      })
      .slice()
      .sort(function (a, b) {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        const aDays = normalizeRequestDays(a.days);
        const bDays = normalizeRequestDays(b.days);
        const aDay = (aDays[0] && aDays[0].dateISO) || "";
        const bDay = (bDays[0] && bDays[0].dateISO) || "";
        return aDay.localeCompare(bDay) || String(a.clientName || "").localeCompare(String(b.clientName || ""));
      });
  }

  /** Skrót pory dnia na chipie dnia — pełne etykiety rozpychają wąski pulpit. */
  const REQUEST_PART_SHORT = { am: "rano", pm: "po poł.", any: "cały dzień" };

  function renderProviderRequestDayChips(days) {
    return `<ul class="request-card__days visit-card__req-days" aria-label="Dni wskazane przez klienta">
        ${days
          .map(function (d) {
            const part = normalizeDayPart(d.part);
            return `<li class="request-day-badge">
              <span class="request-day-badge__day">${escapeHtml(formatDayWithDow(d.dateISO))}</span>
              <span class="request-day-badge__part">${escapeHtml(REQUEST_PART_SHORT[part])}</span>
            </li>`;
          })
          .join("")}
      </ul>`;
  }

  function renderProviderRequestCard(r) {
    const services = (r.serviceNames || []).filter(Boolean);
    const serviceLabel = services.length ? services.join(" + ") : "Usługa";
    const isRejected = r.status === "rejected";
    const isProposed = r.status === "proposed";
    const days = normalizeRequestDays(r.days);
    const p = myProvider();
    const durationMin = p ? requestServicesDuration(p, r.serviceIds || []) : 0;
    const sentCount = isProposed ? (Array.isArray(r.proposals) ? r.proposals.length : 0) : 0;
    const statusLabel = isRejected
      ? "Odrzucona"
      : isProposed
        ? sentCount
          ? `Wysłano ${sentCount} ${proposalCountLabel(sentCount)}`
          : "Wysłano propozycje"
        : "Nowa prośba";
    const proposeLabel = isProposed ? "Zmień propozycje" : "Zaproponuj termin";
    return `
      <div class="visit-card visit-card--provider visit-card--request" data-request-id="${escapeHtml(r.id)}" data-status="${escapeHtml(
        isRejected ? "rejected" : isProposed ? "proposed" : "pending"
      )}" aria-label="${escapeHtml((r.clientName || "Klient") + ", " + serviceLabel)}">
        <div class="visit-card__req-head">
          <span class="visit-card__name">${escapeHtml(r.clientName || "Klient")}</span>
          <span class="status-badge" data-status="${escapeHtml(
            isRejected ? "rejected" : isProposed ? "proposed" : "pending"
          )}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="visit-card__req-svc">
          <span class="visit-card__req-svc-name">${escapeHtml(serviceLabel)}</span>
          ${
            durationMin
              ? `<span class="visit-card__duration" aria-label="Czas trwania: ${escapeHtml(formatDuration(durationMin))}">
                  <span class="visit-card__clock" aria-hidden="true"></span>
                  ${escapeHtml(formatDuration(durationMin))}
                </span>`
              : ""
          }
        </div>
        ${
          days.length
            ? renderProviderRequestDayChips(days)
            : `<p class="visit-card__req-note">${
                isRejected
                  ? "Prośba odrzucona."
                  : "Bez wskazanych dni — możesz zaproponować dowolny termin."
              }</p>`
        }
        ${
          isRejected
            ? ""
            : `<div class="visit-card__actions visit-card__actions--request">
          <button type="button" class="btn btn--primary btn--sm" data-action="propose-open" data-request-id="${escapeHtml(
            r.id
          )}">${escapeHtml(proposeLabel)}</button>
          <button type="button" class="btn btn--quiet btn--sm" data-action="reject-request" data-request-id="${escapeHtml(
            r.id
          )}">Odrzuć</button>
        </div>`
        }
      </div>`;
  }

  /** Ostatnio odrzucone: wizyty + prośby (bez duplikatów), od najnowszych. */
  function providerRecentRejected() {
    const bookings = (window.AppState.bookings || []).filter(function (b) {
      return b && b.providerId === MY_PROVIDER_ID && b.status === "rejected";
    });
    const linkedReq = Object.create(null);
    bookings.forEach(function (b) {
      if (b.requestId) linkedReq[b.requestId] = true;
    });
    const requests = (window.AppState.requests || []).filter(function (r) {
      return r && r.providerId === MY_PROVIDER_ID && r.status === "rejected" && !linkedReq[r.id];
    });
    const items = bookings
      .map(function (b) {
        return {
          kind: "booking",
          sortKey: String(b.dateISO || "") + String(b.from || "") + "\t" + String(b.id || ""),
          booking: b,
        };
      })
      .concat(
        requests.map(function (r) {
          const days = normalizeRequestDays(r.days);
          const day0 = (days[0] && days[0].dateISO) || "";
          return {
            kind: "request",
            sortKey: day0 + "\uffff" + String(r.id || ""),
            request: r,
          };
        })
      );
    items.sort(function (a, b) {
      return b.sortKey.localeCompare(a.sortKey);
    });
    return items;
  }

  function dashSearchQuery() {
    return String(window.AppState.dashSearchQ || "").trim().toLowerCase();
  }

  function dashTextMatches(hay, q) {
    if (!q) return true;
    return String(hay || "")
      .toLowerCase()
      .indexOf(q) !== -1;
  }

  function dashBookingMatches(b, q) {
    if (!q || !b) return true;
    if (dashTextMatches(b.clientName, q) || dashTextMatches(b.clientPhone, q) || dashTextMatches(b.clientEmail, q)) {
      return true;
    }
    const names = b.serviceNames || [];
    for (let i = 0; i < names.length; i++) {
      if (dashTextMatches(names[i], q)) return true;
    }
    return false;
  }

  function dashRequestMatches(r, q) {
    if (!q || !r) return true;
    if (dashTextMatches(r.clientName, q) || dashTextMatches(r.clientPhone, q) || dashTextMatches(r.clientEmail, q)) {
      return true;
    }
    const names = r.serviceNames || [];
    for (let i = 0; i < names.length; i++) {
      if (dashTextMatches(names[i], q)) return true;
    }
    return false;
  }

  function renderDashClientHitCard(c) {
    const sub = [c.phone, c.email].filter(Boolean).join(" · ");
    return `<div class="visit-card visit-card--provider visit-card--client-hit" data-client-id="${escapeHtml(
      c.id || ""
    )}" aria-label="${escapeHtml(c.name || "Klient")}">
      <div class="visit-card__name">${escapeHtml(c.name || "Klient")}</div>
      ${sub ? `<p class="visit-card__req-note">${escapeHtml(sub)}</p>` : ""}
    </div>`;
  }

  /** Treść pulpitu (statystyki, powiadomienia, wizyty) — mobilnie pełny ekran, desktopowo lewy panel. */
  function renderProviderDashBodyHtml(opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    const searchOpen = !!window.AppState.dashSearchOpen;
    const searchQ = dashSearchQuery();
    const upcomingAll = (window.AppState.bookings || [])
      .filter((b) => b.providerId === MY_PROVIDER_ID && (b.status === "confirmed" || b.status === "proposed"))
      .sort((a, b) => (a.dateISO + a.from).localeCompare(b.dateISO + b.from));
    const upcoming = searchQ
      ? upcomingAll.filter(function (b) {
          return dashBookingMatches(b, searchQ);
        })
      : upcomingAll;

    const openRequestsAll = providerOpenRequests();
    const openRequests = searchQ
      ? openRequestsAll.filter(function (r) {
          return dashRequestMatches(r, searchQ);
        })
      : openRequestsAll;
    const pendingCount = openRequestsAll.filter(function (r) {
      return r.status === "pending";
    }).length;
    const rejectedItemsAll = providerRecentRejected();
    const rejectedItems = searchQ
      ? rejectedItemsAll.filter(function (item) {
          return item.kind === "request"
            ? dashRequestMatches(item.request, searchQ)
            : dashBookingMatches(item.booking, searchQ);
        })
      : rejectedItemsAll;
    const listMode =
      window.AppState.dashListMode === "requests" || window.AppState.dashListMode === "rejected"
        ? window.AppState.dashListMode
        : "visits";
    const showRequests = listMode === "requests";
    const showRejected = listMode === "rejected";
    const showFree = !!window.AppState.dashShowFreeSlots && !searchQ;
    const sectionTitle = showRejected
      ? "Ostatnio odrzucone"
      : showRequests
        ? "Prośby o termin"
        : "Nadchodzące wizyty";
    const listAria = showRejected
      ? "Lista ostatnio odrzuconych"
      : showRequests
        ? "Lista próśb o termin"
        : "Lista nadchodzących wizyt";
    let listBody;
    if (showRejected) {
      listBody = rejectedItems.length
        ? rejectedItems
            .map(function (item) {
              return item.kind === "request"
                ? renderProviderRequestCard(item.request)
                : renderProviderVisitCard(item.booking);
            })
            .join("")
        : `<p class="empty-note">${
            searchQ ? "Brak wyników dla tego wyszukiwania." : "Brak odrzuconych pozycji."
          }</p>`;
    } else if (showRequests) {
      listBody = openRequests.length
        ? openRequests.map(renderProviderRequestCard).join("")
        : `<p class="empty-note">${
            searchQ ? "Brak wyników dla tego wyszukiwania." : "Brak próśb o termin."
          }</p>`;
    } else {
      listBody = upcoming.length
        ? renderProviderVisitTimeline(upcoming, { showFree: showFree })
        : `<p class="empty-note">${
            searchQ
              ? "Brak wyników dla tego wyszukiwania."
              : "Brak nadchodzących wizyt. Zarezerwuj coś jako klient, aby zobaczyć synchronizację."
          }</p>`;
    }

    let clientsHitsHtml = "";
    if (searchOpen && searchQ) {
      const clients = collectProviderClients(MY_PROVIDER_ID).filter(function (c) {
        return (
          dashTextMatches(c.name, searchQ) ||
          dashTextMatches(c.phone, searchQ) ||
          dashTextMatches(c.email, searchQ)
        );
      });
      if (clients.length) {
        clientsHitsHtml = `<div class="prov-section-row">
            <h3 class="prov-section">Klienci</h3>
          </div>
          <div class="visit-list visit-list--dash-clients" role="region" aria-label="Dopasowani klienci">
            ${clients.map(renderDashClientHitCard).join("")}
          </div>`;
      }
    }

    return `
        <div class="app-scroll app-scroll--dash${compact ? " app-scroll--dash-side" : ""}">
          <header class="screen-head screen-head--dash">
            <button type="button" class="screen-head__back" data-action="provider-tab" data-tab="calendar" aria-label="Wróć">
              <span class="screen-head__back-icon" aria-hidden="true"></span>
            </button>
            <h2 class="screen-head__title">Pulpit</h2>
            <button type="button" class="screen-head__search${searchOpen ? " is-on" : ""}" data-action="toggle-dash-search"
              aria-label="Szukaj klienta lub usługi" aria-pressed="${searchOpen ? "true" : "false"}" title="Szukaj">
              <span class="screen-head__search-icon" aria-hidden="true"></span>
            </button>
          </header>
          ${
            searchOpen
              ? `<div class="dash-search">
            <span class="dash-search__icon" aria-hidden="true"></span>
            <input type="search" class="dash-search__input" data-role="dash-search-input"
              value="${escapeHtml(window.AppState.dashSearchQ || "")}"
              placeholder="Klient lub usługa" autocomplete="off" spellcheck="false" enterkeyhint="search" />
            ${
              window.AppState.dashSearchQ
                ? `<button type="button" class="dash-search__clear" data-action="clear-dash-search" aria-label="Wyczyść">×</button>`
                : ""
            }
          </div>`
              : ""
          }
          <div class="stat-row" role="region" aria-label="Statystyki" data-h-scroll>
            <button type="button" class="stat-card stat-card--link${
              listMode === "visits" ? " is-active" : ""
            }" data-action="open-dash-visits">
              <span class="stat-card__num">${upcomingAll.length}</span><span class="stat-card__lbl">Nadchodzące wizyty</span>
            </button>
            <button type="button" class="stat-card stat-card--link${pendingCount > 0 ? " stat-card--alert" : ""}${
              listMode === "requests" ? " is-active" : ""
            }" data-action="open-prov-cal-requests">
              <span class="stat-card__num">${pendingCount}</span><span class="stat-card__lbl">Prośby o termin</span>
            </button>
            <button type="button" class="stat-card stat-card--link${
              listMode === "rejected" ? " is-active" : ""
            }" data-action="open-dash-rejected">
              <span class="stat-card__num">${rejectedItemsAll.length}</span><span class="stat-card__lbl">Odrzucone</span>
            </button>
          </div>
          ${searchOpen ? "" : renderNotificationsBlock("provider", "Powiadomienia")}
          ${clientsHitsHtml}
          <div class="prov-section-row">
            <h3 class="prov-section">${escapeHtml(sectionTitle)}</h3>
            ${
              showRequests || showRejected || searchQ
                ? ""
                : `<label class="prov-free-toggle">
              <span class="prov-free-toggle__text">Wolne terminy</span>
              <input type="checkbox" class="avail-edit__switch" data-role="prov-show-free"
                ${showFree ? "checked" : ""} aria-label="Pokazuj wolne terminy" />
            </label>`
            }
          </div>
          <div class="visit-list visit-list--carousel" role="region" aria-label="${escapeHtml(listAria)}">
            ${listBody}
          </div>
        </div>`;
  }

  function renderDashboard() {
    // Desktop: ten sam workspace co kalendarz (pulpit | siatka).
    if (usesDesktopLayout()) return renderProviderCalendar({ navActive: "dashboard" });
    return `
      <div class="app-screen app-screen--provider app-screen--dashboard">
        ${renderProviderDashBodyHtml()}
        ${providerBottomNav("dashboard")}
      </div>`;
  }

  function visitCountLabel(n) {
    const abs = Math.abs(Number(n) || 0) % 100;
    const last = abs % 10;
    if (abs === 1) return "wizyta";
    if (last >= 2 && last <= 4 && (abs < 12 || abs > 14)) return "wizyty";
    return "wizyt";
  }

  /** Nagłówek dnia w agendzie pulpitu — bez niego godziny nie mówią, o który dzień chodzi. */
  function renderProviderDayHeadHtml(dateISO, count) {
    const today = demoTodayISO();
    const prefix = dateISO === today ? "Dziś" : dateISO === addDaysISO(today, 1) ? "Jutro" : "";
    const dayLabel = formatDayWithDow(dateISO);
    return `
      <h4 class="visit-day"${dateISO === today ? ' data-today="true"' : ""}>
        <span class="visit-day__label">${
          prefix ? `<span class="visit-day__prefix">${escapeHtml(prefix)}</span> · ` : ""
        }${escapeHtml(dayLabel)}</span>
        <span class="visit-day__count">${count} ${escapeHtml(visitCountLabel(count))}</span>
      </h4>`;
  }

  /** Lista wizyt z kartami „Wolne” w lukach między kolejnymi terminami tego samego dnia. */
  function renderProviderVisitTimeline(upcoming, opts) {
    const showFree = !opts || opts.showFree !== false;
    const perDay = Object.create(null);
    upcoming.forEach(function (b) {
      perDay[b.dateISO] = (perDay[b.dateISO] || 0) + 1;
    });
    let html = "";
    let openDay = null;
    for (let i = 0; i < upcoming.length; i++) {
      const cur = upcoming[i];
      if (cur.dateISO !== openDay) {
        openDay = cur.dateISO;
        html += renderProviderDayHeadHtml(openDay, perDay[openDay]);
      }
      html += renderProviderVisitCard(cur);
      if (!showFree) continue;
      const next = upcoming[i + 1];
      if (!next) continue;
      if (cur.dateISO !== next.dateISO) continue;
      const gapFrom = timeToMin(cur.to);
      const gapTo = timeToMin(next.from);
      if (!(gapTo > gapFrom)) continue;
      html += renderProviderFreeSlotCard(cur.dateISO, minToTime(gapFrom), minToTime(gapTo));
    }
    return html;
  }

  function isProvCalFreeSelInRange(sel, dateISO, fromMin, toMin) {
    return !!(
      sel &&
      sel.kind === "free" &&
      sel.dateISO === dateISO &&
      Number(sel.fromMin) < toMin &&
      Number(sel.toMin) > fromMin
    );
  }

  function renderProviderFreeSlotCard(dateISO, from, to) {
    const fromMin = timeToMin(from);
    const toMin = timeToMin(to);
    const durationMin = Math.max(0, toMin - fromMin);
    const selected = isProvCalFreeSelInRange(window.AppState.provCalSelection, dateISO, fromMin, toMin);
    return `
      <div class="visit-card visit-card--provider visit-card--free${selected ? " is-selected" : ""}" data-status="free"
        data-date="${escapeHtml(dateISO)}" data-from-min="${fromMin}" data-to-min="${toMin}"
        data-action="select-provider-free" role="button" tabindex="0"
        aria-pressed="${selected ? "true" : "false"}"
        aria-label="Pokaż w kalendarzu: wolne ${escapeHtml(from)}–${escapeHtml(to)}, ${escapeHtml(formatDuration(durationMin))}">
        <div class="visit-card__schedule">
          <time class="visit-card__range" datetime="${escapeHtml(dateISO + "T" + from)}">${escapeHtml(from)}–${escapeHtml(to)}</time>
          <span class="visit-card__duration" aria-label="Czas trwania: ${escapeHtml(formatDuration(durationMin))}">
            <span class="visit-card__clock" aria-hidden="true"></span>
            ${escapeHtml(formatDuration(durationMin))}
          </span>
          <span class="visit-card__free-tag">Wolne</span>
        </div>
      </div>`;
  }

  function renderProviderVisitCard(b) {
    const durationMin = Math.max(0, timeToMin(b.to) - timeToMin(b.from));
    const services = (b.serviceNames || []).length ? b.serviceNames : ["Usługa"];
    const p = myProvider();
    let locId = b.locationId || null;
    if (!locId) {
      const block = resolveAvailBlockForRange(b.dateISO, timeToMin(b.from), timeToMin(b.to));
      if (block && block.locationId) locId = block.locationId;
    }
    const toneClass = locId ? locationToneClass(p, locId) : "";
    const locAttr = locId ? ` data-location-id="${escapeHtml(String(locId))}"` : "";
    const selected = !!(
      window.AppState.provCalSelection &&
      window.AppState.provCalSelection.kind === "booking" &&
      window.AppState.provCalSelection.bookingId === b.id
    );
    return `
      <div class="visit-card visit-card--provider${toneClass ? " " + escapeHtml(toneClass) : ""}${
        selected ? " is-selected" : ""
      }" data-booking-id="${escapeHtml(b.id)}" data-status="${escapeHtml(b.status)}"${locAttr}
        data-action="select-provider-visit" role="button" tabindex="0"
        aria-pressed="${selected ? "true" : "false"}"
        aria-label="Pokaż w kalendarzu: ${escapeHtml((b.clientName || "Klient") + ", " + (services[0] || "usługa"))}">
        <div class="visit-card__schedule">
          <time class="visit-card__range" datetime="${escapeHtml(b.dateISO + "T" + b.from)}">${escapeHtml(b.from)}–${escapeHtml(b.to)}</time>
          <span class="visit-card__duration" aria-label="Czas trwania: ${escapeHtml(formatDuration(durationMin))}">
            <span class="visit-card__clock" aria-hidden="true"></span>
            ${escapeHtml(formatDuration(durationMin))}
          </span>
          ${
            b.status === "proposed"
              ? `<span class="status-badge" data-status="proposed">Propozycja</span>`
              : b.status === "cancelled" || b.status === "rejected"
                ? `<span class="status-badge" data-status="${escapeHtml(b.status)}">${escapeHtml(
                    STATUS_LABEL[b.status] || b.status
                  )}</span>`
                : ""
          }
        </div>
        <div class="visit-card__name">${escapeHtml(b.clientName || "Klient")}</div>
        <ul class="visit-card__services" aria-label="Zamówione usługi">
          ${services.map((serviceName) => `<li>${escapeHtml(serviceName)}</li>`).join("")}
        </ul>
        ${
          b.status === "confirmed"
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--quiet btn--sm" data-action="edit-visit" data-booking-id="${escapeHtml(b.id)}">Edytuj</button>
                 <button type="button" class="btn btn--quiet btn--sm btn--quiet-danger" data-action="cancel-visit" data-booking-id="${escapeHtml(b.id)}">Odwołaj</button>
               </div>`
            : ""
        }
      </div>`;
  }

  function providerVisits() {
    return (window.AppState.bookings || [])
      .filter(function (b) {
        return (
          b.providerId === MY_PROVIDER_ID &&
          b.dateISO &&
          b.from &&
          b.to &&
          (b.status === "confirmed" ||
            b.status === "proposed" ||
            b.status === "cancelled" ||
            b.status === "rejected")
        );
      })
      .slice()
      .sort(function (a, b) {
        return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
      });
  }

  function ensureProvCalDate() {
    if (window.AppState.provCalDate) return window.AppState.provCalDate;
    const today = demoTodayISO();
    const next = providerVisits().find(function (b) {
      return b.dateISO >= today;
    });
    window.AppState.provCalDate = (next && next.dateISO) || today;
    return window.AppState.provCalDate;
  }

  function clampProvCalVisibleDays(n) {
    const v = Math.round(Number(n));
    if (!(v >= 1)) return 7;
    return Math.min(7, Math.max(1, v));
  }

  function ensureProvCalVisibleDays() {
    const n = clampProvCalVisibleDays(window.AppState.provCalVisibleDays);
    window.AppState.provCalVisibleDays = n;
    window.AppState.provCalView = n <= 1 ? "day" : "week";
    return n;
  }

  function isoAddDays(dateISO, delta) {
    const d = new Date(String(dateISO) + "T12:00:00");
    if (isNaN(d.getTime())) return dateISO;
    d.setDate(d.getDate() + Number(delta || 0));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** Domyślny start okna: 7 = poniedziałek, 1 = data, 2–6 = wyśrodkowane na dacie. */
  function defaultProvCalWindowStart(selectedISO, count) {
    const n = clampProvCalVisibleDays(count);
    const sel = selectedISO || ensureProvCalDate();
    if (n === 7) return mondayISOFrom(sel);
    if (n === 1) return sel;
    return isoAddDays(sel, -Math.floor((n - 1) / 2));
  }

  function ensureProvCalWindowStart() {
    const n = ensureProvCalVisibleDays();
    const selected = ensureProvCalDate();
    let start = window.AppState.provCalWindowStart;
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) {
      start = defaultProvCalWindowStart(selected, n);
    }
    if (n === 7) start = mondayISOFrom(start);
    else if (n === 1) start = selected;
    window.AppState.provCalWindowStart = start;
    return start;
  }

  /** Lista dni w aktualnym oknie (nie zależy od klikniętego zaznaczenia dla 2–6). */
  function provCalVisibleDayList(selectedISO, count) {
    const n = clampProvCalVisibleDays(count);
    const selected = selectedISO || ensureProvCalDate();
    let start;
    if (n === 7) {
      start = mondayISOFrom(ensureProvCalWindowStart() || selected);
    } else if (n === 1) {
      start = selected;
    } else {
      start = ensureProvCalWindowStart();
    }
    window.AppState.provCalWindowStart = start;
    const out = [];
    for (let i = 0; i < n; i++) out.push(isoAddDays(start, i));
    return out;
  }

  function provCalWindowContainsDate(dateISO, count) {
    if (!dateISO) return false;
    const days = provCalVisibleDayList(ensureProvCalDate(), count != null ? count : ensureProvCalVisibleDays());
    return days.indexOf(dateISO) !== -1;
  }

  /** Przesuń okno tak, by data była widoczna (miesiąc / Dzisiaj / skok spoza okna). */
  function moveProvCalWindowToInclude(dateISO) {
    if (!dateISO) return;
    const n = ensureProvCalVisibleDays();
    if (n === 7) {
      window.AppState.provCalWindowStart = mondayISOFrom(dateISO);
      return;
    }
    if (n === 1) {
      window.AppState.provCalWindowStart = dateISO;
      return;
    }
    if (provCalWindowContainsDate(dateISO, n)) return;
    window.AppState.provCalWindowStart = defaultProvCalWindowStart(dateISO, n);
  }

  /** Przesuń okno o delta dni (swipe / strzałki); zaznaczenie idzie razem. */
  function shiftProvCalWindow(deltaDays) {
    const n = ensureProvCalVisibleDays();
    const delta = Number(deltaDays) || 0;
    if (!delta) return;
    if (n === 7) {
      const start = mondayISOFrom(ensureProvCalWindowStart());
      window.AppState.provCalWindowStart = mondayISOFrom(isoAddDays(start, delta));
      return;
    }
    if (n === 1) {
      window.AppState.provCalWindowStart = isoAddDays(ensureProvCalDate(), delta);
      return;
    }
    window.AppState.provCalWindowStart = isoAddDays(ensureProvCalWindowStart(), delta);
  }

  /** Zoom poziomy: ile kolumn dni (1–7). */
  function applyProvCalVisibleDays(nextDays, opts) {
    opts = opts || {};
    const n = clampProvCalVisibleDays(nextDays);
    const prev = clampProvCalVisibleDays(window.AppState.provCalVisibleDays);
    let changed = n !== prev || !!opts.force;
    window.AppState.provCalVisibleDays = n;
    window.AppState.provCalView = n <= 1 ? "day" : "week";
    // Przy zmianie liczby kolumn — wyśrodkuj okno na zaznaczonej dacie.
    if (changed) {
      window.AppState.provCalWindowStart = defaultProvCalWindowStart(ensureProvCalDate(), n);
    }
    if (opts.closeMonth !== false && window.AppState.provCalMonthOpen) {
      window.AppState.provCalMonthOpen = false;
      changed = true;
    }
    if (!changed) {
      if (opts.persist) saveState();
      return n;
    }
    if (opts.persist !== false) saveState();
    if (opts.render !== false) renderAll();
    return n;
  }

  function pickProvCalDate(dateISO, opts) {
    opts = opts || {};
    if (!dateISO) return;
    window.AppState.provCalDate = dateISO;
    window.AppState.provCalPickerMonth = dateISO.slice(0, 7);
    // Panel miesiąca zostaje otwarty — zamyka go tylko toggle / Escape.
    if (opts.closeMonth) window.AppState.provCalMonthOpen = false;
    // Zachowaj zoom poziomy (liczbę dni), chyba że wymuszono widok dnia.
    if (opts.forceDay) applyProvCalVisibleDays(1, { render: false, persist: false, closeMonth: false });
    else ensureProvCalVisibleDays();
    // keepWindow: swipe już przesunął okno; inaczej — klik w widocznym dniu nie rusza okna,
    // skok spoza okna (miesiąc / Dzisiaj) dociąga okno do daty.
    if (!opts.keepWindow) {
      if (opts.forceDay || opts.jumpWindow || !provCalWindowContainsDate(dateISO)) {
        moveProvCalWindowToInclude(dateISO);
      }
    }
    if (!opts.keepSelection) window.AppState.provCalSelection = null;
    // Panel „+” otwarty — synchronizuj dzień (pełny i zwinięty widok).
    if (window.AppState.provCalAddOpen && window.AppState.provCalAddDraft) {
      window.AppState.provCalAddDraft.dateISO = dateISO;
    }
    saveState();
    if (opts.render !== false) renderAll();
  }

  /** ±N dni w kalendarzu usługodawcy (gest swipe / nawigacja) — przesuwa okno i zaznaczenie. */
  function shiftProvCalDate(deltaDays, opts) {
    opts = opts || {};
    const delta = Number(deltaDays) || 0;
    if (!delta) return;
    shiftProvCalWindow(delta);
    const iso = isoAddDays(ensureProvCalDate(), delta);
    pickProvCalDate(iso, Object.assign({ keepView: true, keepWindow: true }, opts));
    hapticTap(12);
  }

  /** Widoczna (niezerowa) instancja kalendarza — demo ma 2 ekrany. */
  function resolveVisibleProvCalGcal(preferred) {
    if (preferred && preferred.isConnected && preferred.offsetWidth > 8) return preferred;
    const nodes = document.querySelectorAll('[data-role="prov-cal-gcal"]');
    let best = null;
    let bestArea = 0;
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) {
        bestArea = area;
        best = nodes[i];
      }
    }
    return best || nodes[0] || null;
  }

  function readProvCalTranslateX(el) {
    if (!el) return 0;
    const t = el.style.transform || "";
    const px = t.match(/translate3d\(([-\d.]+)px/i);
    if (px) return Number(px[1]) || 0;
    const pct = t.match(/translate3d\(([-\d.]+)%/i);
    if (pct) return ((Number(pct[1]) || 0) / 100) * (el.offsetWidth || 0);
    return 0;
  }

  function renderProvCalGcalHtml(dateISO) {
    return renderProvCalGoogleWeek(dateISO, providerVisits());
  }

  /** Krok swipa jak w Google Calendar: 1–6 dni → ±1 dzień; 7 dni → ±7 (tydzień). */
  function provCalSwipeStepDays() {
    return ensureProvCalVisibleDays() === 7 ? 7 : 1;
  }

  function renderProvCalHoursHtml(hourH) {
    let hours = "";
    for (let h = PROV_CAL_HOUR_START; h <= PROV_CAL_HOUR_END; h++) {
      const top = (h - PROV_CAL_HOUR_START) * hourH;
      const label =
        h === PROV_CAL_HOUR_START || h === PROV_CAL_HOUR_END ? "" : pad(h) + ":00";
      hours += `
        <div class="gcal__hour" style="top:${top}px" data-hour="${h}">
          <span class="gcal__hour-label">${label}</span>
        </div>`;
    }
    return `<div class="gcal__hours" aria-hidden="true">${hours}</div>`;
  }

  /** Jedna kolumna dnia (bez osi godzin) — używana też przy rozszerzaniu toru swipa. */
  function renderProvCalDayColumnHtml(dateISO, visits) {
    const hourStart = PROV_CAL_HOUR_START;
    const hourEnd = PROV_CAL_HOUR_END;
    const hourH = ensureProvCalHourH();
    const dayStartMin = hourStart * 60;
    const dayEndMin = hourEnd * 60;
    const today = demoTodayISO();
    const isToday = dateISO === today;
    const q = String(window.AppState.provCalSearchQ || "")
      .trim()
      .toLowerCase();
    const dayVisits = (visits || []).filter(function (b) {
      return b.dateISO === dateISO;
    });
    const events = dayVisits
      .map(function (b) {
        const fromM = timeToMinutes(b.from);
        const toM = timeToMinutes(b.to);
        if (isNaN(fromM) || isNaN(toM) || toM <= fromM) return "";
        const clampedFrom = Math.max(dayStartMin, Math.min(dayEndMin, fromM));
        const clampedTo = Math.max(dayStartMin, Math.min(dayEndMin, toM));
        if (clampedTo <= clampedFrom) return "";
        const top = ((clampedFrom - dayStartMin) / 60) * hourH;
        const height = Math.max(22, ((clampedTo - clampedFrom) / 60) * hourH);
        const svc = (b.serviceNames || []).join(", ") || "Usługa";
        const client = b.clientName || "Klient";
        const hay = (svc + " " + client).toLowerCase();
        const dim = q && hay.indexOf(q) === -1;
        const selected = !!(
          window.AppState.provCalSelection &&
          window.AppState.provCalSelection.kind === "booking" &&
          window.AppState.provCalSelection.bookingId === b.id
        );
        const densityCls = provCalDensityCls(height);
        const availBlock = resolveAvailBlockForRange(dateISO, clampedFrom, clampedTo);
        const toneCls = availBlock && availBlock.locationId ? " " + locationToneClass(myProvider(), availBlock.locationId) : "";
        const locAttr =
          availBlock && availBlock.locationId
            ? ` data-location-id="${escapeHtml(String(availBlock.locationId))}"`
            : "";
        return `
          <article class="gcal__event gcal__event--${escapeHtml(b.status)}${densityCls ? " " + densityCls : ""}${
            dim ? " gcal__event--dim" : ""
          }${selected ? " gcal__event--selected" : ""}${toneCls}"
            style="top:${top}px;height:${height}px"
            data-role="prov-cal-slot" data-kind="booking" data-date="${escapeHtml(dateISO)}"
            data-action="select-prov-cal-slot" data-booking-id="${escapeHtml(b.id)}"
            data-from-min="${clampedFrom}" data-to-min="${clampedTo}"${locAttr}
            data-search="${escapeHtml(hay)}" role="button" tabindex="0"
            aria-pressed="${selected ? "true" : "false"}"
            aria-label="${escapeHtml(svc + ", " + client + ", " + b.from + "–" + b.to)}">
            <div class="gcal__event-row">
              <span class="gcal__event-time">${escapeHtml(b.from)}–${escapeHtml(b.to)}</span>
              <span class="gcal__event-title">${escapeHtml(svc)}</span>
            </div>
            <span class="gcal__event-client">${escapeHtml(client)}</span>
          </article>`;
      })
      .join("");

    let nowLine = "";
    if (isToday) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= dayStartMin && nowMin <= dayEndMin) {
        const y = ((nowMin - dayStartMin) / 60) * hourH;
        nowLine = `<div class="gcal__now" style="top:${y}px" data-now-min="${nowMin}" aria-hidden="true"><span></span></div>`;
      }
    }

    const empty =
      !events && ensureProvCalVisibleDays() <= 1
        ? `<p class="gcal__empty">Brak wizyt w tym dniu</p>`
        : "";
    const draftSlot = renderProvCalFreeDraftHtml(dateISO, hourH, dayStartMin, dayEndMin);
    const proposalSlots = renderProvCalProposalDraftsHtml(dateISO, hourH, dayStartMin, dayEndMin);

    const requestDays = replyRequestDaySet();
    const isRequestDay = !!(requestDays && requestDays.has(dateISO));
    const dimOther = !!(requestDays && !window.AppState.provCalReplyShowAll && !isRequestDay);
    const isSel = dateISO === ensureProvCalDate();
    return `
      <div class="gcal-week__col${isToday ? " gcal-week__col--today" : ""}${
        isSel ? " gcal-week__col--sel" : ""
      }${isRequestDay ? " gcal-week__col--request" : ""}${
        dimOther ? " gcal-week__col--dim" : ""
      }" data-date="${escapeHtml(dateISO)}">
        <div class="gcal__track gcal-week__track" data-role="prov-cal-track" data-date="${escapeHtml(dateISO)}">
          ${renderProvCalAvailBars(dateISO, hourH, dayStartMin, dayEndMin)}
          ${nowLine}
          ${events}
          ${draftSlot}
          ${proposalSlots}
          ${empty}
        </div>
      </div>`;
  }

  /** Pusty zaznaczony przedział (jak w Google Calendar) — bez zapisu wizyty. */
  function renderProvCalFreeDraftHtml(dateISO, hourH, dayStartMin, dayEndMin) {
    const sel = window.AppState.provCalSelection;
    if (!sel || sel.kind !== "free" || sel.dateISO !== dateISO) return "";
    const fromM = Math.max(dayStartMin, Math.min(dayEndMin, Number(sel.fromMin) || dayStartMin));
    const toM = Math.max(dayStartMin, Math.min(dayEndMin, Number(sel.toMin) || fromM + 30));
    if (!(toM > fromM)) return "";
    const top = ((fromM - dayStartMin) / 60) * hourH;
    const height = Math.max(28, ((toM - fromM) / 60) * hourH);
    const fromLabel = minToTime(fromM);
    const toLabel = minToTime(toM);
    return `
      <article class="gcal__event gcal__event--draft gcal__event--selected"
        style="top:${top}px;height:${height}px"
        data-role="prov-cal-slot" data-kind="free" data-date="${escapeHtml(dateISO)}"
        data-action="select-prov-cal-slot"
        data-from-min="${fromM}" data-to-min="${toM}"
        role="button" tabindex="0" aria-pressed="true"
        aria-label="Zaznaczony przedział ${escapeHtml(fromLabel)}–${escapeHtml(toLabel)}">
        <span class="gcal__event-resize gcal__event-resize--start" data-role="prov-cal-resize" data-edge="start" aria-hidden="true"></span>
        <div class="gcal__event-row">
          <span class="gcal__event-time">${escapeHtml(fromLabel)}–${escapeHtml(toLabel)}</span>
        </div>
        <span class="gcal__event-resize gcal__event-resize--end" data-role="prov-cal-resize" data-edge="end" aria-hidden="true"></span>
      </article>`;
  }

  /** Propozycje terminów (odpowiedź na prośbę) jako „duchy” na siatce — klik zdejmuje propozycję. */
  function renderProvCalProposalDraftsHtml(dateISO, hourH, dayStartMin, dayEndMin) {
    if (!window.AppState.provCalAddOpen) return "";
    const draft = window.AppState.provCalAddDraft;
    if (!draft || !draft.requestId || !Array.isArray(draft.proposals)) return "";
    return draft.proposals
      .filter(function (c) {
        return c && c.dateISO === dateISO;
      })
      .map(function (c) {
        const fromM = Math.max(dayStartMin, Math.min(dayEndMin, timeToMinutes(c.from)));
        const toM = Math.max(dayStartMin, Math.min(dayEndMin, timeToMinutes(c.to)));
        if (!(toM > fromM)) return "";
        const top = ((fromM - dayStartMin) / 60) * hourH;
        const height = Math.max(28, ((toM - fromM) / 60) * hourH);
        const fromLabel = minToTime(fromM);
        const toLabel = minToTime(toM);
        return `
      <article class="gcal__event gcal__event--draft gcal__event--proposal"
        style="top:${top}px;height:${height}px"
        data-role="prov-cal-slot" data-kind="proposal" data-date="${escapeHtml(dateISO)}"
        data-action="prov-cal-remove-proposal" data-slot="${escapeHtml(c.id)}"
        data-from-min="${fromM}" data-to-min="${toM}"
        role="button" tabindex="0" aria-pressed="true"
        aria-label="Propozycja ${escapeHtml(fromLabel)}–${escapeHtml(toLabel)} — kliknij, aby usunąć">
        <div class="gcal__event-row">
          <span class="gcal__event-time">${escapeHtml(fromLabel)}–${escapeHtml(toLabel)}</span>
        </div>
      </article>`;
      })
      .join("");
  }

  /** Legalny slot dla propozycji w danym dniu — dni i pora z prośby, dostępność, kolizje. */
  function replyProposalSlotForMove(p, req, draft, dateISO, fromMin, durationMin) {
    const daySet = replyRequestDaySet();
    const showAll = !!window.AppState.provCalReplyShowAll;
    if (daySet && !showAll && !daySet.has(dateISO)) return null;
    const slotOpts = slotOptsForServiceIds(p, (draft && draft.serviceIds) || req.serviceIds || []);
    let slots = computeSlots(p, dateISO, Math.max(5, durationMin || 30), slotOpts);
    if (daySet && daySet.has(dateISO)) {
      const part = replyDayPartForDate(dateISO);
      slots = slots.filter(function (s) {
        return slotMatchesDayPart(s, part);
      });
    }
    return (
      slots.find(function (s) {
        return timeToMin(s.from) === fromMin;
      }) || null
    );
  }

  /** Przesuń propozycję na nowy slot (upuszczenie ducha). Zwraca true przy sukcesie. */
  function moveReplyProposalToSlot(slotId, dateISO, fromMin) {
    const draft = window.AppState.provCalAddDraft;
    const req = replyRequest();
    const p = myProvider();
    if (!slotId || !draft || !req || !p) return false;
    const c = (draft.proposals || []).find(function (x) {
      return x && x.id === slotId;
    });
    if (!c) return false;
    const dur = Math.max(5, timeToMinutes(c.to) - timeToMinutes(c.from));
    const slot = replyProposalSlotForMove(p, req, draft, dateISO, fromMin, dur);
    if (!slot) return false;
    c.id = slot.id;
    c.dateISO = dateISO;
    c.from = slot.from;
    c.to = slot.to;
    c.locationId = slot.locationId;
    c.locationLabel = slot.locationLabel;
    draft.proposals.sort(function (a, b) {
      return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
    });
    return true;
  }

  /** Tap w puste miejsce siatki w trybie odpowiedzi — dodaj najbliższą legalną propozycję. */
  function addReplyProposalFromPoint(dateISO, fromMin) {
    const draft = window.AppState.provCalAddDraft;
    const req = replyRequest();
    const p = myProvider();
    if (!draft || !req || !p) return;
    const daySet = replyRequestDaySet();
    const showAll = !!window.AppState.provCalReplyShowAll;
    if (daySet && !showAll && !daySet.has(dateISO)) {
      showToast("Ten dzień jest poza prośbą klienta.");
      return;
    }
    const dur = requestServicesDuration(p, draft.serviceIds || req.serviceIds || []) || 30;
    const slotOpts = slotOptsForServiceIds(p, draft.serviceIds || req.serviceIds || []);
    let slots = computeSlots(p, dateISO, dur, slotOpts);
    if (daySet && daySet.has(dateISO)) {
      const part = replyDayPartForDate(dateISO);
      slots = slots.filter(function (s) {
        return slotMatchesDayPart(s, part);
      });
    }
    let best = null;
    let bestDist = Infinity;
    slots.forEach(function (s) {
      const st = timeToMin(s.from);
      const dist = Math.abs(st - fromMin);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    });
    if (!best) {
      showToast("Brak wolnych terminów tego dnia.");
      return;
    }
    if (!Array.isArray(draft.proposals)) draft.proposals = [];
    if (
      draft.proposals.some(function (c) {
        return c && c.id === best.id;
      })
    ) {
      showToast("Ta propozycja już jest na liście.");
      return;
    }
    draft.proposals.push({
      id: best.id,
      dateISO: dateISO,
      from: best.from,
      to: best.to,
      locationId: best.locationId,
      locationLabel: best.locationLabel,
    });
    draft.proposals.sort(function (a, b) {
      return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
    });
    window.AppState.provCalSelection = null;
    saveState();
    renderAll();
    hapticTap(16);
  }

  /** Wolne luki dnia: bloki dostępności minus zajęte wizyty. */
  function provCalFreeGaps(dateISO, exceptBookingId) {
    const busy = activeDayBookings(dateISO, exceptBookingId)
      .map(function (b) {
        return { from: timeToMinutes(b.from), to: timeToMinutes(b.to) };
      })
      .filter(function (iv) {
        return iv.to > iv.from;
      })
      .sort(function (a, b) {
        return a.from - b.from;
      });
    const gaps = [];
    providerAvailBlocksForDate(dateISO).forEach(function (block) {
      let cursor = timeToMinutes(block.from);
      const end = timeToMinutes(block.to);
      if (!(end > cursor)) return;
      const blockBusy = busy
        .filter(function (iv) {
          return iv.from < end && iv.to > cursor;
        })
        .map(function (iv) {
          return { from: Math.max(iv.from, cursor), to: Math.min(iv.to, end) };
        })
        .filter(function (iv) {
          return iv.to > iv.from;
        })
        .sort(function (a, b) {
          return a.from - b.from;
        });
      blockBusy.forEach(function (iv) {
        if (iv.from > cursor) gaps.push({ from: cursor, to: iv.from });
        cursor = Math.max(cursor, iv.to);
      });
      if (end > cursor) gaps.push({ from: cursor, to: end });
    });
    return gaps;
  }

  /** Docelowy czas trwania szkicu (usługi z panelu „+” albo 30 min). */
  function desiredProvCalFreeDurationMin() {
    if (window.AppState.provCalAddOpen && window.AppState.provCalAddDraft && !replyRequestId()) {
      const draft = window.AppState.provCalAddDraft;
      const p = myProvider();
      const totals = provCalAddServiceTotals(provCalAddSelectedServices(p, draft));
      if (totals && totals.duration > 0) return Math.max(5, totals.duration);
    }
    return 30;
  }

  /**
   * Legalny zakres wolnego szkicu przy preferredFromMin:
   * 1) najbliższy slot z computeSlots (dostępność + bez kolizji),
   * 2) inaczej dopasowanie do wolnej luki (ew. krótszy czas).
   */
  function fitProvCalFreeRange(dateISO, preferredFromMin, durationMin) {
    if (!dateISO) return null;
    durationMin = Math.max(5, Number(durationMin) || 30);
    preferredFromMin = snapProvCalMin(Number(preferredFromMin) || 0);
    const p = myProvider();
    if (p) {
      const slots = computeSlots(p, dateISO, durationMin, { ignoreLead: true });
      const matched = matchProvCalAddSlotForFromMin(slots, preferredFromMin);
      if (matched) {
        return {
          fromMin: timeToMin(matched.from),
          toMin: timeToMin(matched.to),
          slot: matched,
        };
      }
    }
    const gaps = provCalFreeGaps(dateISO);
    let gap = null;
    let bestDist = Infinity;
    gaps.forEach(function (g) {
      if (!(g.to - g.from >= 5)) return;
      let dist = 0;
      if (preferredFromMin < g.from) dist = g.from - preferredFromMin;
      else if (preferredFromMin >= g.to) dist = preferredFromMin - g.to;
      if (dist < bestDist) {
        bestDist = dist;
        gap = g;
      }
    });
    if (!gap) return null;
    const maxDur = gap.to - gap.from;
    const dur = Math.max(5, Math.floor(Math.min(durationMin, maxDur) / PROV_CAL_SNAP_MIN) * PROV_CAL_SNAP_MIN);
    if (dur < 5 || gap.to - gap.from < dur) return null;
    let fromMin = Math.max(gap.from, Math.min(gap.to - dur, preferredFromMin));
    fromMin = snapProvCalMin(fromMin);
    fromMin = Math.max(gap.from, Math.min(gap.to - dur, fromMin));
    return { fromMin: fromMin, toMin: fromMin + dur, slot: null };
  }

  function placeProvCalFreeSelection(dateISO, clientY, track) {
    if (!dateISO || !track) return;
    const hourH = ensureProvCalHourH();
    const dayStart = PROV_CAL_HOUR_START * 60;
    const dayEnd = PROV_CAL_HOUR_END * 60;
    const rect = track.getBoundingClientRect();
    let preferredFrom = dayStart + ((clientY - rect.top) / hourH) * 60;
    preferredFrom = snapProvCalMin(preferredFrom);
    preferredFrom = Math.max(dayStart, Math.min(dayEnd - 5, preferredFrom));
    // Tryb odpowiedzi na prośbę: tap w wolne miejsce dodaje propozycję (bez szkicu).
    if (window.AppState.provCalAddOpen && replyRequestId()) {
      addReplyProposalFromPoint(dateISO, preferredFrom);
      return;
    }
    const fitted = fitProvCalFreeRange(dateISO, preferredFrom, desiredProvCalFreeDurationMin());
    if (!fitted) {
      showToast("Brak wolnego miejsca w tym przedziale.");
      hapticTap(8);
      return;
    }
    const fromMin = fitted.fromMin;
    const toMin = fitted.toMin;
    window.AppState.provCalSelection = normalizeProvCalSelection({
      kind: "free",
      dateISO: dateISO,
      fromMin: fromMin,
      toMin: toMin,
    });
    // Zaznacz też dzień w nagłówku — bez przesuwania okna (keepWindow).
    if (dateISO && window.AppState.provCalDate !== dateISO) {
      window.AppState.provCalDate = dateISO;
      window.AppState.provCalPickerMonth = dateISO.slice(0, 7);
    }
    // Panel „+” otwarty — dzień/slot z legalnego dopasowania (nie sztuczne id).
    if (window.AppState.provCalAddOpen && window.AppState.provCalAddDraft && !replyRequestId()) {
      const draft = window.AppState.provCalAddDraft;
      draft.dateISO = dateISO;
      draft.slotId = fitted.slot ? fitted.slot.id : null;
    }
    // Przed renderem: dopasuj chip (najbliższy start) i dociągnij szkic do slotu.
    if (window.AppState.provCalAddOpen && !replyRequestId()) {
      syncProvCalAddDraftFromSelection();
      snapProvCalSelectionToAddSlot();
    }
    saveState();
    renderAll();
    hapticTap(12);
    updateProvCalAddSelectionLive({ snapSelection: true });
    // Tap w siatkę → karuzela dojeżdża do zaznaczonego wolnego terminu.
    scheduleScrollProvCalAddTimeToSelected();
  }

  function applyProvCalFreeDraftLayout(el, fromMin, toMin) {
    if (!el) return;
    const hourH = ensureProvCalHourH();
    const dayStartMin = PROV_CAL_HOUR_START * 60;
    const top = ((fromMin - dayStartMin) / 60) * hourH;
    const height = Math.max(28, ((toMin - fromMin) / 60) * hourH);
    el.style.top = top + "px";
    el.style.height = height + "px";
    el.setAttribute("data-from-min", String(fromMin));
    el.setAttribute("data-to-min", String(toMin));
    const timeEl = el.querySelector(".gcal__event-time");
    const fromLabel = minToTime(fromMin);
    const toLabel = minToTime(toMin);
    if (timeEl) timeEl.textContent = fromLabel + "–" + toLabel;
    el.setAttribute("aria-label", "Zaznaczony przedział " + fromLabel + "–" + toLabel);
  }

  /** Krótki haptyczny feedback w PWA / na telefonie (jeśli API dostępne). */
  function hapticTap(ms) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(typeof ms === "number" ? ms : 14);
      }
    } catch (err) {
      /* ignore */
    }
  }

  const PROV_CAL_SNAP_MIN = 5;

  function normalizeProvCalSelection(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind === "booking" && raw.bookingId) {
      return {
        kind: "booking",
        bookingId: String(raw.bookingId),
        dateISO: typeof raw.dateISO === "string" ? raw.dateISO : null,
        fromMin: Number(raw.fromMin) || 0,
        toMin: Number(raw.toMin) || 0,
      };
    }
    if (raw.kind === "free" && raw.dateISO) {
      const fromMin = Number(raw.fromMin);
      const toMin = Number(raw.toMin);
      if (!(toMin > fromMin)) return null;
      return { kind: "free", dateISO: String(raw.dateISO), fromMin: fromMin, toMin: toMin };
    }
    return null;
  }

  function provCalSelectionKey(sel) {
    if (!sel) return "";
    if (sel.kind === "booking") return "b:" + sel.bookingId;
    return "f:" + sel.dateISO + ":" + sel.fromMin + ":" + sel.toMin;
  }

  function selectionFromSlotEl(el) {
    if (!el) return null;
    const kind = el.getAttribute("data-kind");
    const dateISO = el.getAttribute("data-date") || ensureProvCalDate();
    const fromMin = Number(el.getAttribute("data-from-min"));
    const toMin = Number(el.getAttribute("data-to-min"));
    if (kind === "booking") {
      return normalizeProvCalSelection({
        kind: "booking",
        bookingId: el.getAttribute("data-booking-id"),
        dateISO: dateISO,
        fromMin: fromMin,
        toMin: toMin,
      });
    }
    if (kind === "free") {
      return normalizeProvCalSelection({ kind: "free", dateISO: dateISO, fromMin: fromMin, toMin: toMin });
    }
    return null;
  }

  function isProvCalSlotSelected(el) {
    const sel = window.AppState.provCalSelection;
    if (!sel || !el) return false;
    return provCalSelectionKey(sel) === provCalSelectionKey(selectionFromSlotEl(el));
  }

  function syncProvCalSelection() {
    document.querySelectorAll('[data-role="prov-cal-slot"]').forEach(function (el) {
      // Duchy propozycji nie podlegają selekcji — są zawsze „włączone”.
      if (el.getAttribute("data-kind") === "proposal") return;
      const on = isProvCalSlotSelected(el);
      el.classList.toggle("gcal__event--selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // Nagłówek dnia + kolumna — podświetlenie zgodnie z provCalDate.
    const selected = window.AppState.provCalDate;
    if (selected) {
      document.querySelectorAll(".gcal-week__dayhead[data-date]").forEach(function (el) {
        el.classList.toggle("gcal-week__dayhead--sel", el.getAttribute("data-date") === selected);
      });
      document.querySelectorAll(".gcal-week__col[data-date]").forEach(function (el) {
        el.classList.toggle("gcal-week__col--sel", el.getAttribute("data-date") === selected);
      });
    }
  }

  function selectProvCalSlot(nextSel, opts) {
    opts = opts || {};
    const normalized = normalizeProvCalSelection(nextSel);
    const prevKey = provCalSelectionKey(window.AppState.provCalSelection);
    const nextKey = provCalSelectionKey(normalized);
    if (!opts.force && prevKey && prevKey === nextKey) {
      window.AppState.provCalSelection = null;
    } else {
      window.AppState.provCalSelection = normalized;
      if (normalized && normalized.dateISO && window.AppState.provCalDate !== normalized.dateISO) {
        window.AppState.provCalDate = normalized.dateISO;
        window.AppState.provCalPickerMonth = normalized.dateISO.slice(0, 7);
      }
    }
    // Odkliknięty szkic na siatce zdejmuje też godzinę z panelu „+”
    // (renderAll — demo renderuje dwie instancje panelu, live-patch trafia tylko pierwszą).
    if (!window.AppState.provCalSelection) {
      const addDraft = window.AppState.provCalAddDraft;
      if (
        window.AppState.provCalAddOpen &&
        addDraft &&
        !addDraft.requestId &&
        !addDraft.bookingId &&
        addDraft.slotId
      ) {
        addDraft.slotId = null;
        saveState();
        renderAll();
      }
    }
    hapticTap(window.AppState.provCalSelection ? 16 : 10);
    syncProvCalSelection();
    saveState();
  }

  function clearProvCalSelection() {
    if (!window.AppState.provCalSelection) return;
    window.AppState.provCalSelection = null;
    syncProvCalSelection();
  }

  function snapProvCalMin(min) {
    return Math.round(Number(min) / PROV_CAL_SNAP_MIN) * PROV_CAL_SNAP_MIN;
  }

  function activeDayBookings(dateISO, exceptId) {
    return (window.AppState.bookings || []).filter(function (b) {
      if (!b || b.dateISO !== dateISO) return false;
      if (exceptId && b.id === exceptId) return false;
      if (b.status !== "confirmed" && b.status !== "proposed") return false;
      const from = timeToMinutes(b.from);
      const to = timeToMinutes(b.to);
      return !isNaN(from) && !isNaN(to) && to > from;
    });
  }

  function clearProvCalDropTargets() {
    document.querySelectorAll(".gcal__event--drop-target").forEach(function (el) {
      el.classList.remove("gcal__event--drop-target");
    });
  }

  function highlightProvCalDropTargets(bookingId, dateISO, duration) {
    clearProvCalDropTargets();
    document.querySelectorAll('[data-role="prov-cal-slot"][data-kind="free"]').forEach(function (el) {
      if ((el.getAttribute("data-date") || "") !== dateISO) return;
      const gapFrom = Number(el.getAttribute("data-from-min"));
      const gapTo = Number(el.getAttribute("data-to-min"));
      el.classList.toggle("gcal__event--drop-target", gapTo - gapFrom >= duration);
    });
  }

  function moveBookingTimes(bookingId, fromMin, toMin, dateISO) {
    const bk = (window.AppState.bookings || []).find(function (b) {
      return b.id === bookingId;
    });
    if (!bk) return false;
    bk.from = minToTime(fromMin);
    bk.to = minToTime(toMin);
    if (dateISO) bk.dateISO = dateISO;
    const block = resolveAvailBlockForRange(bk.dateISO, fromMin, toMin);
    if (block && block.locationId) {
      const p = myProvider();
      bk.locationId = block.locationId;
      bk.locationLabel = locationLabel(p, block.locationId) || bk.locationLabel || "";
    }
    return true;
  }

  /** Kolizja wizyty z inną aktywną wizytą w danym dniu (poza samą sobą). */
  function bookingOverlapsOthers(bookingId, dateISO, fromMin, toMin) {
    return activeDayBookings(dateISO, bookingId).some(function (b) {
      return fromMin < timeToMinutes(b.to) && timeToMinutes(b.from) < toMin;
    });
  }

  // Progi „gęstości" treści wizyty wg wysokości (px) — standard jak w Google Calendar:
  // im mocniej skrócona oś (mały zoom), tym mniej treści się mieści.
  const PROV_CAL_H_MINI = 15; // sam pasek, bez tekstu
  const PROV_CAL_H_TINY = 26; // tylko tytuł
  const PROV_CAL_H_COMPACT = 42; // tytuł + godziny (bez klienta)

  /** Zwraca klasę gęstości dla danej wysokości bloku (pusty string = pełna treść). */
  function provCalDensityCls(height) {
    if (height < PROV_CAL_H_MINI) return "gcal__event--mini";
    if (height < PROV_CAL_H_TINY) return "gcal__event--tiny";
    if (height < PROV_CAL_H_COMPACT) return "gcal__event--compact";
    return "";
  }

  /** Ustaw właściwą klasę gęstości na elemencie (bare/tygodniowe pomijamy). */
  function applyEventDensity(el, height, isBare) {
    el.classList.remove("gcal__event--compact", "gcal__event--tiny", "gcal__event--mini");
    if (isBare) return;
    const cls = provCalDensityCls(height);
    if (cls) el.classList.add(cls);
  }

  /** Etykieta godzin wizyty: pełna „od–do” albo samo rozpoczęcie (wąska kolumna). */
  function formatProvCalEventTimeLabel(fromMin, toMin, shortOnly) {
    const from = minToTime(fromMin);
    if (shortOnly) return from;
    return from + "–" + minToTime(toMin);
  }

  /**
   * Dostosuj tekst godzin do realnej szerokości kolumny/kafla (nie do liczby dni).
   * Gdy „00:00–00:00” + minimalna nazwa się nie mieszczą → tylko godzina startu.
   */
  function syncProvCalEventTimeLabels(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const columns = scope.querySelectorAll(".gcal-week__col");
    columns.forEach(function (col) {
      const events = col.querySelectorAll('.gcal__event[data-kind="booking"][data-from-min]');
      if (!events.length) return;
      const sample = events[0];
      const timeEl = sample.querySelector(".gcal__event-time");
      if (!timeEl || !(sample.clientWidth > 0)) return;

      const prevText = timeEl.textContent;
      const prevFlex = timeEl.style.flex;
      const prevWidth = timeEl.style.width;
      sample.classList.remove("gcal__event--time-short");
      timeEl.style.flex = "0 0 auto";
      timeEl.style.width = "auto";
      timeEl.textContent = "00:00–00:00";
      const fullTimeW = timeEl.scrollWidth;
      timeEl.textContent = prevText;
      timeEl.style.flex = prevFlex;
      timeEl.style.width = prevWidth;

      const cs = getComputedStyle(sample);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = sample.clientWidth - padX;
      const minTitle = 28;
      const gap = 2;
      const short = fullTimeW + gap + minTitle > avail;

      events.forEach(function (el) {
        el.classList.toggle("gcal__event--time-short", short);
        const t = el.querySelector(".gcal__event-time");
        if (!t) return;
        const fromMin = Number(el.getAttribute("data-from-min"));
        const toMin = Number(el.getAttribute("data-to-min"));
        if (isNaN(fromMin) || isNaN(toMin)) return;
        t.textContent = formatProvCalEventTimeLabel(fromMin, toMin, short);
      });
    });
  }

  function bindProvCalTimeLabels() {
    if (bindProvCalTimeLabels.done) return;
    bindProvCalTimeLabels.done = true;
    let raf = 0;
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        syncProvCalEventTimeLabels();
      });
    }
    window.addEventListener("resize", schedule, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(schedule);
      bindProvCalTimeLabels.observe = function () {
        document.querySelectorAll('[data-role="prov-cal-body"]').forEach(function (body) {
          ro.observe(body);
        });
        document.querySelectorAll(".gcal-week__col").forEach(function (el) {
          ro.observe(el);
        });
      };
    }
  }

  function refreshProvCalTimeLabels() {
    if (typeof bindProvCalTimeLabels.observe === "function") bindProvCalTimeLabels.observe();
    syncProvCalEventTimeLabels();
  }

  function applyProvCalSlotLayout(el, fromMin, toMin) {
    if (!el) return;
    const hourH = ensureProvCalHourH();
    const dayStartMin = PROV_CAL_HOUR_START * 60;
    const isBare = el.classList.contains("gcal__event--bare");
    const isFree = el.classList.contains("gcal__event--free");
    const top = ((fromMin - dayStartMin) / 60) * hourH;
    const minH = isBare ? 6 : isFree ? 18 : 22;
    const height = Math.max(minH, ((toMin - fromMin) / 60) * hourH);
    el.style.top = top + "px";
    el.style.height = height + "px";
    el.setAttribute("data-from-min", String(fromMin));
    el.setAttribute("data-to-min", String(toMin));
    applyEventDensity(el, height, isBare);
    const timeEl = el.querySelector(".gcal__event-time");
    if (timeEl) {
      const short = el.classList.contains("gcal__event--time-short");
      timeEl.textContent = formatProvCalEventTimeLabel(fromMin, toMin, short);
    }
    const titleEl = el.querySelector(".gcal__event-title");
    if (titleEl && isFree) titleEl.textContent = "Wolne · " + (toMin - fromMin) + " min";
  }

  /** Zielona godzina startu na osi czasu podczas przytrzymania / przeciągania wizyty. */
  function updateProvCalDragTime(fromMin) {
    const timeline = document.querySelector('[data-role="prov-cal-timeline"]');
    if (!timeline || typeof fromMin !== "number" || isNaN(fromMin)) return;
    let tip = timeline.querySelector('[data-role="prov-cal-drag-time"]');
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "gcal__drag-time";
      tip.setAttribute("data-role", "prov-cal-drag-time");
      tip.setAttribute("aria-hidden", "true");
      timeline.appendChild(tip);
    }
    const hourH = ensureProvCalHourH();
    const dayStartMin = PROV_CAL_HOUR_START * 60;
    const top = ((fromMin - dayStartMin) / 60) * hourH;
    tip.textContent = minToTime(fromMin);
    tip.style.top = Math.max(0, top) + "px";
    tip.hidden = false;
    timeline.classList.add("gcal__timeline--dragging");
  }

  function hideProvCalDragTime() {
    document.querySelectorAll('[data-role="prov-cal-drag-time"]').forEach(function (el) {
      el.remove();
    });
    document.querySelectorAll(".gcal__timeline--dragging").forEach(function (el) {
      el.classList.remove("gcal__timeline--dragging");
    });
  }

  function ensureProvCalPickerMonth() {
    if (window.AppState.provCalPickerMonth) return window.AppState.provCalPickerMonth;
    window.AppState.provCalPickerMonth = ensureProvCalDate().slice(0, 7);
    return window.AppState.provCalPickerMonth;
  }

  function provCalMonthPanels() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-role="prov-cal-month-panel"]'));
  }

  /** Otwórz / zamknij panel miesiąca — z animacją wysuwania (chyba że opts.animate === false). */
  function setProvCalMonthOpen(wantOpen, opts) {
    opts = opts || {};
    const cur = !!window.AppState.provCalMonthOpen;
    if (!!wantOpen === cur && !opts.force) return;

    if (wantOpen) {
      window._provCalMonthClosing = false;
      closeProvCalViewCloud();
      window.AppState.provCalMonthOpen = true;
      window.AppState.provCalPickerMonth = ensureProvCalDate().slice(0, 7);
      // Animacja tylko przy świadomym otwarciu — nie przy restore / swipe miesiąca / re-render.
      window._provCalMonthAnimateReveal = opts.animate !== false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      window._provCalMonthAnimateReveal = false;
      return;
    }

    if (opts.animate === false) {
      window._provCalMonthClosing = false;
      window.AppState.provCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      return;
    }

    const panels = provCalMonthPanels().filter(function (panel) {
      return panel.offsetWidth > 8;
    });
    if (!panels.length) {
      window.AppState.provCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
      return;
    }
    if (window._provCalMonthClosing) return;
    window._provCalMonthClosing = true;
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      window._provCalMonthClosing = false;
      window.AppState.provCalMonthOpen = false;
      if (opts.persist !== false) saveState();
      if (opts.render !== false) renderAll();
    }
    // Pasek dnia/tygodnia jest już w DOM (schowany) — przy zamykaniu jednocześnie
    // chowa się miesiąc i pojawia sticky (bez pustki pod separatorem).
    document.querySelectorAll(".gcal-week__sticky--under-month").forEach(function (el) {
      el.classList.add("gcal-week__sticky--revealing");
      el.removeAttribute("aria-hidden");
    });
    panels.forEach(function (panel) {
      const h = Math.max(panel.offsetHeight, panel.scrollHeight);
      panel.style.maxHeight = h + "px";
      panel.style.opacity = "1";
      panel.style.transform = "translateY(0)";
      panel.classList.add("gcal-month--closing");
      void panel.offsetHeight;
      panel.style.maxHeight = "0px";
      panel.style.opacity = "0";
      panel.style.transform = "translateY(-0.35rem)";
      panel.style.paddingTop = "0";
      panel.style.paddingBottom = "0";
    });
    window.setTimeout(finish, 340);
  }

  function toggleProvCalMonthPanel() {
    setProvCalMonthOpen(!window.AppState.provCalMonthOpen);
  }

  function shiftProvCalPickerMonth(delta) {
    const cur = ensureProvCalPickerMonth();
    const parts = cur.split("-");
    const y = Number(parts[0]) || 2026;
    const m = Number(parts[1]) || 1;
    const d = new Date(y, m - 1 + delta, 1);
    window.AppState.provCalPickerMonth = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    window.AppState.provCalMonthOpen = true;
    saveState();
    renderAll();
  }

  const PROV_CAL_HOUR_H_MIN = 28;
  const PROV_CAL_HOUR_H_MAX = 140;
  const PROV_CAL_HOUR_START = 0;
  const PROV_CAL_HOUR_END = 24;

  function clampProvCalHourH(h) {
    const n = Number(h);
    if (!(n > 0)) return 60;
    return Math.round(Math.min(PROV_CAL_HOUR_H_MAX, Math.max(PROV_CAL_HOUR_H_MIN, n)) * 10) / 10;
  }

  function ensureProvCalHourH() {
    const h = clampProvCalHourH(window.AppState.provCalHourH);
    window.AppState.provCalHourH = h;
    return h;
  }

  // Min. wysokość kafla wizyty (px) — musi zgadzać się z layoutem (Math.max(22, …)).
  const PROV_CAL_BOOKING_MIN_H = 22;

  /**
   * Najmniejsza wysokość godziny (px), przy której sąsiednie wizyty w widocznych dniach
   * jeszcze się nie nakładają. Zoom-out zatrzymuje się, gdy bloki się STYKAJĄ.
   * Wynika z tego, że krótkie wizyty mają wymuszoną min. wysokość — przy zbyt małym
   * zoomie blok byłby wyższy niż odstęp do startu kolejnej wizyty.
   */
  function provCalNoOverlapMinHourH() {
    const selected = ensureProvCalDate();
    const days = provCalVisibleDayList(selected, ensureProvCalVisibleDays());
    const byDate = {};
    days.forEach(function (d) {
      byDate[d] = [];
    });
    providerVisits().forEach(function (b) {
      if (!Object.prototype.hasOwnProperty.call(byDate, b.dateISO)) return;
      const from = timeToMinutes(b.from);
      if (!isNaN(from)) byDate[b.dateISO].push(from);
    });

    let minStartGap = Infinity;
    Object.keys(byDate).forEach(function (d) {
      const starts = byDate[d].sort(function (a, b) {
        return a - b;
      });
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        if (gap > 0 && gap < minStartGap) minStartGap = gap;
      }
    });

    if (!isFinite(minStartGap)) return PROV_CAL_HOUR_H_MIN;
    const required = (PROV_CAL_BOOKING_MIN_H * 60) / minStartGap;
    return Math.min(PROV_CAL_HOUR_H_MAX, Math.max(PROV_CAL_HOUR_H_MIN, required));
  }

  /** Największe widoczne body kalendarza (demo ma 2 instancje — querySelector łapał ukrytą). */
  function resolveProvCalBody(preferred) {
    if (preferred && preferred.getAttribute && preferred.getAttribute("data-role") === "prov-cal-body") {
      return preferred;
    }
    if (preferred && preferred.closest) {
      const near = preferred.closest('[data-role="prov-cal-body"]');
      if (near) return near;
    }
    const bodies = document.querySelectorAll('[data-role="prov-cal-body"]');
    let best = null;
    let bestArea = 0;
    for (let i = 0; i < bodies.length; i++) {
      const r = bodies[i].getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) {
        bestArea = area;
        best = bodies[i];
      }
    }
    return best || bodies[0] || null;
  }

  /** Przelicz układ jednej osi czasu po zmianie wysokości godziny. */
  function layoutProvCalTimeline(timeline, hourH) {
    if (!timeline) return;
    const dayStartMin = PROV_CAL_HOUR_START * 60;
    const spanH = PROV_CAL_HOUR_END - PROV_CAL_HOUR_START;
    timeline.style.height = spanH * hourH + "px";
    timeline.style.setProperty("--gcal-hour-h", hourH + "px");

    timeline.querySelectorAll(".gcal__hour[data-hour]").forEach(function (el) {
      const hour = Number(el.getAttribute("data-hour"));
      if (isNaN(hour)) return;
      el.style.top = (hour - PROV_CAL_HOUR_START) * hourH + "px";
    });

    timeline.querySelectorAll(".gcal__event[data-from-min]").forEach(function (el) {
      const fromM = Number(el.getAttribute("data-from-min"));
      const toM = Number(el.getAttribute("data-to-min"));
      if (isNaN(fromM) || isNaN(toM) || toM <= fromM) return;
      const isFree = el.classList.contains("gcal__event--free");
      const isBare = el.classList.contains("gcal__event--bare");
      const top = ((fromM - dayStartMin) / 60) * hourH;
      const minH = isBare ? 6 : isFree ? 18 : 22;
      const height = Math.max(minH, ((toM - fromM) / 60) * hourH);
      el.style.top = top + "px";
      el.style.height = height + "px";
      applyEventDensity(el, height, isBare);
    });

    timeline.querySelectorAll(".gcal__avail[data-from-min]").forEach(function (el) {
      const fromM = Number(el.getAttribute("data-from-min"));
      const toM = Number(el.getAttribute("data-to-min"));
      if (isNaN(fromM) || isNaN(toM) || toM <= fromM) return;
      el.style.top = ((fromM - dayStartMin) / 60) * hourH + "px";
      el.style.height = Math.max(2, ((toM - fromM) / 60) * hourH) + "px";
    });

    timeline.querySelectorAll(".gcal__now[data-now-min]").forEach(function (nowEl) {
      const nowMin = Number(nowEl.getAttribute("data-now-min"));
      if (!isNaN(nowMin)) nowEl.style.top = ((nowMin - dayStartMin) / 60) * hourH + "px";
    });
  }

  /**
   * Płynny zoom osi (wysokość godziny) — jak Google Calendar Android:
   * pinch / Ctrl+scroll zmienia slotMinHeight, treść znika przy małym zoomie.
   * Aktualizuje WSZYSTKIE timeline (demo ma 2 instancje).
   */
  function applyProvCalZoom(nextH, opts) {
    opts = opts || {};
    const prevH = ensureProvCalHourH();
    // Dolny limit zoom-out: bloki wizyt stykają się, ale nie nachodzą.
    const dynMin = provCalNoOverlapMinHourH();
    const hourH = Math.max(dynMin, clampProvCalHourH(nextH));
    const body = resolveProvCalBody(opts.body || opts.target || null);
    const dayStartMin = PROV_CAL_HOUR_START * 60;
    const timelines = document.querySelectorAll('[data-role="prov-cal-timeline"]');

    let anchorMin = opts.anchorMin;
    if (anchorMin == null && body && prevH > 0) {
      anchorMin = dayStartMin + ((body.scrollTop + body.clientHeight * 0.35) / prevH) * 60;
    }

    window.AppState.provCalHourH = hourH;

    if (!timelines.length) {
      if (opts.persist) saveState();
      return hourH;
    }

    for (let i = 0; i < timelines.length; i++) {
      layoutProvCalTimeline(timelines[i], hourH);
    }

    if (body && typeof anchorMin === "number") {
      const yInBody = ((anchorMin - dayStartMin) / 60) * hourH;
      if (typeof opts.anchorClientY === "number") {
        const bodyRect = body.getBoundingClientRect();
        body.scrollTop = Math.max(0, yInBody - (opts.anchorClientY - bodyRect.top));
      } else {
        body.scrollTop = Math.max(0, yInBody - body.clientHeight * 0.35);
      }
    }

    if (opts.persist) saveState();
    return hourH;
  }

  const PROV_CAL_DOW_SHORT = ["ND.", "PN.", "WT.", "ŚR.", "CZ.", "PT.", "SB."];

  /** Liczba widoku na badge / w menu: 1–7 (bez snapowania do 1/3/7). */
  function snapProvCalViewBadge(days) {
    return clampProvCalVisibleDays(days);
  }

  function provCalViewBadgeLabel(days) {
    const n = snapProvCalViewBadge(days);
    if (n === 1) return "Widok: 1 dzień";
    return "Widok: " + n + " dni";
  }

  const PROV_CAL_VIEW_OPTIONS = [
    { days: 1, label: "1 dzień" },
    { days: 2, label: "2 dni" },
    { days: 3, label: "3 dni" },
    { days: 4, label: "4 dni" },
    { days: 5, label: "5 dni" },
    { days: 6, label: "6 dni" },
    { days: 7, label: "7 dni" },
  ];

  /** Ikona kalendarza z cyfrą — ta sama co w rogu widoku dnia/tygodnia. */
  function renderProvCalViewBadge(num) {
    return `
      <span class="gcal-week__view-badge" aria-hidden="true">
        <svg class="gcal-week__view-badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span class="gcal-week__view-badge-num">${escapeHtml(String(num))}</span>
      </span>`;
  }

  function ensureProvCalViewCloud() {
    let el = document.getElementById("prov-cal-view-cloud");
    if (el) return el;
    el = document.createElement("div");
    el.id = "prov-cal-view-cloud";
    el.className = "prov-cal-view-cloud";
    el.setAttribute("data-role", "prov-cal-view-cloud");
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", "Widok kalendarza");
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closeProvCalViewCloud() {
    const cloud = document.getElementById("prov-cal-view-cloud");
    if (cloud) {
      cloud.hidden = true;
      cloud.innerHTML = "";
      cloud.style.visibility = "";
    }
    document.querySelectorAll('.gcal-week__corner[aria-expanded="true"]').forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function openProvCalViewCloud(trigger) {
    if (!trigger) return;
    const cloud = ensureProvCalViewCloud();
    if (!cloud.hidden) {
      closeProvCalViewCloud();
      return;
    }

    const current = snapProvCalViewBadge(ensureProvCalVisibleDays());
    cloud.innerHTML = PROV_CAL_VIEW_OPTIONS.map(function (opt) {
      const on = opt.days === current;
      return `
        <button type="button" class="prov-cal-view-cloud__item${on ? " is-on" : ""}"
          role="menuitemradio" aria-checked="${on ? "true" : "false"}"
          data-action="prov-cal-set-view" data-days="${opt.days}">
          ${renderProvCalViewBadge(opt.days)}
          <span class="prov-cal-view-cloud__label">${escapeHtml(opt.label)}</span>
        </button>`;
    }).join("");

    cloud.hidden = false;
    cloud.style.visibility = "hidden";
    const rect = trigger.getBoundingClientRect();
    const cloudRect = cloud.getBoundingClientRect();
    const gap = 8;
    let top = rect.bottom + gap;
    let left = rect.left;
    if (left + cloudRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - cloudRect.width - 8);
    }
    if (left < 8) left = 8;
    if (top + cloudRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - cloudRect.height - gap);
    }
    cloud.style.top = top + "px";
    cloud.style.left = left + "px";
    cloud.style.visibility = "visible";
    trigger.setAttribute("aria-expanded", "true");
  }

  /** Przycisk widoku 1–7 — stała pozycja w .prov-cal-top (nad panelem miesiąca). */
  function renderProvCalViewCornerBtn() {
    const days = ensureProvCalVisibleDays();
    const badge = String(snapProvCalViewBadge(days));
    return `
      <button type="button" class="gcal-week__corner prov-cal-view-corner" data-action="prov-cal-view-menu"
        aria-label="${escapeHtml(provCalViewBadgeLabel(days))}"
        aria-haspopup="menu" aria-expanded="false">
        ${renderProvCalViewBadge(badge)}
      </button>`;
  }

  /**
   * Sticky nagłówki dni — zawsze w DOM.
   * Ikona widoku jest w .prov-cal-top (nie tu), tu tylko spacer o tej samej szerokości.
   */
  function renderProvCalStickyDayHeads(daysHtml) {
    const underMonth = !!window.AppState.provCalMonthOpen;
    return `
      <div class="gcal-week__sticky${underMonth ? " gcal-week__sticky--under-month" : ""}"${
        underMonth ? ' aria-hidden="true"' : ""
      }>
        <div class="gcal-week__head">
          <div class="gcal-week__corner gcal-week__corner--spacer" aria-hidden="true"></div>
          <div class="gcal-week__days-clip" data-role="prov-cal-heads-clip">
            <div class="gcal-week__days" data-role="prov-cal-heads-track">${daysHtml}</div>
          </div>
        </div>
      </div>`;
  }

  /** Nagłówek dnia w stylu tygodnia (integralna część .gcal). */
  function renderProvCalDayHeadButton(dateISO, selectedISO) {
    const d = new Date(dateISO + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    const isToday = dateISO === demoTodayISO();
    const isSel = dateISO === selectedISO;
    const sun = d.getDay() === 0;
    const requestDays = replyRequestDaySet();
    const isRequestDay = !!(requestDays && requestDays.has(dateISO));
    const dimOther = !!(requestDays && !window.AppState.provCalReplyShowAll && !isRequestDay);
    return `
      <button type="button" class="gcal-week__dayhead${isToday ? " gcal-week__dayhead--today" : ""}${
        isSel ? " gcal-week__dayhead--sel" : ""
      }${sun ? " gcal-week__dayhead--sun" : ""}${isRequestDay ? " gcal-week__dayhead--request" : ""}${
        dimOther ? " gcal-week__dayhead--dim" : ""
      }"
        data-action="prov-cal-pick-date" data-date="${escapeHtml(dateISO)}"
        aria-label="${escapeHtml(PROV_CAL_DOW_SHORT[d.getDay()] + " " + d.getDate())}${
          isRequestDay ? ", dzień z zapytania" : ""
        }">
        <span class="gcal-week__dow">${PROV_CAL_DOW_SHORT[d.getDay()]}</span>
        <span class="gcal-week__num">${d.getDate()}</span>
      </button>`;
  }

  function renderProvCalMonthPanel(selectedISO, visits) {
    if (!window.AppState.provCalMonthOpen) return "";
    const pickerMonth = ensureProvCalPickerMonth();
    const parts = pickerMonth.split("-");
    const year = Number(parts[0]) || 2026;
    const month = Number(parts[1]) || 1;
    const today = demoTodayISO();
    const visitDays = new Set(
      (visits || []).map(function (b) {
        return b.dateISO;
      })
    );

    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;
    const totalCells = 42;
    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="gcal-month__day gcal-month__day--pad" aria-hidden="true"></span>`;
    }
    const requestDays = replyRequestDaySet();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = year + "-" + pad(month) + "-" + pad(day);
      const selected = dateISO === selectedISO;
      const isToday = dateISO === today;
      const hasVisit = visitDays.has(dateISO);
      const red = isSunday(dateISO) || isRedCalendarDay(dateISO);
      const isRequestDay = !!(requestDays && requestDays.has(dateISO));
      const dimOther = !!(requestDays && !window.AppState.provCalReplyShowAll && !isRequestDay);
      cells += `
        <button type="button"
          class="gcal-month__day${selected ? " gcal-month__day--on" : ""}${isToday ? " gcal-month__day--today" : ""}${hasVisit ? " gcal-month__day--busy" : ""}${red ? " gcal-month__day--red" : ""}${isRequestDay ? " gcal-month__day--request" : ""}${dimOther ? " gcal-month__day--dim" : ""}"
          data-action="prov-cal-pick-date" data-date="${escapeHtml(dateISO)}"
          aria-pressed="${selected ? "true" : "false"}"
          aria-label="${day}${hasVisit ? ", wizyty" : ""}${isRequestDay ? ", zapytanie" : ""}">
          <span class="gcal-month__day-num">${day}</span>
          ${hasVisit ? `<span class="gcal-month__day-dot" aria-hidden="true"></span>` : ""}
        </button>`;
    }
    const filled = startPad + daysInMonth;
    for (let i = filled; i < totalCells; i++) {
      cells += `<span class="gcal-month__day gcal-month__day--pad" aria-hidden="true"></span>`;
    }

    const reveal = !!window._provCalMonthAnimateReveal;
    return `
      <div class="gcal-month${reveal ? "" : " gcal-month--instant"}" id="prov-cal-month-panel" data-role="prov-cal-month-panel">
        <div class="gcal-month__cal" data-role="prov-cal-month-swipe">
          <div class="gcal-month__weekdays">${CAL_WEEKDAYS.map(function (w) {
            return `<span>${w}</span>`;
          }).join("")}</div>
          <div class="gcal-month__grid">${cells}</div>
        </div>
      </div>`;
  }

  function providerAvailBlocksForDate(dateISO) {
    const p = myProvider();
    if (!p || !dateISO) return [];
    const day = (p.availability || []).find(function (d) {
      return d.dateISO === dateISO;
    });
    return (day && day.blocks) || [];
  }

  /**
   * Blok dostępności pokrywający zakres wizyty — preferuj ten ze środkiem wizyty,
   * potem największe nachodzenie (kolor lokalizacji dla kafła).
   */
  function resolveAvailBlockForRange(dateISO, fromMin, toMin) {
    const blocks = providerAvailBlocksForDate(dateISO);
    if (!blocks.length || !(toMin > fromMin)) return null;
    const mid = (fromMin + toMin) / 2;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const f = timeToMinutes(block.from);
      const t = timeToMinutes(block.to);
      if (!(t > f)) continue;
      const overlap = Math.max(0, Math.min(toMin, t) - Math.max(fromMin, f));
      const containsMid = mid >= f && mid < t;
      if (overlap <= 0 && !containsMid) continue;
      let score = overlap;
      if (containsMid) score += 10000;
      if (fromMin >= f && fromMin < t) score += 100;
      if (score > bestScore) {
        bestScore = score;
        best = block;
      }
    }
    return best;
  }

  function clearProvCalLocToneClasses(el) {
    if (!el || !el.classList) return;
    for (let i = 0; i < 6; i++) el.classList.remove("loc-tone-" + i);
  }

  /** Ustaw klasę loc-tone-* na kafelku wizyty wg dostępności pod danym zakresem. */
  function applyProvCalEventAvailTone(el, dateISO, fromMin, toMin) {
    if (!el) return null;
    const block = resolveAvailBlockForRange(dateISO, fromMin, toMin);
    const p = myProvider();
    clearProvCalLocToneClasses(el);
    if (block && block.locationId) {
      el.classList.add(locationToneClass(p, block.locationId));
      el.setAttribute("data-location-id", String(block.locationId));
    } else {
      el.removeAttribute("data-location-id");
    }
    return block;
  }

  function mergeTimeIntervals(intervals) {
    if (!intervals.length) return [];
    const sorted = intervals.slice().sort(function (a, b) {
      return a.from - b.from;
    });
    const out = [{ from: sorted[0].from, to: sorted[0].to }];
    for (let i = 1; i < sorted.length; i++) {
      const last = out[out.length - 1];
      const cur = sorted[i];
      if (cur.from <= last.to) last.to = Math.max(last.to, cur.to);
      else out.push({ from: cur.from, to: cur.to });
    }
    return out;
  }

  /** Pionowe paski zdefiniowanej dostępności dnia (lewy gutter osi) — kolor = lokalizacja bloku. */
  function renderProvCalAvailBars(dateISO, hourH, dayStartMin, dayEndMin) {
    const p = myProvider();
    return providerAvailBlocksForDate(dateISO)
      .map(function (block) {
        const f = timeToMinutes(block.from);
        const t = timeToMinutes(block.to);
        if (isNaN(f) || isNaN(t) || t <= f) return "";
        const from = Math.max(dayStartMin, Math.min(dayEndMin, f));
        const to = Math.max(dayStartMin, Math.min(dayEndMin, t));
        if (to <= from) return "";
        const top = ((from - dayStartMin) / 60) * hourH;
        const height = Math.max(2, ((to - from) / 60) * hourH);
        const tone = locationToneClass(p, block.locationId);
        const locAttr = block.locationId ? ` data-location-id="${escapeHtml(String(block.locationId))}"` : "";
        return `<div class="gcal__avail ${tone}" style="top:${top}px;height:${height}px" data-from-min="${from}" data-to-min="${to}"${locAttr} aria-hidden="true"></div>`;
      })
      .join("");
  }

  /**
   * Widok 1–7 dni (Google Calendar):
   * — oś godzin stała (poza torem swipe),
   * — nagłówki + kolumny dni w osobnych clipach (przesuwane poziomo).
   */
  function renderProvCalGoogleWeek(selectedISO, visits) {
    const dayCount = ensureProvCalVisibleDays();
    const weekDays = provCalVisibleDayList(selectedISO, dayCount);
    const hourH = ensureProvCalHourH();
    const totalH = (PROV_CAL_HOUR_END - PROV_CAL_HOUR_START) * hourH;

    const headCols = weekDays
      .map(function (dateISO) {
        return renderProvCalDayHeadButton(dateISO, selectedISO);
      })
      .join("");

    const cols = weekDays
      .map(function (dateISO) {
        return renderProvCalDayColumnHtml(dateISO, visits);
      })
      .join("");

    return `
      <div class="gcal gcal--week" data-role="prov-cal-gcal" data-prov-cal-day-swipe style="--gcal-days:${weekDays.length}">
        ${renderProvCalStickyDayHeads(headCols)}
        <div class="gcal__timeline gcal-week__timeline" style="height:${totalH}px;--gcal-hour-h:${hourH}px" data-role="prov-cal-timeline">
          ${renderProvCalHoursHtml(hourH)}
          <div class="gcal-week__cols-clip" data-role="prov-cal-cols-clip">
            <div class="gcal-week__cols" data-role="prov-cal-cols-track">${cols}</div>
          </div>
        </div>
      </div>`;
  }

  /** Bloki czasu w panelu „Nowy termin” — usługa „Inne”, bez ceny z oferty. */
  const PROV_CAL_ADD_INNE_NAME = "Inne";
  const PROV_CAL_ADD_DURATION_OPTS = [
    { id: "dur-15", name: PROV_CAL_ADD_INNE_NAME, durationMin: 15, price: null, isDuration: true },
    { id: "dur-30", name: PROV_CAL_ADD_INNE_NAME, durationMin: 30, price: null, isDuration: true },
    { id: "dur-60", name: PROV_CAL_ADD_INNE_NAME, durationMin: 60, price: null, isDuration: true },
    { id: "dur-120", name: PROV_CAL_ADD_INNE_NAME, durationMin: 120, price: null, isDuration: true },
  ];
  const PROV_CAL_ADD_DEFAULT_DURATION_ID = "dur-30";

  function isProvCalAddDurationId(id) {
    return String(id || "").indexOf("dur-") === 0;
  }

  function durationServiceForMinutes(min) {
    const n = Math.max(5, Math.round(Number(min) || 30));
    const exact = PROV_CAL_ADD_DURATION_OPTS.find(function (d) {
      return d.durationMin === n;
    });
    if (exact) return exact;
    return {
      id: "dur-" + n,
      name: PROV_CAL_ADD_INNE_NAME,
      durationMin: n,
      price: null,
      isDuration: true,
    };
  }

  function resolveProvCalAddService(p, id) {
    if (!id) return null;
    if (isProvCalAddDurationId(id)) {
      const known = PROV_CAL_ADD_DURATION_OPTS.find(function (d) {
        return d.id === id;
      });
      if (known) return known;
      const m = /^dur-(\d+)$/.exec(String(id));
      if (m) return durationServiceForMinutes(Number(m[1]));
      return null;
    }
    return ((p && p.services) || []).find(function (s) {
      return s.id === id;
    }) || null;
  }

  function defaultProvCalAddDraft() {
    return {
      bookingId: null,
      requestId: null,
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      clientAddress: "",
      serviceIds: [PROV_CAL_ADD_DEFAULT_DURATION_ID],
      dateISO: ensureProvCalDate(),
      slotId: null,
      /** Robocza lista propozycji w trybie odpowiedzi na zapytanie. */
      proposals: [],
      /** Rozwinięta lista wybranych propozycji w panelu odpowiedzi. */
      proposalsOpen: false,
      servicePickOpen: false,
      clientPickOpen: false,
      /** Rozwinięte pola: telefon / e-mail / adres. */
      clientDetailsOpen: false,
      /** W sheetcie kontaktów: rozwinięte pola nowego kontaktu. */
      clientSheetNewExpanded: false,
      clientSheetNewPhone: "",
      clientSheetNewEmail: "",
      /** Panel szczegółów kontaktu (wysuwany z prawej) — imię klienta lub "". */
      clientSheetDetailName: "",
      /** Osobne wyszukiwanie w sheetcie (tryb Prośby nie nadpisuje wybranego klienta). */
      clientSheetSearchQ: "",
      expandedServiceIds: [],
    };
  }

  function ensureProvCalAddDraft() {
    const cur = window.AppState.provCalAddDraft;
    if (cur && typeof cur === "object") {
      if (!cur.dateISO) cur.dateISO = ensureProvCalDate();
      if (!Array.isArray(cur.serviceIds)) {
        cur.serviceIds = cur.serviceId ? [cur.serviceId] : [];
      }
      if (!Array.isArray(cur.proposals)) cur.proposals = [];
      if (typeof cur.proposalsOpen !== "boolean") cur.proposalsOpen = false;
      if (cur.requestId == null) cur.requestId = null;
      if (typeof cur.servicePickOpen !== "boolean") cur.servicePickOpen = false;
      if (typeof cur.clientPickOpen !== "boolean") cur.clientPickOpen = false;
      if (typeof cur.clientDetailsOpen !== "boolean") cur.clientDetailsOpen = false;
      if (typeof cur.clientSheetNewExpanded !== "boolean") cur.clientSheetNewExpanded = false;
      if (typeof cur.clientSheetNewPhone !== "string") cur.clientSheetNewPhone = "";
      if (typeof cur.clientSheetNewEmail !== "string") cur.clientSheetNewEmail = "";
      if (typeof cur.clientSheetDetailName !== "string") cur.clientSheetDetailName = "";
      if (typeof cur.clientSheetSearchQ !== "string") cur.clientSheetSearchQ = "";
      if (cur.bookingId == null) cur.bookingId = null;
      if (typeof cur.clientPhone !== "string") cur.clientPhone = "";
      if (typeof cur.clientEmail !== "string") cur.clientEmail = "";
      if (typeof cur.clientAddress !== "string") cur.clientAddress = "";
      return cur;
    }
    window.AppState.provCalAddDraft = defaultProvCalAddDraft();
    return window.AppState.provCalAddDraft;
  }

  function replyRequestId() {
    return (
      window.AppState.provCalReplyRequestId ||
      (window.AppState.provCalAddDraft && window.AppState.provCalAddDraft.requestId) ||
      null
    );
  }

  function replyRequest() {
    const id = replyRequestId();
    if (!id) return null;
    return (window.AppState.requests || []).find(function (r) {
      return r && r.id === id;
    }) || null;
  }

  function replyRequestDays() {
    const req = replyRequest();
    return req ? normalizeRequestDays(req.days) : [];
  }

  function replyRequestDaySet() {
    const days = replyRequestDays();
    if (!days.length) return null;
    return new Set(
      days.map(function (d) {
        return d.dateISO;
      })
    );
  }

  function replyDayPartForDate(dateISO) {
    const day = replyRequestDays().find(function (d) {
      return d.dateISO === dateISO;
    });
    return day ? normalizeDayPart(day.part) : "any";
  }

  function clearProvCalReplyMode() {
    window.AppState.provCalReplyRequestId = null;
    window.AppState.provCalReplyShowAll = false;
  }

  function provCalAddSlotIdForBooking(booking) {
    if (!booking || !booking.dateISO || !booking.from) return null;
    return "slot-" + booking.dateISO + "-" + timeToMin(booking.from);
  }

  function serviceIdsFromBooking(booking) {
    const ids = ((booking && booking.serviceIds) || []).filter(Boolean);
    if (ids.length) return ids.slice();
    const from = timeToMin((booking && booking.from) || "00:00");
    const to = timeToMin((booking && booking.to) || "00:00");
    const dur = Math.max(0, to - from);
    if (dur > 0) return [durationServiceForMinutes(dur).id];
    return [PROV_CAL_ADD_DEFAULT_DURATION_ID];
  }

  function ensureProviderClientsList(providerId) {
    if (!providerId) return [];
    if (!window.AppState.providerClients || typeof window.AppState.providerClients !== "object") {
      window.AppState.providerClients = {};
    }
    if (!Array.isArray(window.AppState.providerClients[providerId])) {
      window.AppState.providerClients[providerId] = [];
    }
    return window.AppState.providerClients[providerId];
  }

  /** Zakładka / tryb odpowiedzi: kontakty = tylko osoby z prośbą o termin. */
  function isProvCalAddRequestsContactsMode() {
    if (!window.AppState.provCalAddOpen) return false;
    if (replyRequestId()) return true;
    return window.AppState.provCalAddTab === "requests";
  }

  /** Klienci z otwartymi prośbami (pending / proposed) — do listy kontaktów w zakładce Prośby. */
  function collectProviderRequestClients(providerId) {
    const seen = Object.create(null);
    const list = [];
    (window.AppState.requests || []).forEach(function (r) {
      if (!r || r.providerId !== providerId) return;
      if (r.status !== "pending" && r.status !== "proposed") return;
      const n = String(r.clientName || "").trim();
      if (!n) return;
      const key = n.toLocaleLowerCase("pl");
      if (seen[key]) {
        // Preferuj nowszą / pending nad proposed przy duplikacie imienia.
        if (seen[key].requestStatus === "pending" || r.status !== "pending") return;
      }
      const saved = findCollectedProviderClientByName(providerId, n);
      const entry = {
        id: r.id,
        name: n,
        phone: String(r.clientPhone || (saved && saved.phone) || "").trim(),
        email: String(r.clientEmail || (saved && saved.email) || "").trim(),
        address: String(r.clientAddress || (saved && saved.address) || "").trim(),
        requestId: r.id,
        requestStatus: r.status,
        serviceLabel: (r.serviceNames || []).filter(Boolean).join(", "),
      };
      if (seen[key]) {
        const idx = list.indexOf(seen[key]);
        if (idx !== -1) list.splice(idx, 1);
      }
      seen[key] = entry;
      list.push(entry);
    });
    list.sort(function (a, b) {
      return a.name.localeCompare(b.name, "pl", { sensitivity: "base" });
    });
    return list;
  }

  function findOpenRequestForClientName(providerId, name) {
    const key = String(name || "").trim().toLocaleLowerCase("pl");
    if (!key) return null;
    const open = (window.AppState.requests || []).filter(function (r) {
      return (
        r &&
        r.providerId === providerId &&
        (r.status === "pending" || r.status === "proposed") &&
        String(r.clientName || "").trim().toLocaleLowerCase("pl") === key
      );
    });
    if (!open.length) return null;
    open.sort(function (a, b) {
      if (a.status === b.status) return 0;
      return a.status === "pending" ? -1 : 1;
    });
    return open[0];
  }

  /** Unikalni klienci usługodawcy (zapisani + z wizyt/próśb). */
  function collectProviderClients(providerId) {
    const seen = Object.create(null);
    const list = [];
    function add(entry) {
      const n = String((entry && entry.name) || "").trim();
      if (!n) return;
      const key = n.toLowerCase();
      if (seen[key]) {
        const prev = seen[key];
        if (!prev.phone && entry.phone) prev.phone = String(entry.phone || "").trim();
        if (!prev.email && entry.email) prev.email = String(entry.email || "").trim();
        if (!prev.address && entry.address) prev.address = String(entry.address || "").trim();
        return;
      }
      const client = {
        id: (entry && entry.id) || "cli-virt-" + key.replace(/\s+/g, "-"),
        name: n,
        phone: String((entry && entry.phone) || "").trim(),
        email: String((entry && entry.email) || "").trim(),
        address: String((entry && entry.address) || "").trim(),
      };
      seen[key] = client;
      list.push(client);
    }
    ensureProviderClientsList(providerId).forEach(add);
    (window.AppState.bookings || []).forEach(function (b) {
      if (!b || b.providerId !== providerId) return;
      add({
        name: b.clientName,
        phone: b.clientPhone,
        email: b.clientEmail,
        address: b.clientAddress,
      });
    });
    (window.AppState.requests || []).forEach(function (r) {
      if (!r || r.providerId !== providerId) return;
      add({
        name: r.clientName,
        phone: r.clientPhone,
        email: r.clientEmail,
        address: r.clientAddress,
      });
    });
    list.sort(function (a, b) {
      return a.name.localeCompare(b.name, "pl", { sensitivity: "base" });
    });
    return list;
  }

  /** Unikalne imiona klientów, którzy już byli u usługodawcy (+ ręcznie dodani). */
  function clientContactInitials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function clientContactLetter(name) {
    const ch = String(name || "")
      .trim()
      .charAt(0)
      .toLocaleUpperCase("pl-PL");
    if (!ch) return "#";
    if (/[A-ZĄĆĘŁŃÓŚŹŻ]/i.test(ch)) return ch;
    return "#";
  }

  const CLIENT_SHEET_LETTERS = "AĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ#".split("");

  function findProviderClientByName(providerId, name) {
    const key = String(name || "")
      .trim()
      .toLowerCase();
    if (!providerId || !key) return null;
    return (
      ensureProviderClientsList(providerId).find(function (c) {
        return (
          String((c && c.name) || "")
            .trim()
            .toLowerCase() === key
        );
      }) || null
    );
  }

  /** Klient z listy kontaktów (zapisani + wizyty/prośby), ze scalanymi danymi kontaktowymi. */
  function findCollectedProviderClientByName(providerId, name) {
    const key = String(name || "")
      .trim()
      .toLowerCase();
    if (!providerId || !key) return null;
    return (
      collectProviderClients(providerId).find(function (c) {
        return (
          String((c && c.name) || "")
            .trim()
            .toLowerCase() === key
        );
      }) || null
    );
  }

  /** Upsert klienta: imię + opcjonalnie telefon / e-mail / adres. */
  function upsertProviderClient(providerId, data) {
    const n = String((data && data.name) || "").trim();
    if (!providerId || !n) return null;
    const list = ensureProviderClientsList(providerId);
    let client = findProviderClientByName(providerId, n);
    if (!client) {
      client = {
        id: "cli-" + Date.now(),
        name: n,
        phone: "",
        email: "",
        address: "",
      };
      list.push(client);
    } else {
      client.name = n;
    }
    if (data && Object.prototype.hasOwnProperty.call(data, "phone")) {
      client.phone = String(data.phone || "").trim();
    } else if (typeof client.phone !== "string") {
      client.phone = "";
    }
    if (data && Object.prototype.hasOwnProperty.call(data, "email")) {
      client.email = String(data.email || "").trim();
    } else if (typeof client.email !== "string") {
      client.email = "";
    }
    if (data && Object.prototype.hasOwnProperty.call(data, "address")) {
      client.address = String(data.address || "").trim();
    } else if (typeof client.address !== "string") {
      client.address = "";
    }
    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.upsertClient(providerId, client);
    }
    return client;
  }

  function applyClientContactsToDraft(draft, source) {
    if (!draft) return;
    const src = source || {};
    draft.clientPhone = String(src.phone || src.clientPhone || "").trim();
    draft.clientEmail = String(src.email || src.clientEmail || "").trim();
    draft.clientAddress = String(src.address || src.clientAddress || "").trim();
  }

  function syncProvCalAddClientContactInputs(draft) {
    if (!draft) return;
    const phone = document.querySelector('[data-role="prov-cal-add-phone"]');
    const email = document.querySelector('[data-role="prov-cal-add-email"]');
    if (phone) phone.value = draft.clientPhone || "";
    if (email) email.value = draft.clientEmail || "";
  }

  function captureClientSheetNewDetails() {
    const draft = window.AppState.provCalAddDraft;
    if (!draft) return;
    const phone = document.querySelector('[data-role="client-sheet-new-phone"]');
    const email = document.querySelector('[data-role="client-sheet-new-email"]');
    if (phone) draft.clientSheetNewPhone = String(phone.value || "");
    if (email) draft.clientSheetNewEmail = String(email.value || "");
  }

  function renderClientSheetContactRowHtml(c, opts) {
    opts = opts || {};
    const requestsMode = !!opts.requestsMode;
    const selected = !!opts.selected;
    const sub = requestsMode
      ? c.serviceLabel || (c.requestStatus === "proposed" ? "Wysłano propozycje" : "Nowa prośba")
      : c.phone || c.email || "";
    const reqAttr = c.requestId ? ` data-request-id="${escapeHtml(c.requestId)}"` : "";
    return `
      <div class="client-sheet__row${selected ? " client-sheet__row--selected" : ""}" role="option"${
        selected ? ' aria-selected="true"' : ""
      }>
        <button type="button" class="client-sheet__row-main"
          data-action="prov-cal-add-pick-client" data-name="${escapeHtml(c.name)}"${reqAttr}>
          <span class="client-sheet__avatar" aria-hidden="true">${escapeHtml(clientContactInitials(c.name))}</span>
          <span class="client-sheet__meta">
            <span class="client-sheet__name">${escapeHtml(c.name)}</span>
            ${sub ? `<span class="client-sheet__sub">${escapeHtml(sub)}</span>` : ""}
          </span>
        </button>
        <button type="button" class="client-sheet__row-detail"
          data-action="open-client-sheet-detail" data-name="${escapeHtml(c.name)}"
          aria-label="Szczegóły kontaktu ${escapeHtml(c.name)}">
          <span class="client-sheet__row-detail-icon" aria-hidden="true"></span>
        </button>
      </div>`;
  }

  function clientSheetListQuery(draft) {
    if (isProvCalAddRequestsContactsMode()) {
      return String((draft && draft.clientSheetSearchQ) || "").trim();
    }
    return String((draft && draft.clientName) || "").trim();
  }

  function renderProvCalAddClientListParts(providerId, query) {
    const draft = window.AppState.provCalAddDraft;
    const requestsMode = isProvCalAddRequestsContactsMode();
    const raw = query != null ? String(query || "").trim() : clientSheetListQuery(draft);
    const q = raw.toLocaleLowerCase("pl");
    const clients = requestsMode
      ? collectProviderRequestClients(providerId)
      : collectProviderClients(providerId);
    const filtered = q
      ? clients.filter(function (c) {
          const hay = (
            c.name +
            " " +
            (c.phone || "") +
            " " +
            (c.email || "") +
            " " +
            (c.serviceLabel || "")
          ).toLocaleLowerCase("pl");
          return hay.indexOf(q) !== -1;
        })
      : clients;
    const exact = !!q && clients.some(function (c) {
      return c.name.toLocaleLowerCase("pl") === q;
    });

    const selectedKey = String(
      (draft && draft.clientName) ||
        (replyRequest() && replyRequest().clientName) ||
        ""
    )
      .trim()
      .toLocaleLowerCase("pl");
    let selectedClient = null;
    if (requestsMode && selectedKey) {
      selectedClient =
        filtered.find(function (c) {
          return c.name.toLocaleLowerCase("pl") === selectedKey;
        }) ||
        clients.find(function (c) {
          return c.name.toLocaleLowerCase("pl") === selectedKey;
        }) ||
        null;
    }
    const others = requestsMode
      ? filtered.filter(function (c) {
          return !selectedClient || c.name.toLocaleLowerCase("pl") !== selectedKey;
        })
      : filtered;

    const byLetter = Object.create(null);
    others.forEach(function (c) {
      const letter = clientContactLetter(c.name);
      if (!byLetter[letter]) byLetter[letter] = [];
      byLetter[letter].push(c);
    });
    const activeLetters = CLIENT_SHEET_LETTERS.filter(function (L) {
      return byLetter[L] && byLetter[L].length;
    });

    let pinnedHtml = "";
    if (requestsMode && selectedClient) {
      pinnedHtml = `
        <div class="client-sheet__pinned" data-role="client-sheet-pinned">
          <h4 class="client-sheet__list-label">Wybrany kontakt</h4>
          ${renderClientSheetContactRowHtml(selectedClient, { requestsMode: true, selected: true })}
          <div class="client-sheet__sep" role="separator" aria-hidden="true"></div>
          ${
            others.length || q
              ? `<h4 class="client-sheet__list-label">Czekają na potwierdzenie</h4>`
              : ""
          }
        </div>`;
    }

    let listHtml = "";
    if (raw && !exact && !requestsMode) {
      const expanded = !!(draft && draft.clientSheetNewExpanded);
      const newPhone = draft ? String(draft.clientSheetNewPhone || "") : "";
      const newEmail = draft ? String(draft.clientSheetNewEmail || "") : "";
      listHtml += `
        <div class="client-sheet__add${expanded ? " is-expanded" : ""}" data-role="client-sheet-add">
          <div class="client-sheet__row client-sheet__row--add">
            <button type="button" class="client-sheet__add-main" role="option"
              data-action="prov-cal-add-new-client" data-name="${escapeHtml(raw)}">
              <span class="client-sheet__avatar client-sheet__avatar--add" aria-hidden="true">+</span>
              <span class="client-sheet__meta">
                <span class="client-sheet__name">Dodaj „${escapeHtml(raw)}”</span>
                <span class="client-sheet__sub">Nowy kontakt</span>
              </span>
            </button>
            <button type="button" class="client-sheet__add-expand${expanded ? " is-open" : ""}"
              data-action="toggle-client-sheet-new-details"
              aria-expanded="${expanded ? "true" : "false"}"
              aria-controls="client-sheet-add-details"
              aria-label="${expanded ? "Ukryj dane kontaktu" : "Dodaj telefon i e-mail"}">
              <span class="client-sheet__add-expand-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="client-sheet__add-details" id="client-sheet-add-details" data-role="client-sheet-add-details"${expanded ? "" : " hidden"}>
            <label class="client-sheet__add-field">
              <span class="client-sheet__add-field-label">Telefon</span>
              <input type="tel" class="client-sheet__add-input" data-role="client-sheet-new-phone"
                value="${escapeHtml(newPhone)}" placeholder="Nr telefonu" autocomplete="tel" inputmode="tel" />
            </label>
            <label class="client-sheet__add-field">
              <span class="client-sheet__add-field-label">E-mail</span>
              <input type="email" class="client-sheet__add-input" data-role="client-sheet-new-email"
                value="${escapeHtml(newEmail)}" placeholder="Adres e-mail" autocomplete="email" inputmode="email" />
            </label>
          </div>
        </div>`;
    } else if (draft) {
      draft.clientSheetNewExpanded = false;
    }

    if (requestsMode) {
      if (!others.length && !selectedClient) {
        listHtml = `<p class="empty-note client-sheet__empty">Brak osób proszących o termin.</p>`;
      } else if (!others.length && selectedClient && !q) {
        listHtml = `<p class="empty-note client-sheet__empty">Brak innych próśb.</p>`;
      } else {
        others.forEach(function (c) {
          listHtml += renderClientSheetContactRowHtml(c, { requestsMode: true, selected: false });
        });
      }
    } else {
      activeLetters.forEach(function (letter) {
        listHtml += `<div class="client-sheet__section" data-letter="${escapeHtml(letter)}">
          <div class="client-sheet__letter" aria-hidden="true">${escapeHtml(letter)}</div>`;
        byLetter[letter].forEach(function (c) {
          listHtml += renderClientSheetContactRowHtml(c, { requestsMode: false, selected: false });
        });
        listHtml += `</div>`;
      });
      if (!listHtml) {
        listHtml = `<p class="empty-note client-sheet__empty">Brak kontaktów. Wpisz imię, żeby dodać nowego klienta.</p>`;
      }
    }

    const indexHtml = requestsMode
      ? ""
      : CLIENT_SHEET_LETTERS.map(function (letter) {
          const on = !!byLetter[letter];
          return `<button type="button" class="client-sheet__index-btn${on ? " is-on" : ""}"
        data-action="client-sheet-jump" data-letter="${escapeHtml(letter)}"
        ${on ? "" : " disabled tabindex=\"-1\""}
        aria-label="Przejdź do ${escapeHtml(letter)}">${escapeHtml(letter === "#" ? "#" : letter)}</button>`;
        }).join("");

    return {
      raw: raw,
      pinnedHtml: pinnedHtml,
      listHtml: listHtml,
      indexHtml: indexHtml,
      requestsMode: requestsMode,
    };
  }

  function collectClientPastVisits(providerId, clientName) {
    const key = String(clientName || "")
      .trim()
      .toLocaleLowerCase("pl");
    if (!providerId || !key) return [];
    const today = demoTodayISO();
    return (window.AppState.bookings || [])
      .filter(function (b) {
        if (!b || b.providerId !== providerId) return false;
        if (String(b.clientName || "").trim().toLocaleLowerCase("pl") !== key) return false;
        if (b.status !== "confirmed") return false;
        if (!b.dateISO || b.dateISO > today) return false;
        return true;
      })
      .sort(function (a, b) {
        return (b.dateISO + (b.from || "")).localeCompare(a.dateISO + (a.from || ""));
      });
  }

  function resolveClientSheetContact(providerId, name) {
    const n = String(name || "").trim();
    if (!n) return null;
    const saved = findCollectedProviderClientByName(providerId, n);
    const fromReq = (window.AppState.requests || []).find(function (r) {
      return (
        r &&
        r.providerId === providerId &&
        String(r.clientName || "").trim().toLocaleLowerCase("pl") === n.toLocaleLowerCase("pl")
      );
    });
    return {
      name: n,
      phone: String((saved && saved.phone) || (fromReq && fromReq.clientPhone) || "").trim(),
      email: String((saved && saved.email) || (fromReq && fromReq.clientEmail) || "").trim(),
      address: String((saved && saved.address) || (fromReq && fromReq.clientAddress) || "").trim(),
    };
  }

  function renderClientSheetDetailHtml(providerId, name) {
    const contact = resolveClientSheetContact(providerId, name);
    if (!contact) return "";
    const visits = collectClientPastVisits(providerId, contact.name);
    const visitsHtml = visits.length
      ? `<ul class="client-sheet__visits">
          ${visits
            .map(function (b) {
              const when = escapeHtml(
                formatDayWithDow(b.dateISO) + (b.from ? " · " + b.from + (b.to ? "–" + b.to : "") : "")
              );
              const svc = escapeHtml((b.serviceNames || []).filter(Boolean).join(", ") || "Wizyta");
              return `<li class="client-sheet__visit">
                <span class="client-sheet__visit-when">${when}</span>
                <span class="client-sheet__visit-svc">${svc}</span>
              </li>`;
            })
            .join("")}
        </ul>`
      : `<p class="empty-note client-sheet__empty">Brak odbytych wizyt.</p>`;
    return `
      <div class="client-sheet__detail" data-role="client-sheet-detail" role="dialog" aria-modal="true" aria-label="Szczegóły kontaktu">
        <header class="client-sheet__detail-head">
          <button type="button" class="client-sheet__detail-back" data-action="close-client-sheet-detail" aria-label="Wróć do kontaktów">
            <span class="client-sheet__detail-back-icon" aria-hidden="true"></span>
          </button>
          <h3 class="client-sheet__detail-title">Kontakt</h3>
          <span class="client-sheet__detail-spacer" aria-hidden="true"></span>
        </header>
        <div class="client-sheet__detail-body">
          <div class="client-sheet__detail-card">
            <div class="client-sheet__detail-identity">
              <span class="client-sheet__avatar client-sheet__avatar--lg" aria-hidden="true">${escapeHtml(
                clientContactInitials(contact.name)
              )}</span>
              <span class="client-sheet__detail-name">${escapeHtml(contact.name)}</span>
            </div>
            <div class="client-sheet__detail-sep" role="separator" aria-hidden="true"></div>
            <div class="client-sheet__detail-fields">
              <div class="client-sheet__detail-field">
                <span class="client-sheet__detail-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.6.7A2 2 0 0 1 22 16.9z" />
                  </svg>
                </span>
                <span class="client-sheet__detail-line${contact.phone ? "" : " client-sheet__detail-line--muted"}">${escapeHtml(
                  contact.phone || "Brak telefonu"
                )}</span>
              </div>
              <div class="client-sheet__detail-field">
                <span class="client-sheet__detail-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                </span>
                <span class="client-sheet__detail-line${contact.email ? "" : " client-sheet__detail-line--muted"}">${escapeHtml(
                  contact.email || "Brak e-maila"
                )}</span>
              </div>
            </div>
          </div>
          <h4 class="client-sheet__detail-section">Odbyte wizyty</h4>
          ${visitsHtml}
        </div>
      </div>`;
  }

  function renderProvCalAddClientMenuHtml(providerId, query) {
    const draft = window.AppState.provCalAddDraft;
    const parts = renderProvCalAddClientListParts(providerId, query != null ? query : clientSheetListQuery(draft));
    const requestsMode = !!parts.requestsMode;
    const sheetTitle = requestsMode ? "Prośby o termin" : "Kontakty";
    const detailName = draft ? String(draft.clientSheetDetailName || "").trim() : "";
    const detailHtml = detailName ? renderClientSheetDetailHtml(providerId, detailName) : "";
    return `
      <button type="button" class="client-sheet__backdrop" data-action="close-prov-cal-add-client-pick" aria-label="Zamknij kontakty"></button>
      <div class="client-sheet__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(sheetTitle)}">
        <div class="client-sheet__grab" aria-hidden="true"></div>
        <header class="client-sheet__head">
          <h3 class="client-sheet__title">${escapeHtml(sheetTitle)}</h3>
          <button type="button" class="client-sheet__close" data-action="close-prov-cal-add-client-pick" aria-label="Zamknij">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="client-sheet__search">
          <span class="client-sheet__search-icon" aria-hidden="true"></span>
          <input type="search" class="client-sheet__search-input" data-role="prov-cal-add-client-sheet-search"
            value="${escapeHtml(parts.raw)}" placeholder="${requestsMode ? "Szukaj wśród próśb" : "Szukaj"}" autocomplete="off" spellcheck="false" />
        </div>
        <div class="client-sheet__body${requestsMode ? " client-sheet__body--requests" : ""}">
          ${parts.pinnedHtml || ""}
          <div class="client-sheet__list" data-role="client-sheet-list" role="listbox">${parts.listHtml}</div>
          ${
            parts.indexHtml
              ? `<nav class="client-sheet__index" data-role="client-sheet-index" aria-label="Alfabet">${parts.indexHtml}</nav>`
              : `<nav class="client-sheet__index" data-role="client-sheet-index" hidden aria-hidden="true"></nav>`
          }
        </div>
        ${detailHtml}
      </div>`;
  }

  function ensureProvCalAddClientMenuEl() {
    let menu = document.getElementById("prov-cal-add-client-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "prov-cal-add-client-menu";
      menu.className = "client-sheet";
      menu.setAttribute("data-role", "prov-cal-add-client-menu");
      menu.hidden = true;
    }
    if (menu.parentNode !== document.body) document.body.appendChild(menu);
    return menu;
  }

  function jumpClientSheetLetter(letter) {
    const list = document.querySelector('[data-role="client-sheet-list"]');
    if (!list || !letter) return;
    const section = list.querySelector('.client-sheet__section[data-letter="' + letter + '"]');
    if (section) section.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function clearClientSheetArmTimer() {
    if (window._clientSheetArmTimer) {
      clearTimeout(window._clientSheetArmTimer);
      window._clientSheetArmTimer = null;
    }
    if (window._clientSheetFocusTimer) {
      clearTimeout(window._clientSheetFocusTimer);
      window._clientSheetFocusTimer = null;
    }
  }

  function focusClientSheetSearch(menu) {
    const search = (menu || document).querySelector('[data-role="prov-cal-add-client-sheet-search"]');
    if (!search) return;
    try {
      search.focus({ preventScroll: true });
    } catch (err) {
      search.focus();
    }
  }

  function syncClientSheetDetailClass(menu) {
    const draft = window.AppState.provCalAddDraft;
    const open = !!(draft && String(draft.clientSheetDetailName || "").trim());
    if (menu) menu.classList.toggle("client-sheet--detail", open);
  }

  function setProvCalAddClientPickOpen(open, opts) {
    opts = opts || {};
    const draft = window.AppState.provCalAddDraft;
    if (draft) {
      draft.clientPickOpen = !!open;
      if (!open) draft.clientSheetDetailName = "";
    }
    const pick = document.querySelector('[data-role="prov-cal-add-client-pick"]');
    const menu = ensureProvCalAddClientMenuEl();
    const input = document.querySelector('[data-role="prov-cal-add-client"]');
    if (pick) pick.classList.toggle("is-open", !!open);
    if (input) input.setAttribute("aria-expanded", open ? "true" : "false");
    clearClientSheetArmTimer();
    if (!open) {
      menu.hidden = true;
      menu.classList.remove("is-open", "client-sheet--arming", "client-sheet--detail");
      menu.innerHTML = "";
      document.body.classList.remove("client-sheet-open");
      return;
    }
    menu.hidden = false;
    menu.classList.add("is-open", "client-sheet--arming");
    syncClientSheetDetailClass(menu);
    document.body.classList.add("client-sheet-open");
    // Blokuj backdrop na czas domknięcia gestu otwarcia (żeby ten sam klik go nie zamknął).
    window._clientSheetArmTimer = setTimeout(function () {
      menu.classList.remove("client-sheet--arming");
      window._clientSheetArmTimer = null;
    }, 420);
    if (opts.focusSearch !== false && !(draft && draft.clientSheetDetailName)) {
      window._clientSheetFocusTimer = setTimeout(function () {
        window._clientSheetFocusTimer = null;
        focusClientSheetSearch(menu);
      }, 60);
    }
  }

  function refreshProvCalAddClientMenu(opts) {
    opts = opts || {};
    const draft = window.AppState.provCalAddDraft;
    const p = myProvider();
    if (!draft || !p) return;
    const menu = ensureProvCalAddClientMenuEl();
    const open = !!draft.clientPickOpen;
    if (!open) {
      setProvCalAddClientPickOpen(false);
      return;
    }
    const detailOpen = !!String(draft.clientSheetDetailName || "").trim();
    const list = menu.querySelector('[data-role="client-sheet-list"]');
    const index = menu.querySelector('[data-role="client-sheet-index"]');
    const search = menu.querySelector('[data-role="prov-cal-add-client-sheet-search"]');
    captureClientSheetNewDetails();
    const listQuery = clientSheetListQuery(draft);
    // Przy otwartych szczegółach / trybie próśb przebuduj cały sheet (pinned + lista).
    if (
      detailOpen ||
      isProvCalAddRequestsContactsMode() ||
      !list ||
      !index ||
      !search ||
      !menu.classList.contains("is-open")
    ) {
      const keepSearch = document.activeElement === search ? String(search.value || "") : null;
      menu.innerHTML = renderProvCalAddClientMenuHtml(p.id, listQuery);
      setProvCalAddClientPickOpen(true, { focusSearch: !detailOpen && opts.focusSearch !== false });
      if (keepSearch != null) {
        const again = menu.querySelector('[data-role="prov-cal-add-client-sheet-search"]');
        if (again) {
          again.value = keepSearch;
          try {
            again.focus({ preventScroll: true });
            const len = again.value.length;
            again.setSelectionRange(len, len);
          } catch (err) {
            again.focus();
          }
        }
      }
      return;
    }
    const parts = renderProvCalAddClientListParts(p.id, listQuery);
    // Aktualizuj listę bez niszczenia inputu wyszukiwania (zachowaj fokus i kursor).
    const scrollTop = list.scrollTop;
    list.innerHTML = parts.listHtml;
    index.innerHTML = parts.indexHtml;
    index.hidden = !parts.indexHtml;
    if (document.activeElement !== search && String(search.value || "") !== listQuery) {
      search.value = listQuery;
    }
    list.scrollTop = scrollTop;
    const pick = document.querySelector('[data-role="prov-cal-add-client-pick"]');
    const input = document.querySelector('[data-role="prov-cal-add-client"]');
    if (pick) pick.classList.add("is-open");
    if (input) input.setAttribute("aria-expanded", "true");
    syncClientSheetDetailClass(menu);
  }

  function openClientSheetDetail(name) {
    const draft = ensureProvCalAddDraft();
    const n = String(name || "").trim();
    if (!n) return;
    draft.clientPickOpen = true;
    draft.clientSheetDetailName = n;
    saveState();
    refreshProvCalAddClientMenu({ focusSearch: false });
    hapticTap(12);
  }

  function closeClientSheetDetail() {
    const draft = ensureProvCalAddDraft();
    draft.clientSheetDetailName = "";
    saveState();
    refreshProvCalAddClientMenu({ focusSearch: false });
  }

  function closeProvCalAddClientPick() {
    const draft = window.AppState.provCalAddDraft;
    if (draft) {
      draft.clientPickOpen = false;
      draft.clientSheetDetailName = "";
      draft.clientSheetSearchQ = "";
    }
    setProvCalAddClientPickOpen(false);
    saveState();
  }

  function pickProvCalAddClient(name, opts) {
    const options = opts || {};
    const draft = ensureProvCalAddDraft();
    const p = myProvider();
    const n = String(name || "").trim();
    if (!n) {
      showToast("Wybierz klienta.");
      return;
    }
    // W zakładce Prośby wybór kontaktu = otwarcie prośby tej osoby.
    if (isProvCalAddRequestsContactsMode() && !options.addNew && p) {
      const req =
        (options.requestId &&
          (window.AppState.requests || []).find(function (r) {
            return r && r.id === options.requestId;
          })) ||
        findOpenRequestForClientName(p.id, n);
      if (req) {
        window._clientSheetPickLockUntil = Date.now() + 500;
        clearClientSheetArmTimer();
        setProvCalAddClientPickOpen(false);
        proposeOpen(req.id);
        return;
      }
    }
    captureClientSheetNewDetails();
    let client = null;
    if (options.addNew && p) {
      const phone =
        options.phone != null ? String(options.phone || "").trim() : String(draft.clientSheetNewPhone || "").trim();
      const email =
        options.email != null ? String(options.email || "").trim() : String(draft.clientSheetNewEmail || "").trim();
      client = upsertProviderClient(p.id, { name: n, phone: phone, email: email });
    } else if (p) {
      client = findCollectedProviderClientByName(p.id, n);
      if (client && (client.phone || client.email || client.address)) {
        const payload = { name: client.name };
        if (client.phone) payload.phone = client.phone;
        if (client.email) payload.email = client.email;
        if (client.address) payload.address = client.address;
        upsertProviderClient(p.id, payload);
      }
    }
    draft.clientName = n;
    draft.clientPickOpen = false;
    draft.clientSheetNewExpanded = false;
    draft.clientSheetNewPhone = "";
    draft.clientSheetNewEmail = "";
    applyClientContactsToDraft(draft, client || {});
    draft.clientDetailsOpen = false;
    // Nie otwieraj sheetu ponownie przez focusin/click po wyborze.
    window._clientSheetPickLockUntil = Date.now() + 500;
    clearClientSheetArmTimer();
    setProvCalAddClientPickOpen(false);
    saveState();
    renderAll();
    if (options.addNew) showToast("Klient dodany ✓");
  }

  function isClientSheetPickLocked() {
    return Date.now() < (window._clientSheetPickLockUntil || 0);
  }

  function toggleClientSheetNewDetails() {
    const draft = ensureProvCalAddDraft();
    captureClientSheetNewDetails();
    draft.clientSheetNewExpanded = !draft.clientSheetNewExpanded;
    saveState();
    const block = document.querySelector('[data-role="client-sheet-add"]');
    if (block) {
      const open = !!draft.clientSheetNewExpanded;
      block.classList.toggle("is-expanded", open);
      const details = block.querySelector('[data-role="client-sheet-add-details"]');
      const btn = block.querySelector('[data-action="toggle-client-sheet-new-details"]');
      if (details) {
        if (open) details.removeAttribute("hidden");
        else details.setAttribute("hidden", "");
      }
      if (btn) {
        btn.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute("aria-label", open ? "Ukryj dane kontaktu" : "Dodaj telefon i e-mail");
      }
      if (open) {
        requestAnimationFrame(function () {
          const phone = block.querySelector('[data-role="client-sheet-new-phone"]');
          if (phone) {
            try {
              phone.focus({ preventScroll: true });
            } catch (err) {
              phone.focus();
            }
          }
        });
      }
      return;
    }
    refreshProvCalAddClientMenu({ focusSearch: false });
  }

  function clearProvCalAddClient() {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    draft.clientName = "";
    draft.clientPhone = "";
    draft.clientEmail = "";
    draft.clientAddress = "";
    draft.clientPickOpen = false;
    draft.clientDetailsOpen = false;
    setProvCalAddClientPickOpen(false);
    const input = document.querySelector('[data-role="prov-cal-add-client"]');
    if (input) input.value = "";
    syncProvCalAddClientContactInputs(draft);
    saveState();
    renderAll();
    requestAnimationFrame(function () {
      const again = document.querySelector('[data-role="prov-cal-add-client"]');
      if (again) again.focus();
    });
  }

  function focusProvCalAddClientSearch() {
    const draft = ensureProvCalAddDraft();
    draft.clientPickOpen = true;
    draft.clientSheetSearchQ = "";
    draft.servicePickOpen = false;
    closeAvailPickMenus();
    setProvCalAddServicePickOpen(false);
    saveState();
    refreshProvCalAddClientMenu({ focusSearch: true });
  }

  function renderProvCalAddClientTrailingActionHtml(hasClientName) {
    if (hasClientName) {
      return `<button type="button" class="prov-cal-add__client-clear" data-action="clear-prov-cal-add-client" aria-label="Usuń klienta">
        <span aria-hidden="true">×</span>
      </button>`;
    }
    return `<button type="button" class="prov-cal-add__client-search" data-action="focus-prov-cal-add-client-search" aria-label="Szukaj klienta">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.2" />
        <path d="m15.4 15.4 5.1 5.1" />
      </svg>
    </button>`;
  }

  /** Lupa ↔ × — tylko jedna ikona naraz. */
  function patchProvCalAddClientClearBtn() {
    const draft = window.AppState.provCalAddDraft;
    const row = document.querySelector('[data-role="prov-cal-add-client-pick"] > .prov-cal-add__client-row');
    if (!row || !draft) return;
    const has = !!String(draft.clientName || "").trim();
    const clear = row.querySelector('[data-action="clear-prov-cal-add-client"]');
    const search = row.querySelector('[data-action="focus-prov-cal-add-client-search"]');
    if (has) {
      if (search) search.remove();
      if (!clear) {
        const host = document.createElement("div");
        host.innerHTML = renderProvCalAddClientTrailingActionHtml(true);
        const btn = host.firstElementChild;
        if (btn) row.appendChild(btn);
      }
    } else {
      if (clear) clear.remove();
      if (!search) {
        const host = document.createElement("div");
        host.innerHTML = renderProvCalAddClientTrailingActionHtml(false);
        const btn = host.firstElementChild;
        if (btn) row.appendChild(btn);
      }
    }
  }

  function provCalAddSelectedServices(p, draft) {
    const ids = (draft && draft.serviceIds) || [];
    return ids
      .map(function (id) {
        return resolveProvCalAddService(p, id);
      })
      .filter(Boolean);
  }

  function provCalAddServiceTotals(selected) {
    const list = selected || [];
    const duration = list.reduce(function (a, s) {
      return a + (s.durationMin || 0);
    }, 0);
    const onlyDuration = list.length > 0 && list.every(function (s) {
      return s.isDuration;
    });
    const hasNullPrice = !onlyDuration && list.some(function (s) {
      return s.price == null;
    });
    const price = list.reduce(function (a, s) {
      return a + (s.price || 0);
    }, 0);
    return {
      duration: duration,
      price: price,
      hasNullPrice: hasNullPrice,
      onlyDuration: onlyDuration,
      count: list.length,
    };
  }

  function captureProvCalAddClientName() {
    const draft = window.AppState.provCalAddDraft;
    if (!draft) return;
    const clientInput = document.querySelector('[data-role="prov-cal-add-client"]');
    const phoneInput = document.querySelector('[data-role="prov-cal-add-phone"]');
    const emailInput = document.querySelector('[data-role="prov-cal-add-email"]');
    if (clientInput) draft.clientName = String(clientInput.value || "").trim();
    if (phoneInput) draft.clientPhone = String(phoneInput.value || "").trim();
    if (emailInput) draft.clientEmail = String(emailInput.value || "").trim();
  }

  /** Animacja wjazdu sheetu — tylko przy pierwszym otwarciu, nie przy zmianie dnia/slotu. */
  let provCalAddPlayEnterAnim = false;

  function markProvCalAddEnterAnim() {
    if (!window.AppState.provCalAddOpen) provCalAddPlayEnterAnim = true;
  }

  function openDashVisits() {
    window.AppState.dashListMode = "visits";
    saveState();
    renderAll();
    hapticTap(12);
  }

  function toggleDashSearch() {
    const next = !window.AppState.dashSearchOpen;
    window.AppState.dashSearchOpen = next;
    if (!next) window.AppState.dashSearchQ = "";
    saveState();
    renderAll();
    if (next) {
      requestAnimationFrame(function () {
        const el = document.querySelector('[data-role="dash-search-input"]');
        if (!el) return;
        try {
          el.focus({ preventScroll: true });
        } catch (err) {
          el.focus();
        }
      });
    }
    hapticTap(10);
  }

  function clearDashSearch() {
    window.AppState.dashSearchQ = "";
    window.AppState.dashSearchOpen = true;
    saveState();
    renderAll();
    requestAnimationFrame(function () {
      const el = document.querySelector('[data-role="dash-search-input"]');
      if (!el) return;
      try {
        el.focus({ preventScroll: true });
      } catch (err) {
        el.focus();
      }
    });
  }

  function openDashRejected() {
    window.AppState.dashListMode = "rejected";
    if (!usesDesktopLayout()) {
      window.AppState.screen.provider = "dashboard";
    } else if (window.AppState.screen.provider !== "calendar" && window.AppState.screen.provider !== "dashboard") {
      window.AppState.screen.provider = "calendar";
    }
    saveState();
    renderAll();
    hapticTap(12);
  }

  /** Prośby o termin na liście pulpitu (karty jak wizyty) — bez starej listy w panelu „+”. */
  function openProvCalAddRequests() {
    clearProvCalReplyMode();
    window.AppState.provCalAddOpen = false;
    window.AppState.provCalAddMinimized = false;
    window.AppState.provCalAddDraft = null;
    window.AppState.provCalAddTab = "requests";
    window.AppState.dashListMode = "requests";
    if (!usesDesktopLayout()) {
      window.AppState.screen.provider = "dashboard";
    } else if (window.AppState.screen.provider !== "calendar" && window.AppState.screen.provider !== "dashboard") {
      window.AppState.screen.provider = "calendar";
    }
    setProvCalMonthOpen(false, { animate: false, render: false, persist: false });
    closeProvCalViewCloud();
    saveState();
    renderAll();
    hapticTap(16);
  }

  function openProvCalAdd() {
    clearProvCalReplyMode();
    const draft = defaultProvCalAddDraft();
    const sel = window.AppState.provCalSelection;
    if (sel && sel.kind === "free" && sel.dateISO) {
      const dur = Math.max(5, Number(sel.toMin) - Number(sel.fromMin));
      const durSvc = durationServiceForMinutes(dur);
      draft.dateISO = sel.dateISO;
      draft.serviceIds = [durSvc.id];
      const matched = matchProvCalAddSlotForFromMin(
        computeSlots(myProvider(), sel.dateISO, dur, {}),
        Number(sel.fromMin)
      );
      draft.slotId = matched ? matched.id : null;
      window.AppState.provCalDate = sel.dateISO;
      window.AppState.provCalPickerMonth = sel.dateISO.slice(0, 7);
    }
    markProvCalAddEnterAnim();
    window.AppState.provCalAddTab = "new";
    window.AppState.provCalAddOpen = true;
    window.AppState.provCalAddMinimized = false;
    window.AppState.provCalAddDraft = draft;
    // Wyrównaj szkic do chipa (5 min vs 15 min), żeby etykiety się zgadzały.
    snapProvCalSelectionToAddSlot();
    setProvCalMonthOpen(false, { animate: false, render: false, persist: false });
    closeProvCalViewCloud();
    saveState();
    renderAll();
    scheduleScrollProvCalAddTimeToSelected();
    requestAnimationFrame(function () {
      const input = document.querySelector('[data-role="prov-cal-add-client"]');
      if (input) input.focus();
    });
  }

  function animateProvCalAddSheetHeight(fromH) {
    if (!fromH || fromH < 8) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(function () {
      const sheet = document.querySelector(".prov-cal-add__sheet");
      if (!sheet) return;
      const toH = sheet.getBoundingClientRect().height;
      if (!toH || Math.abs(toH - fromH) < 2) return;
      let cleaned = false;
      function cleanup(event) {
        if (cleaned) return;
        if (event && event.propertyName && event.propertyName !== "height") return;
        cleaned = true;
        sheet.classList.remove("is-height-animating");
        sheet.style.height = "";
        sheet.style.maxHeight = "";
        sheet.style.overflow = "";
        sheet.style.transition = "";
        sheet.removeEventListener("transitionend", cleanup);
      }
      sheet.classList.add("is-height-animating");
      sheet.style.animation = "none";
      sheet.style.overflow = "hidden";
      sheet.style.maxHeight = "none";
      sheet.style.height = fromH + "px";
      sheet.style.transition = "none";
      void sheet.offsetHeight;
      sheet.style.transition = "height 300ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheet.style.height = toH + "px";
      sheet.addEventListener("transitionend", cleanup);
      setTimeout(cleanup, 340);
    });
  }

  function minimizeProvCalAdd() {
    if (!window.AppState.provCalAddOpen) return;
    captureProvCalAddClientName();
    setProvCalAddClientPickOpen(false);
    setProvCalAddServicePickOpen(false);
    // Zwinięty widok = formularz (klient / usługa / godziny), nie lista próśb.
    if (!replyRequestId() && window.AppState.provCalAddTab === "requests") {
      window.AppState.provCalAddTab = "new";
    }
    if (window.AppState.provCalAddDraft && window.AppState.provCalDate) {
      window.AppState.provCalAddDraft.dateISO = window.AppState.provCalDate;
    }
    const sheet = document.querySelector(".prov-cal-add__sheet");
    const fromH = sheet ? sheet.getBoundingClientRect().height : 0;
    window.AppState.provCalAddMinimized = true;
    saveState();
    renderAll();
    animateProvCalAddSheetHeight(fromH);
    hapticTap(12);
  }

  function expandProvCalAdd() {
    if (!window.AppState.provCalAddOpen) return;
    const sheet = document.querySelector(".prov-cal-add__sheet");
    const fromH = sheet ? sheet.getBoundingClientRect().height : 0;
    window.AppState.provCalAddMinimized = false;
    saveState();
    renderAll();
    animateProvCalAddSheetHeight(fromH);
    hapticTap(12);
  }

  /** Klik karty na pulpicie — zaznacz przedział / wizytę w kalendarzu (bez panelu edycji). */
  function applyProvCalSelectionFromDash(nextSel) {
    const next = normalizeProvCalSelection(nextSel);
    if (!next) return;
    const prevKey = provCalSelectionKey(window.AppState.provCalSelection);
    const nextKey = provCalSelectionKey(next);
    if (prevKey && prevKey === nextKey) {
      window.AppState.provCalSelection = null;
    } else {
      window.AppState.provCalSelection = next;
      if (next.dateISO) {
        window.AppState.provCalDate = next.dateISO;
        window.AppState.provCalPickerMonth = next.dateISO.slice(0, 7);
        moveProvCalWindowToInclude(next.dateISO);
      }
    }
    if (
      window.AppState.provCalSelection &&
      window.AppState.provCalSelection.kind === "free" &&
      window.AppState.provCalAddOpen &&
      !replyRequestId()
    ) {
      syncProvCalAddDraftFromSelection();
      snapProvCalSelectionToAddSlot();
    }
    saveState();
    renderAll();
    hapticTap(window.AppState.provCalSelection ? 16 : 10);
    const sel = window.AppState.provCalSelection;
    if (!sel) return;
    requestAnimationFrame(function () {
      document.querySelectorAll('[data-role="prov-cal-slot"].gcal__event--selected').forEach(function (el) {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    });
  }

  function selectProviderVisitInCalendar(bookingId) {
    const bk = (window.AppState.bookings || []).find(function (b) {
      return b && b.id === bookingId;
    });
    if (!bk || !bk.dateISO) return;
    applyProvCalSelectionFromDash({
      kind: "booking",
      bookingId: bk.id,
      dateISO: bk.dateISO,
      fromMin: timeToMinutes(bk.from),
      toMin: timeToMinutes(bk.to),
    });
  }

  function selectProviderFreeInCalendar(dateISO, fromMin, toMin) {
    if (!dateISO) return;
    const from = Number(fromMin);
    const to = Number(toMin);
    if (!(to > from)) return;
    // Ponowny klik w tę samą lukę (także po snapie długości z panelu „+”) — odznacz.
    if (isProvCalFreeSelInRange(window.AppState.provCalSelection, dateISO, from, to)) {
      window.AppState.provCalSelection = null;
      saveState();
      renderAll();
      hapticTap(10);
      return;
    }
    applyProvCalSelectionFromDash({
      kind: "free",
      dateISO: dateISO,
      fromMin: from,
      toMin: to,
    });
  }

  function openProvCalEdit(bookingId) {
    const bk = (window.AppState.bookings || []).find(function (b) {
      return b && b.id === bookingId;
    });
    if (!bk) return;
    clearProvCalReplyMode();
    if (pendingProvCalEditTimer) {
      clearTimeout(pendingProvCalEditTimer);
      pendingProvCalEditTimer = null;
    }
    const draft = defaultProvCalAddDraft();
    draft.bookingId = bk.id;
    draft.clientName = String(bk.clientName || "");
    applyClientContactsToDraft(draft, bk);
    if (!draft.clientPhone && !draft.clientEmail && !draft.clientAddress) {
      const p = myProvider();
      const saved = p ? findCollectedProviderClientByName(p.id, draft.clientName) : null;
      if (saved) applyClientContactsToDraft(draft, saved);
    }
    draft.clientDetailsOpen = false;
    draft.serviceIds = serviceIdsFromBooking(bk);
    draft.dateISO = bk.dateISO || ensureProvCalDate();
    draft.slotId = provCalAddSlotIdForBooking(bk);
    window.AppState.provCalAddTab = "new";
    window.AppState.provCalAddMinimized = false;
    window.AppState.provCalAddDraft = draft;
    window.AppState.provCalDate = draft.dateISO;
    window.AppState.provCalPickerMonth = draft.dateISO.slice(0, 7);
    moveProvCalWindowToInclude(draft.dateISO);
    window.AppState.provCalSelection = normalizeProvCalSelection({
      kind: "booking",
      bookingId: bk.id,
      dateISO: bk.dateISO,
      fromMin: timeToMinutes(bk.from),
      toMin: timeToMinutes(bk.to),
    });
    setProvCalMonthOpen(false, { animate: false, render: false, persist: false });
    closeProvCalViewCloud();

    const desktop = usesDesktopLayout();
    const onCalendar = window.AppState.screen.provider === "calendar";
    // Mobile z pulpitu: najpierw wjazd kalendarza z prawej, potem panel edycji.
    const stagedMobile = !desktop && !onCalendar;

    if (stagedMobile) {
      window.AppState.provCalAddOpen = false;
      window.AppState.screen.provider = "calendar";
      screenEnterAnimMode = "from-right";
      saveState();
      renderAll();
      hapticTap(12);
      const delay = prefersReducedMotion() ? 0 : 340;
      pendingProvCalEditTimer = setTimeout(function () {
        pendingProvCalEditTimer = null;
        if (!window.AppState.provCalAddDraft || window.AppState.provCalAddDraft.bookingId !== bk.id) return;
        markProvCalAddEnterAnim();
        window.AppState.provCalAddOpen = true;
        window.AppState.provCalAddMinimized = false;
        saveState();
        renderAll();
        hapticTap(16);
      }, delay);
      return;
    }

    markProvCalAddEnterAnim();
    window.AppState.provCalAddOpen = true;
    if (!desktop) window.AppState.screen.provider = "calendar";
    saveState();
    renderAll();
    hapticTap(16);
  }

  function closeProvCalAdd() {
    window.AppState.provCalAddOpen = false;
    window.AppState.provCalAddMinimized = false;
    window.AppState.provCalAddDraft = null;
    window.AppState.provCalAddTab = "new";
    clearProvCalReplyMode();
    setProvCalAddClientPickOpen(false);
    setProvCalAddServicePickOpen(false);
    const orphanClient = document.getElementById("prov-cal-add-client-menu");
    if (orphanClient) orphanClient.remove();
    const orphanService = document.getElementById("prov-cal-add-service-sheet");
    if (orphanService) orphanService.remove();
    saveState();
    renderAll();
  }

  function provCalAddServiceDisplayName(s) {
    if (!s) return "";
    if (s.isDuration) return PROV_CAL_ADD_INNE_NAME + " · " + formatDuration(s.durationMin);
    return s.name || "";
  }

  function renderProvCalAddServiceSummaryHtml(selected) {
    const list = selected || [];
    if (!list.length) {
      return `<span class="avail-loc-pick__label avail-loc-pick__label--placeholder">Wybierz usługę</span>`;
    }
    return `<ul class="prov-cal-add__service-summary visit-card__services" aria-label="Wybrane usługi">
      ${list
        .map(function (s) {
          return `<li>${escapeHtml(provCalAddServiceDisplayName(s))}</li>`;
        })
        .join("")}
    </ul>`;
  }

  function renderProvCalAddServiceOptHtml(s, draft) {
    const on = ((draft && draft.serviceIds) || []).indexOf(s.id) !== -1;
    const meta = s.isDuration
      ? formatDuration(s.durationMin)
      : [formatDuration(s.durationMin), formatPrice(s.price)].filter(Boolean).join(" · ");
    const selectLabel = (on ? "Odznacz" : "Zaznacz") + " " + provCalAddServiceDisplayName(s);
    return `<button type="button" class="avail-loc-pick__opt prov-cal-add__service-opt${on ? " is-selected" : ""}" role="option"
      data-action="prov-cal-add-service" data-service-id="${escapeHtml(s.id)}"
      aria-selected="${on ? "true" : "false"}" aria-label="${escapeHtml(selectLabel)}">
      <span class="prov-cal-add__service-opt-main">
        <span class="avail-loc-pick__opt-label">${escapeHtml(s.name)}</span>
        ${meta ? `<span class="prov-cal-add__service-opt-meta">${escapeHtml(meta)}</span>` : ""}
      </span>
      <span class="service-row__check-visual${on ? " is-on" : ""}" aria-hidden="true"></span>
    </button>`;
  }

  function draftHasProvCalAddInne(draft) {
    return ((draft && draft.serviceIds) || []).some(isProvCalAddDurationId);
  }

  function draftProvCalAddCatalogIds(draft) {
    return ((draft && draft.serviceIds) || []).filter(function (id) {
      return !isProvCalAddDurationId(id);
    });
  }

  function draftProvCalAddCatalogDurationMin(p, draft) {
    return draftProvCalAddCatalogIds(draft).reduce(function (acc, id) {
      const s = resolveProvCalAddService(p, id);
      return acc + ((s && s.durationMin) || 0);
    }, 0);
  }

  function draftProvCalAddInneMinutes(draft) {
    const id = ((draft && draft.serviceIds) || []).find(isProvCalAddDurationId);
    if (!id) return 30;
    const m = /^dur-(\d+)$/.exec(String(id));
    if (m) return Math.max(5, Number(m[1]) || 30);
    const s = resolveProvCalAddService(myProvider(), id);
    return (s && s.durationMin) || 30;
  }

  /** Ustaw / podmień tylko „Inne” — usługi z oferty zostają. */
  function setProvCalAddInneMinutesOnDraft(draft, minutes) {
    if (!draft) return;
    const catalog = draftProvCalAddCatalogIds(draft);
    const durSvc = durationServiceForMinutes(minutes);
    draft.serviceIds = catalog.concat([durSvc.id]);
  }

  function clearProvCalAddInneFromDraft(draft) {
    if (!draft) return;
    draft.serviceIds = draftProvCalAddCatalogIds(draft);
    if (!draft.serviceIds.length) draft.serviceIds = [PROV_CAL_ADD_DEFAULT_DURATION_ID];
  }

  /** HH:MM jako długość (minutnik) — max 12 h, krok 5 min. */
  function durationMinToTimeValue(min) {
    const n = Math.max(5, Math.min(12 * 60, Math.round(Number(min) / 5) * 5 || 30));
    return minToTime(n);
  }

  function timeValueToDurationMin(hhmm) {
    const m = timeToMin(hhmm);
    if (!Number.isFinite(m) || m < 5) return 5;
    return Math.min(12 * 60, Math.round(m / 5) * 5);
  }

  /** Jeden wiersz „Inne” — czas wybiera się w pickerze (godziny + minuty). */
  function renderProvCalAddInneOptHtml(draft) {
    const on = draftHasProvCalAddInne(draft);
    const mins = draftProvCalAddInneMinutes(draft);
    const meta = on ? formatDuration(mins) : "Ustaw długość";
    const selectLabel = on
      ? "Inne · " + formatDuration(mins) + " — zmień długość"
      : "Zaznacz Inne i ustaw długość";
    return `<button type="button" class="avail-loc-pick__opt prov-cal-add__service-opt prov-cal-add__inne-opt${
      on ? " is-selected" : ""
    }" role="option" data-action="prov-cal-add-inne" data-role="prov-cal-add-inne-opt"
      aria-selected="${on ? "true" : "false"}" aria-label="${escapeHtml(selectLabel)}">
      <span class="prov-cal-add__service-opt-main">
        <span class="avail-loc-pick__opt-label">${escapeHtml(PROV_CAL_ADD_INNE_NAME)}</span>
        <span class="prov-cal-add__service-opt-meta" data-role="prov-cal-add-inne-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="service-row__check-visual${on ? " is-on" : ""}" aria-hidden="true"></span>
    </button>`;
  }

  function renderProvCalAddInneDurationHtml(minutes) {
    const timeVal = durationMinToTimeValue(minutes);
    const durLabel = formatDuration(timeValueToDurationMin(timeVal));
    return `
      <div class="prov-cal-add__inne-duration" data-role="prov-cal-add-inne-duration">
        <button type="button" class="client-sheet__backdrop" data-action="close-prov-cal-add-inne-duration" aria-label="Zamknij długość"></button>
        <div class="prov-cal-add__inne-duration-panel" role="dialog" aria-modal="true" aria-label="Długość trwania">
          <div class="client-sheet__grab" aria-hidden="true"></div>
          <header class="client-sheet__head">
            <h3 class="client-sheet__title">Inne — długość</h3>
            <button type="button" class="client-sheet__done" data-action="close-prov-cal-add-inne-duration">Gotowe</button>
          </header>
          <div class="prov-cal-add__inne-duration-body">
            <p class="prov-cal-add__inne-duration-label">Czas trwania</p>
            <div class="prov-cal-add__inne-duration-field">
              <span class="avail-edit__time-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <span class="avail-edit__time-wrap avail-edit__time-wrap--from">
                <input class="avail-edit__time prov-cal-add__inne-time" type="time" value="${escapeHtml(timeVal)}"
                  step="300" data-role="prov-cal-add-inne-time"
                  aria-label="Długość w godzinach i minutach" />
              </span>
            </div>
            <p class="prov-cal-add__inne-duration-hint" data-role="prov-cal-add-inne-duration-hint">${escapeHtml(
              durLabel
            )} — wybierz godziny i minuty jak w minutniku</p>
            ${
              draftProvCalAddCatalogIds(window.AppState.provCalAddDraft).length
                ? `<button type="button" class="prov-cal-add__inne-clear" data-action="clear-prov-cal-add-inne">Usuń „Inne” (zostaw tylko usługi)</button>`
                : ""
            }
          </div>
        </div>
      </div>`;
  }

  function bindProvCalAddInneDurationInput(root) {
    const input = root && root.querySelector('[data-role="prov-cal-add-inne-time"]');
    if (!input || input._inneBound) return;
    input._inneBound = true;
    function apply() {
      setProvCalAddInneDurationMinutes(timeValueToDurationMin(input.value));
      const hint = root.querySelector('[data-role="prov-cal-add-inne-duration-hint"]');
      if (hint) {
        hint.textContent =
          formatDuration(timeValueToDurationMin(input.value)) +
          " — wybierz godziny i minuty jak w minutniku";
      }
    }
    input.addEventListener("change", apply);
    input.addEventListener("input", apply);
  }

  function openProvCalAddInneDurationPick() {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    if (!draftHasProvCalAddInne(draft)) {
      // Dołącz „Inne” do już wybranych usług z oferty — nie kasuj ich.
      setProvCalAddInneMinutesOnDraft(draft, PROV_CAL_ADD_DURATION_OPTS[1].durationMin || 30);
      draft.slotId = null;
      syncProvCalSelectionFromAddDraft();
      draft.serviceScheduleDirty = true;
    }
    draft.servicePickOpen = true;
    saveState();
    patchProvCalAddServiceUi();

    const sheet = ensureProvCalAddServiceSheetEl();
    if (sheet.hidden || !sheet.classList.contains("is-open")) {
      setProvCalAddServicePickOpen(true);
    }
    let host = sheet.querySelector('[data-role="prov-cal-add-inne-duration"]');
    if (host) host.remove();
    sheet.insertAdjacentHTML("beforeend", renderProvCalAddInneDurationHtml(draftProvCalAddInneMinutes(draft)));
    host = sheet.querySelector('[data-role="prov-cal-add-inne-duration"]');
    bindProvCalAddInneDurationInput(host);
    sheet.classList.add("has-inne-duration");

    const input = host && host.querySelector('[data-role="prov-cal-add-inne-time"]');
    if (input) {
      requestAnimationFrame(function () {
        try {
          input.focus({ preventScroll: true });
          if (typeof input.showPicker === "function") input.showPicker();
        } catch (err) {
          /* showPicker bywa blokowane poza gestem — pole i tak działa po tapnięciu */
        }
      });
    }
  }

  function closeProvCalAddInneDurationPick() {
    const sheet = document.getElementById("prov-cal-add-service-sheet");
    if (!sheet) return;
    const host = sheet.querySelector('[data-role="prov-cal-add-inne-duration"]');
    const wasOpen = !!host;
    if (host) host.remove();
    sheet.classList.remove("has-inne-duration");
    if (!wasOpen) {
      patchProvCalAddServiceUi();
      return;
    }
    // Odśwież wiersz „Inne” (meta z długością).
    const list = sheet.querySelector('[data-role="prov-cal-add-service-menu"]');
    const draft = window.AppState.provCalAddDraft;
    const p = myProvider();
    if (list && draft && p) {
      list.outerHTML = renderProvCalAddServiceSheetListHtml(p, draft);
    }
    patchProvCalAddServiceUi();
  }

  function setProvCalAddInneDurationMinutes(minutes) {
    const draft = ensureProvCalAddDraft();
    const prev = (draft.serviceIds || []).join(",");
    setProvCalAddInneMinutesOnDraft(draft, minutes);
    const durSvc = durationServiceForMinutes(minutes);
    if (prev !== (draft.serviceIds || []).join(",")) {
      draft.slotId = null;
      syncProvCalSelectionFromAddDraft();
      draft.serviceScheduleDirty = true;
    }
    saveState();
    patchProvCalAddServiceUi();
    // Meta wiersza „Inne” na liście pod spodem (obie powłoki UI).
    document.querySelectorAll('[data-role="prov-cal-add-inne-meta"]').forEach(function (meta) {
      meta.textContent = formatDuration(durSvc.durationMin);
    });
    document.querySelectorAll('[data-role="prov-cal-add-inne-opt"]').forEach(function (opt) {
      opt.classList.add("is-selected");
      opt.setAttribute("aria-selected", "true");
      const check = opt.querySelector(".service-row__check-visual");
      if (check) check.classList.add("is-on");
    });
  }

  function renderProvCalAddServiceSheetListHtml(p, draft) {
    const catalogServices = (p && p.services) || [];
    const rows =
      catalogServices
        .map(function (s) {
          return renderProvCalAddServiceOptHtml(s, draft);
        })
        .join("") +
      (catalogServices.length
        ? `<div class="prov-cal-add__service-sep" role="separator" aria-hidden="true"></div>`
        : "") +
      renderProvCalAddInneOptHtml(draft);
    return `<div class="service-sheet__list" data-role="prov-cal-add-service-menu" role="listbox" aria-multiselectable="true">${rows}</div>`;
  }

  function renderProvCalAddServiceSheetHtml(p, draft) {
    return `
      <button type="button" class="client-sheet__backdrop" data-action="close-prov-cal-add-service-pick" aria-label="Zamknij usługi"></button>
      <div class="client-sheet__panel service-sheet__panel" role="dialog" aria-modal="true" aria-label="Usługi">
        <div class="client-sheet__grab" aria-hidden="true"></div>
        <header class="client-sheet__head">
          <h3 class="client-sheet__title">Usługi</h3>
          <button type="button" class="client-sheet__done" data-action="close-prov-cal-add-service-pick">Gotowe</button>
        </header>
        <div class="client-sheet__body service-sheet__body">
          ${renderProvCalAddServiceSheetListHtml(p, draft)}
        </div>
      </div>`;
  }

  function ensureProvCalAddServiceSheetEl() {
    let sheet = document.getElementById("prov-cal-add-service-sheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "prov-cal-add-service-sheet";
      sheet.className = "client-sheet service-sheet";
      sheet.setAttribute("data-role", "prov-cal-add-service-sheet");
      sheet.hidden = true;
    }
    if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
    return sheet;
  }

  /** Desktop: przyklej sheet usług do kolumny pulpitu (szerokość + pozycja). */
  function syncProvCalAddServiceSheetDeskBounds(sheet) {
    if (!sheet) return;
    const dash =
      document.querySelector("#app-fullscreen .prov-desk__dash") ||
      document.querySelector('.device-frame[data-view="desktop"] .prov-desk__dash') ||
      document.querySelector(".prov-desk__dash");
    const desk =
      usesDesktopLayout() &&
      dash &&
      dash.offsetParent !== null &&
      getComputedStyle(dash).display !== "none";
    sheet.classList.toggle("service-sheet--desk", !!desk);
    if (!desk) {
      sheet.style.removeProperty("--service-sheet-left");
      sheet.style.removeProperty("--service-sheet-top");
      sheet.style.removeProperty("--service-sheet-width");
      sheet.style.removeProperty("--service-sheet-height");
      return;
    }
    const r = dash.getBoundingClientRect();
    sheet.style.setProperty("--service-sheet-left", Math.round(r.left) + "px");
    sheet.style.setProperty("--service-sheet-top", Math.round(r.top) + "px");
    sheet.style.setProperty("--service-sheet-width", Math.round(r.width) + "px");
    sheet.style.setProperty("--service-sheet-height", Math.round(r.height) + "px");
  }

  function clearServiceSheetArmTimer() {
    if (window._serviceSheetArmTimer) {
      clearTimeout(window._serviceSheetArmTimer);
      window._serviceSheetArmTimer = null;
    }
  }

  function setProvCalAddServicePickOpen(open) {
    const draft = window.AppState.provCalAddDraft;
    if (draft) draft.servicePickOpen = !!open;
    const pick = document.querySelector('[data-role="prov-cal-add-service-pick"]');
    const btn = pick && pick.querySelector('[data-action="toggle-prov-cal-add-service"]');
    const sheet = ensureProvCalAddServiceSheetEl();
    if (pick) pick.classList.toggle("is-open", !!open);
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-haspopup", "dialog");
    }
    clearServiceSheetArmTimer();
    if (!open) {
      sheet.hidden = true;
      sheet.classList.remove("is-open", "client-sheet--arming", "has-inne-duration", "service-sheet--desk");
      sheet.innerHTML = "";
      sheet.style.removeProperty("--service-sheet-left");
      sheet.style.removeProperty("--service-sheet-top");
      sheet.style.removeProperty("--service-sheet-width");
      sheet.style.removeProperty("--service-sheet-height");
      document.body.classList.remove("service-sheet-open");
      return;
    }
    const p = myProvider();
    if (!p || !draft) return;
    sheet.innerHTML = renderProvCalAddServiceSheetHtml(p, draft);
    sheet.hidden = false;
    sheet.classList.add("is-open", "client-sheet--arming");
    syncProvCalAddServiceSheetDeskBounds(sheet);
    document.body.classList.add("service-sheet-open");
    window._serviceSheetArmTimer = setTimeout(function () {
      sheet.classList.remove("client-sheet--arming");
      window._serviceSheetArmTimer = null;
    }, 420);
  }

  function closeProvCalAddServicePick() {
    const draft = window.AppState.provCalAddDraft;
    const dirty = !!(draft && draft.serviceScheduleDirty);
    if (draft) draft.servicePickOpen = false;
    setProvCalAddServicePickOpen(false);
    saveState();
    if (dirty) flushProvCalAddServiceSchedule();
  }

  function patchProvCalAddServiceUi() {
    const p = myProvider();
    const draft = window.AppState.provCalAddDraft;
    if (!p || !draft) return;
    const selected = provCalAddSelectedServices(p, draft);
    const totals = provCalAddServiceTotals(selected);
    const hasSvc = selected.length > 0;
    const ids = draft.serviceIds || [];
    const sheet = document.getElementById("prov-cal-add-service-sheet");
    const scope = sheet && !sheet.hidden ? sheet : document;
    const summaryHtml = renderProvCalAddServiceSummaryHtml(selected);
    const names = selected
      .map(function (s) {
        return provCalAddServiceDisplayName(s);
      })
      .join(", ");
    const pickAria = hasSvc ? "Wybrane usługi: " + names : "Wybierz usługi";
    const inneOn = draftHasProvCalAddInne(draft);
    const inneMins = draftProvCalAddInneMinutes(draft);
    const inneAria = inneOn
      ? "Inne · " + formatDuration(inneMins) + " — zmień długość"
      : "Zaznacz Inne i ustaw długość";
    const inneMetaText = inneOn ? formatDuration(inneMins) : "Ustaw długość";

    scope.querySelectorAll('[data-action="prov-cal-add-service"]').forEach(function (opt) {
      const id = opt.getAttribute("data-service-id");
      const on = ids.indexOf(id) !== -1;
      opt.classList.toggle("is-selected", on);
      opt.setAttribute("aria-selected", on ? "true" : "false");
      const check = opt.querySelector(".service-row__check-visual");
      if (check) check.classList.toggle("is-on", on);
      const nameEl = opt.querySelector(".avail-loc-pick__opt-label, .prov-cal-add__dur-chip-label");
      const labelText = nameEl ? nameEl.textContent : "";
      if (labelText) opt.setAttribute("aria-label", (on ? "Odznacz" : "Zaznacz") + " " + labelText);
    });

    // Sheet + obie powłoki UI (symulator i #page-app) — querySelector łapał tylko pierwszą.
    scope.querySelectorAll('[data-role="prov-cal-add-inne-opt"]').forEach(function (inneOpt) {
      inneOpt.classList.toggle("is-selected", inneOn);
      inneOpt.setAttribute("aria-selected", inneOn ? "true" : "false");
      inneOpt.setAttribute("aria-label", inneAria);
      const inneCheck = inneOpt.querySelector(".service-row__check-visual");
      if (inneCheck) inneCheck.classList.toggle("is-on", inneOn);
      const inneMeta = inneOpt.querySelector('[data-role="prov-cal-add-inne-meta"]');
      if (inneMeta) inneMeta.textContent = inneMetaText;
    });

    document
      .querySelectorAll('[data-role="prov-cal-add-service-pick"] [data-role="prov-cal-add-service-summary"]')
      .forEach(function (contentEl) {
        contentEl.innerHTML = summaryHtml;
      });
    document.querySelectorAll('[data-role="prov-cal-add-service-pick"] .avail-loc-pick__btn').forEach(function (pickBtn) {
      pickBtn.classList.toggle("prov-cal-add__service-btn--filled", hasSvc);
      pickBtn.setAttribute("aria-label", pickAria);
    });

    document.querySelectorAll(".prov-cal-add__foot .bottom-nav__summary").forEach(function (summary) {
      summary.classList.toggle("bottom-nav__summary--empty", !hasSvc);
      const dur = summary.querySelector(".bottom-nav__summary-dur");
      const price = summary.querySelector(".bottom-nav__summary-price");
      if (dur) dur.textContent = !hasSvc ? "—" : formatDuration(totals.duration || 0);
      if (price) {
        price.textContent = !hasSvc
          ? "—"
          : totals.onlyDuration
            ? "—"
            : totals.hasNullPrice
              ? "wycena indyw."
              : formatPrice(totals.price);
      }
    });

    let ctaLabel = "Zapisz";
    let ctaDisabled = !(hasSvc && !!draft.slotId);
    if (draft.requestId) {
      const n = (draft.proposals || []).length;
      ctaDisabled = n < 1;
      ctaLabel = ("Wyślij " + (n || "") + " " + proposalCountLabel(n)).replace(/\s+/g, " ").trim();
    }
    document.querySelectorAll('[data-role="prov-cal-add-cta"]').forEach(function (cta) {
      cta.disabled = ctaDisabled;
      cta.textContent = ctaLabel;
    });
  }

  function flushProvCalAddServiceSchedule() {
    const draft = window.AppState.provCalAddDraft;
    if (!draft || !draft.serviceScheduleDirty) return;
    draft.serviceScheduleDirty = false;
    draft.servicePickOpen = false;
    setProvCalAddServicePickOpen(false);
    saveState();
    renderAll();
  }

  /** Start slotu w minutach z id `slot-YYYY-MM-DD-<min>-…`. */
  function parseProvCalSlotStartMin(slotId) {
    const m = String(slotId || "").match(/^slot-\d{4}-\d{2}-\d{2}-(\d+)/);
    return m ? Number(m[1]) : NaN;
  }

  /**
   * Dopasuj wolny slot do szkicu: najpierw dokładny start, inaczej najbliższy start.
   * (Stara heurystyka „fromMin ∈ [start, start+dur)” brała pierwszy nachodzący
   * slot — przy długim czasie 15:20 wpadało w 13:00→15:25.)
   */
  function matchProvCalAddSlotForFromMin(slots, fromMin) {
    if (!slots || !slots.length || !Number.isFinite(fromMin)) return null;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const start = parseProvCalSlotStartMin(slots[i].id);
      if (!Number.isFinite(start)) continue;
      const dist = Math.abs(start - fromMin);
      if (dist < bestDist) {
        bestDist = dist;
        best = slots[i];
        if (dist === 0) break;
      }
    }
    return best;
  }

  /**
   * Po finalizacji: wyrównaj szkic do wybranego chipa (sloty co 15 min, snap siatki co 5).
   * Zwraca true, gdy selekcja się zmieniła.
   */
  function snapProvCalSelectionToAddSlot() {
    if (!window.AppState.provCalAddOpen) return false;
    const draft = window.AppState.provCalAddDraft;
    const sel = window.AppState.provCalSelection;
    if (!draft || !sel || sel.kind !== "free" || replyRequestId()) return false;
    const preferred =
      (draft.slotId && parseProvCalSlotStartMin(draft.slotId)) || Number(sel.fromMin);
    if (!Number.isFinite(preferred)) return false;
    const dur =
      provCalAddServiceTotals(provCalAddSelectedServices(myProvider(), draft)).duration ||
      Math.max(5, Number(sel.toMin) - Number(sel.fromMin));
    const fitted = fitProvCalFreeRange(draft.dateISO || sel.dateISO, preferred, Math.max(5, dur));
    if (!fitted) return false;
    const next = normalizeProvCalSelection({
      kind: "free",
      dateISO: draft.dateISO || sel.dateISO,
      fromMin: fitted.fromMin,
      toMin: fitted.toMin,
    });
    if (fitted.slot) draft.slotId = fitted.slot.id;
    if (provCalSelectionKey(sel) === provCalSelectionKey(next)) return false;
    window.AppState.provCalSelection = next;
    document.querySelectorAll('[data-role="prov-cal-slot"][data-kind="free"]').forEach(function (el) {
      applyProvCalFreeDraftLayout(el, next.fromMin, next.toMin);
    });
    return true;
  }

  function syncProvCalAddDraftFromSelection() {
    if (!window.AppState.provCalAddOpen) return false;
    const draft = window.AppState.provCalAddDraft;
    const sel = window.AppState.provCalSelection;
    if (!draft || !sel || sel.kind !== "free" || !sel.dateISO || replyRequestId()) return false;
    let fromMin = Number(sel.fromMin);
    let toMin = Number(sel.toMin);
    if (!Number.isFinite(fromMin) || !Number.isFinite(toMin) || !(toMin > fromMin)) return false;
    if (!Array.isArray(draft.serviceIds)) draft.serviceIds = [];
    const p = myProvider();
    const catalogIds = draftProvCalAddCatalogIds(draft);
    const catalogDur = draftProvCalAddCatalogDurationMin(p, draft);
    let duration = Math.max(5, toMin - fromMin);
    const prevServices = draft.serviceIds.join(",");

    // Usługi z oferty = stały czas; „Inne” = elastyczna reszta (total − katalog).
    if (catalogDur > 0) {
      if (duration < catalogDur) {
        // Nie skracaj poniżej sumy usług — dociągnij do legalnego slotu (bez kolizji / poza dostępnością).
        const fitted = fitProvCalFreeRange(sel.dateISO, fromMin, catalogDur);
        if (fitted) {
          fromMin = fitted.fromMin;
          toMin = fitted.toMin;
          duration = toMin - fromMin;
          const snapped = normalizeProvCalSelection({
            kind: "free",
            dateISO: sel.dateISO,
            fromMin: fromMin,
            toMin: toMin,
          });
          window.AppState.provCalSelection = snapped;
          document.querySelectorAll('[data-role="prov-cal-slot"][data-kind="free"]').forEach(function (el) {
            applyProvCalFreeDraftLayout(el, snapped.fromMin, snapped.toMin);
          });
          if (fitted.slot) draft.slotId = fitted.slot.id;
        }
        draft.serviceIds = catalogIds.slice();
      } else if (duration > catalogDur) {
        setProvCalAddInneMinutesOnDraft(draft, duration - catalogDur);
      } else {
        // Dokładnie suma katalogu — bez „Inne”.
        draft.serviceIds = catalogIds.slice();
      }
    } else if (draftHasProvCalAddInne(draft) || !draft.serviceIds.length) {
      draft.serviceIds = [durationServiceForMinutes(duration).id];
    }

    const slotDuration =
      provCalAddServiceTotals(provCalAddSelectedServices(p, draft)).duration || duration;
    const slots = p ? computeSlots(p, sel.dateISO, Math.max(5, slotDuration), {}) : [];
    const matched = matchProvCalAddSlotForFromMin(slots, fromMin);
    const nextSlotId = matched ? matched.id : null;
    const changed =
      draft.dateISO !== sel.dateISO ||
      draft.slotId !== nextSlotId ||
      prevServices !== (draft.serviceIds || []).join(",");
    draft.dateISO = sel.dateISO;
    draft.slotId = nextSlotId;
    return changed;
  }

  /**
   * Panel „+” → siatka: szkic na kalendarzu podąża za godziną wybraną w karuzeli;
   * odznaczenie chipa zdejmuje szkic. Tryb odpowiedzi i edycji pomijamy —
   * propozycje renderuje renderProvCalProposalDraftsHtml, edycja ma selekcję wizyty.
   */
  function syncProvCalSelectionFromAddDraft() {
    if (!window.AppState.provCalAddOpen) return false;
    const draft = window.AppState.provCalAddDraft;
    if (!draft || draft.requestId || draft.bookingId) return false;
    let dateISO = null;
    let fromMin = NaN;
    let toMin = NaN;
    if (draft.slotId) {
      const m = String(draft.slotId).match(/^slot-(\d{4}-\d{2}-\d{2})-(\d+)/);
      if (m) {
        dateISO = m[1];
        fromMin = Number(m[2]);
        const dur =
          provCalAddServiceTotals(provCalAddSelectedServices(myProvider(), draft)).duration || 30;
        toMin = fromMin + Math.max(5, dur);
      }
    }
    const next =
      dateISO && isFinite(fromMin) && toMin > fromMin
        ? normalizeProvCalSelection({
            kind: "free",
            dateISO: dateISO,
            fromMin: fromMin,
            toMin: toMin,
          })
        : null;
    const changed =
      provCalSelectionKey(window.AppState.provCalSelection) !== provCalSelectionKey(next);
    window.AppState.provCalSelection = next;
    if (next) {
      if (window.AppState.provCalDate !== next.dateISO) {
        window.AppState.provCalDate = next.dateISO;
        window.AppState.provCalPickerMonth = next.dateISO.slice(0, 7);
      }
      if (!provCalWindowContainsDate(next.dateISO)) moveProvCalWindowToInclude(next.dateISO);
    }
    return changed;
  }

  /**
   * Karuzela „WOLNE TERMINY” / propozycji: dociągnij chip do widoku (smooth),
   * tylko gdy wystaje poza viewport — bez przelotu całej osi od 0.
   * Tylko po finalizacji (tap / drop / koniec resize) — nie przy live-drag.
   */
  function scrollProvCalAddTimeToSelected(slotId) {
    if (!window.AppState.provCalAddOpen) return;
    const draft = window.AppState.provCalAddDraft;
    const targetId = slotId || (draft && !draft.requestId ? draft.slotId : null);
    const pad = 12;
    document.querySelectorAll('[data-role="prov-cal-add-time-list"]').forEach(function (list) {
      const rect = list.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      let chip = null;
      if (targetId) {
        const buttons = list.querySelectorAll("[data-slot]");
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i].getAttribute("data-slot") === targetId) {
            chip = buttons[i];
            break;
          }
        }
      }
      if (!chip) chip = list.querySelector(".time-row--selected");
      if (!chip) return;
      const chipLeft = chip.offsetLeft;
      const chipRight = chipLeft + chip.offsetWidth;
      const viewLeft = list.scrollLeft;
      const viewRight = viewLeft + list.clientWidth;
      // Sąsiad już w kadrze — bez animacji.
      if (chipLeft >= viewLeft + pad && chipRight <= viewRight - pad) return;
      let next = viewLeft;
      if (chipLeft < viewLeft + pad) next = chipLeft - pad;
      else if (chipRight > viewRight - pad) next = chipRight - list.clientWidth + pad;
      const max = Math.max(0, list.scrollWidth - list.clientWidth);
      next = Math.max(0, Math.min(max, next));
      if (Math.abs(next - viewLeft) < 1) return;
      list.scrollTo({ left: next, behavior: "smooth" });
    });
  }

  function scheduleScrollProvCalAddTimeToSelected(slotId) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrollProvCalAddTimeToSelected(slotId);
      });
    });
  }

  function updateProvCalAddTimeList() {
    if (!window.AppState.provCalAddOpen || !window.AppState.provCalAddDraft) return;
    const draft = window.AppState.provCalAddDraft;
    if (draft.requestId) return;
    const p = myProvider();
    const realIds = (draft.serviceIds || []).filter(function (id) {
      return !isProvCalAddDurationId(id);
    });
    const duration = provCalAddServiceTotals(provCalAddSelectedServices(p, draft)).duration || 30;
    const slots = computeSlots(p, draft.dateISO, duration, {});
    const listEls = document.querySelectorAll('[data-role="prov-cal-add-time-list"]');
    if (!listEls.length) return;
    const hasSvc = (draft.serviceIds || []).length > 0;
    listEls.forEach(function (listEl) {
      const prevScroll = listEl.scrollLeft;
      if (!hasSvc || !draft.dateISO) {
        listEl.innerHTML = "";
        listEl.setAttribute("hidden", "");
      } else if (!slots.length) {
        listEl.innerHTML = `<p class="empty-note">Brak wolnych godzin tego dnia.</p>`;
        listEl.removeAttribute("hidden");
      } else {
        listEl.innerHTML = slots
          .map(function (s) {
            const on = draft.slotId === s.id;
            return `<button type="button" class="time-row time-row--chip${on ? " time-row--selected" : ""}" data-action="prov-cal-add-slot" data-slot="${escapeHtml(s.id)}" aria-label="Wybierz ${escapeHtml(s.from)}–${escapeHtml(s.to)}" aria-pressed="${on ? "true" : "false"}">
            <span class="time-row__info">
              <span class="time-row__range">${escapeHtml(s.from)}→${escapeHtml(s.to)}</span>
              ${renderTimeSlotPlace(p, s)}
            </span>
          </button>`;
          })
          .join("");
        listEl.removeAttribute("hidden");
        // Live-patch nie powinien resetować pozycji (drag/resize na żywo).
        listEl.scrollLeft = prevScroll;
      }
    });
    document.querySelectorAll('[data-role="prov-cal-add-times-label"]').forEach(function (labelEl) {
      if (hasSvc && draft.dateISO) labelEl.removeAttribute("hidden");
      else labelEl.setAttribute("hidden", "");
    });
    updateProvCalAddSummaryLive();
  }

  function updateProvCalAddSummaryLive() {
    if (!window.AppState.provCalAddOpen || !window.AppState.provCalAddDraft) return;
    const draft = window.AppState.provCalAddDraft;
    if (draft.requestId) return;
    const p = myProvider();
    const selected = provCalAddSelectedServices(p, draft);
    const totals = provCalAddServiceTotals(selected);
    const hasSvc = selected.length > 0;
    const ctaDisabled = !(hasSvc && !!draft.slotId);
    document.querySelectorAll(".prov-cal-add__foot .bottom-nav__summary").forEach(function (summary) {
      summary.classList.toggle("bottom-nav__summary--empty", !hasSvc);
      const dur = summary.querySelector(".bottom-nav__summary-dur");
      const price = summary.querySelector(".bottom-nav__summary-price");
      if (dur) dur.textContent = !hasSvc ? "—" : formatDuration(totals.duration || 0);
      if (price) {
        price.textContent = !hasSvc
          ? "—"
          : totals.onlyDuration
            ? "—"
            : totals.hasNullPrice
              ? "wycena indyw."
              : formatPrice(totals.price);
      }
    });
    document.querySelectorAll('[data-role="prov-cal-add-cta"]').forEach(function (cta) {
      cta.disabled = ctaDisabled;
      cta.textContent = "Zapisz";
    });
  }

  /**
   * @param {{ snapSelection?: boolean }} [opts]
   * snapSelection — po drop/tap/resize-end wyrównaj godziny szkicu do chipa.
   */
  function updateProvCalAddSelectionLive(opts) {
    opts = opts || {};
    if (!window.AppState.provCalAddOpen || !window.AppState.provCalAddDraft) return false;
    if (!syncProvCalAddDraftFromSelection()) {
      if (opts.snapSelection && snapProvCalSelectionToAddSlot()) {
        scheduleScrollProvCalAddTimeToSelected();
        return true;
      }
      return false;
    }
    updateProvCalAddTimeList();
    // Czas trwania z resize/drag → etykieta „Inne · N min” musi iść w ślad.
    patchProvCalAddServiceUi();
    if (opts.snapSelection) snapProvCalSelectionToAddSlot();
    return true;
  }

  function toggleProvCalAddService(serviceId) {
    if (!serviceId) return;
    // Stare id dur-* z listy → jeden wiersz „Inne” + minutnik.
    if (isProvCalAddDurationId(serviceId)) {
      openProvCalAddInneDurationPick();
      return;
    }
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    if (!Array.isArray(draft.serviceIds)) draft.serviceIds = [];
    const idx = draft.serviceIds.indexOf(serviceId);
    if (idx === -1) {
      // Usługa z oferty: można łączyć z „Inne” (stały czas + elastyczna reszta).
      draft.serviceIds.push(serviceId);
      closeProvCalAddInneDurationPick();
    } else {
      draft.serviceIds.splice(idx, 1);
    }
    if (!draft.serviceIds.length) draft.serviceIds = [PROV_CAL_ADD_DEFAULT_DURATION_ID];
    draft.slotId = null;
    syncProvCalSelectionFromAddDraft();
    draft.servicePickOpen = true;
    draft.serviceScheduleDirty = true;
    saveState();
    // Bez renderAll — inaczej chmurka miga przy każdym checkmarku.
    patchProvCalAddServiceUi();
  }

  function setProvCalAddDate(dateISO) {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    draft.dateISO = dateISO || ensureProvCalDate();
    if (!draft.requestId) draft.slotId = null;
    window.AppState.provCalDate = draft.dateISO;
    window.AppState.provCalPickerMonth = draft.dateISO.slice(0, 7);
    moveProvCalWindowToInclude(draft.dateISO);
    syncProvCalSelectionFromAddDraft();
    saveState();
    renderAll();
  }

  function setProvCalAddSlot(slotId) {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    if (draft.requestId) {
      toggleReplyProposalSlot(draft, slotId);
    } else {
      // Drugi klik w ten sam chip odznacza godzinę — szkic znika z siatki.
      draft.slotId = draft.slotId === slotId ? null : slotId || null;
    }
    syncProvCalSelectionFromAddDraft();
    saveState();
    renderAll();
  }

  function toggleReplyProposalSlot(draft, slotId) {
    if (!draft || !slotId) return;
    const p = myProvider();
    const req = replyRequest();
    if (!p || !req) return;
    if (!Array.isArray(draft.proposals)) draft.proposals = [];
    const idx = draft.proposals.findIndex(function (c) {
      return c.id === slotId;
    });
    if (idx !== -1) {
      draft.proposals.splice(idx, 1);
      if (!draft.proposals.length) draft.proposalsOpen = false;
      return;
    }
    const dateISO = draft.dateISO;
    const totalDur = requestServicesDuration(p, draft.serviceIds || req.serviceIds || []);
    const slotOpts = slotOptsForServiceIds(p, draft.serviceIds || req.serviceIds || []);
    const part = replyDayPartForDate(dateISO);
    const slot = computeSlots(p, dateISO, totalDur, slotOpts)
      .filter(function (s) {
        return slotMatchesDayPart(s, part);
      })
      .find(function (s) {
        return s.id === slotId;
      });
    if (!slot) return;
    draft.proposals.push({
      id: slot.id,
      dateISO: dateISO,
      from: slot.from,
      to: slot.to,
      locationId: slot.locationId,
      locationLabel: slot.locationLabel,
    });
    draft.proposals.sort(function (a, b) {
      return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
    });
  }

  function removeReplyProposalSlot(slotId) {
    const draft = ensureProvCalAddDraft();
    if (!Array.isArray(draft.proposals)) return;
    const idx = draft.proposals.findIndex(function (c) {
      return c.id === slotId;
    });
    if (idx === -1) return;
    draft.proposals.splice(idx, 1);
    if (!draft.proposals.length) draft.proposalsOpen = false;
    saveState();
    renderAll();
  }

  function toggleReplyProposalsOpen() {
    const draft = ensureProvCalAddDraft();
    if (!draft.proposals || !draft.proposals.length) return;
    draft.proposalsOpen = !draft.proposalsOpen;
    saveState();
    renderAll();
    if (draft.proposalsOpen) {
      requestAnimationFrame(function () {
        const list = document.querySelector(
          '#app-fullscreen [data-role="prov-cal-add-proposals"]'
        );
        if (list) list.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function toggleProvCalReplyShowAll() {
    window.AppState.provCalReplyShowAll = !window.AppState.provCalReplyShowAll;
    saveState();
    renderAll();
  }

  function toggleProvCalAddServiceDesc(serviceId) {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    if (!Array.isArray(draft.expandedServiceIds)) draft.expandedServiceIds = [];
    const idx = draft.expandedServiceIds.indexOf(serviceId);
    if (idx === -1) draft.expandedServiceIds.push(serviceId);
    else draft.expandedServiceIds.splice(idx, 1);
    saveState();
    renderAll();
  }

  function confirmProvCalAdd() {
    captureProvCalAddClientName();
    const draft = ensureProvCalAddDraft();
    const p = myProvider();
    if (!p) return;
    const clientName = String(draft.clientName || "").trim();
    const clientPhone = String(draft.clientPhone || "").trim();
    const clientEmail = String(draft.clientEmail || "").trim();
    const clientAddress = String(draft.clientAddress || "").trim();
    // Imię klienta opcjonalne — sam blok usługi / czasu można zapisać bez kontaktu.
    if (clientName) {
      upsertProviderClient(p.id, {
        name: clientName,
        phone: clientPhone,
        email: clientEmail,
        address: clientAddress,
      });
    }
    const selected = provCalAddSelectedServices(p, draft);
    if (!selected.length) {
      showToast("Wybierz usługę.");
      return;
    }
    if (!draft.dateISO || !draft.slotId) {
      showToast("Wybierz dzień i godzinę.");
      return;
    }
    const totals = provCalAddServiceTotals(selected);
    const realIds = (draft.serviceIds || []).filter(function (id) {
      return !isProvCalAddDurationId(id);
    });
    const slotOpts = slotOptsForServiceIds(
      p,
      realIds,
      draft.bookingId ? { exceptBookingId: draft.bookingId } : {}
    );
    const slots = computeSlots(p, draft.dateISO, totals.duration || 15, slotOpts);
    const slot = slots.find(function (s) {
      return s.id === draft.slotId;
    });
    if (!slot) {
      showToast("Ten termin jest już zajęty — wybierz inny.");
      draft.slotId = null;
      saveState();
      renderAll();
      return;
    }
    const serviceIds = selected.map(function (s) {
      return s.id;
    });
    const serviceNames = selected.map(function (s) {
      return s.name;
    });
    let booking = null;
    const editing = !!draft.bookingId;
    if (editing) {
      booking = (window.AppState.bookings || []).find(function (b) {
        return b && b.id === draft.bookingId;
      });
      if (!booking) {
        showToast("Nie znaleziono terminu.");
        return;
      }
      booking.clientName = clientName;
      booking.clientPhone = clientPhone;
      booking.clientEmail = clientEmail;
      booking.clientAddress = clientAddress;
      booking.serviceIds = serviceIds;
      booking.serviceNames = serviceNames;
      booking.dateISO = draft.dateISO;
      booking.from = slot.from;
      booking.to = slot.to;
      booking.locationId = slot.locationId || "";
      booking.locationLabel = slot.locationLabel || "";
      if (!booking.status) booking.status = "confirmed";
    } else {
      booking = {
        id: "bk-" + Date.now(),
        providerId: p.id,
        providerName: p.name,
        clientName: clientName,
        clientPhone: clientPhone,
        clientEmail: clientEmail,
        clientAddress: clientAddress,
        serviceIds: serviceIds,
        serviceNames: serviceNames,
        dateISO: draft.dateISO,
        from: slot.from,
        to: slot.to,
        locationId: slot.locationId || "",
        locationLabel: slot.locationLabel || "",
        status: "confirmed",
        side: "provider",
      };
      window.AppState.bookings.push(booking);
    }
    window.AppState.provCalDate = booking.dateISO;
    window.AppState.provCalPickerMonth = booking.dateISO.slice(0, 7);
    moveProvCalWindowToInclude(booking.dateISO);
    window.AppState.provCalSelection = normalizeProvCalSelection({
      kind: "booking",
      bookingId: booking.id,
      dateISO: booking.dateISO,
      fromMin: timeToMinutes(booking.from),
      toMin: timeToMinutes(booking.to),
    });
    window.AppState.provCalAddOpen = false;
    window.AppState.provCalAddDraft = null;
    saveState();
    renderAll();
    hapticTap(22);
    showToast(editing ? "Termin zapisany ✓" : "Termin dodany ✓");
    if (window.LokalnieApi && window.LokalnieApi.enabled && booking) {
      if (!editing || !booking._fromApi) {
        void window.LokalnieApi.createBookingFromApp(booking).then(function () {
          if (booking.id) {
            window.AppState.provCalSelection = normalizeProvCalSelection({
              kind: "booking",
              bookingId: booking.id,
              dateISO: booking.dateISO,
              fromMin: timeToMinutes(booking.from),
              toMin: timeToMinutes(booking.to),
            });
          }
          saveState();
        });
      } else {
        void window.LokalnieApi.request("/bookings/" + encodeURIComponent(booking.id), {
          method: "PATCH",
          json: {
            status: booking.status,
            dateISO: booking.dateISO,
            from: booking.from,
            to: booking.to,
            locationLabel: booking.locationLabel,
          },
        }).catch(function () {});
      }
    }
  }

  function renderProvCalAddPanel() {
    if (!window.AppState.provCalAddOpen) return "";
    const p = myProvider();
    const draft = ensureProvCalAddDraft();
    const replyReq = draft.requestId ? replyRequest() : null;
    const isReply = !!replyReq;
    if (!Array.isArray(draft.serviceIds) || !draft.serviceIds.length) {
      draft.serviceIds = isReply ? (replyReq.serviceIds || []).slice() : [PROV_CAL_ADD_DEFAULT_DURATION_ID];
    }
    const selected = provCalAddSelectedServices(p, draft);
    const totals = provCalAddServiceTotals(selected);
    const duration = totals.duration || 30;
    const isEdit = !!draft.bookingId;
    const realIds = (draft.serviceIds || []).filter(function (id) {
      return !isProvCalAddDurationId(id);
    });
    const slotOpts = slotOptsForServiceIds(p, realIds, isEdit ? { exceptBookingId: draft.bookingId } : {});
    const allAvailDates = ((p && p.availability) || [])
      .map(function (d) {
        return d.dateISO;
      })
      .filter(function (dateISO) {
        return computeSlots(p, dateISO, duration, slotOpts).length > 0;
      });
    const requestDays = isReply ? normalizeRequestDays(replyReq.days) : [];
    // null = brak ograniczenia dni (prośba bez wyboru dnia).
    const requestDaySet = isReply ? replyRequestDaySet() : null;
    const showAll = !isReply || !requestDaySet || !!window.AppState.provCalReplyShowAll;
    const stripDates = !isReply || showAll
      ? allAvailDates
      : requestDays.map(function (d) {
          return d.dateISO;
        });
    let activeDate = draft.dateISO;
    if (stripDates.length && stripDates.indexOf(activeDate) === -1) {
      activeDate = stripDates[0];
      draft.dateISO = activeDate;
    } else if (!activeDate) {
      activeDate = stripDates[0] || allAvailDates[0] || ensureProvCalDate();
      draft.dateISO = activeDate;
    }
    const hasSvc = selected.length > 0;
    const dayPart = isReply ? replyDayPartForDate(activeDate) : "any";
    const inRequestDay = !isReply || !requestDaySet || requestDaySet.has(activeDate);
    let slots = hasSvc ? computeSlots(p, activeDate, duration, slotOpts) : [];
    if (isReply && inRequestDay) {
      slots = slots.filter(function (s) {
        return slotMatchesDayPart(s, dayPart);
      });
    }
    if (!isReply && draft.slotId && !slots.some(function (s) { return s.id === draft.slotId; })) {
      draft.slotId = null;
    }
    if (!Array.isArray(draft.proposals)) draft.proposals = [];
    const chosenIds = new Set(
      draft.proposals.map(function (c) {
        return c.id;
      })
    );
    const timeList = !hasSvc
      ? ""
      : slots.length
        ? slots
            .map(function (s) {
              const on = isReply ? chosenIds.has(s.id) : draft.slotId === s.id;
              return `
          <button type="button" class="time-row time-row--chip${on ? " time-row--selected" : ""}" data-action="prov-cal-add-slot" data-slot="${escapeHtml(s.id)}"
            aria-label="${isReply ? (on ? "Usuń" : "Dodaj") : "Wybierz"} ${escapeHtml(s.from)}–${escapeHtml(s.to)}" aria-pressed="${on ? "true" : "false"}">
            <span class="time-row__info">
              <span class="time-row__range">${escapeHtml(s.from)}→${escapeHtml(s.to)}</span>
              ${renderTimeSlotPlace(p, s)}
            </span>
          </button>`;
            })
            .join("")
        : `<p class="empty-note">${
            isReply && inRequestDay && dayPart !== "any"
              ? "Brak wolnych godzin w porze wskazanej przez klienta."
              : "Brak wolnych godzin tego dnia."
          }</p>`;

    const partNote =
      isReply && !inRequestDay
        ? `<p class="prov-cal-add__part-note prov-cal-add__part-note--outside">Dzień poza zapytaniem klienta.</p>`
        : "";
    const timesLabelHtml = !isReply
      ? "Wolne terminy"
      : inRequestDay
        ? `Godziny <span class="booking__label-part" data-part="${escapeHtml(dayPart)}">(${escapeHtml(
            DAY_PART_LABEL[dayPart]
          )})</span>`
        : "Godziny";

    const proposalsOpen = !!(isReply && draft.proposalsOpen && draft.proposals.length);
    const chosenList =
      isReply && draft.proposals.length
        ? `<ul class="proposal-list proposal-list--panel" id="prov-cal-add-proposals" data-role="prov-cal-add-proposals"${
            proposalsOpen ? "" : " hidden"
          }>
            ${draft.proposals
              .map(function (c) {
                return `<li class="proposal-row">
                  <span class="proposal-row__range">${escapeHtml(proposalRangeLabel(c))}</span>
                  ${c.locationLabel ? `<span class="proposal-row__place">${escapeHtml(c.locationLabel)}</span>` : ""}
                  <button type="button" class="proposal-row__remove" data-action="reply-propose-remove" data-slot="${escapeHtml(c.id)}"
                    aria-label="Usuń propozycję ${escapeHtml(proposalRangeLabel(c))}" title="Usuń">×</button>
                </li>`;
              })
              .join("")}
          </ul>`
        : "";
    const proposalsToggleHtml =
      isReply && draft.proposals.length
        ? `<button type="button" class="prov-cal-add__proposals-toggle${
            proposalsOpen ? " is-open" : ""
          }" data-action="toggle-reply-proposals" aria-expanded="${
            proposalsOpen ? "true" : "false"
          }" aria-controls="prov-cal-add-proposals">
            <span class="prov-cal-add__proposals-label">Propozycja (${draft.proposals.length})</span>
            <span class="avail-loc-pick__chevron" aria-hidden="true"></span>
          </button>`
        : "";

    const canSave = isReply ? draft.proposals.length > 0 : hasSvc && !!draft.slotId;
    const priceText = !hasSvc
      ? "—"
      : totals.onlyDuration
        ? "—"
        : totals.hasNullPrice
          ? "wycena indyw."
          : formatPrice(totals.price);
    const durText = !hasSvc ? "—" : formatDuration(totals.duration || 0);
    const serviceSummaryHtml = renderProvCalAddServiceSummaryHtml(selected);
    const serviceAriaLabel = !hasSvc
      ? "Wybierz usługi"
      : "Wybrane usługi: " +
        selected
          .map(function (s) {
            return provCalAddServiceDisplayName(s);
          })
          .join(", ");
    const servicePickOpen = !!draft.servicePickOpen;
    const clientPickOpen = !!draft.clientPickOpen;
    const hasClientName = !!String(draft.clientName || "").trim();

    const title = isReply ? "Zaproponuj terminy" : isEdit ? "Edytuj termin" : "Nowy termin";
    const saveAction = isReply ? "propose-confirm" : "confirm-prov-cal-add";
    const saveLabel = isReply
      ? `Wyślij ${draft.proposals.length || ""} ${proposalCountLabel(draft.proposals.length)}`.replace(/\s+/g, " ").trim()
      : "Zapisz";
    const saveAttrs = isReply ? ` data-request-id="${escapeHtml(replyReq.id)}"` : "";
    const headCenter = `<h3 class="prov-cal-add__title" id="prov-cal-add-title">${escapeHtml(title)}</h3>`;

    window.AppState.provCalAddMinimized = false;
    const formBodyHtml = `
            <div class="prov-cal-add__field prov-cal-add__client-pick${
              clientPickOpen ? " is-open" : ""
            }" data-role="prov-cal-add-client-pick" aria-label="Klient">
              <span class="prov-cal-add__client-row">
                <span class="prov-cal-add__client-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="8.2" r="3.4" />
                    <path d="M5.2 19.2c.9-3.2 3.4-4.8 6.8-4.8s5.9 1.6 6.8 4.8" />
                  </svg>
                </span>
                <span class="prov-cal-add__client-main">
                  <input type="text" class="prov-cal-add__input" data-role="prov-cal-add-client"
                    value="${escapeHtml(draft.clientName || "")}" placeholder="Nazwa klienta"
                    autocomplete="off" spellcheck="false" readonly inputmode="none"
                    aria-autocomplete="list" aria-haspopup="dialog"
                    aria-expanded="${clientPickOpen ? "true" : "false"}" aria-controls="prov-cal-add-client-menu" />
                </span>
                ${renderProvCalAddClientTrailingActionHtml(hasClientName)}
              </span>
            </div>

            <div class="prov-cal-add__field" aria-label="Usługa">
              <div class="avail-loc-pick avail-loc-pick--compact prov-cal-add__service-pick${servicePickOpen ? " is-open" : ""}" data-role="prov-cal-add-service-pick">
                <button type="button" class="avail-loc-pick__btn${hasSvc ? " prov-cal-add__service-btn--filled" : ""}" data-action="toggle-prov-cal-add-service"
                  aria-haspopup="dialog" aria-expanded="${servicePickOpen ? "true" : "false"}" aria-label="${escapeHtml(serviceAriaLabel)}">
                  <span class="prov-cal-add__client-avatar" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                      <path d="M7 7h.01" />
                    </svg>
                  </span>
                  <span class="avail-edit__loc-content" data-role="prov-cal-add-service-summary">
                    ${serviceSummaryHtml}
                  </span>
                  <span class="avail-loc-pick__chevron" aria-hidden="true"></span>
                </button>
              </div>
            </div>

            <div class="booking__schedule prov-cal-add__schedule">
              ${partNote}
              <h3 class="booking__label booking__label--caps" data-role="prov-cal-add-times-label"${hasSvc && activeDate ? "" : " hidden"}>${timesLabelHtml}</h3>
              <div class="time-list time-list--horizontal" data-role="prov-cal-add-time-list"${hasSvc && activeDate ? "" : " hidden"}>${timeList}</div>
              ${
                isReply && draft.proposals.length
                  ? `${proposalsToggleHtml}${chosenList}`
                  : ""
              }
            </div>`;

    const footHtml = `<div class="prov-cal-add__foot booking-confirm-bar">
            <div class="bottom-nav__summary${hasSvc ? "" : " bottom-nav__summary--empty"}">
              <span class="bottom-nav__summary-label">${isReply ? "Wybrane:" : "Suma:"}</span>
              <div class="bottom-nav__summary-meta">
                <span class="bottom-nav__summary-dur">${
                  isReply
                    ? escapeHtml(String(draft.proposals.length) + " " + proposalCountLabel(draft.proposals.length))
                    : escapeHtml(durText)
                }</span>
                ${isReply ? "" : `<span class="bottom-nav__summary-price">${escapeHtml(priceText)}</span>`}
              </div>
            </div>
            <button type="button" class="bottom-nav__book" data-role="prov-cal-add-cta" data-action="${saveAction}"${saveAttrs}${
              canSave ? "" : " disabled"
            }>${escapeHtml(saveLabel)}</button>
          </div>`;

    const closeBtnHtml = `<button type="button" class="prov-cal-add__close" data-action="close-prov-cal-add" aria-label="Zamknij">
            <span class="bottom-nav__icon bottom-nav__icon--close" aria-hidden="true"></span>
          </button>`;

    const enterCls = provCalAddPlayEnterAnim ? " prov-cal-add--enter" : "";
    provCalAddPlayEnterAnim = false;

    return `
      <div class="prov-cal-add${isReply ? " prov-cal-add--reply" : ""}${enterCls}" data-role="prov-cal-add">
        <div class="prov-cal-add__sheet" role="dialog" aria-modal="false" aria-labelledby="prov-cal-add-title">
          <header class="prov-cal-add__head">
            <span class="prov-cal-add__head-spacer" aria-hidden="true"></span>
            ${headCenter}
            ${closeBtnHtml}
          </header>
          <div class="prov-cal-add__body">
            ${formBodyHtml}
          </div>
          ${footHtml}
        </div>
      </div>`;
  }

  /**
   * Kalendarz usługodawcy.
   * Desktop: lewy pulpit + większa siatka po prawej (opts.navActive = zakładka w nav).
   */
  function renderProviderCalendar(opts) {
    opts = opts || {};
    const desktop = usesDesktopLayout();
    const navActive = opts.navActive === "dashboard" ? "dashboard" : "calendar";
    const selected = ensureProvCalDate();
    const visits = providerVisits();
    ensureProvCalVisibleDays();
    // Nie pozwól, by zapisany zbyt mały zoom nakładał wizyty po odświeżeniu.
    const dynMinHourH = provCalNoOverlapMinHourH();
    if (ensureProvCalHourH() < dynMinHourH) window.AppState.provCalHourH = clampProvCalHourH(dynMinHourH);
    const monthOpen = !!window.AppState.provCalMonthOpen;
    const addOpen = !!window.AppState.provCalAddOpen;
    const replyReq = replyRequest();
    const isReply = !!(addOpen && replyReq);
    // Etykieta śledzi miesiąc pickera (swipe w panelu), nie tylko wybraną datę tygodnia.
    const monthLabel = monthLabelFromISO(ensureProvCalPickerMonth() + "-01") || "Miesiąc";
    // Desktop: pulpit widać obok — „Wróć” tylko w trybie odpowiedzi.
    const backBtn =
      isReply || !desktop
        ? `<button type="button" class="screen-head__back" data-action="${
            isReply ? "close-prov-cal-add" : "provider-tab"
          }"${isReply ? "" : ' data-tab="dashboard"'} aria-label="Wróć">
                  <span class="screen-head__back-icon" aria-hidden="true"></span>
                </button>`
        : "";
    const calInner = `
        <div class="prov-cal-top">
          <header class="screen-head screen-head--prov-cal">
            <div class="prov-cal-head">
              <div class="prov-cal-head__title-row">
                ${backBtn}
                <h2 class="screen-head__title">Kalendarz</h2>
              </div>
              <div class="prov-cal-head__actions">
                <div class="prov-cal__tools" role="toolbar" aria-label="Narzędzia kalendarza">
                  <button type="button" class="prov-cal__tool prov-cal__tool--month-label${monthOpen ? " is-on" : ""}" data-action="prov-cal-view" data-view="month"
                    aria-label="${escapeHtml(monthLabel)}" aria-pressed="${monthOpen ? "true" : "false"}">
                    <span class="prov-cal__month-name">${escapeHtml(monthLabel)}</span>
                    <span class="prov-cal__month-chevron" aria-hidden="true"></span>
                  </button>
                </div>
                <button type="button" class="prov-cal__today-btn" data-action="prov-cal-today">Dzisiaj</button>
              </div>
            </div>
          </header>
          <div class="prov-cal-top__anchor">
            ${renderProvCalViewCornerBtn()}
            ${renderProvCalMonthPanel(selected, visits)}
          </div>
        </div>
        <div class="prov-cal-body" data-role="prov-cal-body">
          ${renderProvCalGoogleWeek(selected, visits)}
        </div>
        <button type="button" class="prov-cal-fab" data-action="open-prov-cal-add" aria-label="Dodaj termin" title="Dodaj termin"${addOpen ? " hidden" : ""}>
          <span class="prov-cal-fab__icon" aria-hidden="true">+</span>
        </button>`;
    // Desktop: panel tylko nad pulpitem (szerokość lewej kolumny; kalendarz wolny).
    // Mobile: panel w obrębie całego ekranu kalendarza jak dotychczas.
    const addPanel = renderProvCalAddPanel();
    const body = desktop
      ? `<div class="prov-desk" data-role="prov-desk">
          <aside class="prov-desk__dash" data-role="prov-desk-dash" aria-label="Pulpit">
            ${renderProviderDashBodyHtml({ compact: true })}
          </aside>
          <div class="prov-desk__cal" data-role="prov-desk-cal">
            ${calInner}
          </div>
          ${addPanel}
        </div>`
      : `${calInner}${addPanel}`;
    return `
      <div class="app-screen app-screen--provider app-screen--prov-cal${
        desktop ? " app-screen--prov-cal-desktop" : ""
      }${addOpen ? " app-screen--prov-cal-add-open" : ""}${isReply ? " app-screen--prov-cal-reply" : ""}">
        ${body}
        ${providerBottomNav(navActive)}
      </div>`;
  }

  function requestServicesDuration(p, serviceIds) {
    return (
      (serviceIds || []).reduce(function (acc, id) {
        const s = (p.services || []).find(function (x) {
          return x.id === id;
        });
        return acc + (s ? s.durationMin : 0);
      }, 0) || 30
    );
  }

  /** Dni wskazane przez klienta wraz z wolnymi slotami w jego porze dnia. */
  function requestDayOptions(req, p) {
    const totalDur = requestServicesDuration(p, req.serviceIds || []);
    const slotOpts = slotOptsForServiceIds(p, req.serviceIds || []);
    const days = normalizeRequestDays(req.days);
    // Starsze zapytania (sprzed wyboru dni) — pokaż całą dostępność.
    const source = days.length
      ? days
      : (p.availability || []).map(function (d) {
          return { dateISO: d.dateISO, part: "any" };
        });
    return source
      .map(function (d) {
        const slots = computeSlots(p, d.dateISO, totalDur, slotOpts).filter(function (s) {
          return slotMatchesDayPart(s, d.part);
        });
        return { dateISO: d.dateISO, part: normalizeDayPart(d.part), slots: slots };
      })
      .filter(function (d) {
        return d.slots.length;
      });
  }

  /** Robocza lista propozycji usługodawcy (przed wysłaniem klientowi). */
  function requestProposalDraft(req) {
    if (!Array.isArray(req._proposals)) req._proposals = [];
    return req._proposals;
  }

  function proposalCountLabel(n) {
    const abs = Math.abs(Number(n) || 0) % 100;
    const last = abs % 10;
    if (abs === 1) return "termin";
    if (last >= 2 && last <= 4 && (abs < 12 || abs > 14)) return "terminy";
    return "terminów";
  }

  function proposalRangeLabel(prop) {
    return `${formatDayWithDow(prop.dateISO)} · ${prop.from}–${prop.to}`;
  }

  function renderRequestDayBadges(days) {
    if (!days.length) return `<p class="request-card__note">Klient nie wskazał dni — możesz zaproponować dowolny termin.</p>`;
    return `
      <ul class="request-card__days">
        ${days
          .map(function (d) {
            return `<li class="request-day-badge">
              <span class="request-day-badge__day">${escapeHtml(formatDayWithDow(d.dateISO))}</span>
              <span class="request-day-badge__part">${escapeHtml(DAY_PART_LABEL[normalizeDayPart(d.part)])}</span>
            </li>`;
          })
          .join("")}
      </ul>`;
  }

  function renderRequestCard(r) {
    const days = normalizeRequestDays(r.days);
    const proposals = Array.isArray(r.proposals) ? r.proposals : [];
    const isProposed = r.status === "proposed";
    return `
      <div class="request-card" data-request-id="${escapeHtml(r.id)}">
        <div class="visit-card__top">
          <span class="visit-card__name">${escapeHtml(r.clientName || "Klient")}</span>
          <span class="status-badge" data-status="${escapeHtml(isProposed ? "proposed" : "pending")}">${escapeHtml(isProposed ? "Wysłano propozycje" : "Oczekująca")}</span>
        </div>
        <div class="visit-card__svc">${escapeHtml((r.serviceNames || []).join(", "))}</div>
        ${renderRequestDayBadges(days)}
        ${
          isProposed && proposals.length
            ? `<p class="request-card__note">Wysłano ${proposals.length} ${escapeHtml(proposalCountLabel(proposals.length))} — czekamy na wybór klienta.</p>`
            : ""
        }
        <div class="visit-card__actions">
          <button type="button" class="btn btn--primary btn--sm" data-action="propose-open" data-request-id="${escapeHtml(r.id)}">${isProposed ? "Zmień propozycje" : "Zaproponuj terminy"}</button>
        </div>
      </div>`;
  }

  function renderRequests() {
    const all = (window.AppState.requests || []).filter(function (r) {
      return r.providerId === MY_PROVIDER_ID;
    });
    const pending = all.filter(function (r) {
      return r.status === "pending";
    });
    const proposed = all.filter(function (r) {
      return r.status === "proposed";
    });
    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Zapytania o termin</h2>
            <p class="screen-head__sub">Klient podaje dni i porę dnia — Ty odsyłasz kilka godzin do wyboru.</p>
          </header>
          <h3 class="prov-section">Nowe zapytania</h3>
          <div class="request-list">
            ${pending.length ? pending.map(renderRequestCard).join("") : `<p class="empty-note">Brak nowych zapytań.</p>`}
          </div>
          ${
            proposed.length
              ? `<h3 class="prov-section">Czekają na wybór klienta</h3>
                 <div class="request-list">${proposed.map(renderRequestCard).join("")}</div>`
              : ""
          }
        </div>
        ${providerBottomNav("requests")}
      </div>`;
  }

  function renderProposeScreen(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    const p = myProvider();
    if (!req || !p) return renderRequests();

    const totalDur = requestServicesDuration(p, req.serviceIds || []);
    const dayOptions = requestDayOptions(req, p);
    const chosen = requestProposalDraft(req);
    const chosenIds = new Set(
      chosen.map(function (c) {
        return c.id;
      })
    );
    const activeDate = dayOptions.some(function (d) {
      return d.dateISO === req._proposeDate;
    })
      ? req._proposeDate
      : (dayOptions[0] && dayOptions[0].dateISO) || null;
    const activeDay =
      dayOptions.find(function (d) {
        return d.dateISO === activeDate;
      }) || null;

    const todayISO = demoTodayISO();
    const dateStrip = dayOptions
      .map(function (d) {
        const dt = new Date(d.dateISO + "T12:00:00");
        const on = d.dateISO === activeDate;
        const red = isRedCalendarDay(d.dateISO);
        const picked = chosen.filter(function (c) {
          return c.dateISO === d.dateISO;
        }).length;
        return `<button type="button" class="date-chip${on ? " date-chip--active" : ""}${d.dateISO === todayISO ? " date-chip--today" : ""}${red ? " date-chip--holiday" : ""}"
          data-action="propose-date" data-request-id="${escapeHtml(req.id)}" data-date="${escapeHtml(d.dateISO)}">
          <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
          <span class="date-chip__day">${dt.getDate()}</span>
          ${picked ? `<span class="date-chip__badge" aria-hidden="true">${picked}</span>` : ""}
        </button>`;
      })
      .join("");

    const timeList = activeDay
      ? activeDay.slots
          .map(function (s) {
            const on = chosenIds.has(s.id);
            return `<button type="button" class="time-row time-row--chip${on ? " time-row--selected" : ""}" data-action="propose-slot"
              data-request-id="${escapeHtml(req.id)}" data-slot="${escapeHtml(s.id)}" data-date="${escapeHtml(activeDay.dateISO)}" aria-pressed="${on ? "true" : "false"}">
              <span class="time-row__info">
                <span class="time-row__range">${escapeHtml(s.from)}→${escapeHtml(s.to)}</span>
                ${s.locationLabel ? `<span class="time-row__place">${escapeHtml(s.locationLabel)}</span>` : ""}
              </span>
            </button>`;
          })
          .join("")
      : "";

    const chosenList = chosen.length
      ? `<ul class="proposal-list">
          ${chosen
            .map(function (c) {
              return `<li class="proposal-row">
                <span class="proposal-row__range">${escapeHtml(proposalRangeLabel(c))}</span>
                ${c.locationLabel ? `<span class="proposal-row__place">${escapeHtml(c.locationLabel)}</span>` : ""}
                <button type="button" class="proposal-row__remove" data-action="propose-remove" data-request-id="${escapeHtml(req.id)}" data-slot="${escapeHtml(c.id)}"
                  aria-label="Usuń propozycję ${escapeHtml(proposalRangeLabel(c))}" title="Usuń propozycję">×</button>
              </li>`;
            })
            .join("")}
        </ul>`
      : `<p class="empty-note">Zaznacz godziny, które chcesz wysłać klientowi.</p>`;

    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <div class="topbar">
            <button type="button" class="topbar__back" data-action="open-prov-cal-requests" aria-label="Wróć">‹</button>
            <span class="topbar__title">Zaproponuj terminy</span><span class="topbar__spacer"></span>
          </div>
          <div class="booking">
            <div class="booking__header">
              <span class="booking__prov">${escapeHtml(req.clientName || "Klient")}</span>
              <span class="booking__svc">${escapeHtml((req.serviceNames || []).join(", "))}</span>
            </div>
            ${renderRequestDayBadges(normalizeRequestDays(req.days))}
            <h3 class="booking__label">Dzień</h3>
            <div class="date-strip date-strip--booking">${dateStrip || `<p class="empty-note">Brak wolnych godzin w dniach wskazanych przez klienta.</p>`}</div>
            ${
              activeDay
                ? `<h3 class="booking__label">Godziny · ${escapeHtml(formatDateLong(activeDay.dateISO))} · ${escapeHtml(DAY_PART_LABEL[activeDay.part])}</h3>
                   <div class="time-list time-list--horizontal">${timeList}</div>`
                : ""
            }
            <h3 class="booking__label">Propozycja (${chosen.length})</h3>
            ${chosenList}
          </div>
        </div>
        <div class="selection-summary">
          <div class="selection-summary__info"><span class="selection-summary__duration">${escapeHtml(formatDuration(totalDur))}</span></div>
          <button type="button" class="btn btn--primary selection-summary__cta" data-action="propose-confirm" data-request-id="${escapeHtml(req.id)}"${chosen.length ? "" : " disabled"}>Wyślij ${chosen.length || ""} ${escapeHtml(proposalCountLabel(chosen.length))}</button>
        </div>
        ${providerBottomNav("requests")}
      </div>`;
  }

  function getProviderService(serviceId) {
    const p = myProvider();
    if (!p || !serviceId) return null;
    return (p.services || []).find(function (s) {
      return s.id === serviceId;
    }) || null;
  }

  function newServiceDraft() {
    return {
      id: "__new__",
      name: "",
      description: "",
      bookingMode: "auto",
      locationIds: null,
      durationMin: 30,
      price: null,
      photos: [],
      variants: [{ id: "svc-new-v1", durationMin: 30, price: null, label: "" }],
    };
  }

  function getEditServicePhotos() {
    const params = window.AppState.params.provider || {};
    return Array.isArray(params.editServicePhotos) ? params.editServicePhotos.slice() : [];
  }

  function setEditServicePhotos(photos) {
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServicePhotos: photos.slice(),
    });
  }

  function normalizeEditVariants(s) {
    const list = serviceVariants(s);
    if (list.length) {
      return list.map(function (v, i) {
        return {
          id: v.id || "v-" + (i + 1),
          durationMin: Number(v.durationMin) || 30,
          price: v.price == null || v.price === "" ? null : Number(v.price),
          label: v.label || "",
        };
      });
    }
    return [
      {
        id: ((s && s.id) || "svc-new") + "-v1",
        durationMin: Number(s && s.durationMin) || 30,
        price: s && s.price == null ? null : Number(s && s.price),
        label: "",
      },
    ];
  }

  function readServiceEditVariantsFromForm(form) {
    if (!form) return [];
    const rows = form.querySelectorAll("[data-role='service-edit-variant']");
    const out = [];
    rows.forEach(function (row, i) {
      const id = row.getAttribute("data-variant-id") || "v-" + (i + 1);
      const priceEl = row.querySelector('[name="variantPrice"]');
      const durEl = row.querySelector('[name="variantDuration"]');
      const priceRaw = priceEl ? priceEl.value : "";
      const durationMin = Number(durEl && durEl.value);
      out.push({
        id: id,
        durationMin: Number.isFinite(durationMin) && durationMin >= 5 ? Math.round(durationMin) : 30,
        price: priceRaw === "" || priceRaw == null ? null : Number(priceRaw),
        label: "",
      });
    });
    return out.length ? out : [{ id: "v-1", durationMin: 30, price: null, label: "" }];
  }

  /** null = wszystkie miejsca; tablica = tylko zaznaczone; [] = nic nie wybrano. */
  function readServiceEditLocationIds(form) {
    if (!form) return null;
    const checks = form.querySelectorAll('[data-role="service-location-check"]');
    if (!checks.length) return null;
    const ids = [];
    checks.forEach(function (btn) {
      if (!btn.classList.contains("is-on")) return;
      const id = btn.getAttribute("data-loc-id");
      if (id) ids.push(id);
    });
    if (!ids.length) return [];
    if (ids.length >= checks.length) return null;
    return ids;
  }

  /** Formularz edycji oferty — preferuj kontekst kliknięcia / pełny ekran (nie ukryty symulator). */
  function serviceEditForm(fromEl) {
    if (fromEl && fromEl.closest) {
      const near = fromEl.closest("form.service-edit");
      if (near) return near;
    }
    const pageApp = document.getElementById("page-app");
    const fs = document.getElementById("app-fullscreen");
    if (pageApp && !pageApp.hidden && fs) {
      const full = fs.querySelector("form.service-edit");
      if (full) return full;
    }
    return document.querySelector("form.service-edit");
  }

  function readServiceEditBookingMode(form) {
    if (!form) return "auto";
    const hidden = form.querySelector('[data-role="service-booking-mode-value"]');
    if (hidden) return normalizeBookingMode(hidden.value);
    const on = form.querySelector('[data-role="service-booking-mode-switch"]:checked');
    if (on) return normalizeBookingMode(on.getAttribute("data-mode"));
    return "auto";
  }

  function captureServiceEditDraft(fromEl) {
    const form = serviceEditForm(fromEl);
    if (!form) return;
    const variants = readServiceEditVariantsFromForm(form);
    const first = variants[0];
    const bookingMode = readServiceEditBookingMode(form);
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceDraft: {
        name: String(form.elements.name && form.elements.name.value || ""),
        description: String(form.elements.description && form.elements.description.value || ""),
        bookingMode: bookingMode,
        locationIds: readServiceEditLocationIds(form),
        durationMin: first.durationMin,
        price: first.price,
        variants: variants,
      },
    });
  }

  function applyServiceEditDraft(s) {
    const draft = window.AppState.params.provider && window.AppState.params.provider.editServiceDraft;
    if (!draft || !s) return s;
    return Object.assign({}, s, draft);
  }

  function renderServiceEditVariants(variants) {
    const list = Array.isArray(variants) && variants.length ? variants : [{ id: "v-1", durationMin: 30, price: null }];
    const rows = list
      .map(function (v, i) {
        const priceVal = v.price == null || v.price === "" ? "" : String(v.price);
        const canRemove = list.length > 1;
        const isLast = i === list.length - 1;
        return `
        <div class="service-edit__variant" data-role="service-edit-variant" data-variant-id="${escapeHtml(v.id || "v-" + (i + 1))}">
          <div class="service-edit__variant-fields">
            <label class="service-edit__field service-edit__field--float service-edit__field--price">
              <input class="service-edit__input" name="variantPrice" type="number" min="0" max="99999" step="1" value="${escapeHtml(priceVal)}" placeholder=" " aria-label="Cena wariantu ${i + 1}" />
              <span class="service-edit__label">Cena (zł)</span>
            </label>
            <label class="service-edit__field service-edit__field--float service-edit__field--duration">
              <input class="service-edit__input" name="variantDuration" type="number" required min="5" max="480" step="5" value="${escapeHtml(String(v.durationMin || 30))}" placeholder=" " aria-label="Czas wariantu ${i + 1}" />
              <span class="service-edit__label">Czas (min)</span>
            </label>
          </div>
          ${
            canRemove
              ? `<button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--remove" data-action="remove-service-variant" data-index="${i}" aria-label="Usuń wariant ${i + 1}" title="Usuń">
                  <span aria-hidden="true">×</span>
                </button>`
              : `<span class="avail-edit__icon-spacer" aria-hidden="true"></span>`
          }
          ${
            isLast
              ? `<button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="add-service-variant" aria-label="Dodaj wariant ceny i czasu" title="Dodaj">
                  <span aria-hidden="true">+</span>
                </button>`
              : `<span class="avail-edit__icon-spacer" aria-hidden="true"></span>`
          }
        </div>`;
      })
      .join("");
    return `
      <div class="service-edit__variants" data-role="service-edit-variants">
        <div class="service-edit__variants-list">${rows}</div>
      </div>`;
  }

  function addServiceVariant() {
    captureServiceEditDraft();
    const draft = window.AppState.params.provider && window.AppState.params.provider.editServiceDraft;
    if (!draft) return;
    const variants = Array.isArray(draft.variants) ? draft.variants.slice() : normalizeEditVariants(draft);
    const last = variants[variants.length - 1] || { durationMin: 30, price: null };
    variants.push({
      id: "v-" + Date.now().toString(36),
      durationMin: last.durationMin || 30,
      price: last.price == null ? null : last.price,
      label: "",
    });
    draft.variants = variants;
    draft.durationMin = variants[0].durationMin;
    draft.price = variants[0].price;
    window.AppState.params.provider.editServiceDraft = draft;
    saveState();
    renderAll();
  }

  function removeServiceVariant(index) {
    captureServiceEditDraft();
    const draft = window.AppState.params.provider && window.AppState.params.provider.editServiceDraft;
    if (!draft) return;
    const variants = Array.isArray(draft.variants) ? draft.variants.slice() : normalizeEditVariants(draft);
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= variants.length || variants.length <= 1) return;
    variants.splice(i, 1);
    draft.variants = variants;
    draft.durationMin = variants[0].durationMin;
    draft.price = variants[0].price;
    window.AppState.params.provider.editServiceDraft = draft;
    saveState();
    renderAll();
  }

  function renderServiceEditPhotos(photos) {
    const items = (photos || [])
      .map(function (url, index) {
        return `
        <div class="service-edit__photo">
          <img class="service-edit__photo-img" src="${escapeHtml(url)}" alt="Zdjęcie ${index + 1}" />
          <button type="button" class="service-edit__photo-remove" data-action="remove-service-photo" data-index="${index}" aria-label="Usuń zdjęcie ${index + 1}">×</button>
        </div>`;
      })
      .join("");
    const canAdd = (photos || []).length < 6;
    return `
      <div class="service-edit__field">
        <span class="service-edit__label">Zdjęcia usługi</span>
        <div class="service-edit__photos">
          ${items}
          ${
            canAdd
              ? `<label class="service-edit__photo-add">
                   <span class="service-edit__photo-add-icon" aria-hidden="true">+</span>
                   <span class="service-edit__photo-add-text">Dodaj</span>
                   <input type="file" class="service-edit__photo-file" accept="image/*" multiple data-action="add-service-photos" tabindex="-1" />
                 </label>`
              : ""
          }
        </div>
        <span class="service-edit__hint">Do 6 zdjęć · JPG/PNG</span>
      </div>`;
  }

  function renderServiceEditLocations(s, provider) {
    const locs = ensureProviderLocations(provider);
    if (!locs.length) {
      return `
        <div class="service-edit__field" data-field="locations">
          <span class="service-edit__label">Miejsce wykonywania</span>
          <p class="service-edit__hint">Dodaj lokalizacje w Ustawieniach — wtedy wybierzesz je tu dla oferty.</p>
        </div>`;
    }
    const all = serviceAllowsAllLocations(s);
    const selected = {};
    (Array.isArray(s.locationIds) ? s.locationIds : []).forEach(function (id) {
      selected[id] = true;
    });
    const checks = locs
      .map(function (loc) {
        const on = all || !!selected[loc.id];
        const tone = locationToneClass(provider, loc.id);
        return `
          <button type="button" class="service-edit__loc-check${on ? " is-on" : ""}" data-action="service-location-toggle"
            data-role="service-location-check" data-loc-id="${escapeHtml(loc.id)}"
            aria-pressed="${on ? "true" : "false"}">
            <span class="service-edit__loc-dot ${escapeHtml(tone)}" aria-hidden="true"></span>
            <span class="service-edit__loc-text">
              <span class="service-edit__loc-name">${escapeHtml(loc.label || "Miejsce")}</span>
              ${loc.address ? `<span class="service-edit__loc-addr">${escapeHtml(loc.address)}</span>` : ""}
            </span>
            <span class="service-edit__loc-mark" aria-hidden="true"></span>
          </button>`;
      })
      .join("");
    return `
      <div class="service-edit__field" data-field="locations">
        <span class="service-edit__label">Miejsce wykonywania</span>
        <div class="service-edit__locs" data-role="service-location-list" role="group" aria-label="Miejsce wykonywania usługi">
          ${checks}
        </div>
      </div>`;
  }

  function renderServiceEditForm(s, isNew, opts) {
    opts = opts || {};
    const hideBack = !!opts.hideBack;
    const p = myProvider();
    const serviceId = isNew ? "__new__" : s.id;
    const photos = getEditServicePhotos();
    const variants = normalizeEditVariants(s);
    const mode = normalizeBookingMode(s.bookingMode);
    const head = hideBack
      ? `<header class="screen-head">
          <h2 class="screen-head__title">${isNew ? "Nowa usługa" : "Edytuj usługę"}</h2>
        </header>`
      : `<header class="screen-head screen-head--with-back">
          <button type="button" class="screen-head__back" data-action="cancel-edit-service" aria-label="Wróć">
            <span class="screen-head__back-icon" aria-hidden="true"></span>
          </button>
          <h2 class="screen-head__title">${isNew ? "Nowa usługa" : "Edytuj usługę"}</h2>
        </header>`;
    return `
      <form class="service-edit" data-service-id="${escapeHtml(serviceId)}" data-new="${isNew ? "true" : "false"}" onsubmit="return false;">
        ${head}
        <label class="service-edit__field service-edit__field--float">
          <input class="service-edit__input" name="name" type="text" required maxlength="80" value="${escapeHtml(s.name || "")}" placeholder=" " />
          <span class="service-edit__label">Nazwa</span>
        </label>
        <label class="service-edit__field service-edit__field--float">
          <textarea class="service-edit__input service-edit__textarea" name="description" rows="6" maxlength="500" placeholder=" ">${escapeHtml(s.description || s.subtitle || "")}</textarea>
          <span class="service-edit__label">Opis</span>
        </label>
        <div class="service-edit__field" data-field="bookingMode">
          <span class="service-edit__label">Jak klient rezerwuje</span>
          <div class="service-edit__mode-list service-edit__mode-list--category" data-role="service-booking-mode-panel">
            <div class="settings-contact__toggle service-edit__mode-toggle">
              <div class="settings__toggle-text">
                <span class="settings__hint">Klient rezerwuje jeden z dostępnych terminów</span>
              </div>
              <label class="settings__toggle" title="Klient rezerwuje jeden z dostępnych terminów">
                <input type="checkbox" class="avail-edit__switch" data-role="service-booking-mode-switch"
                  data-mode="confirm" data-group="confirm" ${
                    bookingModeGroup(mode) === "confirm" ? "checked" : ""
                  } aria-label="Klient rezerwuje jeden z dostępnych terminów" />
              </label>
            </div>
            <div class="settings-contact__toggle service-edit__mode-toggle">
              <div class="settings__toggle-text">
                <span class="settings__hint">Klient prosi o podanie terminu</span>
              </div>
              <label class="settings__toggle" title="Klient prosi o podanie terminu">
                <input type="checkbox" class="avail-edit__switch" data-role="service-booking-mode-switch"
                  data-mode="ask" data-group="ask" ${
                    bookingModeGroup(mode) === "ask" ? "checked" : ""
                  } aria-label="Klient prosi o podanie terminu" />
              </label>
            </div>
          </div>
          <input type="hidden" name="bookingMode" value="${escapeHtml(mode)}" data-role="service-booking-mode-value" />
        </div>
        ${renderServiceEditLocations(s, p)}
        ${renderServiceEditPhotos(photos)}
        ${renderServiceEditVariants(variants)}
        <div class="service-edit__actions">
          <button type="button" class="btn btn--primary" data-action="save-service" data-service-id="${escapeHtml(serviceId)}">${isNew ? "Dodaj" : "Zapisz"}</button>
          <button type="button" class="btn btn--ghost" data-action="cancel-edit-service">Anuluj</button>
        </div>
        ${
          isNew
            ? ""
            : `<div class="service-edit__danger">
          <button type="button" class="btn btn--quiet btn--quiet-danger service-edit__delete" data-action="delete-service" data-service-id="${escapeHtml(
            serviceId
          )}">Usuń usługę</button>
        </div>`
        }
      </form>`;
  }

  function renderProviderServicesGroupSeg(group, options, activeMode, pickMode) {
    if (pickMode) return "";
    const descHtml = activeMode
      ? `<p class="service-list__group-desc">${escapeHtml(bookingModeDescription(activeMode))}</p>`
      : `<div class="service-list__group-desc-list">
          ${options
            .map(function (opt) {
              return `<p class="service-list__group-desc">
                <span class="service-list__group-desc-label">${escapeHtml(opt.label)}</span>
                ${escapeHtml(bookingModeDescription(opt.mode))}
              </p>`;
            })
            .join("")}
        </div>`;
    return `<div class="service-list__mode-seg" role="group" aria-label="Typ rezerwacji">
      ${options
        .map(function (opt) {
          const on = activeMode === opt.mode;
          return `<button type="button" class="service-list__mode-seg-btn${on ? " is-on" : ""}" data-action="set-services-group-mode" data-group="${escapeHtml(
            group
          )}" data-mode="${escapeHtml(opt.mode)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(opt.label)}</button>`;
        })
        .join("")}
    </div>
    ${descHtml}
    <p class="service-list__group-hint">Dotyczy wszystkich ofert w tej grupie</p>`;
  }

  function renderProviderServicesListHtml(p, editId) {
    ensureServicesBookingMode(p);
    const all = (p && p.services) || [];
    const openBook = all.filter(function (s) {
      return bookingModeGroup(listServiceBookingMode(s, p)) === "confirm";
    });
    const requests = all.filter(function (s) {
      return bookingModeGroup(listServiceBookingMode(s, p)) === "ask";
    });
    const confirmMode = activeModeForBookingGroup(p, "confirm");
    const askMode = activeModeForBookingGroup(p, "ask");
    const pickMode = providerServicesPickMode();
    const pickIds = providerServicesPickIds();
    const totalCount = (p && p.services ? p.services.length : 0) || 0;

    function rowHtml(s) {
      const thumb = servicePhotos(s)[0];
      const variants = serviceVariants(s);
      const defId = defaultServiceVariantId(s);
      const resolved = resolveServiceVariant(s, defId);
      const mode = listServiceBookingMode(s, p);
      const modeLabel = bookingModeLabel(mode);
      const locLabel = serviceLocationSummary(s, p);
      const selected = !pickMode && editId && editId === s.id;
      const picked = pickMode && pickIds.indexOf(s.id) !== -1;
      const rowAction = pickMode ? "toggle-service-pick" : "edit-service";
      const rowLabel = pickMode
        ? (picked ? "Odznacz" : "Zaznacz") + " " + (s.name || "usługę")
        : "Edytuj " + (s.name || "usługę");
      return `
      <div class="service-row service-row--static${variants.length ? " service-row--has-variants" : ""}${
        selected ? " is-selected" : ""
      }${pickMode ? " service-row--pick" : ""}${picked ? " is-picked" : ""}" data-action="${rowAction}" data-service-id="${escapeHtml(
        s.id
      )}" role="button" tabindex="0"
        aria-pressed="${pickMode ? (picked ? "true" : "false") : selected ? "true" : "false"}" aria-label="${escapeHtml(rowLabel)}">
        <div class="service-row__top">
          ${
            pickMode
              ? `<span class="service-row__select service-row__select--checkbox${
                  picked ? " service-row__select--on" : ""
                }" aria-hidden="true"><span class="service-row__select-mark"></span></span>`
              : ""
          }
          ${
            thumb
              ? `<img class="service-row__thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
              : `<span class="service-row__thumb service-row__thumb--empty" aria-hidden="true"></span>`
          }
          <div class="service-row__static-main">
            <span class="service-row__body">
              <span class="service-row__name">${escapeHtml(s.name)}</span>
              <span class="service-row__sub">${escapeHtml(serviceListSummary(s))}</span>
              <span class="service-row__mode service-row__mode--${escapeHtml(mode)}">${escapeHtml(modeLabel)}</span>
              <span class="service-row__locs">${escapeHtml(locLabel)}</span>
            </span>
            <span class="service-row__meta">
              <span class="service-row__dur">${escapeHtml(formatDuration(resolved.durationMin))}</span>
              <span class="service-row__price">${escapeHtml(formatPrice(resolved.price))}</span>
            </span>
          </div>
          ${
            pickMode
              ? ""
              : `<button type="button" class="service-row__edit" data-action="edit-service" data-service-id="${escapeHtml(
                  s.id
                )}" aria-label="Edytuj ${escapeHtml(s.name)}" title="Edytuj">
            <span class="service-row__edit-icon" aria-hidden="true"></span>
          </button>`
          }
        </div>
        ${renderServiceVariantCarousel(s, null, { interactive: false })}
      </div>`;
    }

    let list = "";
    list += `<div class="service-list__group-head">
          <h4 class="service-list__group-title">Typ rezerwacji — klient wybiera termin</h4>
          ${renderProviderServicesGroupSeg(
            "confirm",
            [
              { mode: "auto", label: "Dowolny wybór" },
              { mode: "queue", label: "Kolejka" },
            ],
            confirmMode,
            pickMode
          )}
        </div>${
          openBook.length
            ? openBook.map(rowHtml).join("")
            : `<p class="empty-note service-list__group-empty">Brak ofert w tej grupie.</p>`
        }`;
    list += `<div class="service-list__sep service-list__sep--divider">
          <h4 class="service-list__group-title">Typ rezerwacji — na prośbę</h4>
          ${renderProviderServicesGroupSeg(
            "ask",
            [
              { mode: "approval", label: "Z wyborem dnia" },
              { mode: "request", label: "Bez wyboru dnia" },
            ],
            askMode,
            pickMode
          )}
        </div>${
          requests.length
            ? requests.map(rowHtml).join("")
            : `<p class="empty-note service-list__group-empty">Brak ofert w tej grupie.</p>`
        }`;

    const pickBtn =
      totalCount > 0
        ? `<button type="button" class="screen-head__text-btn" data-action="toggle-services-pick">${
            pickMode ? "Anuluj" : "Wybierz"
          }</button>`
        : "";

    return `
          <header class="screen-head screen-head--services">
            <div class="screen-head__text">
              <h2 class="screen-head__title">Usługi</h2>
            </div>
            ${pickBtn}
          </header>
          <div class="service-list${pickMode ? " service-list--pick" : ""}">${list}</div>`;
  }

  function renderServicesFab() {
    if (providerServicesPickMode()) return "";
    return `<button type="button" class="prov-cal-fab service-list-fab" data-action="add-service" aria-label="Dodaj usługę" title="Dodaj usługę">
      <span class="prov-cal-fab__icon" aria-hidden="true">+</span>
    </button>`;
  }

  function renderServicesPickBar() {
    if (!providerServicesPickMode()) return "";
    const pickCount = providerServicesPickIds().length;
    return `<div class="service-list__pick-bar" role="toolbar" aria-label="Akcje zaznaczenia">
      <span class="service-list__pick-count">${
        pickCount ? escapeHtml(String(pickCount) + " zazn.") : "Zaznacz oferty"
      }</span>
      <button type="button" class="btn btn--danger service-list__pick-delete" data-action="delete-selected-services"${
        pickCount ? "" : " disabled"
      }>Usuń${pickCount ? " (" + pickCount + ")" : ""}</button>
    </div>`;
  }

  function renderServices() {
    const p = myProvider();
    const editId = window.AppState.params.provider && window.AppState.params.provider.editServiceId;
    const isNew = editId === "__new__";
    const base = isNew ? newServiceDraft() : editId ? getProviderService(editId) : null;
    const editing = base ? applyServiceEditDraft(base) : null;
    const desktop = usesDesktopLayout();

    // Desktop: lista (szerokość pulpitu) | edycja (pusta albo wybrana usługa).
    if (desktop) {
      const editPane = editing
        ? `<div class="app-scroll app-scroll--svc-edit">${renderServiceEditForm(editing, isNew, {
            hideBack: true,
          })}</div>`
        : `<div class="prov-svc__empty" data-role="prov-svc-empty">
            <p class="prov-svc__empty-title">Edycja usługi</p>
            <p class="prov-svc__empty-text">Wybierz usługę z listy po lewej, aby zobaczyć i zmienić jej szczegóły.</p>
          </div>`;
      return `
      <div class="app-screen app-screen--provider app-screen--services app-screen--services-desktop${
        editing ? " app-screen--services-editing" : ""
      }${providerServicesPickMode() ? " app-screen--services-pick" : ""}">
        <div class="prov-svc" data-role="prov-svc">
          <aside class="prov-svc__list" data-role="prov-svc-list" aria-label="Lista usług">
            <div class="app-scroll app-scroll--svc-side">
              ${renderProviderServicesListHtml(p, editId)}
            </div>
            ${renderServicesFab()}
          </aside>
          <section class="prov-svc__edit" data-role="prov-svc-edit" aria-label="Panel edycji usługi">
            ${editPane}
          </section>
        </div>
        ${providerBottomNav("services")}
        ${renderServicesPickBar()}
      </div>`;
    }

    if (editing) {
      return `
      <div class="app-screen app-screen--provider app-screen--service-edit">
        <div class="app-scroll">
          ${renderServiceEditForm(editing, isNew)}
        </div>
        ${providerBottomNav("services")}
      </div>`;
    }

    return `
      <div class="app-screen app-screen--provider app-screen--services${
        providerServicesPickMode() ? " app-screen--services-pick" : ""
      }">
        <div class="app-scroll">
          ${renderProviderServicesListHtml(p, null)}
        </div>
        ${providerBottomNav("services")}
        ${renderServicesFab()}
        ${renderServicesPickBar()}
      </div>`;
  }

  function providerServicesPickMode() {
    const params = window.AppState.params.provider || {};
    return !!params.servicesPickMode;
  }

  function providerServicesPickIds() {
    const params = window.AppState.params.provider || {};
    return Array.isArray(params.servicesPickIds) ? params.servicesPickIds.slice() : [];
  }

  function setProviderServicesPickMode(on) {
    const params = Object.assign({}, window.AppState.params.provider || {});
    if (on) {
      params.servicesPickMode = true;
      if (!Array.isArray(params.servicesPickIds)) params.servicesPickIds = [];
    } else {
      delete params.servicesPickMode;
      delete params.servicesPickIds;
    }
    window.AppState.params.provider = params;
  }

  function toggleProviderServicePick(serviceId) {
    if (!serviceId) return;
    const params = Object.assign({}, window.AppState.params.provider || {});
    const ids = Array.isArray(params.servicesPickIds) ? params.servicesPickIds.slice() : [];
    const idx = ids.indexOf(serviceId);
    if (idx === -1) ids.push(serviceId);
    else ids.splice(idx, 1);
    params.servicesPickMode = true;
    params.servicesPickIds = ids;
    window.AppState.params.provider = params;
    saveState();
    renderAll();
  }

  function openEditService(serviceId) {
    const s = getProviderService(serviceId);
    if (!s) return;
    if (providerServicesPickMode()) {
      toggleProviderServicePick(serviceId);
      return;
    }
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceId: serviceId,
      editServicePhotos: Array.isArray(s.photos) ? s.photos.slice() : [],
      editServiceDraft: null,
    });
    setProviderServicesPickMode(false);
    window.AppState.screen.provider = "services";
    saveState();
    renderAll();
  }

  function openAddService(group) {
    const p = myProvider();
    const g = group === "ask" || group === "confirm" ? group : "confirm";
    const mode = defaultModeForBookingGroup(p, g);
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceId: "__new__",
      editServicePhotos: [],
      editServiceDraft: { bookingMode: mode },
    });
    setProviderServicesPickMode(false);
    window.AppState.screen.provider = "services";
    saveState();
    renderAll();
  }

  function cancelEditService() {
    if (window.AppState.params.provider) {
      delete window.AppState.params.provider.editServiceId;
      delete window.AppState.params.provider.editServicePhotos;
      delete window.AppState.params.provider.editServiceDraft;
    }
    saveState();
    renderAll();
  }

  function removeServicePhoto(index) {
    captureServiceEditDraft();
    const photos = getEditServicePhotos();
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= photos.length) return;
    photos.splice(i, 1);
    setEditServicePhotos(photos);
    saveState();
    renderAll();
  }

  function addServicePhotosFromFiles(fileList) {
    captureServiceEditDraft();
    const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!files.length) {
      showToast("Wybierz pliki graficzne.");
      return;
    }
    const photos = getEditServicePhotos();
    const room = 6 - photos.length;
    if (room <= 0) {
      showToast("Możesz dodać maksymalnie 6 zdjęć.");
      return;
    }
    const toRead = files.slice(0, room);
    let pending = toRead.length;
    toRead.forEach(function (file) {
      if (file.size > 2.5 * 1024 * 1024) {
        showToast("Jedno ze zdjęć jest za duże (max 2,5 MB).");
        pending -= 1;
        if (pending === 0) {
          setEditServicePhotos(photos);
          saveState();
          renderAll();
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        photos.push(String(reader.result || ""));
        pending -= 1;
        if (pending === 0) {
          setEditServicePhotos(photos);
          saveState();
          renderAll();
          showToast(toRead.length === 1 ? "Zdjęcie dodane." : "Zdjęcia dodane.");
        }
      };
      reader.onerror = function () {
        pending -= 1;
        if (pending === 0) {
          setEditServicePhotos(photos);
          saveState();
          renderAll();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function saveService(serviceId, form) {
    const p = myProvider();
    if (!p || !form) return;
    const isNew = serviceId === "__new__";
    let s = isNew ? null : getProviderService(serviceId);
    if (!isNew && !s) return;

    const name = String(form.elements.name && form.elements.name.value || "").trim();
    const description = String(form.elements.description && form.elements.description.value || "").trim();
    const variants = readServiceEditVariantsFromForm(form);
    const photos = getEditServicePhotos();
    const first = variants[0];

    if (!name) {
      showToast("Podaj nazwę usługi.");
      return;
    }
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!Number.isFinite(v.durationMin) || v.durationMin < 5) {
        showToast("Podaj poprawny czas trwania.");
        return;
      }
      if (v.price != null && (!Number.isFinite(v.price) || v.price < 0)) {
        showToast("Podaj poprawną cenę.");
        return;
      }
    }

    const durationMin = Math.round(first.durationMin);
    const price = first.price;

    let bookingMode = normalizeBookingMode(
      (form.elements.bookingMode && form.elements.bookingMode.value) || readServiceEditBookingMode(form)
    );
    // Wariant szczegółowy bierze się z koszyka na liście — przy zapisie dopasuj do grupy.
    {
      const group = bookingModeGroup(bookingMode);
      const peers = ((p && p.services) || []).filter(function (svc) {
        if (!svc || svc.id === serviceId) return false;
        return bookingModeGroup(serviceBookingMode(svc, p)) === group;
      });
      if (peers.length) {
        bookingMode = serviceBookingMode(peers[0], p);
      } else {
        bookingMode = group === "ask"
          ? bookingMode === "request"
            ? "request"
            : "approval"
          : bookingMode === "queue"
            ? "queue"
            : "auto";
      }
    }

    const locIdsRaw = readServiceEditLocationIds(form);
    const validLocIds = ensureProviderLocations(p).map(function (l) {
      return l.id;
    });
    let locationIds = null;
    if (Array.isArray(locIdsRaw)) {
      if (!locIdsRaw.length) {
        showToast("Wybierz przynajmniej jedno miejsce.");
        return;
      }
      locationIds = locIdsRaw.filter(function (id) {
        return validLocIds.indexOf(id) !== -1;
      });
      if (!locationIds.length) {
        showToast("Wybierz przynajmniej jedno miejsce.");
        return;
      }
    }

    if (isNew) {
      if (!Array.isArray(p.services)) p.services = [];
      s = {
        id: "svc-" + Date.now().toString(36),
        name: name,
        bookingMode: bookingMode,
        durationMin: durationMin,
        price: price,
        photos: photos,
      };
      if (description) s.description = description;
      if (locationIds) s.locationIds = locationIds;
      if (variants.length > 1) {
        s.variants = variants.map(function (v, i) {
          return {
            id: s.id + "-v" + (i + 1),
            durationMin: Math.round(v.durationMin),
            price: v.price,
            label: v.label || "",
          };
        });
      }
      p.services.push(s);
    } else {
      s.name = name;
      s.description = description || undefined;
      delete s.subtitle;
      s.bookingMode = bookingMode;
      s.durationMin = durationMin;
      s.price = price;
      s.photos = photos;
      if (locationIds) s.locationIds = locationIds;
      else delete s.locationIds;
      if (variants.length > 1) {
        s.variants = variants.map(function (v, i) {
          return {
            id: v.id && String(v.id).indexOf(s.id) === 0 ? v.id : s.id + "-v" + (i + 1),
            durationMin: Math.round(v.durationMin),
            price: v.price,
            label: v.label || "",
          };
        });
      } else {
        delete s.variants;
      }
    }

    if (window.AppState.params.provider) {
      delete window.AppState.params.provider.editServiceId;
      delete window.AppState.params.provider.editServicePhotos;
      delete window.AppState.params.provider.editServiceDraft;
    }
    saveState();
    renderAll();
    showToast(isNew ? "Usługa dodana." : "Usługa zapisana.");
  }

  function ensureDeleteServiceDialog() {
    let el = document.getElementById("delete-service-dialog");
    if (el) return el;
    el = document.createElement("div");
    el.id = "delete-service-dialog";
    el.className = "cancel-visit-dialog delete-service-dialog";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "delete-service-title");
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closeDeleteServiceDialog() {
    const el = document.getElementById("delete-service-dialog");
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    delete el.dataset.serviceIds;
    document.body.classList.remove("cancel-visit-dialog-open");
  }

  function openDeleteServiceDialog(serviceIds) {
    const ids = (Array.isArray(serviceIds) ? serviceIds : [serviceIds]).filter(Boolean);
    if (!ids.length) return;
    const p = myProvider();
    const names = ids
      .map(function (id) {
        const s = getProviderService(id);
        return s && s.name ? s.name : "";
      })
      .filter(Boolean);
    const count = ids.length;
    const title = count === 1 ? "Usunąć usługę?" : "Usunąć " + count + " usługi?";
    const lead =
      count === 1
        ? names[0]
          ? "„" + names[0] + "” zniknie z oferty widocznej dla klientów."
          : "Ta usługa zniknie z oferty widocznej dla klientów."
        : "Wybrane oferty znikną z listy widocznej dla klientów.";
    const el = ensureDeleteServiceDialog();
    el.dataset.serviceIds = ids.join(",");
    el.innerHTML = `
      <button type="button" class="cancel-visit-dialog__backdrop" data-action="close-delete-service" aria-label="Zamknij"></button>
      <div class="cancel-visit-dialog__panel">
        <h2 class="cancel-visit-dialog__title" id="delete-service-title">${escapeHtml(title)}</h2>
        <p class="cancel-visit-dialog__lead">${escapeHtml(lead)}</p>
        <div class="cancel-visit-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="close-delete-service">Anuluj</button>
          <button type="button" class="btn btn--danger" data-action="confirm-delete-service">Usuń</button>
        </div>
      </div>`;
    el.hidden = false;
    document.body.classList.add("cancel-visit-dialog-open");
  }

  function deleteServices(serviceIds) {
    const p = myProvider();
    if (!p || !Array.isArray(p.services)) return;
    const ids = (Array.isArray(serviceIds) ? serviceIds : [serviceIds]).filter(Boolean);
    if (!ids.length) return;
    const idSet = {};
    ids.forEach(function (id) {
      idSet[id] = true;
    });
    p.services = p.services.filter(function (s) {
      return s && !idSet[s.id];
    });
    const params = window.AppState.params.provider || {};
    if (params.editServiceId && idSet[params.editServiceId]) {
      delete params.editServiceId;
      delete params.editServicePhotos;
      delete params.editServiceDraft;
    }
    params.servicesPickIds = (params.servicesPickIds || []).filter(function (id) {
      return !idSet[id];
    });
    if (!params.servicesPickIds.length) {
      delete params.servicesPickMode;
      delete params.servicesPickIds;
    }
    window.AppState.params.provider = params;
    closeDeleteServiceDialog();
    saveState();
    renderAll();
    showToast(ids.length === 1 ? "Usługa usunięta." : "Usunięto " + ids.length + " usługi.");
    hapticTap(16);
  }

  function mondayISOFrom(dateISO) {
    const d = new Date(dateISO + "T12:00:00");
    if (isNaN(d.getTime())) return demoTodayISO();
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function ensureAvailWeekStart() {
    if (window.AppState.availWeekStart) return window.AppState.availWeekStart;
    window.AppState.availWeekStart = mondayISOFrom(demoTodayISO());
    return window.AppState.availWeekStart;
  }

  /** Aktualnie ustawiony dzień: najbliższy (od dziś) z dostępnością, inaczej „dziś”. */
  function firstUpcomingAvailDate() {
    const p = myProvider();
    const today = demoTodayISO();
    const isos = ((p && p.availability) || [])
      .map(function (d) {
        return d.dateISO;
      })
      .filter(function (iso) {
        return iso >= today;
      })
      .sort();
    return isos[0] || today;
  }

  function ensureAvailFocusDate() {
    if (!window.AppState.availFocusDate) {
      window.AppState.availFocusDate = firstUpcomingAvailDate();
    }
    return window.AppState.availFocusDate;
  }

  /** Wejście na ekran dostępności: wyśrodkuj kalendarz na aktualnie ustawionym dniu. */
  function openAvailability() {
    const focus = firstUpcomingAvailDate();
    window.AppState.availFocusDate = focus;
    window.AppState.availWeekStart = mondayISOFrom(focus);
    window.AppState.availStripScrollLeft = null;
    window.AppState.availPickerMonth = String(focus).slice(0, 7);
    window.AppState.availEditDate = null;
    navigate("provider", "availability", {});
  }

  /** Pasek kalendarza: poprzedni miesiąc → +2 miesiące względem „dziś” (kilka miesięcy naraz). */
  function availWeekDays(weekStartISO) {
    const start = new Date(weekStartISO + "T12:00:00");
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()));
    }
    return out;
  }

  function scrollAvailStripByWeeks(deltaWeeks) {
    const grid = document.querySelector('[data-role="avail-week-grid"]');
    if (!grid) return;
    const col = grid.querySelector(".avail-week__col");
    const step = ((col && col.offsetWidth) || 74) + 7;
    grid.scrollBy({ left: deltaWeeks * 7 * step, behavior: "smooth" });
  }

  function ensureAvailPickerMonth() {
    if (window.AppState.availPickerMonth) return window.AppState.availPickerMonth;
    const focus = ensureAvailFocusDate() || demoTodayISO();
    window.AppState.availPickerMonth = String(focus).slice(0, 7);
    return window.AppState.availPickerMonth;
  }

  function shiftAvailPickerMonth(delta) {
    const cur = ensureAvailPickerMonth();
    const parts = cur.split("-");
    const y = Number(parts[0]) || 2026;
    const m = Number(parts[1]) || 1;
    const d = new Date(y, m - 1 + Number(delta || 0), 1);
    window.AppState.availPickerMonth = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    saveState();
    // Tylko panel miesiąca — slide, bez pełnego renderAll (bez błysku).
    refreshAvailMonthOnly({ monthDir: Number(delta) > 0 ? 1 : -1 });
  }

  function goAvailToday() {
    const today = demoTodayISO();
    window.AppState.availFocusDate = today;
    window.AppState.availWeekStart = mondayISOFrom(today);
    window.AppState.availPickerMonth = today.slice(0, 7);
    window.AppState.availEditDate = null;
    saveState();
    renderAll();
    scrollAvailListToDate(today);
  }

  /** Przesuń listę dostępności o całe tygodnie (góra = poprzedni, dół = następny). */
  /** Panel miesiąca (jak w kalendarzu wizyt) — kropki = dni z ustawioną dostępnością. */
  /** Do 3 unikalnych tonów lokalizacji z bloków dnia (kolejność pierwszego wystąpienia). */
  function availDayToneSlots(provider, blocks) {
    const slots = ["", "", ""];
    const seen = Object.create(null);
    let n = 0;
    (blocks || []).forEach(function (b) {
      if (n >= 3) return;
      const key = b.locationId == null ? "" : String(b.locationId);
      if (seen[key]) return;
      seen[key] = true;
      slots[n] = locationToneClass(provider, b.locationId);
      n += 1;
    });
    return slots;
  }

  function toggleAvailMonthPanel() {
    // Na desktopie kalendarz jest stałą kolumną — nie chowamy go toggle’em.
    if (usesDesktopLayout()) return;
    window.AppState.availMonthOpen = !window.AppState.availMonthOpen;
    saveState();
    renderAll();
  }

  // Poprzedni top (px) podświetlenia — przeżywa re-render, żeby tydzień „jechał” animacją.
  let availWeekHlPrevTopPx = null;

  /** Wiersz siatki miesiąca (0..5) dla poniedziałku tygodnia listy; -1 = poza widokiem. */
  function availMonthWeekRow(year, month, startPad, weekMondayISO) {
    const monday = new Date(String(weekMondayISO) + "T12:00:00");
    if (isNaN(monday.getTime())) return -1;
    const gridStart = new Date(year, month - 1, 1 - startPad, 12, 0, 0);
    const days = Math.round((monday.getTime() - gridStart.getTime()) / 86400000);
    const row = Math.floor(days / 7);
    if (row < 0 || row > 5) return -1;
    return row;
  }

  /** Płynne przesunięcie podświetlenia tygodnia — pozycja z realnej geometrii komórek. */
  function animateAvailWeekHighlight() {
    const nodes = document.querySelectorAll('[data-role="avail-week-highlight"]');
    let applied = false;
    nodes.forEach(function (hl) {
      const grid = hl.parentElement;
      // Pomiń ukryte instancje (telefon w tle) — inaczej offsetHeight=0 psuje fullscreen.
      if (!grid || grid.offsetWidth < 8) return;
      const row = Number(hl.getAttribute("data-row"));
      if (isNaN(row) || row < 0) {
        hl.style.opacity = "0";
        return;
      }
      const cells = grid.querySelectorAll('.gcal-month__day[data-grid-row="' + row + '"]');
      let cell = null;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].offsetHeight > 0) {
          cell = cells[i];
          break;
        }
      }
      if (!cell) {
        hl.style.opacity = "0";
        return;
      }
      const top = cell.offsetTop;
      const prev = availWeekHlPrevTopPx == null || isNaN(availWeekHlPrevTopPx) ? top : availWeekHlPrevTopPx;
      hl.style.height = cell.offsetHeight + "px";
      hl.style.opacity = "1";
      hl.style.transition = "none";
      hl.style.transform = "translateY(" + prev + "px)";
      void hl.offsetHeight;
      hl.style.transition = "";
      hl.style.transform = "translateY(" + top + "px)";
      if (!applied) {
        availWeekHlPrevTopPx = top;
        applied = true;
      }
    });
    if (!applied) availWeekHlPrevTopPx = null;
  }

  function renderAvailMonthPanel(provider, selectedISO, availByDate, opts) {
    const forceOpen = !!(opts && opts.force);
    if (!forceOpen && !window.AppState.availMonthOpen) return "";
    const pickerMonth = ensureAvailPickerMonth();
    const parts = pickerMonth.split("-");
    const year = Number(parts[0]) || 2026;
    const month = Number(parts[1]) || 1;
    const today = demoTodayISO();
    const first = new Date(year, month - 1, 1);
    const startPad = (first.getDay() + 6) % 7;
    const totalCells = 42; // zawsze 6 tygodni
    // Tydzień z listy poniżej (Pn–Nd), nie „dzień w środku miesiąca”.
    const weekStartISO = mondayISOFrom(selectedISO || ensureAvailFocusDate() || today);
    const weekRow = availMonthWeekRow(year, month, startPad, weekStartISO);
    const gridStart = new Date(year, month - 1, 1 - startPad, 12, 0, 0);
    let cells = "";
    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const cellYear = cellDate.getFullYear();
      const cellMonth = cellDate.getMonth() + 1;
      const day = cellDate.getDate();
      const dateISO = cellYear + "-" + pad(cellMonth) + "-" + pad(day);
      const outside = cellYear !== year || cellMonth !== month;
      const inWeek = mondayISOFrom(dateISO) === weekStartISO;
      const isToday = dateISO === today;
      const blocks = (availByDate && availByDate[dateISO]) || [];
      const hasAvail = blocks.length > 0;
      const tones = availDayToneSlots(provider, blocks);
      const red = !outside && (isSunday(dateISO) || isRedCalendarDay(dateISO));
      const dotsHtml = tones
        .map(function (tone) {
          return `<span class="gcal-month__day-dot${tone ? " is-on " + tone : ""}" aria-hidden="true"></span>`;
        })
        .join("");
      const cellRow = Math.floor(i / 7);
      cells += `
        <button type="button"
          class="gcal-month__day${outside ? " gcal-month__day--outside" : ""}${isToday ? " gcal-month__day--today" : ""}${hasAvail ? " gcal-month__day--busy" : ""}${inWeek ? " gcal-month__day--week" : ""}${red ? " gcal-month__day--red" : ""}"
          data-action="avail-jump-date" data-date="${escapeHtml(dateISO)}" data-grid-row="${cellRow}"
          aria-label="${day}${outside ? ", inny miesiąc" : ""}${hasAvail ? ", dostępność" : ""}${inWeek ? ", wybrany tydzień" : ""}">
          <span class="gcal-month__day-dots" aria-hidden="true">${dotsHtml}</span>
          <span class="gcal-month__day-num">${day}</span>
        </button>`;
    }
    return `
      <div class="gcal-month gcal-month--avail" data-role="avail-month-panel">
        <div class="gcal-month__viewport" data-role="avail-month-viewport">
          <div class="gcal-month__cal" data-role="avail-month-swipe">
            <div class="gcal-month__weekdays">${CAL_WEEKDAYS.map(function (w) {
              return `<span>${w}</span>`;
            }).join("")}</div>
            <div class="gcal-month__grid" data-role="avail-month-grid" data-month="${escapeHtml(pickerMonth)}" data-week-start="${escapeHtml(weekStartISO)}">
              <span class="gcal-month__wk" data-role="avail-week-highlight" data-row="${weekRow}" data-week-start="${escapeHtml(weekStartISO)}" aria-hidden="true"></span>
              ${cells}
            </div>
          </div>
        </div>
      </div>`;
  }

  function updateAvailMonthLabels(pickerMonth) {
    const monthLabel = monthLabelFromISO(pickerMonth + "-01");
    document.querySelectorAll('[data-role="avail-week-month"]').forEach(function (el) {
      el.textContent = monthLabel;
      const btn = el.closest(".prov-cal__tool--month-label");
      if (btn) btn.setAttribute("aria-label", monthLabel);
    });
  }

  /**
   * Podmiana siatki miesiąca ze slide (dir: 1 = następny z prawej, -1 = poprzedni z lewej).
   * dir 0 = crosfade bez slide.
   */
  function swapAvailMonthPanels(panelHtml, direction) {
    const dir = Number(direction) || 0;
    const panels = document.querySelectorAll('[data-role="avail-month-panel"]');
    if (!panels.length) {
      if (!panelHtml) return;
      document.querySelectorAll('.app-screen--avail [data-role="avail-cal"]').forEach(function (hostCol) {
        const host = document.createElement("div");
        host.innerHTML = panelHtml;
        const next = host.firstElementChild;
        if (next) hostCol.appendChild(next);
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(animateAvailWeekHighlight);
      });
      return;
    }

    panels.forEach(function (panel) {
      if (!panelHtml) {
        panel.remove();
        return;
      }
      if (panel.offsetWidth < 8) {
        const host = document.createElement("div");
        host.innerHTML = panelHtml;
        const next = host.firstElementChild;
        if (next && panel.parentNode) panel.parentNode.replaceChild(next, panel);
        return;
      }

      const viewport = panel.querySelector('[data-role="avail-month-viewport"]') || panel;
      const oldCal = panel.querySelector('[data-role="avail-month-swipe"]');
      const host = document.createElement("div");
      host.innerHTML = panelHtml;
      const nextPanel = host.firstElementChild;
      const newCal = nextPanel && nextPanel.querySelector('[data-role="avail-month-swipe"]');
      if (!oldCal || !newCal) {
        if (nextPanel && panel.parentNode) panel.parentNode.replaceChild(nextPanel, panel);
        return;
      }

      // Bez kierunku — krótki fade zamiast twardego blink.
      if (!dir) {
        panel.classList.add("gcal-month--avail-fade");
        window.setTimeout(function () {
          if (panel.parentNode) panel.parentNode.replaceChild(nextPanel, panel);
          requestAnimationFrame(function () {
            requestAnimationFrame(animateAvailWeekHighlight);
          });
        }, 140);
        return;
      }

      const height = oldCal.offsetHeight;
      viewport.style.height = height + "px";
      viewport.classList.add("gcal-month__viewport--slide");
      newCal.classList.add("gcal-month__cal--incoming");
      newCal.style.transform = "translateX(" + (dir > 0 ? "100%" : "-100%") + ")";
      // newCal wychodzi z nextPanel — po animacji wstawiamy świeży HTML, nie pusty nextPanel.
      viewport.appendChild(newCal);
      void viewport.offsetWidth;
      oldCal.classList.add("gcal-month__cal--outgoing");
      oldCal.style.transform = "translateX(" + (dir > 0 ? "-100%" : "100%") + ")";
      newCal.style.transform = "translateX(0)";

      let done = false;
      function finish() {
        if (done) return;
        done = true;
        if (!panel.parentNode) return;
        // Świeży markup — nextPanel jest już bez siatki (przeniesionej do animacji).
        const cleanHost = document.createElement("div");
        cleanHost.innerHTML = panelHtml;
        const cleanPanel = cleanHost.firstElementChild;
        if (cleanPanel) panel.parentNode.replaceChild(cleanPanel, panel);
        else panel.remove();
        // Upewnij się, że panel miesiąca zostaje otwarty po swipe.
        window.AppState.availMonthOpen = true;
        requestAnimationFrame(function () {
          requestAnimationFrame(animateAvailWeekHighlight);
        });
      }
      newCal.addEventListener(
        "transitionend",
        function (event) {
          if (event.propertyName && event.propertyName.indexOf("transform") === -1) return;
          finish();
        },
        { once: true }
      );
      window.setTimeout(finish, 420);
    });
  }

  /** Tylko etykieta + siatka miesiąca (swipe miesiąca), bez przebudowy listy. */
  function refreshAvailMonthOnly(opts) {
    const p = myProvider();
    if (!p) return;
    const focusDate = ensureAvailFocusDate();
    const pickerMonth = ensureAvailPickerMonth();
    const availByDate = collectAvailByDate(p);
    updateAvailMonthLabels(pickerMonth);
    availWeekHlPrevTopPx = null;
    swapAvailMonthPanels(
      renderAvailMonthPanel(p, focusDate, availByDate, { force: usesDesktopLayout() }),
      opts && opts.monthDir
    );
  }

  function initAvailStripScroll(grid) {
    if (!grid) return;
    if (typeof window.AppState.availStripScrollLeft === "number") {
      grid.scrollLeft = window.AppState.availStripScrollLeft;
    } else {
      const focusISO = ensureAvailFocusDate() || demoTodayISO();
      const col =
        grid.querySelector('.avail-week__col[data-date="' + focusISO + '"]') ||
        grid.querySelector('.avail-week__col[data-date="' + (ensureAvailWeekStart() || focusISO) + '"]');
      if (col) grid.scrollLeft = Math.max(0, col.offsetLeft - grid.clientWidth / 2 + col.offsetWidth / 2);
    }
    updateAvailMonthLabel(grid);
  }

  function handleAvailStripScroll(grid) {
    if (!grid) return;
    window.AppState.availStripScrollLeft = grid.scrollLeft;
    const iso = updateAvailMonthLabel(grid);
    if (iso) window.AppState.availWeekStart = mondayISOFrom(iso);
  }

  function prepareAvailListForDate(dateISO) {
    if (!dateISO) return false;
    if (document.querySelector('.avail-day-group[data-date="' + dateISO + '"]')) return false;
    let changed = false;
    const weekStart = mondayISOFrom(dateISO);
    if (window.AppState.availWeekStart !== weekStart) {
      window.AppState.availWeekStart = weekStart;
      changed = true;
    }
    // Dzień bez dostępności — otwórz edycję, żeby pojawił się na liście.
    if (window.AppState.availEditDate !== dateISO) {
      const p = myProvider();
      const draft = ensureAvailDraft(dateISO);
      if (draft && p && (!draft.blocks || !draft.blocks.length)) {
        draft.blocks.push(defaultAvailBlock(p));
      }
      window.AppState.availEditDate = dateISO;
      changed = true;
    }
    if (changed) {
      saveState();
      renderAll();
    }
    return changed;
  }

  function scrollAvailListToDate(dateISO) {
    if (!dateISO) return;
    window.AppState.availFocusDate = dateISO;
    prepareAvailListForDate(dateISO);

    function runScroll() {
      const body = document.querySelector('[data-role="avail-body"]');
      const group = document.querySelector('.avail-day-group[data-date="' + dateISO + '"]');
      if (!body || !group) return;

      const bodyRect = body.getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const nextTop = body.scrollTop + (groupRect.top - bodyRect.top) - 10;
      body.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });

      group.classList.remove("avail-day-group--flash");
      void group.offsetWidth;
      group.classList.add("avail-day-group--flash");
      window.clearTimeout(scrollAvailListToDate._flashTimer);
      scrollAvailListToDate._flashTimer = window.setTimeout(function () {
        group.classList.remove("avail-day-group--flash");
      }, 1100);
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(runScroll);
    });
  }

  /**
   * Stary mostek do poziomego paska tygodnia (jeśli jeszcze w DOM).
   * Zmiana tygodnia dostępności — tylko klik w kalendarz miesiąca, nie gest na liście.
   */
  function bindAvailWeekScrollBridge() {
    if (bindAvailWeekScrollBridge.done) return;
    bindAvailWeekScrollBridge.done = true;

    document.addEventListener(
      "wheel",
      function (event) {
        const week = event.target.closest(".avail-week");
        if (!week) return;
        const grid = week.querySelector('[data-role="avail-week-grid"]');
        if (!grid) return;
        const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!dx) return;
        event.preventDefault();
        grid.scrollLeft += dx;
        handleAvailStripScroll(grid);
      },
      { passive: false }
    );

    const availDrag = {
      active: false,
      el: null,
      startX: 0,
      startScroll: 0,
      moved: false,
      pointerId: null,
    };

    document.addEventListener(
      "pointerdown",
      function (event) {
        if (event.button !== 0) return;
        const grid = event.target.closest('[data-role="avail-week-grid"]');
        if (!grid) return;
        availDrag.active = true;
        availDrag.el = grid;
        availDrag.startX = event.clientX;
        availDrag.startScroll = grid.scrollLeft;
        availDrag.moved = false;
        availDrag.pointerId = event.pointerId;
        grid.classList.add("avail-week__grid--dragging");
        try {
          grid.setPointerCapture(event.pointerId);
        } catch (err) {
          /* ignore */
        }
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!availDrag.active || !availDrag.el) return;
        const dx = event.clientX - availDrag.startX;
        if (Math.abs(dx) > 4) availDrag.moved = true;
        if (!availDrag.moved) return;
        event.preventDefault();
        availDrag.el.scrollLeft = availDrag.startScroll - dx;
        handleAvailStripScroll(availDrag.el);
      },
      { capture: true, passive: false }
    );

    function endAvailDrag() {
      if (!availDrag.active) return;
      if (availDrag.el) {
        availDrag.el.classList.remove("avail-week__grid--dragging");
        try {
          if (availDrag.pointerId != null) availDrag.el.releasePointerCapture(availDrag.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
      availDrag.active = false;
      availDrag.el = null;
      availDrag.pointerId = null;
    }

    document.addEventListener("pointerup", endAvailDrag, true);
    document.addEventListener("pointercancel", endAvailDrag, true);

    document.addEventListener(
      "click",
      function (event) {
        if (!availDrag.moved) return;
        if (!event.target.closest || !event.target.closest('[data-role="avail-week-grid"]')) {
          availDrag.moved = false;
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        availDrag.moved = false;
      },
      true
    );
  }

  const AVAIL_MAX_BLOCKS_PER_DAY = 3;

  const AVAIL_REPEAT_OPTIONS = [
    { id: "none", label: "Nie powtarzaj" },
    { id: "weekly", label: "Co tydzień" },
    { id: "biweekly", label: "Co drugi tydzień" },
  ];

  function normalizeAvailRepeat(block) {
    if (!block) return "none";
    const id = block.repeat;
    if (id === "daily") return "weekly";
    if (id === "none" || id === "weekly" || id === "biweekly") return id;
    return block.recurring ? "weekly" : "none";
  }

  function availRepeatLabel(repeatId) {
    const opt = AVAIL_REPEAT_OPTIONS.find(function (o) {
      return o.id === repeatId;
    });
    return opt ? opt.label : "Nie powtarzaj";
  }

  function normalizeAvailTimeValue(value) {
    const parts = String(value || "09:00").split(":");
    let h = Number(parts[0]);
    let m = Number(parts[1]);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    return pad(h) + ":" + pad(m);
  }

  /**
   * Standardowy natywny picker godzin (koło na iOS, zegar na Androidzie).
   * Kluczowe: BEZ <label> naokoło (label re-dispatchuje tap i zamyka picker na mobile)
   * oraz BEZ appearance:none (to wyłącza natywny picker w WebKit).
   */
  function renderAvailTimeField(name, value, ariaLabel) {
    const v = normalizeAvailTimeValue(value);
    const side = name === "to" ? "to" : "from";
    return `<span class="avail-edit__time-wrap avail-edit__time-wrap--${side}" data-role="avail-time-field">
      <input class="avail-edit__time" type="time" name="${escapeHtml(name)}" value="${escapeHtml(v)}" step="300" required aria-label="${escapeHtml(ariaLabel)}" />
    </span>`;
  }

  function defaultAvailBlock(p) {
    const locId = p && p.locations && p.locations[0] ? p.locations[0].id : "";
    return {
      from: "09:00",
      to: "17:00",
      locationId: locId,
      repeat: "weekly",
      recurring: true,
    };
  }

  /**
   * Kolejny przedział startuje tam, gdzie kończy się ostatni — dzięki temu
   * dodanie nie tworzy od razu konfliktu, a lokalizacja i rytm są dziedziczone.
   */
  function nextAvailBlock(p, blocks) {
    const base = defaultAvailBlock(p);
    const last = (blocks || [])[(blocks || []).length - 1];
    if (!last || !last.to) return base;
    const start = timeToMinutes(last.to);
    if (isNaN(start) || start >= 23 * 60 + 30) return base;
    const end = Math.min(start + 120, 23 * 60 + 59);
    const repeat = normalizeAvailRepeat(last);
    return {
      from: minToTime(start),
      to: minToTime(end),
      locationId: last.locationId || base.locationId,
      repeat: repeat,
      recurring: repeat !== "none",
    };
  }

  function buildAvailDraftFromProvider(p, dateISO) {
    const day = (p.availability || []).find(function (d) {
      return d.dateISO === dateISO;
    });
    const blocks = (day && day.blocks ? day.blocks : []).map(function (b) {
      const repeat = normalizeAvailRepeat(b);
      return {
        from: b.from || "09:00",
        to: b.to || "17:00",
        locationId: b.locationId || defaultAvailBlock(p).locationId,
        repeat: repeat,
        recurring: repeat !== "none",
      };
    });
    return { dateISO: dateISO, blocks: blocks };
  }

  function ensureAvailDraft(dateISO) {
    if (!dateISO) return null;
    const p = myProvider();
    if (!p) return null;
    if (!window.AppState.availEditDrafts || typeof window.AppState.availEditDrafts !== "object") {
      window.AppState.availEditDrafts = {};
    }
    if (!window.AppState.availEditDrafts[dateISO]) {
      window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
    }
    window.AppState.availEditDraft = window.AppState.availEditDrafts[dateISO];
    return window.AppState.availEditDrafts[dateISO];
  }

  /** Tylko lista dni — bez ruszania kalendarza miesiąca (żadnego „odświeżenia” / animacji). */
  function refreshAvailListOnly() {
    const p = myProvider();
    const listEl = document.querySelector('[data-role="avail-list"]');
    if (!p || !listEl) {
      renderAll();
      return;
    }
    const weekStart =
      window.AppState.availWeekStart || mondayISOFrom(ensureAvailFocusDate() || demoTodayISO());
    const listHtml = renderAvailWeekListHtml(
      p,
      weekStart,
      collectAvailByDate(p),
      window.AppState.availEditDate || null
    );
    swapAvailWeekLists(listHtml, 0);
  }

  /** Otwórz edycję dnia na liście (pozostałe wiersze zostają zwinięte). */
  function openAvailDayEdit(dateISO) {
    if (!dateISO) return;
    const p = myProvider();
    const draft = ensureAvailDraft(dateISO);
    if (draft && p && (!draft.blocks || !draft.blocks.length)) {
      draft.blocks.push(defaultAvailBlock(p));
    }
    window.AppState.availEditDate = dateISO;
    // Nie ruszaj availFocusDate — inaczej kalendarz „mruga” animacją tygodnia.
    saveState();
    refreshAvailListOnly();
  }

  /**
   * Zwróć formularz z widoku, w którym użytkownik wykonał akcję.
   * Aplikacja renderuje równolegle symulator i fullscreen, więc globalne
   * querySelector może wskazać ukrytą kopię formularza ze starymi wartościami.
   */
  function availEditFormForDate(dateISO, source) {
    if (!dateISO) return null;
    const selector = '[data-role="avail-edit-form"][data-date="' + dateISO + '"]';
    if (source && source.closest) {
      const direct = source.matches && source.matches(selector) ? source : source.closest(selector);
      if (direct) return direct;
      const scope = source.closest(".avail-day-group, .app-screen, .app-mount");
      const scoped = scope && scope.querySelector(selector);
      if (scoped) return scoped;
    }
    const forms = Array.prototype.slice.call(document.querySelectorAll(selector));
    return (
      forms.find(function (form) {
        return form.offsetParent !== null;
      }) ||
      forms.find(function (form) {
        return form.closest("#app-fullscreen");
      }) ||
      forms[0] ||
      null
    );
  }

  function toggleAvailDayEdit(dateISO, source) {
    if (!dateISO) return;
    if (window.AppState.availEditDate === dateISO) {
      // Przycisk w stanie otwartym = Zapisz i zamknij.
      saveAvailDayEdit(dateISO, { quiet: true, source: source });
      window.AppState.availEditDate = null;
      saveState();
      refreshAvailListOnly();
      patchAvailMonthBusyDots();
      return;
    }
    openAvailDayEdit(dateISO);
  }

  function syncAvailDraftFromForm(dateISO, source) {
    const draft = ensureAvailDraft(dateISO);
    if (!draft) return null;
    const form = availEditFormForDate(dateISO, source);
    if (!form) return draft;
    const rows = form.querySelectorAll("[data-avail-block]");
    const blocks = [];
    rows.forEach(function (row) {
      const fromEl = row.querySelector('[name="from"]');
      const toEl = row.querySelector('[name="to"]');
      const locEl = row.querySelector('[name="locationId"]');
      const repeatEl = row.querySelector('[name="repeat"]');
      const from = fromEl ? fromEl.value : draft.blocks[blocks.length] && draft.blocks[blocks.length].from;
      const to = toEl ? toEl.value : draft.blocks[blocks.length] && draft.blocks[blocks.length].to;
      if (!from || !to) return;
      const repeat = normalizeAvailRepeat({ repeat: repeatEl ? repeatEl.value : "none" });
      blocks.push({
        from: from,
        to: to,
        locationId: locEl ? locEl.value : defaultAvailBlock(myProvider()).locationId,
        repeat: repeat,
        recurring: repeat !== "none",
      });
    });
    if (blocks.length) draft.blocks = blocks;
    return draft;
  }

  function addDaysISO(dateISO, deltaDays) {
    const d = new Date(String(dateISO) + "T12:00:00");
    if (isNaN(d.getTime())) return dateISO;
    d.setDate(d.getDate() + Number(deltaDays || 0));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** Zapis bloków dnia bez ruszania stanu edytora. */
  function setAvailDayBlocks(dateISO, blocks) {
    const p = myProvider();
    if (!p || !dateISO) return;
    if (!p.availability) p.availability = [];
    const existing = p.availability.findIndex(function (d) {
      return d.dateISO === dateISO;
    });
    const nextBlocks = Array.isArray(blocks) ? blocks : [];
    if (!nextBlocks.length) {
      if (existing !== -1) p.availability.splice(existing, 1);
    } else if (existing !== -1) {
      p.availability[existing].blocks = nextBlocks;
    } else {
      p.availability.push({ dateISO: dateISO, blocks: nextBlocks });
      p.availability.sort(function (a, b) {
        return a.dateISO.localeCompare(b.dateISO);
      });
    }
    if (window.AppState.availEditDrafts) {
      window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
    }
  }

  function writeAvailDayBlocks(dateISO, blocks) {
    const capped = Array.isArray(blocks) ? blocks.slice(0, AVAIL_MAX_BLOCKS_PER_DAY) : [];
    setAvailDayBlocks(dateISO, capped);
    const p = myProvider();
    window.AppState.availEditDraft = window.AppState.availEditDrafts
      ? window.AppState.availEditDrafts[dateISO]
      : null;
    window.AppState.availEditDate = dateISO;
    if (p && window.AppState.availEditDrafts && !window.AppState.availEditDrafts[dateISO]) {
      window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
      window.AppState.availEditDraft = window.AppState.availEditDrafts[dateISO];
    }
  }

  const AVAIL_REPEAT_HORIZON_DAYS = 90;

  function cloneAvailBlockForDate(p, dateISO, block, idx) {
    const repeat = normalizeAvailRepeat(block);
    return {
      id: "blk-" + (p && p.id ? p.id : "p") + "-" + dateISO + "-" + idx,
      from: block.from,
      to: block.to,
      locationId: block.locationId || defaultAvailBlock(p).locationId,
      repeat: repeat,
      recurring: repeat !== "none",
    };
  }

  /**
   * Rozszerza bloki „Co tydzień” / „Co drugi tydzień” na kolejne daty w oknie ~90 dni.
   * Na dniach docelowych podmienia bloki o tym samym typie powtórzenia; one-off zostają.
   */
  function expandAvailRepeats(sourceDateISO, blocks) {
    const p = myProvider();
    if (!p || !sourceDateISO || !blocks || !blocks.length) return;

    const horizonEnd = addDaysISO(sourceDateISO, AVAIL_REPEAT_HORIZON_DAYS);
    const seriesByType = {
      weekly: blocks.filter(function (b) {
        return normalizeAvailRepeat(b) === "weekly";
      }),
      biweekly: blocks.filter(function (b) {
        return normalizeAvailRepeat(b) === "biweekly";
      }),
    };

    Object.keys(seriesByType).forEach(function (repeatType) {
      const series = seriesByType[repeatType];
      if (!series.length) return;
      const step = repeatType === "biweekly" ? 14 : 7;
      let target = addDaysISO(sourceDateISO, step);
      while (target <= horizonEnd) {
        const existing = providerAvailBlocksForDate(target).map(function (b) {
          return Object.assign({}, b);
        });
        const kept = existing.filter(function (b) {
          return normalizeAvailRepeat(b) !== repeatType;
        });
        const merged = kept.concat(
          series.map(function (b, idx) {
            return cloneAvailBlockForDate(p, target, b, kept.length + idx);
          })
        );
        setAvailDayBlocks(target, merged);
        target = addDaysISO(target, step);
      }
    });
  }

  function blocksFromAvailForm(dateISO, source) {
    const p = myProvider();
    if (!p || !dateISO) return [];
    const form = availEditFormForDate(dateISO, source);
    if (!form) return [];
    const blocks = [];
    form.querySelectorAll("[data-avail-block]").forEach(function (row, idx) {
      const fromEl = row.querySelector('[name="from"]');
      const toEl = row.querySelector('[name="to"]');
      const locEl = row.querySelector('[name="locationId"]');
      const repeatEl = row.querySelector('[name="repeat"]');
      const from = fromEl ? fromEl.value : "";
      const to = toEl ? toEl.value : "";
      if (!from || !to) return;
      if (timeToMinutes(from) >= timeToMinutes(to)) return;
      const repeat = normalizeAvailRepeat({ repeat: repeatEl ? repeatEl.value : "none" });
      blocks.push({
        id: "blk-" + p.id + "-" + dateISO + "-" + idx,
        from: from,
        to: to,
        locationId: locEl ? locEl.value : defaultAvailBlock(p).locationId,
        repeat: repeat,
        recurring: repeat !== "none",
      });
    });
    return blocks;
  }

  function persistAvailDraft(dateISO) {
    const p = myProvider();
    const draft = ensureAvailDraft(dateISO);
    if (!p || !draft) return;
    const blocks = (draft.blocks || [])
      .filter(function (b) {
        return b && b.from && b.to && timeToMinutes(b.from) < timeToMinutes(b.to);
      })
      .map(function (b, idx) {
        const repeat = normalizeAvailRepeat(b);
        return {
          id: "blk-" + p.id + "-" + dateISO + "-" + idx,
          from: b.from,
          to: b.to,
          locationId: b.locationId || defaultAvailBlock(p).locationId,
          repeat: repeat,
          recurring: repeat !== "none",
        };
      });
    writeAvailDayBlocks(dateISO, blocks);
  }

  function addAvailEditBlock(dateISO, source) {
    const p = myProvider();
    if (!p || !dateISO) return;
    window.AppState.availEditDate = dateISO;
    const draft = syncAvailDraftFromForm(dateISO, source) || ensureAvailDraft(dateISO);
    if (!draft) return;
    if ((draft.blocks || []).length >= AVAIL_MAX_BLOCKS_PER_DAY) return;
    draft.blocks.push(nextAvailBlock(p, draft.blocks));
    persistAvailDraft(dateISO);
    saveState();
    refreshAvailListOnly();
  }

  function removeAvailEditBlock(dateISO, index, source) {
    const draft = syncAvailDraftFromForm(dateISO, source) || ensureAvailDraft(dateISO);
    if (!draft || !draft.blocks) return;
    const i = Number(index);
    if (isNaN(i) || i < 0 || i >= draft.blocks.length) return;
    draft.blocks.splice(i, 1);
    persistAvailDraft(dateISO);
    saveState();
    refreshAvailListOnly();
  }

  /** Czy dwa bloki należą do tej samej serii (godziny + lokalizacja + typ powtórzenia). */
  function availBlockSameSeries(a, b) {
    if (!a || !b) return false;
    const repeat = normalizeAvailRepeat(a);
    if (repeat === "none" || normalizeAvailRepeat(b) !== repeat) return false;
    return (
      a.from === b.from &&
      a.to === b.to &&
      String(a.locationId || "") === String(b.locationId || "")
    );
  }

  /**
   * Usuń całą serię powtórzeń bloku: ten dzień + kolejne wystąpienia
   * (co tydzień / co 2 tygodnie) w oknie horyzontu.
   */
  function clearAvailRecurringSeries(dateISO, index) {
    const p = myProvider();
    if (!p || !dateISO) return;
    syncAvailDraftFromForm(dateISO);
    const draft = ensureAvailDraft(dateISO);
    const i = Number(index);
    if (!draft || !draft.blocks || isNaN(i) || i < 0 || i >= draft.blocks.length) return;

    const template = Object.assign({}, draft.blocks[i]);
    const repeat = normalizeAvailRepeat(template);
    // Gdy kilka terminów ma identyczne godziny/lokalizację/powtarzanie,
    // usuń tylko wybrany z nich, a nie wszystkie pasujące bloki.
    const seriesOrdinal =
      draft.blocks.slice(0, i + 1).filter(function (b) {
        return availBlockSameSeries(b, template);
      }).length - 1;
    closeAvailSeriesCloud();

    if (repeat === "none") {
      removeAvailEditBlock(dateISO, i);
      showToast("Ten blok się nie powtarza — nie ma serii do usunięcia.");
      return;
    }

    const step = repeat === "biweekly" ? 14 : 7;
    const horizonEnd = addDaysISO(dateISO, AVAIL_REPEAT_HORIZON_DAYS);
    let target = dateISO;
    while (target <= horizonEnd) {
      const sourceBlocks =
        target === dateISO
          ? draft.blocks.map(function (b) {
              return Object.assign({}, b);
            })
          : providerAvailBlocksForDate(target).map(function (b) {
              return Object.assign({}, b);
            });
      let removeIndex = -1;
      if (target === dateISO) {
        removeIndex = i;
      } else {
        let matchOrdinal = -1;
        sourceBlocks.some(function (b, blockIndex) {
          if (!availBlockSameSeries(b, template)) return false;
          matchOrdinal += 1;
          if (matchOrdinal !== seriesOrdinal) return false;
          removeIndex = blockIndex;
          return true;
        });
      }
      if (removeIndex !== -1) {
        const next = sourceBlocks.slice();
        next.splice(removeIndex, 1);
        setAvailDayBlocks(target, next);
      }
      target = addDaysISO(target, step);
    }

    const left = providerAvailBlocksForDate(dateISO);
    if (left.length) {
      window.AppState.availEditDate = dateISO;
      if (window.AppState.availEditDrafts) {
        window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
        window.AppState.availEditDraft = window.AppState.availEditDrafts[dateISO];
      }
    } else {
      window.AppState.availEditDate = null;
      window.AppState.availEditDraft = null;
      if (window.AppState.availEditDrafts) {
        window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
      }
    }

    saveState();
    refreshAvailListOnly();
    patchAvailMonthBusyDots();
    showToast(
      repeat === "biweekly"
        ? "Usunięto serię (co drugi tydzień)."
        : "Usunięto serię (co tydzień)."
    );
  }

  function ensureAvailSeriesCloud() {
    let el = document.getElementById("avail-series-cloud");
    if (el) return el;
    el = document.createElement("div");
    el.id = "avail-series-cloud";
    el.className = "avail-series-cloud";
    el.setAttribute("data-role", "avail-series-cloud");
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closeAvailSeriesCloud() {
    const cloud = document.getElementById("avail-series-cloud");
    if (cloud) {
      cloud.hidden = true;
      cloud.innerHTML = "";
      cloud.style.visibility = "";
      cloud.removeAttribute("data-for-date");
      cloud.removeAttribute("data-for-index");
    }
  }

  /** Klik × → chmurka: Usuń dzień / Usuń serię. */
  function openAvailSeriesCloud(trigger) {
    if (!trigger) return;
    const dateISO = trigger.getAttribute("data-date");
    const index = trigger.getAttribute("data-index");
    if (!dateISO || index == null || index === "") return;

    const cloud = ensureAvailSeriesCloud();
    if (
      !cloud.hidden &&
      cloud.getAttribute("data-for-date") === dateISO &&
      cloud.getAttribute("data-for-index") === String(index)
    ) {
      closeAvailSeriesCloud();
      return;
    }

    syncAvailDraftFromForm(dateISO);
    const draft = ensureAvailDraft(dateISO);
    const block = draft && draft.blocks ? draft.blocks[Number(index)] : null;
    const hasSeries = !!(block && normalizeAvailRepeat(block) !== "none");

    cloud.setAttribute("data-for-date", dateISO);
    cloud.setAttribute("data-for-index", String(index));
    cloud.innerHTML =
      `<button type="button" class="avail-series-cloud__btn" data-action="clear-avail-day" data-date="${escapeHtml(dateISO)}">
        <span class="avail-series-cloud__icon" aria-hidden="true"></span>
        <span>Usuń dzień</span>
      </button>
      <button type="button" class="avail-series-cloud__btn${hasSeries ? "" : " is-disabled"}" data-action="clear-avail-recurring-series" data-date="${escapeHtml(dateISO)}" data-index="${escapeHtml(String(index))}"${hasSeries ? "" : " disabled aria-disabled=\"true\""}>
        <span class="avail-series-cloud__icon" aria-hidden="true"></span>
        <span>Usuń serię</span>
      </button>`;

    const dayBtn = cloud.querySelector('[data-action="clear-avail-day"]');
    if (dayBtn) {
      dayBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeAvailSeriesCloud();
        clearAvailDay(dateISO, { closeEdit: true });
      });
    }
    const seriesBtn = cloud.querySelector('[data-action="clear-avail-recurring-series"]');
    if (seriesBtn && hasSeries) {
      seriesBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        clearAvailRecurringSeries(dateISO, index);
      });
    }

    cloud.hidden = false;
    cloud.style.visibility = "hidden";
    const rect = trigger.getBoundingClientRect();
    const cloudRect = cloud.getBoundingClientRect();
    let top = rect.top - cloudRect.height - 10;
    let left = rect.right - cloudRect.width;
    if (top < 8) top = rect.bottom + 10;
    if (left < 8) left = 8;
    if (left + cloudRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - cloudRect.width - 8);
    }
    if (top + cloudRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - cloudRect.height - 8);
    }
    cloud.style.top = top + "px";
    cloud.style.left = left + "px";
    cloud.style.visibility = "visible";
  }

  function saveAvailDayEdit(dateISO, options) {
    const opts = options || {};
    if (!dateISO) return;
    ensureAvailDraft(dateISO);
    const blocks = blocksFromAvailForm(dateISO, opts.source);
    writeAvailDayBlocks(dateISO, blocks);
    expandAvailRepeats(dateISO, blocks);
    // Po ekspansji przywróć draft/edycję źródłowego dnia (expand pisał inne daty).
    if (window.AppState.availEditDrafts) {
      window.AppState.availEditDraft = window.AppState.availEditDrafts[dateISO] || null;
    }
    window.AppState.availEditDate = dateISO;
    // Draft trzyma też bloki niepoprawne (np. koniec przed startem), żeby wpisana
    // godzina nie znikała użytkownikowi z pola przy najbliższym re-renderze.
    syncAvailDraftFromForm(dateISO, opts.source);
    saveState();
    // Zmiana godziny: NIE przebudowujemy edytora, bo podmiana <input> w trakcie
    // potwierdzania natywnego pickera (iOS/Android) gubi właśnie wybraną wartość.
    if (opts.noRender) {
      patchAvailMonthBusyDots();
      return;
    }
    const scroller = document.querySelector('[data-role="avail-body"]');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    refreshAvailListOnly();
    // Kropki w kalendarzu — cicha aktualizacja bez animacji paska tygodnia.
    patchAvailMonthBusyDots();
    if (scrollTop) {
      requestAnimationFrame(function () {
        const again = document.querySelector('[data-role="avail-body"]');
        if (again) again.scrollTop = scrollTop;
      });
    }
  }

  function clearAvailDay(dateISO, options) {
    const opts = options || {};
    const p = myProvider();
    if (!p || !p.availability) return;
    p.availability = p.availability.filter(function (d) {
      return d.dateISO !== dateISO;
    });
    if (window.AppState.availEditDrafts) {
      window.AppState.availEditDrafts[dateISO] = buildAvailDraftFromProvider(p, dateISO);
    }
    if (opts.closeEdit) {
      window.AppState.availEditDate = null;
      window.AppState.availEditDraft = null;
    } else {
      window.AppState.availEditDraft = window.AppState.availEditDrafts
        ? window.AppState.availEditDrafts[dateISO]
        : null;
      window.AppState.availEditDate = dateISO;
    }
    saveState();
    refreshAvailListOnly();
    patchAvailMonthBusyDots();
    if (!opts.quiet) showToast("Usunięto dostępność w tym dniu.");
  }

  /** Odśwież kropki dostępności w siatce miesiąca bez animacji / przebudowy panelu. */
  function patchAvailMonthBusyDots() {
    const p = myProvider();
    if (!p) return;
    const availByDate = collectAvailByDate(p);
    document.querySelectorAll('[data-role="avail-month-grid"]').forEach(function (grid) {
      if (grid.offsetWidth < 8) return;
      grid.querySelectorAll(".gcal-month__day[data-date]").forEach(function (btn) {
        const iso = btn.getAttribute("data-date");
        const blocks = (availByDate && availByDate[iso]) || [];
        const hasAvail = blocks.length > 0;
        btn.classList.toggle("gcal-month__day--busy", hasAvail);
        const tones = availDayToneSlots(p, blocks);
        const dots = btn.querySelector('[aria-hidden="true"].gcal-month__day-dots') || btn.querySelector(".gcal-month__day-dots");
        if (!dots) return;
        dots.innerHTML = tones
          .map(function (tone) {
            return `<span class="gcal-month__day-dot${tone ? " is-on " + tone : ""}" aria-hidden="true"></span>`;
          })
          .join("");
      });
    });
  }

  function closeAvailPickMenus(except) {
    document
      .querySelectorAll(
        '[data-role="avail-loc-pick"].is-open, [data-role="avail-repeat-pick"].is-open'
      )
      .forEach(function (pick) {
        if (except && pick === except) return;
        pick.classList.remove("is-open");
        const btn = pick.querySelector(
          '[data-action="toggle-avail-loc"], [data-action="toggle-avail-repeat"]'
        );
        const menu = pick.querySelector(
          '[data-role="avail-loc-menu"], [data-role="avail-repeat-menu"]'
        );
        if (btn) btn.setAttribute("aria-expanded", "false");
        if (menu) menu.hidden = true;
      });
  }

  function toggleAvailPickMenu(pick, btn, menuRole) {
    if (!pick || !btn) return;
    const open = !pick.classList.contains("is-open");
    closeAvailPickMenus(open ? pick : null);
    pick.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const menu = pick.querySelector('[data-role="' + menuRole + '"]');
    if (menu) menu.hidden = !open;
  }

  function setAvailBlockLocation(dateISO, index, locationId, source) {
    const p = myProvider();
    if (!p || !dateISO || !locationId) return;
    const form = availEditFormForDate(dateISO, source);
    if (!form) return;
    const row = form.querySelector('[data-avail-block][data-index="' + index + '"]');
    if (!row) return;
    const pick = row.querySelector('[data-role="avail-loc-pick"]');
    const input = pick && pick.querySelector('[name="locationId"]');
    const labelEl = pick && pick.querySelector('[data-role="avail-loc-label"]');
    const tone = locationToneClass(p, locationId);
    if (input) input.value = locationId;
    if (labelEl) {
      const nextLabel = locationLabel(p, locationId) || "wybierz lokalizację";
      labelEl.textContent = nextLabel;
      labelEl.classList.toggle("avail-loc-pick__label--placeholder", !locationId);
    }
    const toneDot = pick && pick.querySelector('[data-role="avail-loc-tone-dot"]');
    if (toneDot) {
      toneDot.className = "avail-edit__loc-dot " + tone + (locationId ? "" : " is-hidden");
      toneDot.hidden = !locationId;
    }
    const times = row.querySelector('[data-role="avail-edit-times"]');
    if (times) {
      times.className = times.className.replace(/\bloc-tone-\d+\b/g, "").trim() + " " + tone;
    }
    pick &&
      pick.querySelectorAll("[data-action=pick-avail-loc]").forEach(function (opt) {
        const on = opt.getAttribute("data-location-id") === locationId;
        opt.classList.toggle("is-selected", on);
        opt.setAttribute("aria-selected", on ? "true" : "false");
      });
    closeAvailPickMenus();
    saveAvailDayEdit(dateISO, { quiet: true, source: form });
  }

  function setAvailBlockRepeat(dateISO, index, repeatId, source) {
    if (!dateISO) return;
    const repeat = normalizeAvailRepeat({ repeat: repeatId });
    const form = availEditFormForDate(dateISO, source);
    if (!form) return;
    const row = form.querySelector('[data-avail-block][data-index="' + index + '"]');
    if (!row) return;
    const pick = row.querySelector('[data-role="avail-repeat-pick"]');
    const input = pick && pick.querySelector('[name="repeat"]');
    const labelEl = pick && pick.querySelector('[data-role="avail-repeat-label"]');
    if (input) input.value = repeat;
    if (labelEl) labelEl.textContent = availRepeatLabel(repeat);
    pick &&
      pick.querySelectorAll("[data-action=pick-avail-repeat]").forEach(function (opt) {
        const on = opt.getAttribute("data-repeat") === repeat;
        opt.classList.toggle("is-selected", on);
        opt.setAttribute("aria-selected", on ? "true" : "false");
      });
    closeAvailPickMenus();
    saveAvailDayEdit(dateISO, { quiet: true, source: form });
  }

  /** Długość przedziału w minutach; null gdy godziny są niepoprawne. */
  function availBlockDurationMin(block) {
    if (!block || !block.from || !block.to) return null;
    const from = timeToMinutes(block.from);
    const to = timeToMinutes(block.to);
    if (isNaN(from) || isNaN(to) || to <= from) return null;
    return to - from;
  }

  /**
   * Zwraca komunikat walidacji dla bloku o indeksie `index` (albo "" gdy OK).
   * Kolejność: własny zakres godzin → nakładanie na inny blok tego dnia.
   */
  function availBlockIssue(blocks, index) {
    const list = blocks || [];
    const b = list[index];
    if (!b || !b.from || !b.to) return "Uzupełnij godzinę rozpoczęcia i zakończenia.";
    const from = timeToMinutes(b.from);
    const to = timeToMinutes(b.to);
    if (isNaN(from) || isNaN(to)) return "Uzupełnij godzinę rozpoczęcia i zakończenia.";
    if (to <= from) return "Koniec musi być późniejszy niż początek.";
    for (let i = 0; i < list.length; i++) {
      if (i === index) continue;
      const other = list[i];
      if (!other || !other.from || !other.to) continue;
      const oFrom = timeToMinutes(other.from);
      const oTo = timeToMinutes(other.to);
      if (isNaN(oFrom) || isNaN(oTo) || oTo <= oFrom) continue;
      if (from < oTo && oFrom < to) return "Ten przedział nakłada się na inny w tym dniu.";
    }
    return "";
  }

  /**
   * Odświeża w miejscu długość przedziału i komunikaty walidacji — bez re-renderu,
   * żeby natywny picker godzin nie gubił właśnie wybranej wartości.
   */
  function refreshAvailEditMeta(form) {
    if (!form) return;
    const rows = Array.prototype.slice.call(form.querySelectorAll("[data-avail-block]"));
    const blocks = rows.map(function (row) {
      const fromEl = row.querySelector('[name="from"]');
      const toEl = row.querySelector('[name="to"]');
      return { from: fromEl ? fromEl.value : "", to: toEl ? toEl.value : "" };
    });
    rows.forEach(function (row, i) {
      const durEl = row.querySelector('[data-role="avail-duration"]');
      const alertEl = row.querySelector('[data-role="avail-slot-alert"]');
      const min = availBlockDurationMin(blocks[i]);
      if (durEl) {
        durEl.textContent = min == null ? "" : formatDuration(min);
        durEl.hidden = min == null;
      }
      const issue = availBlockIssue(blocks, i);
      row.classList.toggle("is-invalid", !!issue);
      if (alertEl) {
        const textEl = alertEl.querySelector('[data-role="avail-slot-alert-text"]') || alertEl;
        textEl.textContent = issue;
        alertEl.hidden = !issue;
      }
      row.querySelectorAll("input.avail-edit__time").forEach(function (input) {
        input.setAttribute("aria-invalid", issue ? "true" : "false");
      });
    });
  }

  /** Edytor dnia w stylu Calendly: [od]–[do] ×  +  oraz miejsce / powtarzaj. */
  function renderAvailDayEditor(p, dateISO, draft) {
    const locs = p.locations || [];
    const blockList = draft.blocks || [];
    const dateAttr = escapeHtml(dateISO);

    if (!blockList.length) {
      return `
      <form class="avail-edit avail-edit--day" data-role="avail-edit-form" data-date="${dateAttr}" onsubmit="return false;">
        <div class="avail-edit__empty">
          <span class="avail-edit__empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.2 1.8" />
            </svg>
          </span>
          <span class="avail-edit__empty-text">
            <span class="avail-edit__empty-title">Dzień wolny</span>
            <span class="avail-edit__empty-sub">Klienci nie mogą tu nic zarezerwować.</span>
          </span>
          <button type="button" class="avail-edit__add" data-action="add-avail-block" data-date="${dateAttr}">
            <span class="avail-edit__add-icon" aria-hidden="true">+</span>
            <span>Dodaj godziny</span>
          </button>
        </div>
      </form>`;
    }

    const slots = blockList
      .map(function (b, i) {
        const locTone = locationToneClass(p, b.locationId);
        const hasLoc = !!(b.locationId && locationLabel(p, b.locationId));
        const locLabel = hasLoc ? locationLabel(p, b.locationId) : "wybierz lokalizację";
        const issue = availBlockIssue(blockList, i);
        const durationMin = availBlockDurationMin(b);
        const locMenu = (locs.length ? locs : [{ id: b.locationId || "", label: locLabel }])
          .map(function (l) {
            const tone = locationToneClass(p, l.id);
            const on = l.id === b.locationId;
            return `<button type="button" class="avail-loc-pick__opt ${tone}${on ? " is-selected" : ""}" role="option"
              data-action="pick-avail-loc" data-date="${dateAttr}" data-index="${i}"
              data-location-id="${escapeHtml(l.id)}" aria-selected="${on ? "true" : "false"}">
              <span class="avail-edit__loc-dot ${tone}" aria-hidden="true"></span>
              <span class="avail-loc-pick__opt-label">${escapeHtml(l.label)}</span>
            </button>`;
          })
          .join("");
        return `
        <div class="avail-edit__slot${issue ? " is-invalid" : ""}" data-avail-block data-index="${i}">
          <div class="avail-edit__slot-row">
            <div class="avail-edit__slot-times ${locTone}" data-role="avail-edit-times">
              <span class="avail-edit__time-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3.2 1.8" />
                </svg>
              </span>
              ${renderAvailTimeField("from", b.from || "09:00", "Godzina rozpoczęcia")}
              <span class="avail-edit__dash" aria-hidden="true">–</span>
              ${renderAvailTimeField("to", b.to || "17:00", "Godzina zakończenia")}
            </div>
            <span class="avail-edit__duration" data-role="avail-duration"${durationMin == null ? " hidden" : ""}>${durationMin == null ? "" : escapeHtml(formatDuration(durationMin))}</span>
            <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--remove" data-action="open-avail-remove-cloud" data-date="${dateAttr}" data-index="${i}"
              aria-label="Usuń przedział ${escapeHtml(b.from || "")}–${escapeHtml(b.to || "")}" title="Usuń dzień lub serię" aria-haspopup="menu">
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M7 7l10 10M17 7L7 17" />
                </svg>
              </span>
            </button>
          </div>
          <p class="avail-edit__alert" data-role="avail-slot-alert" role="status" aria-live="polite"${issue ? "" : " hidden"}>
            <span class="avail-edit__alert-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
            </span>
            <span data-role="avail-slot-alert-text">${escapeHtml(issue)}</span>
          </p>
          <div class="avail-edit__slot-loc">
            <div class="avail-loc-pick avail-loc-pick--compact" data-role="avail-loc-pick">
              <input type="hidden" name="locationId" value="${escapeHtml(b.locationId || "")}" />
              <button type="button" class="avail-loc-pick__btn" data-action="toggle-avail-loc"
                aria-haspopup="listbox" aria-expanded="false" aria-label="Wybierz lokalizację">
                <span class="avail-edit__loc-lead" aria-hidden="true">
                  <span class="avail-edit__loc-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <span class="avail-edit__loc-dot ${locTone}${hasLoc ? "" : " is-hidden"}" data-role="avail-loc-tone-dot"${hasLoc ? "" : " hidden"}></span>
                </span>
                <span class="avail-edit__loc-content">
                  <span class="avail-loc-pick__label${hasLoc ? "" : " avail-loc-pick__label--placeholder"}" data-role="avail-loc-label">${escapeHtml(locLabel)}</span>
                </span>
                <span class="avail-loc-pick__chevron" aria-hidden="true"></span>
              </button>
              <div class="avail-loc-pick__menu" data-role="avail-loc-menu" role="listbox" hidden>${locMenu}</div>
            </div>
          </div>
          <div class="avail-edit__slot-meta">
            <div class="avail-loc-pick avail-loc-pick--compact avail-repeat-pick" data-role="avail-repeat-pick">
              <input type="hidden" name="repeat" value="${escapeHtml(normalizeAvailRepeat(b))}" />
              <button type="button" class="avail-loc-pick__btn" data-action="toggle-avail-repeat"
                aria-haspopup="listbox" aria-expanded="false" aria-label="Powtarzaj">
                <span class="avail-edit__loc-lead" aria-hidden="true">
                  <span class="avail-edit__repeat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12a9 9 0 0 0-15.4-6.4" />
                      <path d="M3 4.5v5h5" />
                      <path d="M3 12a9 9 0 0 0 15.4 6.4" />
                      <path d="M21 19.5v-5h-5" />
                    </svg>
                  </span>
                </span>
                <span class="avail-edit__loc-content">
                  <span class="avail-loc-pick__label" data-role="avail-repeat-label">${escapeHtml(availRepeatLabel(normalizeAvailRepeat(b)))}</span>
                </span>
                <span class="avail-loc-pick__chevron" aria-hidden="true"></span>
              </button>
              <div class="avail-loc-pick__menu" data-role="avail-repeat-menu" role="listbox" hidden>
                ${AVAIL_REPEAT_OPTIONS.map(function (opt) {
                  const on = normalizeAvailRepeat(b) === opt.id;
                  return `<button type="button" class="avail-loc-pick__opt${on ? " is-selected" : ""}" role="option"
                    data-action="pick-avail-repeat" data-date="${dateAttr}" data-index="${i}"
                    data-repeat="${escapeHtml(opt.id)}" aria-selected="${on ? "true" : "false"}">
                    <span class="avail-loc-pick__opt-label">${escapeHtml(opt.label)}</span>
                  </button>`;
                }).join("")}
              </div>
            </div>
          </div>
        </div>`;
      })
      .join("");

    const canAdd = blockList.length < AVAIL_MAX_BLOCKS_PER_DAY;
    return `
      <form class="avail-edit avail-edit--day" data-role="avail-edit-form" data-date="${dateAttr}" onsubmit="return false;">
        <div class="avail-edit__slots">${slots}</div>
        ${
          canAdd
            ? `<button type="button" class="avail-edit__add" data-action="add-avail-block" data-date="${dateAttr}">
          <span class="avail-edit__add-icon" aria-hidden="true">+</span>
          <span>Dodaj przedział</span>
        </button>`
            : `<p class="avail-edit__limit">Maksymalnie ${AVAIL_MAX_BLOCKS_PER_DAY} przedziały w jednym dniu.</p>`
        }
      </form>`;
  }

  function collectAvailByDate(p) {
    const availByDate = {};
    (p ? p.availability || [] : []).forEach(function (d) {
      availByDate[d.dateISO] = d.blocks || [];
    });
    return availByDate;
  }

  function renderAvailWeekListHtml(p, weekStart, availByDate, editDate) {
    const AVAIL_DOW_PRINT = ["ND", "PN", "WT", "ŚR", "CZ", "PT", "SB"];
    return availWeekDays(weekStart)
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T12:00:00");
        const isEditing = editDate === dateISO;
        const draft = isEditing ? ensureAvailDraft(dateISO) : null;
        // Przy otwartej edycji nagłówek pokazuje draft (aktualne godziny), nie stary zapis.
        const blocks =
          isEditing && draft && Array.isArray(draft.blocks)
            ? draft.blocks
            : (availByDate && availByDate[dateISO]) || [];
        const red = isSunday(dateISO);
        const has = blocks.length > 0;
        const editor =
          isEditing && draft
            ? `<div class="avail-day avail-day--editing">${renderAvailDayEditor(p, dateISO, draft)}</div>`
            : "";
        const dateNum = pad(dt.getDate()) + "." + pad(dt.getMonth() + 1);
        // Przy otwartej edycji godziny tylko w formularzu — w nagłówku po zamknięciu panelu.
        const hoursHtml = isEditing
          ? ""
          : has
            ? blocks
                .map(function (b) {
                  const tone = locationToneClass(p, b.locationId);
                  return `<span class="avail-day__hours-row">
                  <span class="avail-day__loc-dot ${tone}" aria-hidden="true"></span>
                  <span class="avail-day__from">${escapeHtml(b.from || "—")}</span>
                  <span class="avail-day__hours-sep" aria-hidden="true">–</span>
                  <span class="avail-day__to">${escapeHtml(b.to || "—")}</span>
                </span>`;
                })
                .join("")
            : `<span class="avail-day__hours-row avail-day__hours-row--empty">—</span>`;
        const swipeLocked = !has || isEditing;
        return `
        <div class="avail-day-group${has ? "" : " avail-day-group--closed"}${isEditing ? " avail-day-group--open" : ""}" data-date="${escapeHtml(dateISO)}" id="avail-day-${escapeHtml(dateISO)}">
          <div class="avail-day__swipe${swipeLocked ? " avail-day__swipe--locked" : ""}" data-role="avail-day-swipe" data-date="${escapeHtml(dateISO)}">
            <button type="button" class="avail-day__swipe-action" data-action="swipe-clear-avail-day" data-date="${escapeHtml(dateISO)}"
              tabindex="${swipeLocked ? "-1" : "0"}" aria-hidden="${swipeLocked ? "true" : "false"}"
              aria-label="Usuń dostępność w dniu ${escapeHtml(dateNum)}">
              <span class="avail-day__swipe-trash" aria-hidden="true"></span>
            </button>
            <div class="avail-day__swipe-front" data-role="avail-day-swipe-front">
              <div class="avail-day__sep">
                <div class="avail-day__sep-main">
                  <span class="avail-day__dow${red ? " avail-day__dow--red" : ""}">${AVAIL_DOW_PRINT[dt.getDay()]}</span>
                  <span class="avail-day__date${red ? " avail-day__date--red" : ""}">${dateNum}</span>
                  ${hoursHtml ? `<span class="avail-day__hours">${hoursHtml}</span>` : ""}
                </div>
                <button type="button" class="avail-day__edit-btn${isEditing ? " is-on avail-day__edit-btn--save" : ""}"
                  data-action="toggle-avail-day-edit" data-date="${escapeHtml(dateISO)}"
                  aria-expanded="${isEditing ? "true" : "false"}"
                  aria-label="${isEditing ? "Zapisz" : "Edytuj"}"
                  title="${isEditing ? "Zapisz" : "Edytuj"}">
                  ${
                    isEditing
                      ? `<span class="avail-day__edit-label">Zapisz</span>`
                      : `<span class="avail-day__toggle-icon avail-day__toggle-icon--edit" aria-hidden="true"></span>`
                  }
                </button>
              </div>
            </div>
          </div>
          ${editor}
        </div>`;
      })
      .join("");
  }

  /** Aktualizacja zaznaczenia tygodnia na istniejącej siatce (bez przebudowy DOM). */
  function syncAvailMonthWeekChrome(focusDate) {
    const weekStart = mondayISOFrom(focusDate);
    const today = demoTodayISO();
    document.querySelectorAll('[data-role="avail-month-grid"]').forEach(function (grid) {
      if (grid.offsetWidth < 8) return;
      grid.setAttribute("data-week-start", weekStart);
      grid.querySelectorAll(".gcal-month__day[data-date]").forEach(function (btn) {
        const iso = btn.getAttribute("data-date");
        const inWeek = mondayISOFrom(iso) === weekStart;
        btn.classList.remove("gcal-month__day--on");
        btn.classList.toggle("gcal-month__day--today", iso === today);
        btn.classList.toggle("gcal-month__day--week", inWeek);
        btn.removeAttribute("aria-pressed");
      });
      let row = -1;
      availWeekDays(weekStart).some(function (iso) {
        const btn = grid.querySelector('.gcal-month__day[data-date="' + iso + '"]');
        if (!btn) return false;
        const r = Number(btn.getAttribute("data-grid-row"));
        if (isNaN(r)) return false;
        row = r;
        return true;
      });
      const hl = grid.querySelector('[data-role="avail-week-highlight"]');
      if (hl) {
        hl.setAttribute("data-row", String(row));
        hl.setAttribute("data-week-start", weekStart);
      }
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(animateAvailWeekHighlight);
    });
  }

  /**
   * Pionowy slide listy tygodnia (dir: 1 = następny tydzień z dołu, -1 = poprzedni z góry).
   */
  function swapAvailWeekLists(listHtml, direction) {
    const dir = Number(direction) || 0;
    const viewports = document.querySelectorAll('[data-role="avail-list-viewport"]');
    if (!viewports.length) {
      document.querySelectorAll('[data-role="avail-list"]').forEach(function (el) {
        el.innerHTML = listHtml;
      });
      return;
    }

    viewports.forEach(function (viewport) {
      if (viewport.offsetWidth < 8) {
        const track = viewport.querySelector('[data-role="avail-list"]');
        if (track) track.innerHTML = listHtml;
        return;
      }
      const oldTrack = viewport.querySelector('[data-role="avail-list"]');
      if (!oldTrack) {
        viewport.innerHTML = `<div class="avail-list" data-role="avail-list">${listHtml}</div>`;
        return;
      }
      if (!dir) {
        oldTrack.innerHTML = listHtml;
        return;
      }

      const newTrack = document.createElement("div");
      newTrack.className = "avail-list avail-list--incoming";
      newTrack.setAttribute("data-role", "avail-list");
      newTrack.innerHTML = listHtml;

      const height = Math.max(oldTrack.offsetHeight, 1);
      viewport.style.height = height + "px";
      viewport.classList.add("avail-list-viewport--slide");
      newTrack.style.transform = "translateY(" + (dir > 0 ? "100%" : "-100%") + ")";
      viewport.appendChild(newTrack);
      void viewport.offsetWidth;
      oldTrack.classList.add("avail-list--outgoing");
      oldTrack.style.transform = "translateY(" + (dir > 0 ? "-100%" : "100%") + ")";
      newTrack.style.transform = "translateY(0)";

      let done = false;
      function finish() {
        if (done) return;
        done = true;
        viewport.classList.remove("avail-list-viewport--slide");
        viewport.style.height = "";
        viewport.innerHTML = `<div class="avail-list" data-role="avail-list">${listHtml}</div>`;
      }
      newTrack.addEventListener(
        "transitionend",
        function (event) {
          if (event.propertyName && event.propertyName.indexOf("transform") === -1) return;
          finish();
        },
        { once: true }
      );
      window.setTimeout(finish, 420);
    });
  }

  /**
   * Lekkie odświeżenie widoku dostępności przy zmianie tygodnia:
   * lista + pasek (animacja), opcjonalnie przebudowa miesiąca gdy zmiana miesiąca.
   */
  function refreshAvailWeekView(opts) {
    const rebuildMonth = !!(opts && opts.rebuildMonth);
    const monthDir = opts && typeof opts.monthDir === "number" ? opts.monthDir : 0;
    const weekDir = opts && typeof opts.weekDir === "number" ? opts.weekDir : 0;
    const p = myProvider();
    if (!p) {
      renderAll();
      return;
    }
    const focusDate = ensureAvailFocusDate();
    const weekStart = mondayISOFrom(focusDate);
    window.AppState.availWeekStart = weekStart;
    const pickerMonth = ensureAvailPickerMonth();
    const availByDate = collectAvailByDate(p);
    const listHtml = renderAvailWeekListHtml(p, weekStart, availByDate, window.AppState.availEditDate || null);

    swapAvailWeekLists(listHtml, weekDir);
    updateAvailMonthLabels(pickerMonth);

    const existingGrids = document.querySelectorAll('[data-role="avail-month-grid"]');
    const canPatchGrid = !rebuildMonth && existingGrids.length > 0;
    if (canPatchGrid) {
      syncAvailMonthWeekChrome(focusDate);
      return;
    }

    // Zmiana miesiąca: slide zamiast twardego blink.
    availWeekHlPrevTopPx = null;
    swapAvailMonthPanels(
      renderAvailMonthPanel(p, focusDate, availByDate, { force: usesDesktopLayout() }),
      monthDir
    );
  }

  function renderAvailability() {
    const p = myProvider();
    const focusDate = ensureAvailFocusDate();
    const weekStart = mondayISOFrom(focusDate);
    window.AppState.availWeekStart = weekStart;
    const pickerMonth = ensureAvailPickerMonth();
    const availByDate = collectAvailByDate(p);
    const desktop = usesDesktopLayout();

    const monthLabel = monthLabelFromISO(pickerMonth + "-01");
    const monthOpen = desktop || !!window.AppState.availMonthOpen;
    const editDate = window.AppState.availEditDate || null;
    const list = renderAvailWeekListHtml(p, weekStart, availByDate, editDate);

    return `
      <div class="app-screen app-screen--provider app-screen--avail${desktop ? " app-screen--avail-desktop" : ""}">
        <div class="avail-top">
          <header class="screen-head screen-head--prov-cal">
            <div class="prov-cal-head">
              <div class="prov-cal-head__title-row">
                <button type="button" class="screen-head__back" data-action="provider-tab" data-tab="dashboard" aria-label="Wróć">
                  <span class="screen-head__back-icon" aria-hidden="true"></span>
                </button>
                <h2 class="screen-head__title">Dostępności</h2>
              </div>
              <div class="prov-cal-head__actions">
                <div class="prov-cal__tools" role="toolbar" aria-label="Narzędzia dostępności">
                  <button type="button" class="prov-cal__tool prov-cal__tool--month-label${monthOpen ? " is-on" : ""}${desktop ? " prov-cal__tool--month-static" : ""}"
                    data-action="avail-month-toggle"
                    aria-label="${escapeHtml(monthLabel)}" aria-pressed="${monthOpen ? "true" : "false"}"${desktop ? " disabled" : ""}>
                    <span class="prov-cal__month-name" data-role="avail-week-month">${escapeHtml(monthLabel)}</span>
                    <span class="prov-cal__month-chevron" aria-hidden="true"></span>
                  </button>
                </div>
                <button type="button" class="prov-cal__today-btn" data-action="avail-today">Dzisiaj</button>
              </div>
            </div>
          </header>
        </div>
        <div class="avail-main" data-role="avail-main">
          <aside class="avail-cal" data-role="avail-cal" aria-label="Kalendarz dostępności">
            ${renderAvailMonthPanel(p, focusDate, availByDate, { force: desktop })}
          </aside>
          <div class="avail-body" data-role="avail-body">
            <div class="avail-list__head">
              <h3 class="avail-list__heading">Godziny dostępności</h3>
            </div>
            <div class="avail-list-viewport" data-role="avail-list-viewport">
              <div class="avail-list" data-role="avail-list">${list}</div>
            </div>
          </div>
        </div>
        ${providerBottomNav("availability")}
      </div>`;
  }

  function renderSettingsLocations(p) {
    const locs = ensureProviderLocations(p).slice(0, SETTINGS_LOC_MAX);
    const canAdd = locs.length < SETTINGS_LOC_MAX;
    const cards = locs
      .map(function (loc, i) {
        const tone = locationToneIndex(p, loc.id);
        const toneBtns = SETTINGS_LOC_TONES.map(function (t) {
          return `<button type="button" class="settings-loc__tone loc-tone-${t}${t === tone ? " is-on" : ""}"
            data-action="settings-loc-tone" data-id="${escapeHtml(loc.id)}" data-tone="${t}"
            aria-label="Kolor ${t + 1}" aria-pressed="${t === tone ? "true" : "false"}"></button>`;
        }).join("");
        const isLast = i === locs.length - 1;
        return `
          <div class="settings-loc loc-tone-${tone}" data-loc-id="${escapeHtml(loc.id)}">
            <div class="settings-loc__head">
              <div class="settings-loc__color">
                <button type="button" class="settings-loc__swatch" data-action="settings-loc-color-toggle"
                  data-id="${escapeHtml(loc.id)}" aria-label="Wybierz kolor miejsca" aria-haspopup="true"
                  aria-expanded="false" title="Kolor miejsca"></button>
                <div class="settings-loc__palette" role="group" aria-label="Kolor miejsca">
                  <div class="settings-loc__palette-inner">${toneBtns}</div>
                </div>
              </div>
              <label class="settings-contact__field settings-contact__field--float settings-loc__name-field">
                <input type="text" class="settings-contact__input settings-loc__name" data-role="settings-loc-name" data-id="${escapeHtml(loc.id)}"
                  value="${escapeHtml(loc.label || "")}" placeholder=" " maxlength="40" autocomplete="off" />
                <span class="settings-contact__label">Nazwa miejsca</span>
              </label>
              <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--remove" data-action="settings-loc-remove" data-id="${escapeHtml(loc.id)}"
                aria-label="Usuń miejsce" title="Usuń">
                <span aria-hidden="true">×</span>
              </button>
              ${
                isLast && canAdd
                  ? `<button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="settings-loc-add"
                      aria-label="Dodaj miejsce" title="Dodaj">
                      <span aria-hidden="true">+</span>
                    </button>`
                  : `<span class="avail-edit__icon-spacer" aria-hidden="true"></span>`
              }
            </div>
            <label class="settings-contact__field settings-contact__field--float settings-loc__field">
              <input type="text" class="settings-contact__input settings-loc__address" data-role="settings-loc-address" data-id="${escapeHtml(loc.id)}"
                value="${escapeHtml(loc.address || "")}" placeholder=" " maxlength="120" autocomplete="street-address" />
              <span class="settings-contact__label">Adres</span>
            </label>
          </div>`;
      })
      .join("");
    const emptyAdd =
      !locs.length && canAdd
        ? `<div class="settings-loc settings-loc--empty">
            <div class="settings-loc__head">
              <span class="settings-loc__empty-label">Brak miejsc</span>
              <span class="avail-edit__icon-spacer" aria-hidden="true"></span>
              <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="settings-loc-add"
                aria-label="Dodaj miejsce" title="Dodaj">
                <span aria-hidden="true">+</span>
              </button>
            </div>
          </div>`
        : "";
    return `
      <div class="settings__row settings__row--locations" data-field="locations">
        <p class="settings__help">Do ${SETTINGS_LOC_MAX} miejsc wykonywania usług. Kolor widać w ofercie i w kalendarzu.</p>
        <div class="settings-locs">${cards || emptyAdd || `<p class="empty-note">Brak miejsc.</p>`}</div>
        ${!canAdd ? `<p class="settings__cap">Osiągnięto limit ${SETTINGS_LOC_MAX} miejsc.</p>` : ""}
      </div>`;
  }

  function closeSettingsLocColorPickers(exceptEl) {
    document.querySelectorAll(".settings-loc__color.is-open").forEach(function (el) {
      if (exceptEl && el === exceptEl) return;
      el.classList.remove("is-open");
      const btn = el.querySelector(".settings-loc__swatch");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function toggleSettingsLocColorPicker(locId, trigger) {
    const wrap = trigger && trigger.closest
      ? trigger.closest(".settings-loc__color")
      : document.querySelector('.settings-loc[data-loc-id="' + locId + '"] .settings-loc__color');
    if (!wrap) return;
    const willOpen = !wrap.classList.contains("is-open");
    closeSettingsLocColorPickers(willOpen ? wrap : null);
    wrap.classList.toggle("is-open", willOpen);
    const btn = wrap.querySelector(".settings-loc__swatch");
    if (btn) btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  function addProviderLocation() {
    const p = myProvider();
    if (!p) return;
    const locs = ensureProviderLocations(p);
    if (locs.length >= SETTINGS_LOC_MAX) {
      showToast("Możesz dodać maksymalnie " + SETTINGS_LOC_MAX + " miejsca.");
      return;
    }
    locs.push({
      id: "loc-" + Date.now(),
      label: "Nowe miejsce",
      address: "",
      toneIndex: nextLocationToneIndex(p),
    });
    saveState();
    renderAll();
  }

  function removeProviderLocation(locId) {
    const p = myProvider();
    if (!p || !locId) return;
    const locs = ensureProviderLocations(p);
    if (locs.length <= 1) {
      showToast("Zostaw przynajmniej jedno miejsce.");
      return;
    }
    p.locations = locs.filter(function (l) {
      return l.id !== locId;
    });
    saveState();
    renderAll();
  }

  function setProviderLocationTone(locId, tone) {
    const p = myProvider();
    if (!p || !locId) return;
    const locs = ensureProviderLocations(p);
    const loc = locs.find(function (l) {
      return l.id === locId;
    });
    if (!loc) return;
    const t = Number(tone);
    if (!isFinite(t)) return;
    loc.toneIndex = ((Math.floor(t) % 6) + 6) % 6;
    saveState();
    renderAll();
  }

  function captureProviderLocationFields() {
    const p = myProvider();
    if (!p) return;
    const locs = ensureProviderLocations(p);
    locs.forEach(function (loc) {
      const nameEl = document.querySelector(
        '[data-role="settings-loc-name"][data-id="' + loc.id + '"]'
      );
      const addrEl = document.querySelector(
        '[data-role="settings-loc-address"][data-id="' + loc.id + '"]'
      );
      if (nameEl) {
        const n = String(nameEl.value || "").trim();
        loc.label = n || loc.label || "Miejsce";
      }
      if (addrEl) loc.address = String(addrEl.value || "").trim();
    });
  }

  function captureProviderContactFields() {
    const p = myProvider();
    if (!p) return;
    ensureProviderContact(p);
    const phoneEl = document.querySelector('[data-role="settings-phone"]');
    const emailEl = document.querySelector('[data-role="settings-email"]');
    const emailVisEl = document.querySelector('[data-role="settings-email-visible"]');
    if (phoneEl) p.phone = String(phoneEl.value || "").trim();
    if (emailEl) p.email = String(emailEl.value || "").trim();
    if (emailVisEl) p.emailVisible = !!emailVisEl.checked;
    captureProviderSocialFields();
  }

  function captureProviderSocialFields() {
    const p = myProvider();
    if (!p) return;
    const links = ensureProviderSocialLinks(p);
    links.forEach(function (l) {
      const kindEl = document.querySelector(
        '[data-role="settings-social-kind"][data-id="' + l.id + '"]'
      );
      const valEl = document.querySelector(
        '[data-role="settings-social-value"][data-id="' + l.id + '"]'
      );
      if (kindEl) l.kind = socialKindMeta(kindEl.value).key;
      if (valEl) l.value = String(valEl.value || "").trim();
    });
    ensureProviderSocialLinks(p);
  }

  function addProviderSocialLink() {
    const p = myProvider();
    if (!p) return;
    captureProviderSocialFields();
    const links = ensureProviderSocialLinks(p);
    if (links.length >= SETTINGS_SOCIAL_MAX) {
      showToast("Możesz dodać maksymalnie " + SETTINGS_SOCIAL_MAX + " linki.");
      return;
    }
    const used = {};
    links.forEach(function (l) {
      used[l.kind] = true;
    });
    const nextKind =
      (SETTINGS_SOCIAL_KINDS.find(function (s) {
        return !used[s.key];
      }) || SETTINGS_SOCIAL_KINDS[0]).key;
    links.push({ id: "sl-" + Date.now(), kind: nextKind, value: "" });
    saveState();
    renderAll();
  }

  function removeProviderSocialLink(linkId) {
    const p = myProvider();
    if (!p || !linkId) return;
    captureProviderSocialFields();
    const links = ensureProviderSocialLinks(p);
    if (links.length <= 1) {
      links[0].value = "";
      saveState();
      renderAll();
      return;
    }
    p.socialLinks = links.filter(function (l) {
      return l.id !== linkId;
    });
    ensureProviderSocialLinks(p);
    saveState();
    renderAll();
  }

  function renderSettingsGroup(title, bodyHtml) {
    return `
      <section class="settings__group">
        <h3 class="settings__group-title">${escapeHtml(title)}</h3>
        <div class="settings__group-body">${bodyHtml}</div>
      </section>`;
  }

  /** Pole z pływającą etykietą (duża w ramce → mała nad treścią). */
  function renderSettingsFloatField(opts) {
    opts = opts || {};
    const tag = opts.tag === "textarea" || opts.tag === "select" ? opts.tag : "input";
    const role = escapeHtml(opts.role || "");
    const label = escapeHtml(opts.label || "");
    const extra = opts.attrs ? " " + opts.attrs : "";
    const selectClass = tag === "select" ? " settings-contact__field--select" : "";
    const areaClass = tag === "textarea" ? " settings-contact__textarea" : "";
    if (tag === "textarea") {
      return `
        <label class="settings-contact__field settings-contact__field--float">
          <textarea class="settings-contact__input${areaClass}" data-role="${role}" placeholder=" "${extra}>${escapeHtml(opts.value || "")}</textarea>
          <span class="settings-contact__label">${label}</span>
        </label>`;
    }
    if (tag === "select") {
      return `
        <label class="settings-contact__field settings-contact__field--float${selectClass}">
          <select class="settings-contact__input" data-role="${role}"${extra}>${opts.optionsHtml || ""}</select>
          <span class="settings-contact__label">${label}</span>
        </label>`;
    }
    return `
      <label class="settings-contact__field settings-contact__field--float">
        <input type="${escapeHtml(opts.type || "text")}" class="settings-contact__input" data-role="${role}"
          value="${escapeHtml(opts.value || "")}" placeholder=" "${extra} />
        <span class="settings-contact__label">${label}</span>
      </label>`;
  }

  function renderSettingsContact(p) {
    ensureProviderContact(p);
    const emailOn = !!p.emailVisible;
    return `
      <div class="settings__row settings__row--contact" data-field="contact">
        <p class="settings__help">Dane do kontaktu z klientem.</p>
        ${renderSettingsFloatField({
          label: "Telefon",
          role: "settings-phone",
          type: "tel",
          value: p.phone || "",
          attrs: 'autocomplete="tel" inputmode="tel"',
        })}
        ${renderSettingsFloatField({
          label: "E-mail",
          role: "settings-email",
          type: "email",
          value: p.email || "",
          attrs: 'autocomplete="email" inputmode="email"',
        })}
        <div class="settings-contact__toggle">
          <div class="settings__toggle-text">
            <span class="settings__hint">${emailOn ? "E-mail widoczny dla klientów" : "E-mail ukryty"}</span>
            <span class="settings-contact__toggle-hint">${emailOn ? "Klienci mogą napisać na ten adres" : "Tylko Ty widzisz ten adres w ustawieniach"}</span>
          </div>
          <label class="settings__toggle">
            <input type="checkbox" class="avail-edit__switch" data-role="settings-email-visible"
              ${emailOn ? "checked" : ""} aria-label="Widoczność adresu e-mail" />
          </label>
        </div>
      </div>`;
  }

  function renderSettingsSocial(p) {
    ensureProviderContact(p);
    const links = ensureProviderSocialLinks(p);
    const canAdd = links.length < SETTINGS_SOCIAL_MAX;
    const kindOptions = SETTINGS_SOCIAL_KINDS.map(function (s) {
      return `<option value="${escapeHtml(s.key)}">${escapeHtml(s.label)}</option>`;
    }).join("");
    const rows = links
      .map(function (l, i) {
        const meta = socialKindMeta(l.kind);
        const opts = SETTINGS_SOCIAL_KINDS.map(function (s) {
          return `<option value="${escapeHtml(s.key)}"${s.key === l.kind ? " selected" : ""}>${escapeHtml(s.label)}</option>`;
        }).join("");
        const isLast = i === links.length - 1;
        return `
          <div class="settings-social" data-social-id="${escapeHtml(l.id)}">
            <label class="settings-social__kind" title="${escapeHtml(meta.label)}">
              <span class="settings-social__logo settings-social__logo--${escapeHtml(l.kind)}" aria-hidden="true"></span>
              <select class="settings-social__kind-select" data-role="settings-social-kind" data-id="${escapeHtml(l.id)}"
                aria-label="Platforma">${opts || kindOptions}</select>
            </label>
            <input type="text" class="settings-social__input" data-role="settings-social-value" data-id="${escapeHtml(l.id)}"
              value="${escapeHtml(l.value || "")}" placeholder="${escapeHtml(meta.placeholder)}" autocomplete="off" />
            <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--remove" data-action="settings-social-remove" data-id="${escapeHtml(l.id)}"
              aria-label="Usuń link" title="Usuń">
              <span aria-hidden="true">×</span>
            </button>
            ${
              isLast && canAdd
                ? `<button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="settings-social-add"
                    aria-label="Dodaj link" title="Dodaj">
                    <span aria-hidden="true">+</span>
                  </button>`
                : `<span class="avail-edit__icon-spacer" aria-hidden="true"></span>`
            }
          </div>`;
      })
      .join("");
    return `
      <div class="settings__row settings__row--contact settings__row--socials" data-field="social">
        <p class="settings__help">Logo po lewej, link po prawej — widoczne w profilu klienta.</p>
        <div class="settings-socials">${rows}</div>
        ${canAdd ? "" : `<p class="settings__cap">Osiągnięto limit ${SETTINGS_SOCIAL_MAX} linków.</p>`}
      </div>`;
  }

  function renderSelectOptions(opts, selected) {
    return opts
      .map(function (o) {
        const on = Number(selected) === Number(o.v);
        return `<option value="${o.v}"${on ? " selected" : ""}>${escapeHtml(o.label)}</option>`;
      })
      .join("");
  }

  function renderSettingsProfile(p) {
    ensureProviderBookingRules(p);
    return `
      <div class="settings__row settings__row--contact" data-field="profile">
        <p class="settings__help">Nazwa i opis na stronie rezerwacji.</p>
        ${renderSettingsFloatField({
          label: "Nazwa",
          role: "settings-name",
          value: p.name || "",
          attrs: 'maxlength="60" autocomplete="organization"',
        })}
        ${renderSettingsFloatField({
          label: "Adres główny",
          role: "settings-address",
          value: p.address || "",
          attrs: 'maxlength="120" autocomplete="street-address" title="Puste = usługi online"',
        })}
        ${renderSettingsFloatField({
          tag: "textarea",
          label: "O firmie",
          role: "settings-about",
          value: p.about || "",
          attrs: 'rows="3" maxlength="280"',
        })}
        <div class="settings-share-stack">
          <div class="settings-share">
            <div class="settings__toggle-text">
              <span class="settings-contact__label">Link profilu</span>
              <span class="settings__hint">/${escapeHtml(p.slug)}</span>
            </div>
            <button type="button" class="settings-share__btn" data-action="share-provider" data-slug="${escapeHtml(p.slug)}">Udostępnij</button>
          </div>
          <div class="settings-share">
            <div class="settings__toggle-text">
              <span class="settings-contact__label">Osadzenie na stronie</span>
              <span class="settings__hint">/embed/${escapeHtml(p.slug)}</span>
            </div>
            <button type="button" class="settings-share__btn" data-action="copy-provider-embed" data-slug="${escapeHtml(p.slug)}">Kopiuj</button>
          </div>
        </div>
      </div>`;
  }

  function renderSettingsBookingRules(p) {
    const r = ensureProviderBookingRules(p);
    return `
      <div class="settings__row settings__row--contact" data-field="bookingRules">
        <p class="settings__help">Okno terminów, wyprzedzenie i zasady anulowania.</p>
        ${renderSettingsFloatField({
          tag: "select",
          label: "Rezerwacja z wyprzedzeniem",
          role: "settings-rule-future",
          optionsHtml: renderSelectOptions(BOOKING_FUTURE_OPTS, r.futureDays),
          attrs: 'aria-label="Rezerwacja z wyprzedzeniem"',
        })}
        ${renderSettingsFloatField({
          tag: "select",
          label: "Minimalny czas przed wizytą",
          role: "settings-rule-lead",
          optionsHtml: renderSelectOptions(BOOKING_LEAD_OPTS, r.minLeadHours),
          attrs: 'aria-label="Minimalny czas przed wizytą"',
        })}
        ${renderSettingsFloatField({
          tag: "select",
          label: "Anulowanie / przełożenie do",
          role: "settings-rule-cancel",
          optionsHtml: renderSelectOptions(BOOKING_CANCEL_OPTS, r.cancelHours),
          attrs: 'aria-label="Termin anulowania"',
        })}
        ${renderSettingsFloatField({
          tag: "textarea",
          label: "Polityka anulowania",
          role: "settings-rule-policy",
          value: r.policy || "",
          attrs: 'rows="3" maxlength="400"',
        })}
      </div>`;
  }

  function captureProviderProfileFields() {
    const p = myProvider();
    if (!p) return;
    ensureProviderBookingRules(p);
    const nameEl = document.querySelector('[data-role="settings-name"]');
    const addrEl = document.querySelector('[data-role="settings-address"]');
    const aboutEl = document.querySelector('[data-role="settings-about"]');
    if (nameEl) {
      const n = String(nameEl.value || "").trim();
      p.name = n || p.name || "Firma";
    }
    if (addrEl) p.address = String(addrEl.value || "").trim();
    if (aboutEl) p.about = String(aboutEl.value || "").trim();
    captureProviderSocialFields();
    const futureEl = document.querySelector('[data-role="settings-rule-future"]');
    const leadEl = document.querySelector('[data-role="settings-rule-lead"]');
    const cancelEl = document.querySelector('[data-role="settings-rule-cancel"]');
    const policyEl = document.querySelector('[data-role="settings-rule-policy"]');
    if (futureEl) p.bookingRules.futureDays = Number(futureEl.value) || 30;
    if (leadEl) p.bookingRules.minLeadHours = Number(leadEl.value) || 0;
    if (cancelEl) p.bookingRules.cancelHours = Number(cancelEl.value) || 0;
    if (policyEl) p.bookingRules.policy = String(policyEl.value || "").trim();
  }

  function renderSettings() {
    const p = myProvider();
    if (!p) return renderDashboard();
    ensureProviderContact(p);
    ensureProviderBookingRules(p);
    const visible = !!p.visibleInSearch;
    const visibilityRow = `
      <div class="settings__row settings__row--toggle" data-field="visibleInSearch">
        <div class="settings__toggle-text">
          <span class="settings__key">Widoczność w katalogu</span>
          <span class="settings__hint">${visible ? "Widoczny w wyszukiwaniu" : "Ukryty — tylko z linku"}</span>
        </div>
        <label class="settings__toggle">
          <input type="checkbox" class="avail-edit__switch" data-role="settings-visible-search"
            ${visible ? "checked" : ""} aria-label="Widoczność w katalogu" />
        </label>
      </div>`;
    return `
      <div class="app-screen app-screen--provider app-screen--settings">
        <div class="app-scroll">
          <header class="screen-head screen-head--with-back">
            <button type="button" class="screen-head__back" data-action="provider-tab" data-tab="dashboard" aria-label="Wróć">
              <span class="screen-head__back-icon" aria-hidden="true"></span>
            </button>
            <div class="screen-head__text">
              <h2 class="screen-head__title">Ustawienia</h2>
              <p class="screen-head__sub">Profil, lokalizacje i reguły rezerwacji.</p>
            </div>
          </header>
          <div class="settings">
            ${renderSettingsGroup("Dane firmy", renderSettingsProfile(p))}
            ${renderSettingsGroup("Kontakt", renderSettingsContact(p))}
            ${renderSettingsGroup("Social media", renderSettingsSocial(p))}
            ${renderSettingsGroup("Lokalizacje (miejsce wykonywania usług)", renderSettingsLocations(p))}
            ${renderSettingsGroup("Rezerwacje online", visibilityRow + renderSettingsBookingRules(p))}
          </div>
        </div>
        ${providerBottomNav("settings")}
      </div>`;
  }

  /** Patch UI edycji oferty bez renderAll — zachowaj scroll (bez skoku ekranu). */
  function withServiceEditScroll(fromEl, fn) {
    const form = serviceEditForm(fromEl);
    const scroller =
      (fromEl && fromEl.closest && fromEl.closest(".app-scroll")) ||
      (form && form.closest(".app-scroll")) ||
      document.querySelector("#app-fullscreen .app-scroll");
    const top = scroller ? scroller.scrollTop : 0;
    fn(form);
    if (!scroller) return;
    scroller.scrollTop = top;
    requestAnimationFrame(function () {
      scroller.scrollTop = top;
    });
  }

  function providerServicesListScrollEl() {
    const pageApp = document.getElementById("page-app");
    const fs = document.getElementById("app-fullscreen");
    const root = pageApp && !pageApp.hidden && fs ? fs : document;
    return (
      root.querySelector('[data-role="prov-svc-list"] .app-scroll--svc-side') ||
      root.querySelector(".prov-svc__list .app-scroll--svc-side") ||
      root.querySelector(".app-screen--services:not(.app-screen--services-desktop):not(.app-screen--service-edit) > .app-scroll")
    );
  }

  /** Podmienia HTML listy usług bez resetu scrolla / panelu edycji. */
  function refreshProviderServicesListInPlace() {
    const scroller = providerServicesListScrollEl();
    if (!scroller || !scroller.querySelector(".service-list")) return false;
    const p = myProvider();
    if (!p) return false;
    const editId = window.AppState.params.provider && window.AppState.params.provider.editServiceId;
    const scrollTop = scroller.scrollTop;
    scroller.innerHTML = renderProviderServicesListHtml(p, editId);
    scroller.scrollTop = scrollTop;
    requestAnimationFrame(function () {
      scroller.scrollTop = scrollTop;
    });
    return true;
  }

  /** Odświeża listę usług (desktop) z animacją FLIP przy zmianie grupy po przełączeniu trybu. */
  function refreshProviderServicesListWithModeMove() {
    const scroller = providerServicesListScrollEl();
    if (!scroller) return false;
    const p = myProvider();
    if (!p) return false;
    const editId = window.AppState.params.provider && window.AppState.params.provider.editServiceId;
    const reduce = prefersReducedMotion();
    const first = Object.create(null);
    if (!reduce) {
      scroller.querySelectorAll(".service-row--static[data-service-id]").forEach(function (row) {
        const id = row.getAttribute("data-service-id");
        if (id) first[id] = row.getBoundingClientRect();
      });
    }
    const scrollTop = scroller.scrollTop;
    scroller.innerHTML = renderProviderServicesListHtml(p, editId);
    scroller.scrollTop = scrollTop;
    if (reduce) return true;

    const moving = [];
    scroller.querySelectorAll(".service-row--static[data-service-id]").forEach(function (row) {
      const id = row.getAttribute("data-service-id");
      const prev = id && first[id];
      if (!prev) {
        row.classList.add("service-row--list-enter");
        return;
      }
      const next = row.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      row.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
      row.style.transition = "none";
      row.classList.add("service-row--list-moving");
      moving.push(row);
    });
    if (!moving.length) return true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        moving.forEach(function (row) {
          row.style.transition = "";
          row.style.transform = "";
        });
      });
    });
    window.setTimeout(function () {
      moving.forEach(function (row) {
        row.classList.remove("service-row--list-moving");
        row.style.transition = "";
        row.style.transform = "";
      });
      scroller.querySelectorAll(".service-row--list-enter").forEach(function (row) {
        row.classList.remove("service-row--list-enter");
      });
    }, 420);
    return true;
  }

  function setServiceBookingMode(modeOrGroup, fromEl) {
    withServiceEditScroll(fromEl, function (form) {
      if (!form) return;
      const p = myProvider();
      const current = readServiceEditBookingMode(form);
      let next;
      if (modeOrGroup === "confirm" || modeOrGroup === "ask") {
        next =
          bookingModeGroup(current) === modeOrGroup
            ? current
            : defaultModeForBookingGroup(p, modeOrGroup);
      } else {
        next = normalizeBookingMode(modeOrGroup);
      }
      const groupChanged = bookingModeGroup(current) !== bookingModeGroup(next);
      const hidden = form.querySelector('[data-role="service-booking-mode-value"]') || form.elements.bookingMode;
      if (hidden) hidden.value = next;
      const group = bookingModeGroup(next);
      form.querySelectorAll('[data-role="service-booking-mode-switch"]').forEach(function (sw) {
        const g = sw.getAttribute("data-group") || bookingModeGroup(sw.getAttribute("data-mode"));
        sw.checked = g === group;
      });
      captureServiceEditDraft(form);
      saveState();
      if (groupChanged) refreshProviderServicesListWithModeMove();
    });
  }

  function toggleServiceLocation(locId, fromEl) {
    withServiceEditScroll(fromEl, function (form) {
      if (!form || !locId) return;
      const checkBtn = form.querySelector('[data-role="service-location-check"][data-loc-id="' + locId + '"]');
      if (!checkBtn) return;
      const on = !checkBtn.classList.contains("is-on");
      if (!on) {
        const selectedCount = form.querySelectorAll('[data-role="service-location-check"].is-on').length;
        if (selectedCount <= 1) {
          showToast("Zostaw przynajmniej jedno miejsce.");
          return;
        }
      }
      checkBtn.classList.toggle("is-on", on);
      checkBtn.setAttribute("aria-pressed", on ? "true" : "false");
      captureServiceEditDraft(form);
      saveState();
    });
  }

  function renderProvider(screen) {
    switch (screen) {
      case "requests":
        return renderRequests();
      case "propose":
        return renderProposeScreen(window.AppState.params.provider && window.AppState.params.provider.requestId);
      case "services":
        return renderServices();
      case "calendar":
        return renderProviderCalendar();
      case "availability":
        return renderAvailability();
      case "settings":
        return renderSettings();
      case "dashboard":
      default:
        return renderDashboard();
    }
  }

  function renderRoleHTML(role) {
    return role === "provider" ? renderProvider(window.AppState.screen.provider) : renderClient(window.AppState.screen.client);
  }

  // ─────────────────────────────────────────────────────────
  // Render do kontenerów (symulator + pełny ekran)
  // ─────────────────────────────────────────────────────────
  function render(instance) {
    const el = document.getElementById(`app-${instance}`);
    if (el) el.innerHTML = renderRoleHTML(instance);
  }

  function renderFullscreen() {
    const el = document.getElementById("app-fullscreen");
    if (!el) return;
    const role = window.AppState.activeRole || "client";
    el.innerHTML = renderRoleHTML(role);
  }

  // Ostatnio wyrenderowane ekrany — do wykrycia zmiany ekranu i crossfade wejścia.
  let lastRenderedScreens = null;
  /** "from-right" | null — tryb animacji wejścia ekranu (np. Pulpit → Kalendarz). */
  let screenEnterAnimMode = null;
  let pendingProvCalEditTimer = null;

  function playScreenEnterAnim(prev) {
    if (prefersReducedMotion()) {
      screenEnterAnimMode = null;
      return;
    }
    const enterClass =
      screenEnterAnimMode === "from-right" ? "app-screen--enter-from-right" : "app-screen--enter";
    screenEnterAnimMode = null;
    const role = window.AppState.activeRole || "client";
    const mountIds = [];
    if (prev.client !== window.AppState.screen.client) mountIds.push("app-client");
    if (prev.provider !== window.AppState.screen.provider) mountIds.push("app-provider");
    if (prev.role !== role || prev[role] !== window.AppState.screen[role]) mountIds.push("app-fullscreen");
    mountIds.forEach(function (id) {
      const mount = document.getElementById(id);
      const screen = mount && mount.querySelector(":scope > .app-screen");
      if (!screen) return;
      screen.classList.remove("app-screen--enter", "app-screen--enter-from-right");
      void screen.offsetWidth;
      screen.classList.add(enterClass);
      screen.addEventListener("animationend", function handler() {
        screen.classList.remove(enterClass);
        screen.removeEventListener("animationend", handler);
      });
    });
  }

  function renderAll() {
    closeProviderCardMenu();
    if (window.AppState.loggedIn && window.AppState.activeRole) {
      updateAppHeader(window.AppState.activeRole);
    }
    const prevBottomNavTab = captureBottomNavTab();
    const prevScreens = lastRenderedScreens;
    // Zachowaj scroll osi czasu — inaczej każdy klik (np. w godzinę przy panelu „+”)
    // wraca do linii „teraz” / pierwszej wizyty i podgląd skacze w górę.
    const prevProvScrolls = Array.prototype.map.call(
      document.querySelectorAll('[data-role="prov-cal-body"]'),
      function (b) {
        return b.scrollTop;
      }
    );
    // Karuzela wolnych terminów — bez resetu do 0 (smooth inaczej leci przez całą oś).
    const prevAddTimeScrolls = Array.prototype.map.call(
      document.querySelectorAll('[data-role="prov-cal-add-time-list"]'),
      function (el) {
        return el.scrollLeft;
      }
    );
    const prevMyCalTabScrolls = Array.prototype.map.call(
      document.querySelectorAll("[data-my-cal-status-scroll]"),
      function (el) {
        return el.scrollLeft;
      }
    );
    const prevDashStatScrolls = Array.prototype.map.call(
      document.querySelectorAll("[data-h-scroll]"),
      function (el) {
        return el.scrollLeft;
      }
    );
    INSTANCES.forEach(render);
    renderFullscreen();
    // Przywróć od razu (sync), zanim scheduleScroll zrobi short-nudge.
    document.querySelectorAll('[data-role="prov-cal-add-time-list"]').forEach(function (el, i) {
      if (typeof prevAddTimeScrolls[i] === "number") el.scrollLeft = prevAddTimeScrolls[i];
    });
    lastRenderedScreens = {
      client: window.AppState.screen.client,
      provider: window.AppState.screen.provider,
      role: window.AppState.activeRole || "client",
    };
    syncSearchFilterControlIds();
    syncAppMenus();
    // Po layoutcie — inaczej przy flex itemach szerokość bywa jeszcze 0.
    requestAnimationFrame(function () {
      syncBottomNavIndicators(prevBottomNavTab);
      if (prevScreens) playScreenEnterAnim(prevScreens);
    });
    document.querySelectorAll('[data-role="booking-date-strip"]').forEach(updateBookingMonthLabel);
    document.querySelectorAll(".filter-scroll--dates").forEach(updateSearchFilterMonthLabel);
    document.querySelectorAll("[data-my-cal-status-scroll]").forEach(function (el, i) {
      if (typeof prevMyCalTabScrolls[i] === "number") el.scrollLeft = prevMyCalTabScrolls[i];
    });
    document.querySelectorAll("[data-h-scroll]").forEach(function (el, i) {
      if (typeof prevDashStatScrolls[i] === "number") el.scrollLeft = prevDashStatScrolls[i];
    });
    requestAnimationFrame(function () {
      syncAllMyCalStatusRails({ bringActive: true });
      document.querySelectorAll("[data-h-scroll]").forEach(function (el, i) {
        if (typeof prevDashStatScrolls[i] === "number") el.scrollLeft = prevDashStatScrolls[i];
      });
      const availGrid = document.querySelector('[data-role="avail-week-grid"]');
      if (availGrid) initAvailStripScroll(availGrid);
      const bodies = document.querySelectorAll('[data-role="prov-cal-body"]');
      bodies.forEach(function (body, i) {
        if (!body || window.AppState.provCalMonthOpen) return;
        // Ukryta instancja (0px) — pomijamy, żeby nie wymuszać scroll-behavior smooth
        // z html { scroll-behavior:smooth } i nie zjeżdżać widocznego podglądu.
        if (!(body.scrollHeight - body.clientHeight > 0)) return;
        const prev = prevProvScrolls[i];
        const prevWasScrolled = typeof prev === "number" && prev > 0;
        if (prevWasScrolled) {
          body.scrollTop = prev;
        } else {
          const nowEl = body.querySelector(".gcal__now");
          const firstEvent = body.querySelector(".gcal__event");
          const target = nowEl || firstEvent;
          if (target) {
            body.scrollTop = Math.max(0, target.offsetTop - 48);
          } else {
            // Widok 24h: bez „teraz”/wizyt startuj koło 8:00, nie od północy.
            const hourH = ensureProvCalHourH();
            const morningY = ((8 * 60 - PROV_CAL_HOUR_START * 60) / 60) * hourH;
            body.scrollTop = Math.max(0, morningY - 48);
          }
        }
      });
      // Po layoutcie flex jeszcze raz — sync mógł nie złapać pełnej szerokości.
      document.querySelectorAll('[data-role="prov-cal-add-time-list"]').forEach(function (el, i) {
        if (typeof prevAddTimeScrolls[i] === "number") el.scrollLeft = prevAddTimeScrolls[i];
      });
      refreshProvCalTimeLabels();
      // Drugi frame — po layoutcie siatki miesiąca (inaczej pasek pada na top:0).
      requestAnimationFrame(animateAvailWeekHighlight);
    });
  }

  // Poziome przeciąganie myszką: filtry + karuzela wariantów (przetrwa re-render).
  // Klik blokujemy tylko przez krótką chwilę po REALNYM przeciągnięciu (znacznik czasu),
  // nigdy trwałym flagą — inaczej flaga potrafi się „zaciąć” i klik w chip przestaje działać.
  const filterDrag = {
    active: false,
    el: null,
    startX: 0,
    startScroll: 0,
    moved: false,
    pointerId: null,
    dragEndAt: 0,
  };

  function dragScrollTarget(event) {
    return event.target.closest(
      "[data-filter-scroll], [data-h-scroll], .service-variant-carousel__track"
    );
  }

  function bindFilterScroll() {
    if (bindFilterScroll.done) return;
    bindFilterScroll.done = true;

    document.addEventListener(
      "pointerdown",
      function (event) {
        const el = dragScrollTarget(event);
        if (!el || event.button !== 0) return;
        // Na touch zostaje natywne pan-x; tu głównie desktop / mysz.
        if (event.pointerType === "touch") return;
        filterDrag.active = true;
        filterDrag.el = el;
        filterDrag.startX = event.clientX;
        filterDrag.startScroll = el.scrollLeft;
        filterDrag.moved = false;
        filterDrag.pointerId = event.pointerId;
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!filterDrag.active || !filterDrag.el) return;
        const dx = event.clientX - filterDrag.startX;
        if (!filterDrag.moved) {
          if (Math.abs(dx) <= 3) return;
          filterDrag.moved = true;
          filterDrag.el.classList.add("filter-scroll--dragging");
          try {
            filterDrag.el.setPointerCapture(filterDrag.pointerId);
          } catch (err) {
            /* ignore */
          }
        }
        event.preventDefault();
        filterDrag.el.scrollLeft = filterDrag.startScroll - dx;
        if (filterDrag.el.classList.contains("filter-scroll--dates")) {
          updateSearchFilterMonthLabel(filterDrag.el);
          ensureSearchFilterDatesExtended(filterDrag.el);
        }
      },
      { capture: true, passive: false }
    );

    function endFilterDrag() {
      if (!filterDrag.active) return;
      if (filterDrag.el) {
        filterDrag.el.classList.remove("filter-scroll--dragging");
        try {
          filterDrag.el.releasePointerCapture(filterDrag.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
      // Zapamiętaj tylko chwilę zakończenia realnego drag — do jednorazowego zdławienia kliku.
      if (filterDrag.moved) filterDrag.dragEndAt = Date.now();
      filterDrag.active = false;
      filterDrag.el = null;
      filterDrag.pointerId = null;
      filterDrag.moved = false;
    }

    document.addEventListener("pointerup", endFilterDrag, true);
    document.addEventListener("pointercancel", endFilterDrag, true);

    document.addEventListener(
      "click",
      function (event) {
        // Klik tuż po przeciągnięciu (≤250 ms) na tym samym torze — pomiń, to nie był wybór.
        if (!filterDrag.dragEndAt || Date.now() - filterDrag.dragEndAt > 250) return;
        filterDrag.dragEndAt = 0;
        if (
          !event.target.closest(
            "[data-filter-scroll], [data-h-scroll], .service-variant-carousel__track"
          )
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    // Kółko myszy na karuzelach poziomych → przewijanie w poziomie.
    document.addEventListener(
      "wheel",
      function (event) {
        const track = event.target.closest(
          ".service-variant-carousel__track, [data-h-scroll]"
        );
        if (!track) return;
        if (track.scrollWidth <= track.clientWidth + 1) return;
        const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!dx) return;
        event.preventDefault();
        track.scrollLeft += dx;
      },
      { passive: false }
    );
  }

  // ─────────────────────────────────────────────────────────
  // Nawigacja / akcje
  // ─────────────────────────────────────────────────────────
  function navigate(instance, screen, params) {
    if (INSTANCES.indexOf(instance) === -1) return;
    window.AppState.screen[instance] = screen;
    window.AppState.params[instance] = params || {};
    saveState();
    renderAll();
  }

  function setRole(instance, role) {
    if (INSTANCES.indexOf(instance) === -1) return;
    window.AppState.role[instance] = role;
    window.AppState.screen[instance] = DEFAULT_SCREEN[role] || window.AppState.screen[instance];
    saveState();
    renderAll();
  }

  function goScreen(screen) {
    window.AppState.appMenuOpen = false;
    if (screen !== "search" && screen !== "favorites") {
      window.AppState.searchOpenSlug = null;
    }
    if (screen === "search" && window.AppState.screen.client === "booking") {
      window.AppState.draft = null;
      window.AppState.params.client = {};
    }
    // Ekrany klienta (konto, ulubione…) — przełącz rolę, jeśli jesteśmy jako usługodawca.
    if (
      (screen === "account" || screen === "favorites" || screen === "search" || screen === "myCalendar") &&
      window.AppState.activeRole === "provider"
    ) {
      window.AppState.activeRole = "client";
    }
    window.AppState.screen.client = screen;
    if (window.AppState.loggedIn) {
      updateAppHeader(window.AppState.activeRole || "client");
    }
    saveState();
    renderAll();
  }

  function usesDesktopLayout() {
    return window.matchMedia("(min-width: 900px)").matches;
  }

  function clientUsesDesktopBookingLayout() {
    return usesDesktopLayout();
  }

  const PROVIDER_PANEL_MS = 300;

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function applyCloseProviderState() {
    window.AppState.searchOpenSlug = null;
    window.AppState.draft = null;
    if (window.AppState.screen.client === "booking" || window.AppState.screen.client === "profile") {
      window.AppState.screen.client = "search";
    }
    saveState();
  }

  function animateCloseProviderPanels(done) {
    const panels = document.querySelectorAll(".provider-item--open .provider-booking-panel");
    if (!panels.length || prefersReducedMotion()) {
      done();
      return;
    }

    let finished = false;
    const finish = function () {
      if (finished) return;
      finished = true;
      done();
    };

    panels.forEach(function (panel) {
      panel.classList.add("provider-booking-panel--closing");
      const card = panel.closest(".provider-item")?.querySelector(".provider-card");
      if (card) card.classList.add("provider-card--closing");
    });

    const firstPanel = panels[0];
    firstPanel.addEventListener(
      "animationend",
      function (event) {
        if (event.target === firstPanel) finish();
      },
      { once: true }
    );
    window.setTimeout(finish, PROVIDER_PANEL_MS + 40);
  }

  function closeProvider() {
    if (window.AppState.closingProvider) return;

    const hasInlinePanel = !!document.querySelector(".provider-item--open .provider-booking-panel");
    if (!hasInlinePanel || prefersReducedMotion()) {
      applyCloseProviderState();
      renderAll();
      return;
    }

    window.AppState.closingProvider = true;
    animateCloseProviderPanels(function () {
      window.AppState.closingProvider = false;
      applyCloseProviderState();
      renderAll();
    });
  }

  function openProvider(slug, opts) {
    opts = opts || {};
    // Nie blokuj otwarcia, jeśli animacja zamykania utknęła.
    window.AppState.closingProvider = false;
    const p = getProviderBySlug(slug);
    if (!p) return;

    initDraftForProvider(p);
    const preferredIds = Array.isArray(opts.serviceIds) ? opts.serviceIds.filter(Boolean) : [];
    if (preferredIds.length) {
      const validIds = preferredIds.filter(function (id) {
        return (p.services || []).some(function (s) {
          return s && s.id === id;
        });
      });
      if (validIds.length) {
        window.AppState.draft.serviceIds = validIds;
        ensureDraftServiceVariants(window.AppState.draft);
        validIds.forEach(function (id) {
          const svc = (p.services || []).find(function (s) {
            return s && s.id === id;
          });
          if (svc) selectedVariantIdForService(window.AppState.draft, svc);
        });
      }
    }
    window.AppState.params.client = { slug: slug };
    window.AppState.activeRole = "client";
    window.AppState.searchOpenSlug = null;
    window.AppState.screen.client = "booking";

    saveState();
    renderAll();
    window.AppState.bookingPanelEnterSlug = null;
  }

  function rebookVisit(bookingId) {
    const b = (window.AppState.bookings || []).find(function (x) {
      return x && x.id === bookingId;
    });
    if (!b) {
      showToast("Nie znaleziono wizyty.");
      return;
    }
    const p = getProviderById(b.providerId);
    if (!p) {
      showToast("Usługodawca niedostępny.");
      return;
    }
    openProvider(p.slug, { serviceIds: b.serviceIds || [], force: true });
  }

  function icsEscape(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function icsUtcStamp(date) {
    const d = date instanceof Date ? date : new Date();
    if (isNaN(d.getTime())) return "";
    return d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  /** Lokalna data+godzina wizyty → UTC w formacie ICS. */
  function icsUtcFromLocal(dateISO, hhmm) {
    const t = String(hhmm || "00:00");
    const d = new Date(String(dateISO) + "T" + (t.length === 5 ? t + ":00" : t));
    if (isNaN(d.getTime())) return "";
    return icsUtcStamp(d);
  }

  function buildVisitIcs(b) {
    if (!b || !b.dateISO || !b.from) return "";
    const start = icsUtcFromLocal(b.dateISO, b.from);
    let end = b.to ? icsUtcFromLocal(b.dateISO, b.to) : "";
    if (!start) return "";
    if (!end) {
      const d = new Date(String(b.dateISO) + "T" + String(b.from).slice(0, 5) + ":00");
      d.setMinutes(d.getMinutes() + 30);
      end = icsUtcStamp(d);
    }
    const provider = getProviderById(b.providerId);
    const services = (b.serviceNames || []).join(", ");
    const summary = [services || "Wizyta", b.providerName || (provider && provider.name) || ""]
      .filter(Boolean)
      .join(" · ");
    const location = resolveVisitNavAddress(b, provider) || b.locationLabel || "";
    const descParts = [];
    if (b.providerName) descParts.push("Usługodawca: " + b.providerName);
    if (services) descParts.push("Usługa: " + services);
    if (b.locationLabel) descParts.push("Miejsce: " + b.locationLabel);
    const uid = String(b.id || "visit") + "@lokalnie.app";
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lokalnie//PL",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + icsUtcStamp(new Date()),
      "DTSTART:" + start,
      "DTEND:" + end,
      "SUMMARY:" + icsEscape(summary),
      location ? "LOCATION:" + icsEscape(location) : "",
      descParts.length ? "DESCRIPTION:" + icsEscape(descParts.join("\n")) : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");
  }

  function addVisitToCalendar(bookingId) {
    const b = (window.AppState.bookings || []).find(function (x) {
      return x && x.id === bookingId;
    });
    if (!b) {
      showToast("Nie znaleziono wizyty.");
      return;
    }
    const ics = buildVisitIcs(b);
    if (!ics) {
      showToast("Brak terminu do dodania.");
      return;
    }
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const day = String(b.dateISO || "wizyta").slice(0, 10);
    a.href = url;
    a.download = "lokalnie-" + day + ".ics";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    showToast("Plik kalendarza pobrany ✓");
  }

  function applyFavButtons(slug, on) {
    if (!slug) return;
    const label = on ? "Usuń z ulubionych" : "Dodaj do ulubionych";
    document.querySelectorAll('[data-action="toggle-fav"]').forEach(function (btn) {
      if (btn.getAttribute("data-slug") !== slug) return;
      if (btn.classList.contains("provider-card__fav")) {
        btn.classList.toggle("provider-card__fav--on", on);
      }
      if (btn.classList.contains("fav-btn")) {
        btn.classList.toggle("fav-btn--on", on);
      }
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", label);
      btn.title = label;
    });
  }

  function toggleFav(slug) {
    if (!slug) return;
    const i = window.AppState.favorites.indexOf(slug);
    if (i === -1) window.AppState.favorites.push(slug);
    else window.AppState.favorites.splice(i, 1);
    saveState();
    // Na liście Ulubione trzeba przebudować karty; gdzie indziej tylko stan przycisku.
    if (window.AppState.role === "client" && window.AppState.screen.client === "favorites") {
      renderAll();
      return;
    }
    applyFavButtons(slug, window.AppState.favorites.indexOf(slug) !== -1);
  }

  function toggleServiceDesc(serviceId) {
    const draft = window.AppState.draft;
    if (!draft) return;
    if (!Array.isArray(draft.expandedServiceIds)) draft.expandedServiceIds = [];

    const ids = draft.expandedServiceIds;
    const idx = ids.indexOf(serviceId);
    if (idx === -1) ids.push(serviceId);
    else ids.splice(idx, 1);

    const expanded = ids.indexOf(serviceId) !== -1;
    saveState();
    applyServiceRowExpanded(serviceId, expanded);
  }

  function applyServiceSelection(serviceId, mode) {
    const draft = window.AppState.draft;
    if (!draft) return;
    const p = getProviderBySlug(draft.slug);
    if (!p) return;
    ensureDraftServiceVariants(draft);
    ensureServicesBookingMode(p);

    let ids = (draft.serviceIds || []).slice();
    const idx = ids.indexOf(serviceId);
    const multi =
      mode === "multi" || (mode !== "single" && (!!p.multiSelect || !!draft.multiSelectMode));
    const svc = (p.services || []).find(function (s) {
      return s.id === serviceId;
    });
    if (!svc) return;
    const nextMode = serviceBookingMode(svc, p);

    if (!multi) {
      draft.serviceIds = idx === -1 ? [serviceId] : [];
      if (idx === -1) selectedVariantIdForService(draft, svc);
      if (idx !== -1) delete draft.serviceVariants[serviceId];
    } else if (idx === -1) {
      const nextFamily = bookingModeFamily(nextMode);
      const compatible = ids.filter(function (id) {
        const other = (p.services || []).find(function (s) {
          return s && s.id === id;
        });
        return other && bookingModeFamily(serviceBookingMode(other, p)) === nextFamily;
      });
      if (compatible.length !== ids.length) {
        ids.forEach(function (id) {
          if (compatible.indexOf(id) === -1 && draft.serviceVariants) {
            delete draft.serviceVariants[id];
          }
        });
        showToast(
          nextFamily === "request"
            ? "Oferty na prośbę — usunięto inne tryby z koszyka."
            : nextFamily === "queue"
              ? "Oferty w kolejce — usunięto inne tryby z koszyka."
              : "Oferty automatyczne — usunięto inne tryby z koszyka."
        );
        ids = compatible;
      }
      ids.push(serviceId);
      selectedVariantIdForService(draft, svc);
      draft.serviceIds = ids;
    } else {
      ids.splice(idx, 1);
      delete draft.serviceVariants[serviceId];
      draft.serviceIds = ids;
    }
    draft.slotId = null;
    // Pusty wybór = zostajemy w panelu (nie zamykamy usługodawcy).
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function pickServiceVariant(serviceId, variantId) {
    const draft = window.AppState.draft;
    if (!draft || !serviceId || !variantId) return;
    const p = getProviderBySlug(draft.slug);
    if (!p) return;
    const svc = (p.services || []).find(function (s) {
      return s.id === serviceId;
    });
    if (!svc || !serviceVariants(svc).some(function (v) {
      return v.id === variantId;
    })) {
      return;
    }
    ensureDraftServiceVariants(draft);
    ensureServicesBookingMode(p);
    draft.serviceVariants[serviceId] = variantId;
    if ((draft.serviceIds || []).indexOf(serviceId) === -1) {
      const multi = !!p.multiSelect || !!draft.multiSelectMode;
      const nextMode = serviceBookingMode(svc, p);
      let ids = multi ? (draft.serviceIds || []).slice() : [];
      if (multi) {
        ids = ids.filter(function (id) {
          const other = (p.services || []).find(function (s) {
            return s && s.id === id;
          });
          return other && serviceBookingMode(other, p) === nextMode;
        });
        ids.push(serviceId);
        draft.serviceIds = ids;
      } else {
        draft.serviceIds = [serviceId];
      }
    }
    draft.slotId = null;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function toggleService(serviceId) {
    applyServiceSelection(serviceId, "auto");
  }

  function toggleServiceCheck(serviceId) {
    const draft = window.AppState.draft;
    const p = draft && draft.slug ? getProviderBySlug(draft.slug) : null;
    applyServiceSelection(serviceId, p && p.multiSelect ? "multi" : "single");
  }

  function startBooking(slug) {
    const draft = window.AppState.draft;
    if (!draft || !draft.serviceIds || !draft.serviceIds.length) {
      showToast("Wybierz co najmniej jedną usługę.");
      return;
    }
    draft.slug = slug;
    window.AppState.screen.client = "booking";
    saveState();
    renderAll();
  }

  function pickDate(dateISO) {
    if (!window.AppState.draft) return;
    window.AppState.draft.dateISO = dateISO;
    window.AppState.draft.calMonth = dateISO.slice(0, 7);
    window.AppState.draft.slotId = null;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function shiftCalMonth(delta) {
    const draft = window.AppState.draft;
    if (!draft) return;
    const ref = draft.calMonth || (draft.dateISO || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const parts = ref.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    draft.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function pickSlot(slotId) {
    if (!window.AppState.draft) return;
    window.AppState.draft.slotId = slotId;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function clearSlot() {
    if (!window.AppState.draft) return;
    window.AppState.draft.slotId = null;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function cancelBookingSelection() {
    const draft = window.AppState.draft;
    if (!draft) return;
    draft.serviceIds = [];
    draft.slotId = null;
    draft.multiSelectMode = false;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function toggleMultiSelect() {
    const draft = window.AppState.draft;
    if (!draft) return;
    draft.multiSelectMode = !draft.multiSelectMode;
    saveState();
    const pickOn = draft.multiSelectMode;
    if (!refreshBookingDraftUI()) renderAll();
    if (pickOn) {
      const list =
        document.querySelector('.app-screen--booking [data-role="booking-mobile-services"]') ||
        document.querySelector(".app-screen--booking .booking-mobile .booking__services-list") ||
        document.querySelector(".app-screen--booking .booking__services-list") ||
        document.querySelector(".provider-item--open .booking__services-list");
      if (list) list.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function bookSlot(slotId) {
    if (!window.AppState.draft) return;
    window.AppState.draft.slotId = slotId;
    confirmBooking();
  }

  function confirmBooking() {
    const draft = window.AppState.draft;
    if (!draft || !draft.slotId) {
      showToast("Wybierz godzinę.");
      return;
    }
    const p = getProviderBySlug(draft.slug);
    if (!p) return;

    const slotOpts = slotOptsForServiceIds(p, draft.serviceIds || []);
    const slots = computeSlots(p, draft.dateISO, draftTotals(p).duration || 15, slotOpts);
    const slot = slots.find((s) => s.id === draft.slotId);
    if (!slot) {
      showToast("Ten termin jest już zajęty — wybierz inny.");
      renderAll();
      return;
    }

    const svcs = draftServices(p);
    const cp = ensureClientProfile();
    const booking = {
      id: "bk-" + Date.now(),
      providerId: p.id,
      providerName: p.name,
      clientName: cp.name || "Klient",
      clientPhone: cp.phone || "",
      clientEmail: cp.email || "",
      serviceIds: svcs.map((s) => s.id),
      serviceNames: svcs.map((s) => s.name),
      dateISO: draft.dateISO,
      from: slot.from,
      to: slot.to,
      locationId: slot.locationId,
      locationLabel: slot.locationLabel,
      status: "confirmed",
      side: "client",
    };
    window.AppState.bookings.push(booking);
    window.AppState.draft = null;
    window.AppState.searchOpenSlug = null;
    window.AppState.screen.client = "myCalendar";
    saveState();
    renderAll();
    showToast("Rezerwacja potwierdzona ✓");
    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.createBookingFromApp(booking).then(function () {
        saveState();
      });
    }
  }

  function toggleRequestDay(dateISO) {
    const draft = window.AppState.draft;
    if (!draft || !dateISO) return;
    const days = normalizeRequestDays(draft.requestDays);
    const idx = days.findIndex(function (d) {
      return d.dateISO === dateISO;
    });
    if (idx === -1) days.push({ dateISO: dateISO, part: "any" });
    else days.splice(idx, 1);
    draft.requestDays = normalizeRequestDays(days);
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function setRequestDayPart(dateISO, part) {
    const draft = window.AppState.draft;
    if (!draft || !dateISO) return;
    const days = normalizeRequestDays(draft.requestDays);
    const day = days.find(function (d) {
      return d.dateISO === dateISO;
    });
    if (!day) return;
    day.part = normalizeDayPart(part);
    draft.requestDays = days;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
  }

  function sendRequest(slug) {
    const draft = window.AppState.draft;
    const p = getProviderBySlug(slug);
    if (!p) return;
    if (!draft || !draft.serviceIds || !draft.serviceIds.length) {
      showToast("Wybierz co najmniej jedną usługę.");
      return;
    }
    const mode = draftBookingMode(p);
    const days = mode === "request" ? [] : normalizeRequestDays(draft.requestDays);
    if (mode === "approval" && !days.length) {
      showToast("Zaznacz co najmniej jeden pasujący dzień.");
      return;
    }
    if (!isOfferRequestMode(mode)) {
      showToast("Wybierz ofertę na prośbę o termin.");
      return;
    }
    const svcs = draftServices(p);
    const cp = ensureClientProfile();
    const clientName = cp.name || "Klient";
    const req = {
      id: "rq-" + Date.now(),
      providerId: p.id,
      providerName: p.name,
      clientName: clientName,
      clientPhone: cp.phone || "",
      clientEmail: cp.email || "",
      serviceIds: svcs.map((s) => s.id),
      serviceNames: svcs.map((s) => s.name),
      days: days,
      requestMode: mode === "request" ? "request" : "approval",
      proposals: [],
      acceptedProposalId: null,
      status: "pending",
    };
    window.AppState.requests.push(req);
    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.createRequestFromApp(req).then(function () {
        saveState();
      });
    }

    // Widoczne u klienta jako "oczekująca" wizyta bez terminu
    window.AppState.bookings.push({
      id: "bk-" + Date.now(),
      requestId: req.id,
      providerId: p.id,
      providerName: p.name,
      clientName: req.clientName,
      serviceIds: req.serviceIds,
      serviceNames: req.serviceNames,
      dateISO: "",
      from: "",
      to: "",
      locationLabel: "",
      status: "pending",
      side: "client",
    });

    window.AppState.draft = null;
    window.AppState.searchOpenSlug = null;
    window.AppState.screen.client = "myCalendar";
    saveState();
    renderAll();
    showToast("Zapytanie wysłane — czekaj na propozycje terminów.");
  }

  // Usługodawca proponuje terminy w kalendarzu (panel jak po „+”), w dniach z zapytania
  function proposeOpen(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;

    const seed = (Array.isArray(req.proposals) && req.proposals.length
      ? req.proposals
      : Array.isArray(req._proposals)
        ? req._proposals
        : []
    ).map(function (c) {
      return Object.assign({}, c);
    });
    req._proposals = seed.map(function (c) {
      return Object.assign({}, c);
    });

    const days = normalizeRequestDays(req.days);
    const firstDay = (days[0] && days[0].dateISO) || ensureProvCalDate();
    const draft = defaultProvCalAddDraft();
    draft.requestId = req.id;
    draft.clientName = String(req.clientName || "Klient");
    applyClientContactsToDraft(draft, req);
    if (!draft.clientPhone && !draft.clientEmail && !draft.clientAddress) {
      const p = myProvider();
      const saved = p ? findCollectedProviderClientByName(p.id, draft.clientName) : null;
      if (saved) applyClientContactsToDraft(draft, saved);
    }
    draft.serviceIds = (req.serviceIds || []).slice();
    draft.dateISO = firstDay;
    draft.slotId = null;
    draft.proposals = seed;
    draft.clientDetailsOpen = false;

    window.AppState.provCalReplyRequestId = req.id;
    window.AppState.provCalReplyShowAll = false;
    window.AppState.dashListMode = "requests";
    markProvCalAddEnterAnim();
    window.AppState.provCalAddTab = "requests";
    window.AppState.provCalAddOpen = true;
    window.AppState.provCalAddMinimized = false;
    window.AppState.provCalAddDraft = draft;
    window.AppState.provCalDate = firstDay;
    window.AppState.provCalPickerMonth = String(firstDay).slice(0, 7);
    moveProvCalWindowToInclude(firstDay);
    window.AppState.provCalSelection = null;
    window.AppState.params.provider = { requestId: requestId };
    window.AppState.screen.provider = "calendar";
    setProvCalMonthOpen(false, { animate: false, render: false, persist: false });
    closeProvCalViewCloud();
    saveState();
    renderAll();
    hapticTap(16);
  }

  function proposeDate(requestId, dateISO) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    req._proposeDate = dateISO;
    saveState();
    renderAll();
  }

  function proposeSlot(requestId, slotId, dateISO) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    const p = myProvider();
    if (!req || !p) return;
    req._proposeDate = dateISO;
    const chosen = requestProposalDraft(req);
    const idx = chosen.findIndex(function (c) {
      return c.id === slotId;
    });
    if (idx !== -1) {
      chosen.splice(idx, 1);
    } else {
      const day = requestDayOptions(req, p).find(function (d) {
        return d.dateISO === dateISO;
      });
      const slot = day && day.slots.find(function (s) {
        return s.id === slotId;
      });
      if (!slot) return;
      chosen.push({
        id: slot.id,
        dateISO: dateISO,
        from: slot.from,
        to: slot.to,
        locationId: slot.locationId,
        locationLabel: slot.locationLabel,
      });
      chosen.sort(function (a, b) {
        return (a.dateISO + a.from).localeCompare(b.dateISO + b.from);
      });
    }
    saveState();
    renderAll();
  }

  function proposeRemove(requestId, slotId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    const chosen = requestProposalDraft(req);
    const idx = chosen.findIndex(function (c) {
      return c.id === slotId;
    });
    if (idx === -1) return;
    chosen.splice(idx, 1);
    saveState();
    renderAll();
  }

  function proposeConfirm(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    const p = myProvider();
    if (!req || !p) return;

    const draft = window.AppState.provCalAddDraft;
    const fromPanel =
      draft && draft.requestId === req.id && Array.isArray(draft.proposals) ? draft.proposals : null;
    const chosen = fromPanel && fromPanel.length ? fromPanel : requestProposalDraft(req);
    if (!chosen.length) return;

    req.proposals = chosen.map(function (c) {
      return Object.assign({}, c);
    });
    req.acceptedProposalId = null;
    req.status = "proposed";
    req._proposals = [];
    req._proposeDate = null;

    // Wizyta klienta czeka bez terminu — konkretną godzinę wybierze on sam z propozycji.
    const bk = (window.AppState.bookings || []).find((b) => b.requestId === req.id);
    if (bk) {
      bk.dateISO = "";
      bk.from = "";
      bk.to = "";
      bk.locationId = null;
      bk.locationLabel = "";
      bk.status = "proposed";
    }

    pushNotification(
      "client",
      `${req.providerName}: ${req.proposals.length} ${proposalCountLabel(req.proposals.length)} do wyboru.`
    );

    clearProvCalReplyMode();
    window.AppState.provCalAddTab = "requests";
    window.AppState.provCalAddDraft = defaultProvCalAddDraft();
    window.AppState.provCalAddOpen = true;
    window.AppState.provCalAddMinimized = false;
    window.AppState.screen.provider = "calendar";
    window.AppState.screen.client = "myCalendar";
    saveState();
    renderAll();
    showToast(`Wysłano ${req.proposals.length} ${proposalCountLabel(req.proposals.length)} klientowi.`);
    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.proposeRequestFromApp(req).then(function () {
        saveState();
      });
    }
  }

  function acceptProposal(bookingId) {
    const bk = (window.AppState.bookings || []).find((b) => b.id === bookingId);
    if (!bk) return;
    bk.status = "confirmed";
    const req = (window.AppState.requests || []).find((r) => r.id === bk.requestId);
    if (req) req.status = "confirmed";
    saveState();
    renderAll();
    showToast("Termin potwierdzony ✓");
  }

  function rejectProposal(bookingId) {
    const bk = (window.AppState.bookings || []).find((b) => b.id === bookingId);
    if (!bk) return;
    bk.status = "rejected";
    const req = (window.AppState.requests || []).find((r) => r.id === bk.requestId);
    if (req) req.status = "pending"; // wraca do puli — pętla propozycji
    saveState();
    renderAll();
    showToast("Propozycja odrzucona.");
  }

  /** Klient rezerwuje jedną z propozycji — pozostałe tracą ważność. */
  function acceptRequestProposal(requestId, proposalId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    const prop = (req.proposals || []).find(function (c) {
      return c.id === proposalId;
    });
    if (!prop) return;

    let bk = (window.AppState.bookings || []).find((b) => b.requestId === req.id);
    if (!bk) {
      bk = {
        id: "bk-" + Date.now(),
        requestId: req.id,
        providerId: req.providerId,
        providerName: req.providerName,
        clientName: req.clientName,
        serviceIds: req.serviceIds,
        serviceNames: req.serviceNames,
        side: "client",
      };
      window.AppState.bookings.push(bk);
    }
    bk.dateISO = prop.dateISO;
    bk.from = prop.from;
    bk.to = prop.to;
    bk.locationId = prop.locationId || null;
    bk.locationLabel = prop.locationLabel || "";
    bk.status = "confirmed";

    req.status = "confirmed";
    req.acceptedProposalId = prop.id;
    req.proposals = [Object.assign({}, prop)];

    pushNotification(
      "provider",
      `${req.clientName || "Klient"} zarezerwował(a) termin: ${proposalRangeLabel(prop)} — ${(req.serviceNames || []).join(", ")}.`
    );

    window.AppState.myCalDate = prop.dateISO;
    window.AppState.myCalMonth = String(prop.dateISO).slice(0, 7);
    window.AppState.screen.client = "myCalendar";
    saveState();
    renderAll();
    showToast("Termin zarezerwowany ✓");
    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.acceptRequestFromApp(req.id, prop.id).then(function (res) {
        if (res && res.booking && bk) {
          bk.id = res.booking.id;
          bk._fromApi = true;
          saveState();
        }
      });
    }
  }

  function declineRequestProposals(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    req.proposals = [];
    req.acceptedProposalId = null;
    req.status = "pending";
    const bk = (window.AppState.bookings || []).find((b) => b.requestId === req.id);
    if (bk) {
      bk.dateISO = "";
      bk.from = "";
      bk.to = "";
      bk.locationId = null;
      bk.locationLabel = "";
      bk.status = "pending";
    }
    pushNotification(
      "provider",
      `${req.clientName || "Klient"} prosi o inne terminy — ${(req.serviceNames || []).join(", ")}.`
    );
    saveState();
    renderAll();
    showToast("Poprosiliśmy o inne terminy.");
  }

  /** Klient wycofuje prośbę o termin (zanim zarezerwuje jedną z propozycji). */
  function cancelClientRequest(requestId) {
    const req = (window.AppState.requests || []).find(function (r) {
      return r && r.id === requestId;
    });
    if (!req) return;
    if (req.status !== "pending" && req.status !== "proposed") return;
    req.status = "cancelled";
    req.proposals = [];
    req.acceptedProposalId = null;
    const bk = (window.AppState.bookings || []).find(function (b) {
      return b && b.requestId === req.id;
    });
    if (bk) bk.status = "cancelled";
    pushNotification(
      "provider",
      `${req.clientName || "Klient"} anulował(a) prośbę o termin — ${(req.serviceNames || []).join(", ") || "usługa"}.`
    );
    saveState();
    renderAll();
    showToast("Prośba o termin anulowana.");
    hapticTap(12);
  }

  function rejectRequest(requestId) {
    const req = (window.AppState.requests || []).find((r) => r && r.id === requestId);
    if (!req) return;
    req.status = "rejected";
    req.proposals = [];
    req.acceptedProposalId = null;
    const bk = (window.AppState.bookings || []).find((b) => b && b.requestId === req.id);
    if (bk) bk.status = "rejected";
    if (replyRequestId() === req.id) {
      window.AppState.provCalReplyRequestId = null;
      window.AppState.provCalReplyShowAll = false;
      const draft = window.AppState.provCalAddDraft || defaultProvCalAddDraft();
      draft.requestId = null;
      draft.proposals = [];
      draft.slotId = null;
      window.AppState.provCalAddDraft = draft;
    }
    pushNotification(
      "client",
      `${req.providerName || "Usługodawca"} odrzucił(a) prośbę o termin — ${(req.serviceNames || []).join(", ") || "usługa"}.`
    );
    saveState();
    renderAll();
    showToast("Prośba o termin odrzucona.");
    hapticTap(16);
  }

  function clearNotifications(role) {
    window.AppState.notifications = (window.AppState.notifications || []).filter(function (n) {
      return !n || n.role !== role;
    });
    saveState();
    renderAll();
  }

  function ensureCancelVisitDialog() {
    let el = document.getElementById("cancel-visit-dialog");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cancel-visit-dialog";
    el.className = "cancel-visit-dialog";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "cancel-visit-title");
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closeCancelVisitDialog() {
    const el = document.getElementById("cancel-visit-dialog");
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    delete el.dataset.bookingId;
    document.body.classList.remove("cancel-visit-dialog-open");
  }

  function openCancelVisitDialog(bookingId) {
    const bk = (window.AppState.bookings || []).find((b) => b.id === bookingId);
    if (!bk || bk.status !== "confirmed") return;
    const provider = getProviderById(bk.providerId);
    const policy = providerCancelPolicyText(provider);
    const when =
      (bk.dateISO ? formatDateLong(bk.dateISO) : "") +
      (bk.from && bk.to ? ", " + bk.from + "–" + bk.to : bk.from ? ", " + bk.from : "");
    const el = ensureCancelVisitDialog();
    el.dataset.bookingId = bookingId;
    el.innerHTML = `
      <button type="button" class="cancel-visit-dialog__backdrop" data-action="close-cancel-visit" aria-label="Zamknij"></button>
      <div class="cancel-visit-dialog__panel">
        <h2 class="cancel-visit-dialog__title" id="cancel-visit-title">Odwołać wizytę?</h2>
        <p class="cancel-visit-dialog__lead">${escapeHtml(when || "Ta wizyta")} · ${escapeHtml(bk.providerName || bk.clientName || "wizyta")}</p>
        ${
          policy
            ? `<p class="cancel-visit-dialog__policy"><span class="cancel-visit-dialog__policy-label">Zasady anulowania</span>${escapeHtml(policy)}</p>`
            : ""
        }
        <div class="cancel-visit-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="close-cancel-visit">Zostaw</button>
          <button type="button" class="btn btn--primary" data-action="confirm-cancel-visit" data-booking-id="${escapeHtml(bookingId)}">Odwołaj wizytę</button>
        </div>
      </div>`;
    el.hidden = false;
    document.body.classList.add("cancel-visit-dialog-open");
  }

  function cancelVisit(bookingId) {
    const bk = (window.AppState.bookings || []).find((b) => b.id === bookingId);
    if (!bk) return;
    bk.status = "cancelled";
    closeCancelVisitDialog();
    saveState();
    renderAll();
    showToast("Wizyta odwołana.");
  }

  // ─────────────────────────────────────────────────────────
  // Reszta (logowanie, strony, toast) — jak wcześniej
  // ─────────────────────────────────────────────────────────
  function resetDemo() {
    try {
      localStorage.removeItem(STATE_KEY);
    } catch (err) {
      // ignore
    }
    window.AppState = defaultState();
    saveState();
    renderAll();
    showSimulator();
  }

  function showToast(message) {
    const toast = document.getElementById("app-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.hidden = true;
    }, 2800);
  }

  function showPage(page) {
    const home = document.getElementById("page-home");
    const app = document.getElementById("page-app");
    if (!home || !app) return;
    if (page === "app") {
      home.hidden = true;
      app.hidden = false;
      window.scrollTo(0, 0);
    } else {
      app.hidden = true;
      home.hidden = false;
    }
  }

  function showSimulator() {
    showPage("home");
    const sim = document.getElementById("simulator");
    if (sim) {
      requestAnimationFrame(function () {
        sim.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  /** Wejście do marketplace (lista usługodawców) zamiast panelu głównego / odkryj. */
  function goMarketplace() {
    window.AppState.loggedIn = true;
    window.AppState.activeRole = "client";
    window.AppState.screen.client = "search";
    window.AppState.searchOpenSlug = null;
    window.AppState.appMenuOpen = false;
    saveState();
    updateAppHeader("client");
    renderAll();
    showPage("app");
  }

  function handleRouteHash() {
    const hash = (location.hash || "").replace(/^#/, "");
    const embedMatch = hash.match(/^embed\/(.+)$/);
    if (embedMatch && embedMatch[1]) {
      const slug = decodeURIComponent(embedMatch[1]);
      setEmbedMode(true);
      window.AppState.loggedIn = true;
      window.AppState.activeRole = "client";
      window.AppState.screen.client = "booking";
      saveState();
      updateAppHeader("client");
      showPage("app");
      openProvider(slug, { force: true, embed: true });
      return;
    }
    setEmbedMode(false);
    if (hash === "simulator") {
      showSimulator();
      return;
    }
    const providerMatch = hash.match(/^provider\/(.+)$/);
    if (providerMatch && providerMatch[1]) {
      showSimulator();
      openProvider(decodeURIComponent(providerMatch[1]));
      return;
    }
    if (hash === "calendar") {
      showPage("home");
      const cal = document.getElementById("calendar");
      if (cal) {
        requestAnimationFrame(function () {
          cal.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }

  function appHeaderNavItems(activeRole) {
    const menuOpen = !!window.AppState.appMenuOpen;
    const role = activeRole || "client";
    if (role === "provider") {
      const screen = window.AppState.screen.provider;
      return [
        { label: "Pulpit", action: "provider-tab", tab: "dashboard", screen: "dashboard", active: !menuOpen && screen === "dashboard" },
        { label: "Kalendarz", action: "provider-tab", tab: "calendar", screen: "calendar", active: !menuOpen && screen === "calendar" },
        { label: "Usługi", action: "provider-tab", tab: "services", screen: "services", active: !menuOpen && screen === "services" },
        { label: "Dostępność", action: "provider-tab", tab: "availability", screen: "availability", active: !menuOpen && screen === "availability" },
      ];
    }
    const screen = window.AppState.screen.client;
    const onMarket = screen === "search" || screen === "booking" || screen === "profile";
    const pendingCount = clientPendingAttentionCount();
    return [
      { label: "Szukaj", action: "go-screen", screen: "search", active: !menuOpen && onMarket },
      { label: "Ulubione", action: "go-screen", screen: "favorites", active: !menuOpen && screen === "favorites" },
      {
        label: "Kalendarz",
        action: "go-screen",
        screen: "myCalendar",
        active: !menuOpen && screen === "myCalendar",
        count: pendingCount,
      },
    ];
  }

  function renderAppHeaderNav(activeRole) {
    const nav = document.getElementById("app-header-nav");
    if (!nav) return;
    const role = activeRole || "client";
    const items = appHeaderNavItems(role);
    nav.setAttribute("aria-label", role === "provider" ? "Menu usługodawcy" : "Menu klienta");
    nav.innerHTML = items
      .map(function (it) {
        const attrs = [];
        if (it.screen) attrs.push(`data-screen="${it.screen}"`);
        if (it.tab) attrs.push(`data-tab="${it.tab}"`);
        const badge = renderCountBadge(it.count, "count-badge site-nav__badge");
        const aria =
          it.count > 0
            ? `${it.label}, ${it.count} oczekując${it.count === 1 ? "e" : "ych"}`
            : it.label;
        return `<button type="button" class="site-nav__link${it.active ? " site-nav__link--active" : ""}"
          data-action="${it.action}" ${attrs.join(" ")} aria-label="${escapeHtml(aria)}"${
            it.active ? ' aria-current="page"' : ""
          }><span class="site-nav__link-label">${escapeHtml(it.label)}</span>${badge}</button>`;
      })
      .join("");
  }

  function syncAppHeaderMenuBtn(open) {
    const btn = document.getElementById("app-header-menu-btn");
    if (!btn) return;
    btn.classList.toggle("app-header__menu-btn--open", !!open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function appHeaderUserLabel(activeRole) {
    if (activeRole === "provider") {
      const provider = myProvider();
      if (provider && provider.name) return provider.name;
    }
    const cp = ensureClientProfile();
    const user = data().CURRENT_USER;
    return cp.name || (user && user.name) || "";
  }

  function updateAppHeader(activeRole) {
    const user = data().CURRENT_USER;
    const userEl = document.getElementById("app-header-user");
    if (userEl) userEl.textContent = appHeaderUserLabel(activeRole);

    const pageApp = document.getElementById("page-app");
    if (pageApp) pageApp.dataset.activeRole = activeRole || "client";

    const hasProviderRole = user && user.providerRole && user.providerRole.active;
    const roleSwitch = document.getElementById("app-role-switch");
    if (roleSwitch) roleSwitch.hidden = !hasProviderRole;

    if (hasProviderRole && roleSwitch) {
      roleSwitch.querySelectorAll(".app-role-btn").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.role === activeRole ? "true" : "false");
      });
    }

    renderAppHeaderNav(activeRole);
    syncAppHeaderMenuBtn(!!window.AppState.appMenuOpen);

    const onMyCalendar = activeRole === "client" && window.AppState.screen.client === "myCalendar";
    document.querySelectorAll('#page-home [data-action="open-my-calendar"]').forEach(function (btn) {
      btn.classList.toggle("site-nav__link--active", onMyCalendar);
      btn.setAttribute("aria-current", onMyCalendar ? "page" : "false");
    });
  }

  function openMyCalendar() {
    window.AppState.loggedIn = true;
    window.AppState.activeRole = "client";
    window.AppState.screen.client = "myCalendar";
    window.AppState.searchOpenSlug = null;
    saveState();
    updateAppHeader("client");
    renderAll();
    showPage("app");
  }

  function testLogin(startRole) {
    const role = INSTANCES.indexOf(startRole) !== -1 ? startRole : "client";
    window.AppState.loggedIn = true;
    window.AppState.activeRole = role;
    window.AppState.screen[role] = DEFAULT_SCREEN[role];
    saveState();
    updateAppHeader(role);
    renderAll();
    showPage("app");
  }

  function logout() {
    window.AppState.loggedIn = false;
    window.AppState.activeRole = null;
    saveState();
    goMarketplace();
  }

  function closeAppMenuThen(fn) {
    const wasMenuOpen = !!window.AppState.appMenuOpen;
    window.AppState.appMenuOpen = false;
    saveState();
    syncAppMenuNavButtons(false);
    if (wasMenuOpen) {
      setAppMenuOpenClass(false);
      setTimeout(function () {
        if (window.AppState.appMenuOpen) return;
        fn();
      }, 380);
    } else {
      fn();
    }
  }

  function switchRole(role) {
    if (INSTANCES.indexOf(role) === -1) return;
    window.AppState.activeRole = role;
    updateAppHeader(role);
    closeAppMenuThen(function () {
      renderAll();
    });
  }

  function editClientProfile() {
    window.AppState.activeRole = "client";
    window.AppState.screen.client = "account";
    updateAppHeader("client");
    closeAppMenuThen(function () {
      renderAll();
    });
  }

  function editProviderProfile() {
    if (!myProvider()) {
      showToast("Brak profilu usługodawcy.");
      return;
    }
    window.AppState.activeRole = "provider";
    window.AppState.screen.provider = "settings";
    updateAppHeader("provider");
    closeAppMenuThen(function () {
      renderAll();
    });
  }

  function setClientAvatarFromFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      showToast("Wybierz plik graficzny.");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      showToast("Zdjęcie jest za duże (max 2,5 MB).");
      return;
    }

    function applyLocalPreview() {
      const reader = new FileReader();
      reader.onload = function () {
        window.AppState.clientAvatarUrl = String(reader.result || "");
        window.AppState.appMenuOpen = true;
        saveState();
        renderAll();
        showToast("Zdjęcie profilu zaktualizowane.");
      };
      reader.onerror = function () {
        showToast("Nie udało się wczytać zdjęcia.");
      };
      reader.readAsDataURL(file);
    }

    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.uploadAvatar(file).then(function (url) {
        if (url) {
          window.AppState.clientAvatarUrl = url;
          window.AppState.appMenuOpen = true;
          saveState();
          renderAll();
          showToast("Zdjęcie profilu zapisane na serwerze.");
          return;
        }
        applyLocalPreview();
      });
      return;
    }
    applyLocalPreview();
  }

  window.App = {
    navigate: navigate,
    render: render,
    renderAll: renderAll,
    setRole: setRole,
    loadState: loadState,
    saveState: saveState,
    resetDemo: resetDemo,
    testLogin: testLogin,
    logout: logout,
    switchRole: switchRole,
    showPage: showPage,
    showSimulator: showSimulator,
    computeSlots: computeSlots,
    usesDesktopLayout: usesDesktopLayout,
  };

  // ─────────────────────────────────────────────────────────
  // Delegacja zdarzeń
  // ─────────────────────────────────────────────────────────
  document.addEventListener("keydown", function (event) {
    const photoPreviewOpen = document.getElementById("service-photo-preview");
    if (photoPreviewOpen && !photoPreviewOpen.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeServicePhotoPreview();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        shiftServicePhotoPreview(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        shiftServicePhotoPreview(1);
        return;
      }
    }
    if (event.key === "Escape") {
      const deleteSvcDlg = document.getElementById("delete-service-dialog");
      if (deleteSvcDlg && !deleteSvcDlg.hidden) {
        event.preventDefault();
        closeDeleteServiceDialog();
        return;
      }
      const installHelp = document.getElementById("pwa-install-help");
      if (installHelp && !installHelp.hidden) {
        event.preventDefault();
        closePwaInstallHelp();
        return;
      }
      const preview = document.getElementById("avatar-preview");
      if (preview && !preview.hidden) {
        event.preventDefault();
        closeAvatarPreview();
        return;
      }
      if (window.AppState.appMenuOpen) {
        event.preventDefault();
        closeAppMenu();
        return;
      }
      if (window.AppState.provCalSelection) {
        event.preventDefault();
        clearProvCalSelection();
        saveState();
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const slot = event.target.closest('[data-role="prov-cal-slot"]');
      if (slot) {
        event.preventDefault();
        const sel = selectionFromSlotEl(slot);
        if (sel && sel.kind === "booking" && sel.bookingId) openProvCalEdit(sel.bookingId);
        else selectProvCalSlot(sel);
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const t = event.target;
      const tag = (t && t.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
      if (!document.querySelector(".app-screen--prov-cal")) return;
      if (window.AppState.provCalMonthOpen) return;
      event.preventDefault();
      const step = provCalSwipeStepDays();
      shiftProvCalDate(event.key === "ArrowLeft" ? -step : step);
    }
  });

  document.addEventListener("change", function (event) {
    const clientAvatar = event.target.closest("[data-action=change-client-avatar]");
    if (clientAvatar && clientAvatar.files && clientAvatar.files[0]) {
      setClientAvatarFromFile(clientAvatar.files[0]);
      clientAvatar.value = "";
      return;
    }
    const servicePhotos = event.target.closest("[data-action=add-service-photos]");
    if (servicePhotos && servicePhotos.files && servicePhotos.files.length) {
      addServicePhotosFromFiles(servicePhotos.files);
      servicePhotos.value = "";
    }
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".settings-loc__color")) {
      closeSettingsLocColorPickers();
    }
    if (
      !event.target.closest('[data-role="avail-loc-pick"]') &&
      !event.target.closest('[data-role="avail-repeat-pick"]')
    ) {
      closeAvailPickMenus();
    }
    if (
      !event.target.closest('[data-role="prov-cal-add-client-pick"]') &&
      !event.target.closest('[data-role="prov-cal-add-client-menu"]') &&
      !event.target.closest(".client-sheet__panel")
    ) {
      const menu = document.getElementById("prov-cal-add-client-menu");
      if (menu && menu.classList.contains("client-sheet--arming")) {
        /* ten sam gest co otwarcie — nie zamykaj */
      } else {
        const addDraft = window.AppState.provCalAddDraft;
        if (addDraft && addDraft.clientPickOpen) {
          closeProvCalAddClientPick();
        }
      }
    }
    if (
      !event.target.closest('[data-role="prov-cal-add-service-pick"]') &&
      !event.target.closest('[data-role="prov-cal-add-service-sheet"]') &&
      !event.target.closest(".service-sheet__panel")
    ) {
      const sheet = document.getElementById("prov-cal-add-service-sheet");
      if (sheet && sheet.classList.contains("client-sheet--arming")) {
        /* arming */
      } else if (sheet && sheet.querySelector('[data-role="prov-cal-add-inne-duration"]')) {
        closeProvCalAddInneDurationPick();
      } else {
        const addDraft = window.AppState.provCalAddDraft;
        if (addDraft && addDraft.servicePickOpen) {
          closeProvCalAddServicePick();
        }
      }
    }
    if (
      !event.target.closest("#avail-series-cloud") &&
      !event.target.closest('[data-action="open-avail-remove-cloud"]')
    ) {
      closeAvailSeriesCloud();
    }
    if (
      !event.target.closest("#prov-cal-view-cloud") &&
      !event.target.closest('[data-action="prov-cal-view-menu"]')
    ) {
      closeProvCalViewCloud();
    }

    const popover = document.getElementById("provider-card-popover");
    const insidePopover = event.target.closest("#provider-card-popover");
    const menuBtn = event.target.closest("[data-action=open-provider-menu]");

    if (popover && !popover.hidden && !insidePopover && !menuBtn) {
      closeProviderCardMenu();
    }

    if (event.target.closest(".provider-card-popover__item[href]")) {
      closeProviderCardMenu();
      return;
    }

    const simLink = event.target.closest('a[href="#simulator"]');
    if (simLink) {
      event.preventDefault();
      if (location.hash !== "#simulator") location.hash = "#simulator";
      else handleRouteHash();
      return;
    }

    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    const d = btn.dataset;

    switch (a) {
      case "reset-demo": resetDemo(); break;
      case "test-login": event.preventDefault(); testLogin(d.target); break;
      case "open-my-calendar": event.preventDefault(); openMyCalendar(); break;
      case "logout": logout(); break;
      case "go-home":
        event.preventDefault();
        goMarketplace();
        break;
      case "show-simulator":
        event.preventDefault();
        showSimulator();
        break;
      case "switch-role": switchRole(d.role); break;
      case "edit-client-profile":
        event.preventDefault();
        editClientProfile();
        break;
      case "edit-provider-profile":
        event.preventDefault();
        editProviderProfile();
        break;
      case "go-screen": goScreen(d.screen); break;
      case "toggle-app-menu":
        event.preventDefault();
        toggleAppMenu();
        break;
      case "close-app-menu":
        event.preventDefault();
        closeAppMenu();
        break;
      case "add-provider-profile":
        event.preventDefault();
        closeAppMenu();
        showToast("Wkrótce: dodawanie profilu usługodawcy.");
        break;
      case "open-legal":
        event.preventDefault();
        {
          const labels = {
            privacy: "Polityka prywatności",
            terms: "Regulamin",
            contact: "Kontakt: hello@lokalnie.app",
          };
          showToast(labels[d.doc] || "Informacja");
        }
        break;
      case "check-pwa-update":
        event.preventDefault();
        checkPwaUpdate();
        break;
      case "install-pwa":
        event.preventDefault();
        handlePwaInstallClick();
        break;
      case "close-pwa-install-help":
        event.preventDefault();
        closePwaInstallHelp();
        break;
      case "open-provider": openProvider(d.slug); break;
      case "open-profile": openProvider(d.slug); break;
      case "rebook-visit": rebookVisit(d.bookingId); break;
      case "add-visit-calendar":
        event.preventDefault();
        addVisitToCalendar(d.bookingId);
        break;
      case "preview-avatar":
        event.preventDefault();
        event.stopPropagation();
        openAvatarPreview(d.slug);
        break;
      case "close-avatar-preview":
        event.preventDefault();
        event.stopPropagation();
        closeAvatarPreview();
        break;
      case "open-provider-info":
        event.preventDefault();
        event.stopPropagation();
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        openProviderInfo(d.slug);
        break;
      case "call-provider":
        event.preventDefault();
        event.stopPropagation();
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        callProvider(d.slug);
        break;
      case "close-provider": closeProvider(); break;
      case "toggle-fav":
        event.preventDefault();
        event.stopPropagation();
        toggleFav(d.slug);
        break;
      case "open-provider-menu":
        event.preventDefault();
        event.stopPropagation();
        openProviderCardMenu(d.slug, btn);
        break;
      case "toggle-booking-provider-info":
        event.preventDefault();
        event.stopPropagation();
        toggleBookingProviderInfo(d.slug);
        break;
      case "toggle-provider-card-info":
        event.preventDefault();
        event.stopPropagation();
        toggleProviderCardInfo(d.slug);
        break;
      case "toggle-provider-card-hours":
        event.preventDefault();
        event.stopPropagation();
        toggleProviderCardHoursExpanded();
        break;
      case "peek-hours-week-slot":
        event.preventDefault();
        event.stopPropagation();
        peekHoursWeekSlot(btn.closest(".provider-hours-week__slot") || btn);
        break;
      case "provider-info-profile":
        event.preventDefault();
        event.stopPropagation();
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        openProviderInfo(d.slug);
        break;
      case "close-provider-menu":
        event.preventDefault();
        closeProviderCardMenu();
        break;
      case "share-provider":
        event.preventDefault();
        shareProvider(d.slug);
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        break;
      case "copy-provider-embed":
        event.preventDefault();
        copyProviderEmbed(d.slug);
        break;
      case "report-provider":
        event.preventDefault();
        reportProvider(d.slug);
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        break;
      case "toggle-service": toggleService(d.serviceId); break;
      case "toggle-service-check": toggleServiceCheck(d.serviceId); break;
      case "pick-service-variant":
        event.preventDefault();
        pickServiceVariant(d.serviceId, d.variantId);
        break;
      case "toggle-service-desc": toggleServiceDesc(d.serviceId); break;
      case "preview-service-photos":
        event.preventDefault();
        event.stopPropagation();
        openServicePhotoPreview(d.serviceId, 0);
        break;
      case "close-service-photo-preview":
        event.preventDefault();
        closeServicePhotoPreview();
        break;
      case "service-photo-prev":
        event.preventDefault();
        shiftServicePhotoPreview(-1);
        break;
      case "service-photo-next":
        event.preventDefault();
        shiftServicePhotoPreview(1);
        break;
      case "start-booking": startBooking(d.slug); break;
      case "send-request": sendRequest(d.slug); break;
      case "pick-date": pickDate(d.date); break;
      case "pick-slot": pickSlot(d.slot); break;
      case "clear-slot": clearSlot(); break;
      case "cancel-booking-selection": cancelBookingSelection(); break;
      case "focus-booking-services": toggleMultiSelect(); break;
      case "book-slot": bookSlot(d.slot); break;
      case "cal-prev": shiftCalMonth(-1); break;
      case "cal-next": shiftCalMonth(1); break;
      case "my-cal-prev": shiftMyCalMonth(-1); break;
      case "my-cal-next": shiftMyCalMonth(1); break;
      case "my-cal-month-toggle": toggleMyCalMonthPanel(); break;
      case "my-cal-today": goMyCalToday(); break;
      case "my-cal-pick-date": pickMyCalDate(d.date); break;
      case "my-cal-status-filter":
        event.preventDefault();
        setMyCalStatusFilter(d.status);
        break;
      case "my-cal-status-scroll":
        event.preventDefault();
        scrollMyCalStatusRail(d.dir, btn);
        break;
      case "avail-week-prev":
        event.preventDefault();
        scrollAvailStripByWeeks(-1);
        break;
      case "avail-week-next":
        event.preventDefault();
        scrollAvailStripByWeeks(1);
        break;
      case "avail-today":
        event.preventDefault();
        goAvailToday();
        break;
      case "avail-month-toggle":
        event.preventDefault();
        toggleAvailMonthPanel();
        break;
      case "avail-jump-date":
        event.preventDefault();
        if (d.date) {
          const prevMonth = ensureAvailPickerMonth();
          const prevWeek = mondayISOFrom(ensureAvailFocusDate() || d.date);
          window.AppState.availFocusDate = d.date;
          window.AppState.availPickerMonth = String(d.date).slice(0, 7);
          window.AppState.availWeekStart = mondayISOFrom(d.date);
          const nextMonth = window.AppState.availPickerMonth;
          const nextWeek = window.AppState.availWeekStart;
          const monthChanged = prevMonth !== nextMonth;
          const weekChanged = prevWeek !== nextWeek;
          saveState();
          refreshAvailWeekView({
            rebuildMonth: monthChanged,
            monthDir: monthChanged ? (nextMonth > prevMonth ? 1 : -1) : 0,
            weekDir: weekChanged ? (nextWeek > prevWeek ? 1 : -1) : 0,
          });
          scrollAvailListToDate(d.date);
        }
        break;
      case "toggle-avail-day-edit":
        event.preventDefault();
        toggleAvailDayEdit(d.date, btn);
        if (d.date && window.AppState.availEditDate === d.date) {
          scrollAvailListToDate(d.date);
        }
        break;
      case "add-avail-block":
        event.preventDefault();
        {
          const dateISO = d.date || ensureAvailFocusDate();
          addAvailEditBlock(dateISO, btn);
          scrollAvailListToDate(dateISO);
        }
        break;
      case "open-avail-remove-cloud":
        event.preventDefault();
        openAvailSeriesCloud(btn);
        break;
      case "remove-avail-block":
        event.preventDefault();
        closeAvailSeriesCloud();
        removeAvailEditBlock(d.date, d.index, btn);
        break;
      case "clear-avail-recurring-series":
        event.preventDefault();
        clearAvailRecurringSeries(d.date, d.index);
        break;
      case "save-avail-day":
        event.preventDefault();
        saveAvailDayEdit(d.date, { source: btn });
        break;
      case "toggle-avail-loc":
        event.preventDefault();
        toggleAvailPickMenu(btn.closest('[data-role="avail-loc-pick"]'), btn, "avail-loc-menu");
        break;
      case "pick-avail-loc":
        event.preventDefault();
        setAvailBlockLocation(d.date, d.index, d.locationId, btn);
        break;
      case "toggle-avail-repeat":
        event.preventDefault();
        toggleAvailPickMenu(btn.closest('[data-role="avail-repeat-pick"]'), btn, "avail-repeat-menu");
        break;
      case "pick-avail-repeat":
        event.preventDefault();
        setAvailBlockRepeat(d.date, d.index, d.repeat, btn);
        break;
      case "clear-avail-day":
        event.preventDefault();
        closeAvailSeriesCloud();
        clearAvailDay(d.date, { closeEdit: true });
        break;
      case "swipe-clear-avail-day":
        event.preventDefault();
        clearAvailDay(d.date, { closeEdit: true });
        break;
      case "confirm-booking": confirmBooking(); break;
      case "accept-proposal": acceptProposal(d.bookingId); break;
      case "reject-proposal": rejectProposal(d.bookingId); break;
      case "request-toggle-day": toggleRequestDay(d.date); break;
      case "request-day-part": setRequestDayPart(d.date, d.part); break;
      case "accept-request-proposal": acceptRequestProposal(d.requestId, d.proposalId); break;
      case "decline-request-proposals": declineRequestProposals(d.requestId); break;
      case "cancel-client-request":
        event.preventDefault();
        cancelClientRequest(d.requestId);
        break;
      case "clear-notifications": clearNotifications(d.notifRole); break;

      case "provider-tab":
        window.AppState.appMenuOpen = false;
        window.AppState.activeRole = "provider";
        updateAppHeader("provider");
        if (d.tab === "availability") openAvailability();
        else if (d.tab === "calendar") {
          ensureProvCalDate();
          navigate("provider", "calendar", {});
        } else if (d.tab === "requests") openProvCalAddRequests();
        else navigate("provider", d.tab, {});
        break;
      case "service-location-toggle":
        event.preventDefault();
        toggleServiceLocation(d.locId || btn.getAttribute("data-loc-id"), btn);
        break;
      case "settings-social-add":
        event.preventDefault();
        captureProviderProfileFields();
        captureProviderContactFields();
        addProviderSocialLink();
        break;
      case "settings-social-remove":
        event.preventDefault();
        captureProviderProfileFields();
        captureProviderContactFields();
        removeProviderSocialLink(d.id);
        break;
      case "settings-loc-add":
        event.preventDefault();
        captureProviderProfileFields();
        captureProviderContactFields();
        captureProviderLocationFields();
        addProviderLocation();
        break;
      case "settings-loc-remove":
        event.preventDefault();
        captureProviderProfileFields();
        captureProviderContactFields();
        captureProviderLocationFields();
        removeProviderLocation(d.id);
        break;
      case "settings-loc-color-toggle":
        event.preventDefault();
        event.stopPropagation();
        toggleSettingsLocColorPicker(d.id, event.target.closest(".settings-loc__swatch") || event.target);
        break;
      case "settings-loc-tone":
        event.preventDefault();
        captureProviderProfileFields();
        captureProviderContactFields();
        captureProviderLocationFields();
        setProviderLocationTone(d.id, d.tone);
        break;
      case "select-prov-cal-slot":
        event.preventDefault();
        event.stopPropagation();
        if (window._provCalSlotIgnoreClick || window._provCalResizeIgnoreClick) {
          window._provCalSlotIgnoreClick = false;
          window._provCalResizeIgnoreClick = false;
          break;
        }
        if (d.bookingId || d.kind === "booking") {
          openProvCalEdit(d.bookingId);
          break;
        }
        // Pusty przedział: drugi tap odznacza.
        selectProvCalSlot({
          kind: "free",
          dateISO: d.date || ensureProvCalDate(),
          fromMin: Number(d.fromMin),
          toMin: Number(d.toMin),
        });
        break;
      case "prov-cal-remove-proposal":
        event.preventDefault();
        event.stopPropagation();
        // Tap myszą/dotykiem obsłużony już na pointerup (tam też drag) — tu tylko klawiatura.
        if (window._provCalSlotIgnoreClick || window._provCalResizeIgnoreClick) {
          window._provCalSlotIgnoreClick = false;
          window._provCalResizeIgnoreClick = false;
          break;
        }
        setProvCalAddSlot(d.slot);
        break;
      case "prov-cal-today":
        event.preventDefault();
        pickProvCalDate(demoTodayISO(), { keepView: true });
        break;
      case "prov-cal-month":
        event.preventDefault();
        toggleProvCalMonthPanel();
        break;
      case "prov-cal-view":
        event.preventDefault();
        if (d.view === "month") toggleProvCalMonthPanel();
        break;
      case "prov-cal-view-menu":
        event.preventDefault();
        event.stopPropagation();
        openProvCalViewCloud(btn);
        break;
      case "prov-cal-set-view":
        event.preventDefault();
        closeProvCalViewCloud();
        applyProvCalVisibleDays(Number(d.days) || 1, { closeMonth: true });
        break;
      case "prov-cal-pick-date":
        event.preventDefault();
        if (window._provCalSwipeSuppressClick) break;
        pickProvCalDate(d.date);
        break;
      case "open-prov-cal-add":
        event.preventDefault();
        openProvCalAdd();
        break;
      case "open-prov-cal-requests":
        event.preventDefault();
        openProvCalAddRequests();
        break;
      case "open-dash-visits":
        event.preventDefault();
        openDashVisits();
        break;
      case "open-dash-rejected":
        event.preventDefault();
        openDashRejected();
        break;
      case "toggle-dash-search":
        event.preventDefault();
        toggleDashSearch();
        break;
      case "clear-dash-search":
        event.preventDefault();
        clearDashSearch();
        break;
      case "close-prov-cal-add":
        event.preventDefault();
        closeProvCalAdd();
        break;
      case "minimize-prov-cal-add":
        event.preventDefault();
        minimizeProvCalAdd();
        break;
      case "expand-prov-cal-add":
        event.preventDefault();
        expandProvCalAdd();
        break;
      case "clear-prov-cal-add-client":
        event.preventDefault();
        clearProvCalAddClient();
        break;
      case "focus-prov-cal-add-client-search":
        event.preventDefault();
        focusProvCalAddClientSearch();
        break;
      case "close-prov-cal-add-client-pick":
        event.preventDefault();
        {
          const menu = document.getElementById("prov-cal-add-client-menu");
          if (menu && menu.classList.contains("client-sheet--arming")) break;
        }
        closeProvCalAddClientPick();
        break;
      case "client-sheet-jump":
        event.preventDefault();
        jumpClientSheetLetter(d.letter);
        break;
      case "toggle-prov-cal-add-service": {
        event.preventDefault();
        const addDraft = window.AppState.provCalAddDraft;
        const willOpen = !(addDraft && addDraft.servicePickOpen);
        if (addDraft) {
          addDraft.servicePickOpen = willOpen;
          if (willOpen) addDraft.clientPickOpen = false;
        }
        if (willOpen) {
          setProvCalAddClientPickOpen(false);
          setProvCalAddServicePickOpen(true);
        } else {
          closeProvCalAddServicePick();
        }
        break;
      }
      case "close-prov-cal-add-service-pick":
        event.preventDefault();
        {
          const sheet = document.getElementById("prov-cal-add-service-sheet");
          if (sheet && sheet.classList.contains("client-sheet--arming")) break;
        }
        closeProvCalAddServicePick();
        break;
      case "prov-cal-add-service":
        event.preventDefault();
        toggleProvCalAddService(d.serviceId);
        break;
      case "prov-cal-add-inne":
        event.preventDefault();
        openProvCalAddInneDurationPick();
        break;
      case "clear-prov-cal-add-inne":
        event.preventDefault();
        event.stopPropagation();
        {
          const draft = ensureProvCalAddDraft();
          if (!draftProvCalAddCatalogIds(draft).length) break;
          clearProvCalAddInneFromDraft(draft);
          draft.slotId = null;
          syncProvCalSelectionFromAddDraft();
          draft.serviceScheduleDirty = true;
          closeProvCalAddInneDurationPick();
          saveState();
          patchProvCalAddServiceUi();
        }
        break;
      case "close-prov-cal-add-inne-duration":
        event.preventDefault();
        event.stopPropagation();
        closeProvCalAddInneDurationPick();
        break;
      case "prov-cal-add-pick-client":
        event.preventDefault();
        pickProvCalAddClient(d.name || btn.getAttribute("data-name") || "", {
          requestId: d.requestId || btn.getAttribute("data-request-id") || "",
        });
        break;
      case "open-client-sheet-detail":
        event.preventDefault();
        event.stopPropagation();
        openClientSheetDetail(d.name || btn.getAttribute("data-name") || "");
        break;
      case "close-client-sheet-detail":
        event.preventDefault();
        event.stopPropagation();
        closeClientSheetDetail();
        break;
      case "prov-cal-add-new-client":
        event.preventDefault();
        pickProvCalAddClient(d.name || btn.getAttribute("data-name") || "", { addNew: true });
        break;
      case "toggle-client-sheet-new-details":
        event.preventDefault();
        event.stopPropagation();
        toggleClientSheetNewDetails();
        break;
      case "prov-cal-add-toggle-desc":
        event.preventDefault();
        toggleProvCalAddServiceDesc(d.serviceId);
        break;
      case "prov-cal-add-date":
        event.preventDefault();
        setProvCalAddDate(d.date);
        break;
      case "prov-cal-add-slot":
        event.preventDefault();
        setProvCalAddSlot(d.slot);
        break;
      case "confirm-prov-cal-add":
        event.preventDefault();
        confirmProvCalAdd();
        break;
      case "toggle-prov-cal-reply-show-all":
        event.preventDefault();
        toggleProvCalReplyShowAll();
        break;
      case "reply-propose-remove":
        event.preventDefault();
        removeReplyProposalSlot(d.slot);
        break;
      case "toggle-reply-proposals":
        event.preventDefault();
        toggleReplyProposalsOpen();
        break;
      case "propose-open": proposeOpen(d.requestId); break;
      case "reject-request":
        event.preventDefault();
        event.stopPropagation();
        rejectRequest(d.requestId);
        break;
      case "propose-date": proposeDate(d.requestId, d.date); break;
      case "propose-slot": proposeSlot(d.requestId, d.slot, d.date); break;
      case "propose-remove": proposeRemove(d.requestId, d.slot); break;
      case "propose-confirm": proposeConfirm(d.requestId); break;
      case "edit-service":
        event.preventDefault();
        openEditService(d.serviceId);
        break;
      case "add-service":
        event.preventDefault();
        openAddService(d.group);
        break;
      case "remove-service-photo":
        event.preventDefault();
        removeServicePhoto(d.index);
        break;
      case "cancel-edit-service":
        event.preventDefault();
        cancelEditService();
        break;
      case "add-service-variant":
        event.preventDefault();
        addServiceVariant();
        break;
      case "remove-service-variant":
        event.preventDefault();
        removeServiceVariant(d.index);
        break;
      case "save-service":
        event.preventDefault();
        {
          const form = btn.closest("form.service-edit");
          saveService(d.serviceId, form);
        }
        break;
      case "delete-service":
        event.preventDefault();
        openDeleteServiceDialog(d.serviceId || btn.getAttribute("data-service-id"));
        break;
      case "toggle-services-pick":
        event.preventDefault();
        setProviderServicesPickMode(!providerServicesPickMode());
        saveState();
        renderAll();
        break;
      case "set-services-group-mode":
        event.preventDefault();
        setProviderServicesGroupMode(
          d.group || btn.getAttribute("data-group"),
          d.mode || btn.getAttribute("data-mode")
        );
        break;
      case "toggle-service-pick":
        event.preventDefault();
        toggleProviderServicePick(d.serviceId || btn.getAttribute("data-service-id"));
        break;
      case "delete-selected-services":
        event.preventDefault();
        openDeleteServiceDialog(providerServicesPickIds());
        break;
      case "close-delete-service":
        event.preventDefault();
        closeDeleteServiceDialog();
        break;
      case "confirm-delete-service":
        event.preventDefault();
        {
          const dlg = document.getElementById("delete-service-dialog");
          const raw = (dlg && dlg.dataset.serviceIds) || "";
          const ids = raw
            ? raw.split(",").map(function (x) {
                return x.trim();
              }).filter(Boolean)
            : [];
          deleteServices(ids);
        }
        break;
      case "select-provider-visit":
        event.preventDefault();
        selectProviderVisitInCalendar(d.bookingId);
        break;
      case "select-provider-free":
        event.preventDefault();
        selectProviderFreeInCalendar(d.date, d.fromMin, d.toMin);
        break;
      case "edit-visit":
        event.preventDefault();
        openProvCalEdit(d.bookingId);
        break;
      case "cancel-visit":
        event.preventDefault();
        openCancelVisitDialog(d.bookingId);
        break;
      case "close-cancel-visit":
        event.preventDefault();
        closeCancelVisitDialog();
        break;
      case "confirm-cancel-visit":
        event.preventDefault();
        cancelVisit(d.bookingId);
        break;
      case "filter-category":
        window.AppState.searchCategory = d.category || "";
        window.AppState.searchSubcategory = "";
        saveState();
        renderAll();
        break;
      case "filter-subcategory":
        window.AppState.searchSubcategory = d.subcategory || "";
        saveState();
        renderAll();
        break;
      case "toggle-search-filters":
        window.AppState.searchFiltersOpen = !window.AppState.searchFiltersOpen;
        saveState();
        applySearchFiltersOpen(window.AppState.searchFiltersOpen, btn);
        break;
      case "toggle-filter-date":
        {
          const dateISO = d.date || "";
          if (!dateISO) break;
          const dates = (window.AppState.searchFilterDates || []).slice();
          const idx = dates.indexOf(dateISO);
          if (idx === -1) dates.push(dateISO);
          else dates.splice(idx, 1);
          dates.sort();
          window.AppState.searchFilterDates = dates;
          saveState();
          renderAll();
        }
        break;
      case "toggle-filter-period":
        {
          const period = d.period || "";
          if (period !== "morning" && period !== "afternoon" && period !== "evening") break;
          const periods = (window.AppState.searchFilterPeriods || []).slice();
          const idx = periods.indexOf(period);
          if (idx === -1) periods.push(period);
          else periods.splice(idx, 1);
          window.AppState.searchFilterPeriods = periods;
          saveState();
          renderAll();
        }
        break;
      case "clear-location":
        window.AppState.searchUseCurrentLocation = true;
        window.AppState.searchLocation = "";
        saveState();
        renderAll();
        break;
      case "run-search":
        saveState();
        updateProviderLists();
        break;
      default: break;
    }
  });

  // Wyszukiwarka (input) — delegacja
  document.addEventListener("input", function (event) {
    const inp = event.target.closest('[data-role="search-input"]');
    if (inp) {
      window.AppState.searchQuery = inp.value;
      saveState();
      updateProviderLists();
      return;
    }

    const locInp = event.target.closest('[data-role="search-location"]');
    if (locInp) {
      const val = locInp.value.trim();
      if (!val) {
        window.AppState.searchUseCurrentLocation = true;
        window.AppState.searchLocation = "";
      } else {
        window.AppState.searchUseCurrentLocation = false;
        window.AppState.searchLocation = val;
      }
      saveState();
      updateProviderLists();
      return;
    }

    const addClientInp = event.target.closest('[data-role="prov-cal-add-client"]');
    if (addClientInp) {
      // Pole jest readonly — wyszukiwanie tylko w sheetcie; tu tylko synchronizacja wartości.
      const draft = ensureProvCalAddDraft();
      draft.clientName = String(addClientInp.value || "");
      patchProvCalAddClientClearBtn();
      saveState();
      return;
    }

    const dashSearch = event.target.closest('[data-role="dash-search-input"]');
    if (dashSearch) {
      window.AppState.dashSearchOpen = true;
      window.AppState.dashSearchQ = String(dashSearch.value || "");
      const start = dashSearch.selectionStart;
      const end = dashSearch.selectionEnd;
      saveState();
      renderAll();
      requestAnimationFrame(function () {
        const again = document.querySelector('[data-role="dash-search-input"]');
        if (!again) return;
        try {
          again.focus({ preventScroll: true });
          if (typeof start === "number" && typeof end === "number") {
            again.setSelectionRange(start, end);
          }
        } catch (err) {
          again.focus();
        }
      });
      return;
    }

    const sheetSearch = event.target.closest('[data-role="prov-cal-add-client-sheet-search"]');
    if (sheetSearch) {
      const draft = ensureProvCalAddDraft();
      captureClientSheetNewDetails();
      const q = String(sheetSearch.value || "");
      draft.clientPickOpen = true;
      if (isProvCalAddRequestsContactsMode()) {
        draft.clientSheetSearchQ = q;
      } else {
        draft.clientName = q;
        const formInput = document.querySelector('[data-role="prov-cal-add-client"]');
        if (formInput) formInput.value = draft.clientName;
        patchProvCalAddClientClearBtn();
      }
      refreshProvCalAddClientMenu({ focusSearch: false });
      saveState();
      return;
    }

    const newPhoneInp = event.target.closest('[data-role="client-sheet-new-phone"]');
    if (newPhoneInp) {
      const draft = ensureProvCalAddDraft();
      draft.clientSheetNewPhone = String(newPhoneInp.value || "");
      saveState();
      return;
    }
    const newEmailInp = event.target.closest('[data-role="client-sheet-new-email"]');
    if (newEmailInp) {
      const draft = ensureProvCalAddDraft();
      draft.clientSheetNewEmail = String(newEmailInp.value || "");
      saveState();
      return;
    }

    const addPhoneInp = event.target.closest('[data-role="prov-cal-add-phone"]');
    if (addPhoneInp) {
      const draft = ensureProvCalAddDraft();
      draft.clientPhone = String(addPhoneInp.value || "");
      draft.clientPickOpen = false;
      setProvCalAddClientPickOpen(false);
      saveState();
      return;
    }
    const addEmailInp = event.target.closest('[data-role="prov-cal-add-email"]');
    if (addEmailInp) {
      const draft = ensureProvCalAddDraft();
      draft.clientEmail = String(addEmailInp.value || "");
      draft.clientPickOpen = false;
      setProvCalAddClientPickOpen(false);
      saveState();
      return;
    }
  });

  document.addEventListener("focusin", function (event) {
    const addClientInp = event.target.closest('[data-role="prov-cal-add-client"]');
    if (!addClientInp) return;
    if (isClientSheetPickLocked()) return;
    const draft = ensureProvCalAddDraft();
    if (draft.clientPickOpen) return;
    draft.clientName = String(draft.clientName || addClientInp.value || "");
    draft.clientPickOpen = true;
    draft.servicePickOpen = false;
    closeAvailPickMenus();
    setProvCalAddServicePickOpen(false);
    refreshProvCalAddClientMenu({ focusSearch: true });
  });

  document.addEventListener("click", function (event) {
    const addClientInp = event.target.closest('[data-role="prov-cal-add-client"]');
    if (!addClientInp) return;
    if (isClientSheetPickLocked()) return;
    // Klik w pole (readonly) zawsze otwiera sheet — także gdy już ma fokus.
    const draft = ensureProvCalAddDraft();
    if (draft.clientPickOpen) {
      focusClientSheetSearch();
      return;
    }
    draft.clientName = String(draft.clientName || addClientInp.value || "");
    draft.clientPickOpen = true;
    draft.servicePickOpen = false;
    closeAvailPickMenus();
    setProvCalAddServicePickOpen(false);
    refreshProvCalAddClientMenu({ focusSearch: true });
  }, true);

  document.addEventListener("change", function (event) {
    const radiusSel = event.target.closest('[data-role="search-radius"]');
    if (radiusSel) {
      window.AppState.searchRadiusKm = Number(radiusSel.value) || 15;
      saveState();
      updateProviderLists();
      return;
    }

    const showFreeToggle = event.target.closest('[data-role="prov-show-free"]');
    if (showFreeToggle) {
      window.AppState.dashShowFreeSlots = !!showFreeToggle.checked;
      saveState();
      renderAll();
      return;
    }

    const visibleSearchToggle = event.target.closest('[data-role="settings-visible-search"]');
    if (visibleSearchToggle) {
      const p = myProvider();
      if (p) {
        p.visibleInSearch = !!visibleSearchToggle.checked;
        saveState();
        renderAll();
      }
      return;
    }

    const emailVisibleToggle = event.target.closest('[data-role="settings-email-visible"]');
    if (emailVisibleToggle) {
      captureProviderProfileFields();
      captureProviderContactFields();
      saveState();
      renderAll();
      return;
    }

    const bookingModeSwitch = event.target.closest('[data-role="service-booking-mode-switch"]');
    if (bookingModeSwitch) {
      const group = bookingModeSwitch.getAttribute("data-group");
      const picked = group || normalizeBookingMode(bookingModeSwitch.getAttribute("data-mode"));
      // Jedna kategoria aktywna naraz; wyłączenie wraca do „klient potwierdza”.
      const next = bookingModeSwitch.checked ? picked : "confirm";
      setServiceBookingMode(next, bookingModeSwitch);
      return;
    }

    const accountNotif = event.target.closest(
      '[data-role="account-notif-reminders"], [data-role="account-notif-status"], [data-role="account-notif-marketing"]'
    );
    if (accountNotif) {
      captureClientAccountFields();
      saveState();
      renderAll();
      return;
    }

    const accountField = event.target.closest(
      '[data-role="account-name"], [data-role="account-phone"], [data-role="account-email"]'
    );
    if (accountField) {
      captureClientAccountFields();
      saveState();
      updateAppHeader(window.AppState.activeRole || "client");
      return;
    }

    const profileField = event.target.closest(
      '[data-role="settings-name"], [data-role="settings-address"], [data-role="settings-about"], [data-role="settings-rule-future"], [data-role="settings-rule-lead"], [data-role="settings-rule-cancel"], [data-role="settings-rule-policy"]'
    );
    if (profileField) {
      captureProviderProfileFields();
      saveState();
      if (profileField.matches("select")) renderAll();
      return;
    }

    const socialKindField = event.target.closest('[data-role="settings-social-kind"]');
    if (socialKindField) {
      captureProviderSocialFields();
      saveState();
      renderAll();
      return;
    }

    const socialValueField = event.target.closest('[data-role="settings-social-value"]');
    if (socialValueField) {
      captureProviderSocialFields();
      saveState();
      return;
    }

    const contactField = event.target.closest(
      '[data-role="settings-phone"], [data-role="settings-email"]'
    );
    if (contactField) {
      captureProviderProfileFields();
      captureProviderContactFields();
      saveState();
      return;
    }

    const locField = event.target.closest(
      '[data-role="settings-loc-name"], [data-role="settings-loc-address"]'
    );
    if (locField) {
      captureProviderLocationFields();
      saveState();
      return;
    }

    const availField = event.target.closest('.avail-edit input:not([type="hidden"]), .avail-edit select');
    if (availField) {
      const form = availField.closest('[data-role="avail-edit-form"]');
      const dateISO = form && form.getAttribute("data-date");
      if (dateISO) {
        // Godziny: zapis bez przebudowy DOM (mobile picker gubi wartość przy re-renderze).
        const isTime = availField.matches && availField.matches("input.avail-edit__time");
        saveAvailDayEdit(dateISO, { quiet: true, noRender: isTime, source: form });
        if (isTime) refreshAvailEditMeta(form);
      }
    }
  });

  // Długość przedziału i walidacja aktualizują się w trakcie wpisywania godzin.
  document.addEventListener("input", function (event) {
    const timeField =
      event.target.closest && event.target.closest("input.avail-edit__time");
    if (!timeField) return;
    refreshAvailEditMeta(timeField.closest('[data-role="avail-edit-form"]'));
  });

  // Klawiatura w listach wyboru (lokalizacja / powtarzanie): Esc, strzałki, Home/End.
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const openPick = document.querySelector(
        '[data-role="avail-loc-pick"].is-open, [data-role="avail-repeat-pick"].is-open'
      );
      if (!openPick) return;
      event.preventDefault();
      const openTrigger = openPick.querySelector(
        '[data-action="toggle-avail-loc"], [data-action="toggle-avail-repeat"]'
      );
      closeAvailPickMenus();
      if (openTrigger) openTrigger.focus();
      return;
    }
    const pick =
      event.target.closest &&
      event.target.closest('[data-role="avail-loc-pick"], [data-role="avail-repeat-pick"]');
    if (!pick) return;
    const isOpen = pick.classList.contains("is-open");
    const trigger = pick.querySelector(
      '[data-action="toggle-avail-loc"], [data-action="toggle-avail-repeat"]'
    );
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End")
      return;
    const options = Array.prototype.slice.call(
      pick.querySelectorAll("[data-action=pick-avail-loc], [data-action=pick-avail-repeat]")
    );
    if (!options.length) return;
    event.preventDefault();
    if (!isOpen) {
      if (trigger) trigger.click();
      const selected = options.find(function (opt) {
        return opt.classList.contains("is-selected");
      });
      (selected || options[0]).focus();
      return;
    }
    const current = options.indexOf(document.activeElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % options.length;
    else next = current <= 0 ? options.length - 1 : current - 1;
    options[next].focus();
  });

  document.addEventListener(
    "scroll",
    function (event) {
      const target = event.target;
      if (!target || !target.closest) return;
      const bookingStrip = target.closest('[data-role="booking-date-strip"], [data-role="prov-cal-add-date-strip"]');
      if (bookingStrip) updateBookingMonthLabel(bookingStrip);
      const filterDates = target.closest(".filter-scroll--dates");
      if (filterDates) {
        updateSearchFilterMonthLabel(filterDates);
        ensureSearchFilterDatesExtended(filterDates);
      }
      const availGrid = target.closest('[data-role="avail-week-grid"]');
      if (availGrid) handleAvailStripScroll(availGrid);
    },
    true
  );

  /**
   * Zaznaczanie wolnych/zajętych + przeciąganie WIZYT na wolne sloty (snap 5 min).
   * „Wolne” da się tylko zaznaczyć — nie przesuwa się; przyjmuje upuszczoną wizytę.
   */
  /** Tap w pusty tor → zaznacz przedział 30 min (jak Google Calendar). */
  function bindProvCalEmptyTap() {
    if (bindProvCalEmptyTap.done) return;
    bindProvCalEmptyTap.done = true;
    const tap = {
      active: false,
      pointerId: null,
      x: 0,
      y: 0,
      track: null,
      dateISO: null,
    };

    function resolveEmptyTapTrack(target) {
      if (!target || !target.closest) return null;
      if (target.closest('[data-role="prov-cal-slot"]')) return null;
      if (target.closest('[data-role="prov-cal-resize"]')) return null;
      let track = target.closest('[data-role="prov-cal-track"]');
      if (!track) {
        // Trafienie w tło kolumny / clip — weź tor z kolumny dnia.
        const col = target.closest(".gcal-week__col[data-date], [data-role='prov-cal-cols-track'] > [data-date]");
        if (col) track = col.querySelector('[data-role="prov-cal-track"]');
      }
      if (!track) return null;
      if (!track.closest('[data-role="prov-cal-body"]')) return null;
      return track;
    }

    function armEmptyTap(event) {
      if (event.button != null && event.button !== 0) return;
      if (window.AppState.provCalMonthOpen) return;
      if (document.body.classList.contains("prov-cal-dragging")) return;
      if (document.body.classList.contains("prov-cal-pinching")) return;
      if (document.body.classList.contains("prov-cal-resizing")) return;
      const track = resolveEmptyTapTrack(event.target);
      if (!track) {
        tap.active = false;
        return;
      }
      tap.active = true;
      tap.pointerId = event.pointerId;
      tap.x = event.clientX;
      tap.y = event.clientY;
      tap.track = track;
      tap.dateISO =
        track.getAttribute("data-date") ||
        (track.closest("[data-date]") && track.closest("[data-date]").getAttribute("data-date")) ||
        ensureProvCalDate();
    }

    function cancelEmptyTapIfMoved(event) {
      if (!tap.active) return;
      if (tap.pointerId != null && event.pointerId != null && event.pointerId !== tap.pointerId) return;
      if (Math.abs(event.clientX - tap.x) > 10 || Math.abs(event.clientY - tap.y) > 10) {
        tap.active = false;
      }
    }

    function commitEmptyTap(event) {
      if (!tap.active || !tap.track) return;
      if (tap.pointerId != null && event.pointerId != null && event.pointerId !== tap.pointerId) return;
      const track = tap.track;
      const dateISO = tap.dateISO;
      const y = event.clientY;
      tap.active = false;
      tap.track = null;
      if (window._provCalSlotIgnoreClick || window._provCalResizeIgnoreClick || window._provCalSwipeSuppressClick) {
        return;
      }
      // Po poziomym swipe dnia nie dokładaj szkicu.
      if (track.closest(".prov-cal-body--day-swipe, .prov-cal-body--animating-days")) return;
      event.preventDefault();
      event.stopPropagation();
      window._provCalEmptyTapHandled = true;
      setTimeout(function () {
        window._provCalEmptyTapHandled = false;
      }, 0);
      placeProvCalFreeSelection(dateISO, y, track);
    }

    document.addEventListener("pointerdown", armEmptyTap, true);
    document.addEventListener("pointermove", cancelEmptyTapIfMoved, true);
    document.addEventListener("pointerup", commitEmptyTap, true);
    document.addEventListener(
      "pointercancel",
      function () {
        tap.active = false;
        tap.track = null;
      },
      true
    );

    // Fallback (gdy pointer events nie dają clicka / są zablokowane).
    document.addEventListener(
      "click",
      function (event) {
        if (window._provCalEmptyTapHandled) return;
        if (window._provCalSlotIgnoreClick || window._provCalResizeIgnoreClick || window._provCalSwipeSuppressClick) {
          return;
        }
        if (window.AppState.provCalMonthOpen) return;
        const track = resolveEmptyTapTrack(event.target);
        if (!track) return;
        if (track.closest(".prov-cal-body--day-swipe, .prov-cal-body--animating-days")) return;
        event.preventDefault();
        event.stopPropagation();
        const dateISO =
          track.getAttribute("data-date") ||
          (track.closest("[data-date]") && track.closest("[data-date]").getAttribute("data-date")) ||
          ensureProvCalDate();
        placeProvCalFreeSelection(dateISO, event.clientY, track);
      },
      true
    );
  }

  /** Przeciąganie górnego/dolnego uchwytu pustego przedziału. */
  function bindProvCalDraftResize() {
    if (bindProvCalDraftResize.done) return;
    bindProvCalDraftResize.done = true;
    const resize = {
      active: false,
      el: null,
      edge: null,
      pointerId: null,
      dateISO: null,
      fromMin: 0,
      toMin: 0,
      moved: false,
    };

    function endResize(event) {
      if (!resize.active) return;
      if (event && resize.pointerId != null && event.pointerId != null && event.pointerId !== resize.pointerId) {
        return;
      }
      window._provCalResizeIgnoreClick = true;
      setTimeout(function () {
        window._provCalResizeIgnoreClick = false;
      }, 0);
      if (resize.moved) {
        window.AppState.provCalSelection = normalizeProvCalSelection({
          kind: "free",
          dateISO: resize.dateISO,
          fromMin: resize.fromMin,
          toMin: resize.toMin,
        });
        updateProvCalAddSelectionLive({ snapSelection: true });
        saveState();
        hapticTap(10);
        // Koniec resize — karuzela dojeżdża do dopasowanego slotu.
        scheduleScrollProvCalAddTimeToSelected();
      }
      resize.active = false;
      resize.el = null;
      resize.edge = null;
      resize.pointerId = null;
      resize.moved = false;
      document.body.classList.remove("prov-cal-resizing");
    }

    document.addEventListener(
      "pointerdown",
      function (event) {
        if (event.button != null && event.button !== 0) return;
        const handle = event.target.closest && event.target.closest('[data-role="prov-cal-resize"]');
        if (!handle) return;
        const el = handle.closest('[data-role="prov-cal-slot"][data-kind="free"]');
        if (!el) return;
        event.preventDefault();
        event.stopPropagation();
        resize.active = true;
        resize.el = el;
        resize.edge = handle.getAttribute("data-edge") === "start" ? "start" : "end";
        resize.pointerId = event.pointerId;
        resize.dateISO = el.getAttribute("data-date") || ensureProvCalDate();
        resize.fromMin = Number(el.getAttribute("data-from-min"));
        resize.toMin = Number(el.getAttribute("data-to-min"));
        resize.moved = false;
        document.body.classList.add("prov-cal-resizing");
        try {
          handle.setPointerCapture(event.pointerId);
        } catch (err) {}
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!resize.active || !resize.el) return;
        if (resize.pointerId != null && event.pointerId !== resize.pointerId) return;
        event.preventDefault();
        const track = resize.el.closest('[data-role="prov-cal-track"]') || resize.el.closest(".gcal__track");
        if (!track) return;
        const hourH = ensureProvCalHourH();
        const dayStart = PROV_CAL_HOUR_START * 60;
        const dayEnd = PROV_CAL_HOUR_END * 60;
        const minDur = 15;
        const rect = track.getBoundingClientRect();
        let min = dayStart + ((event.clientY - rect.top) / hourH) * 60;
        min = snapProvCalMin(min);
        min = Math.max(dayStart, Math.min(dayEnd, min));
        // Trzymaj resize w wolnej luce (dostępność − wizyty), żeby nie nachodził na inne.
        const gaps = provCalFreeGaps(resize.dateISO);
        const mid = (resize.fromMin + resize.toMin) / 2;
        let gap =
          gaps.find(function (g) {
            return mid >= g.from && mid < g.to;
          }) || null;
        if (!gap) {
          gap = { from: dayStart, to: dayEnd };
        }
        const lo = Math.max(dayStart, gap.from);
        const hi = Math.min(dayEnd, gap.to);
        let fromMin = resize.fromMin;
        let toMin = resize.toMin;
        if (resize.edge === "start") {
          fromMin = Math.min(min, toMin - minDur);
          fromMin = Math.max(lo, fromMin);
        } else {
          toMin = Math.max(min, fromMin + minDur);
          toMin = Math.min(hi, toMin);
        }
        if (toMin - fromMin < minDur) return;
        if (fromMin === resize.fromMin && toMin === resize.toMin) return;
        resize.fromMin = fromMin;
        resize.toMin = toMin;
        resize.moved = true;
        applyProvCalFreeDraftLayout(resize.el, fromMin, toMin);
        window.AppState.provCalSelection = normalizeProvCalSelection({
          kind: "free",
          dateISO: resize.dateISO,
          fromMin: fromMin,
          toMin: toMin,
        });
        updateProvCalAddSelectionLive();
      },
      { capture: true, passive: false }
    );

    document.addEventListener("pointerup", endResize, true);
    document.addEventListener("pointercancel", endResize, true);
  }

  function bindProvCalEventDrag() {
    if (bindProvCalEventDrag.done) return;
    bindProvCalEventDrag.done = true;
    const HOLD_MS = 300;
    const MOUSE_THRESHOLD = 4;
    const AUTO_EDGE = 52;
    /** Wąska strefa pozioma (jak GCal) — nie pół kolumny dnia. */
    const H_EDGE = 22;
    const AUTO_STEP = 14;
    /** Dwell w strefie krawędzi przed przesunięciem dnia (jeden skok; kolejny po re-entry). */
    const EDGE_DWELL_MS = 480;
    const drag = {
      active: false,
      el: null,
      kind: null,
      bookingId: null,
      dateISO: null,
      startDate: null,
      startFrom: 0,
      startTo: 0,
      duration: 0,
      originX: 0,
      originY: 0,
      lastClientX: 0,
      lastClientY: 0,
      grabMinOffset: 0,
      pointerId: null,
      pointerType: "mouse",
      moved: false,
      allowMove: false,
      armed: false,
      weekView: false,
      holdTimer: 0,
      autoRAF: 0,
      autoDir: 0,
      edgeDir: 0,
      lastEdgeShiftAt: 0,
      /** true dopiero gdy wskaźnik był poza strefą krawędzi w trakcie tego dragu. */
      edgeEligible: false,
      edgeEnterAt: 0,
    };

    function isWeekView() {
      return ensureProvCalVisibleDays() > 1;
    }

    function dragRootGcal() {
      return (drag.el && drag.el.closest && drag.el.closest('[data-role="prov-cal-gcal"]')) || null;
    }

    function trackForDate(dateISO) {
      const root = dragRootGcal();
      const scope = root || document;
      const col = scope.querySelector('.gcal-week__col[data-date="' + dateISO + '"]');
      if (col) return col.querySelector(".gcal-week__track");
      return drag.el ? drag.el.closest(".gcal__track") : null;
    }

    /** Minuty osi czasu odpowiadające pozycji Y wskaźnika w danym torze. */
    function pointerFromMin(clientY, track) {
      if (!track) return PROV_CAL_HOUR_START * 60;
      const hourH = ensureProvCalHourH();
      const rect = track.getBoundingClientRect();
      return PROV_CAL_HOUR_START * 60 + ((clientY - rect.top) / hourH) * 60;
    }

    /**
     * ISO dnia kolumny (tydzień) z geometrii — bez elementFromPoint / pointer-events:none
     * (Safari przy tym często emituje pointercancel i urywa drag).
     */
    function columnDateUnderPoint(clientX, clientY) {
      const root = dragRootGcal();
      if (!root) return null;
      const cols = root.querySelectorAll(".gcal-week__col[data-date]");
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const r = col.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        // W pionie kolumna jest wysoka — bierzemy oś X; lekki margines gdy palec między kolumnami.
        if (clientX >= r.left && clientX <= r.right) {
          return col.getAttribute("data-date");
        }
        const dist = clientX < r.left ? r.left - clientX : clientX - r.right;
        if (dist < bestDist) {
          bestDist = dist;
          best = col;
        }
      }
      return best && bestDist < 28 ? best.getAttribute("data-date") : null;
    }

    function captureDragPointer() {
      if (!drag.el || drag.pointerId == null) return;
      try {
        drag.el.setPointerCapture(drag.pointerId);
      } catch (err) {
        /* ignore — Safari bywa kapryśny po reparent */
      }
    }

    function clearHoldTimer() {
      if (drag.holdTimer) {
        clearTimeout(drag.holdTimer);
        drag.holdTimer = 0;
      }
    }

    function clearDragEdgeHint() {
      drag.edgeDir = 0;
      document.querySelectorAll(".gcal--drag-edge-left, .gcal--drag-edge-right").forEach(function (el) {
        el.classList.remove("gcal--drag-edge-left", "gcal--drag-edge-right");
      });
    }

    function colsClipRect() {
      const root = dragRootGcal();
      const clip =
        (root && root.querySelector('[data-role="prov-cal-cols-clip"]')) ||
        document.querySelector('[data-role="prov-cal-cols-clip"]');
      return clip ? clip.getBoundingClientRect() : null;
    }

    /** -1 / 1 gdy wskaźnik w wąskiej strefie lewej/prawej krawędzi okna dni. */
    function horizontalEdgeDir(clientX) {
      const rect = colsClipRect();
      if (!rect) return 0;
      if (clientX <= rect.left + H_EDGE) return -1;
      if (clientX >= rect.right - H_EDGE) return 1;
      return 0;
    }

    function stopAutoScroll() {
      if (drag.autoRAF) {
        cancelAnimationFrame(drag.autoRAF);
        drag.autoRAF = 0;
      }
      drag.autoDir = 0;
      clearDragEdgeHint();
      drag.lastEdgeShiftAt = 0;
      drag.edgeEnterAt = 0;
      drag.edgeEligible = false;
    }

    function resetDrag() {
      clearHoldTimer();
      stopAutoScroll();
      if (drag.el) drag.el.classList.remove("gcal__event--dragging", "gcal__event--invalid");
      clearProvCalDropTargets();
      hideProvCalDragTime();
      document.body.classList.remove("prov-cal-dragging");
      document.querySelectorAll(".gcal--drag-active").forEach(function (el) {
        el.classList.remove("gcal--drag-active", "gcal--drag-edge-left", "gcal--drag-edge-right");
      });
      drag.active = false;
      drag.el = null;
      drag.pointerId = null;
      drag.moved = false;
      drag.allowMove = false;
      drag.armed = false;
      drag.weekView = false;
      drag.slotId = null;
    }

    function armBookingDrag() {
      drag.holdTimer = 0;
      if (!drag.active || !drag.allowMove || !drag.el) return;
      drag.armed = true;
      drag.weekView = isWeekView();
      drag.el.classList.add("gcal__event--dragging");
      // Start w strefie krawędzi (termin w skrajnej kolumnie) — nie shiftuj, aż wyjedziesz i wrócisz.
      drag.edgeEligible = horizontalEdgeDir(drag.lastClientX) === 0;
      drag.edgeEnterAt = 0;
      drag.lastEdgeShiftAt = 0;
      drag.edgeDir = 0;
      // Przechwyć wskaźnik i zablokuj natywny scroll / hit-test obcych slotów (Safari).
      document.body.classList.add("prov-cal-dragging");
      const gcal = dragRootGcal();
      if (gcal) gcal.classList.add("gcal--drag-active");
      captureDragPointer();
      if (!isProvCalSlotSelected(drag.el)) {
        if (drag.kind === "free") {
          selectProvCalSlot(
            {
              kind: "free",
              dateISO: drag.dateISO,
              fromMin: drag.startFrom,
              toMin: drag.startTo,
            },
            { force: true }
          );
        } else {
          selectProvCalSlot(
            {
              kind: "booking",
              bookingId: drag.bookingId,
              dateISO: drag.dateISO,
              fromMin: drag.startFrom,
              toMin: drag.startTo,
            },
            { force: true }
          );
        }
      } else {
        hapticTap(16);
      }
      if (!drag.weekView && drag.kind === "booking") {
        highlightProvCalDropTargets(drag.bookingId, drag.dateISO, drag.duration);
        updateProvCalDragTime(drag.startFrom);
      } else if (!drag.weekView) {
        updateProvCalDragTime(drag.startFrom);
      }
    }

    /** Przelicz pozycję wskaźnika na czas/dzień i zaktualizuj blok (obsługa scrolla i kolumn). */
    function updateDragLayout() {
      if (!drag.armed || !drag.el) return;
      const dayStart = PROV_CAL_HOUR_START * 60;
      const dayEnd = PROV_CAL_HOUR_END * 60;

      let targetDate = drag.dateISO;
      let track;
      if (drag.weekView) {
        // Kolumna = pod palcem. Gdy edge zablokowany (start/po skoku) i palec
        // nadal na brzegu — nie przeskakuj dnia na skrajną kolumnę.
        if (drag.edgeEligible || !horizontalEdgeDir(drag.lastClientX)) {
          const d = columnDateUnderPoint(drag.lastClientX, drag.lastClientY);
          if (d) targetDate = d;
        }
        track = trackForDate(targetDate) || drag.el.parentElement;
      } else {
        track = drag.el.closest(".gcal__track");
      }
      if (!track) return;

      if (targetDate !== drag.dateISO && track) {
        track.appendChild(drag.el);
        drag.dateISO = targetDate;
        // Po przeniesieniu między kolumnami Safari gubi capture — odzyskaj.
        captureDragPointer();
      }

      const rawFrom = pointerFromMin(drag.lastClientY, track) + drag.grabMinOffset;
      let newFrom = snapProvCalMin(rawFrom);
      let newTo = newFrom + drag.duration;
      if (newFrom < dayStart) {
        newFrom = dayStart;
        newTo = newFrom + drag.duration;
      }
      if (newTo > dayEnd) {
        newTo = dayEnd;
        newFrom = newTo - drag.duration;
      }
      applyProvCalSlotLayout(drag.el, newFrom, newTo);
      // Kolor kafła = lokalizacja dostępności pod aktualną pozycją (na żywo przy przeciąganiu).
      if (drag.kind === "booking") {
        applyProvCalEventAvailTone(drag.el, drag.dateISO, newFrom, newTo);
      }
      if (!drag.weekView) updateProvCalDragTime(newFrom);
      if (drag.kind === "booking") {
        drag.el.classList.toggle(
          "gcal__event--invalid",
          bookingOverlapsOthers(drag.bookingId, drag.dateISO, newFrom, newTo)
        );
      }
      drag.el.setAttribute("data-date", drag.dateISO);
      if (drag.kind === "free") {
        drag.el.setAttribute(
          "aria-label",
          "Zaznaczony przedział " + minToTime(newFrom) + "–" + minToTime(newTo)
        );
        // Chip w karuzeli „jedzie” za palcem na żywo (zgodnie z resize/tap).
        syncDragLiveToState(drag.dateISO, newFrom, newTo);
      }
    }

    function syncDragLiveToState(dateISO, fromMin, toMin) {
      if (!(toMin > fromMin) || !dateISO) return;
      if (drag.kind === "free") {
        window.AppState.provCalSelection = normalizeProvCalSelection({
          kind: "free",
          dateISO: dateISO,
          fromMin: fromMin,
          toMin: toMin,
        });
        if (window.AppState.provCalDate !== dateISO) {
          window.AppState.provCalDate = dateISO;
          window.AppState.provCalPickerMonth = dateISO.slice(0, 7);
          syncProvCalSelection();
        }
        updateProvCalAddSelectionLive();
        return;
      }
      if (drag.bookingId) moveBookingTimes(drag.bookingId, fromMin, toMin, dateISO);
    }

    function reattachDragAfterRender() {
      let el = null;
      if (drag.kind === "free") {
        el = document.querySelector('[data-role="prov-cal-slot"][data-kind="free"]');
      } else if (drag.bookingId) {
        el = document.querySelector(
          '[data-role="prov-cal-slot"][data-booking-id="' + String(drag.bookingId) + '"]'
        );
      }
      if (!el) return false;
      drag.el = el;
      drag.weekView = isWeekView();
      el.classList.add("gcal__event--dragging");
      document.body.classList.add("prov-cal-dragging");
      const gcal = dragRootGcal();
      if (gcal) {
        gcal.classList.add("gcal--drag-active");
        gcal.classList.remove("gcal--drag-edge-left", "gcal--drag-edge-right");
      }
      captureDragPointer();
      updateDragLayout();
      return true;
    }

    /** Po skoku dnia: zatrzymaj edge-scroll, aż palec wyjedzie ze strefy i wróci. */
    function armEdgeCooldownAfterShift() {
      drag.edgeEligible = false;
      drag.edgeEnterAt = 0;
      drag.lastEdgeShiftAt = 0;
      clearDragEdgeHint();
    }

    /** Przytrzymanie przy lewej/prawej krawędzi okna dni — przesuń widok i przenieś blok (jak GCal). */
    function tryEdgeDayShift() {
      if (!drag.armed || !drag.allowMove || !drag.el) return;
      // Duchy propozycji: bez skoków okna — przesuwanie tylko w obrębie widocznych dni.
      if (drag.kind === "proposal") {
        clearDragEdgeHint();
        return;
      }
      const root = dragRootGcal();
      if (!colsClipRect()) {
        clearDragEdgeHint();
        return;
      }
      const dir = horizontalEdgeDir(drag.lastClientX);
      if (!dir) {
        // Poza krawędzią — odblokuj edge-scroll na kolejne celowe wejście.
        drag.edgeEligible = true;
        drag.edgeEnterAt = 0;
        drag.lastEdgeShiftAt = 0;
        if (drag.edgeDir) clearDragEdgeHint();
        return;
      }

      // Start dragu / cooldown po skoku — zwykły ruch bez kolejnego auto-shift.
      if (!drag.edgeEligible) {
        if (drag.edgeDir) clearDragEdgeHint();
        return;
      }

      drag.edgeDir = dir;
      if (root) {
        root.classList.toggle("gcal--drag-edge-left", dir === -1);
        root.classList.toggle("gcal--drag-edge-right", dir === 1);
      }

      const now = performance.now();
      if (!drag.edgeEnterAt) drag.edgeEnterAt = now;
      // Jeden skok po dwell; kolejny dopiero po wyjechaniu ze strefy (edgeEligible).
      if (now - drag.edgeEnterAt < EDGE_DWELL_MS) return;

      updateDragLayout();
      const fromMin = Number(drag.el.getAttribute("data-from-min"));
      const toMin = Number(drag.el.getAttribute("data-to-min"));
      if (!(toMin > fromMin)) return;

      const nVisible = ensureProvCalVisibleDays();
      const days = provCalVisibleDayList(ensureProvCalDate(), nVisible);
      if (!days.length) return;
      const edgeDate = dir < 0 ? days[0] : days[days.length - 1];
      // Przesuń okno o 1 dzień za skraj — jak GCal: kafelek zostaje pod palcem na nowej krawędzi.
      const advanceTo = isoAddDays(edgeDate, dir);

      const body = document.querySelector('[data-role="prov-cal-body"]');
      const scrollTop = body ? body.scrollTop : 0;
      // Bez haptic (shiftProvCalDate) — przy trzymaniu na krawędzi byłby spam.
      if (nVisible === 7) {
        // Tydzień pon–ndz: skok do tygodnia zawierającego dzień za skrajem.
        window.AppState.provCalWindowStart = mondayISOFrom(advanceTo);
      } else {
        shiftProvCalWindow(dir);
      }
      pickProvCalDate(advanceTo, { keepSelection: true, keepWindow: true, render: false });

      const newDays = provCalVisibleDayList(ensureProvCalDate(), ensureProvCalVisibleDays());
      if (!newDays.length) return;
      const pinDate = dir < 0 ? newDays[0] : newDays[newDays.length - 1];

      drag.moved = true;
      drag.dateISO = pinDate;
      syncDragLiveToState(pinDate, fromMin, toMin);
      renderAll();
      const bodyAfter = document.querySelector('[data-role="prov-cal-body"]');
      if (bodyAfter) bodyAfter.scrollTop = scrollTop;
      // Zatrzymaj serię skoków — palec często zostaje na brzegu po renderze.
      armEdgeCooldownAfterShift();
      if (!reattachDragAfterRender()) {
        resetDrag();
      }
    }

    function dragAnimTick() {
      drag.autoRAF = 0;
      if (!drag.armed) return;
      let keep = false;
      if (drag.autoDir) {
        const body = document.querySelector('[data-role="prov-cal-body"]');
        if (body) {
          const before = body.scrollTop;
          const max = body.scrollHeight - body.clientHeight;
          body.scrollTop = Math.max(0, Math.min(max, before + AUTO_STEP * drag.autoDir));
          if (body.scrollTop !== before) updateDragLayout();
        }
        keep = true;
      }
      tryEdgeDayShift();
      // Podtrzymuj pętlę tylko podczas aktywnego (eligible) czekania na krawędzi — nie po cooldownie.
      if (drag.edgeDir && drag.edgeEligible) keep = true;
      if (keep && drag.armed) drag.autoRAF = requestAnimationFrame(dragAnimTick);
    }

    function ensureDragAnimLoop() {
      if (!drag.armed) return;
      if (!drag.autoRAF) drag.autoRAF = requestAnimationFrame(dragAnimTick);
    }

    function updateAutoScroll(clientY) {
      const body = document.querySelector('[data-role="prov-cal-body"]');
      if (!body || !drag.armed) {
        drag.autoDir = 0;
        return;
      }
      const rect = body.getBoundingClientRect();
      let dir = 0;
      if (clientY < rect.top + AUTO_EDGE) dir = -1;
      else if (clientY > rect.bottom - AUTO_EDGE) dir = 1;
      drag.autoDir = dir;
      ensureDragAnimLoop();
    }

    function commitBookingDrag() {
      if (!drag.el) return;
      const newFrom = Number(drag.el.getAttribute("data-from-min"));
      const newTo = Number(drag.el.getAttribute("data-to-min"));
      const targetDate = drag.dateISO;
      const unchanged =
        targetDate === drag.startDate && newFrom === drag.startFrom && newTo === drag.startTo;
      if (!(newTo > newFrom) || unchanged) {
        resetDrag();
        renderAll();
        return;
      }
      if (drag.kind === "free") {
        // Szkic: tylko zaznaczenie — bez zmiany provCalDate (okno dni nie skacze).
        window.AppState.provCalSelection = normalizeProvCalSelection({
          kind: "free",
          dateISO: targetDate,
          fromMin: newFrom,
          toMin: newTo,
        });
        // Karuzela w panelu „+” podąża za upuszczonym szkicem (+ snap do chipa).
        updateProvCalAddSelectionLive({ snapSelection: true });
        hapticTap(22);
        resetDrag();
        saveState();
        renderAll();
        // Po dropie — animacja karuzeli do chipa (nie przy live-drag).
        scheduleScrollProvCalAddTimeToSelected();
        return;
      }
      if (drag.kind === "proposal") {
        // Duch propozycji: przesuwa propozycję na legalny slot; inaczej odbija z powrotem.
        const movedProposal = moveReplyProposalToSlot(drag.slotId, targetDate, newFrom);
        const movedSlotId =
          movedProposal && window.AppState.provCalAddDraft
            ? (window.AppState.provCalAddDraft.proposals || []).find(function (c) {
                return c && c.dateISO === targetDate && timeToMinutes(c.from) === newFrom;
              })
            : null;
        hapticTap(movedProposal ? 22 : 10);
        resetDrag();
        saveState();
        renderAll();
        if (!movedProposal) showToast("Ten termin nie pasuje do prośby.");
        else if (movedSlotId) scheduleScrollProvCalAddTimeToSelected(movedSlotId.id);
        return;
      }
      const overlap = bookingOverlapsOthers(drag.bookingId, targetDate, newFrom, newTo);
      moveBookingTimes(drag.bookingId, newFrom, newTo, targetDate);
      const bk = (window.AppState.bookings || []).find(function (b) {
        return b.id === drag.bookingId;
      });
      if (overlap && bk && bk.status === "confirmed") {
        bk.status = "proposed";
        showToast('Nakłada się na inną wizytę — ustawiono „na akceptację”.');
      }
      window.AppState.provCalSelection = normalizeProvCalSelection({
        kind: "booking",
        bookingId: drag.bookingId,
        dateISO: targetDate,
        fromMin: newFrom,
        toMin: newTo,
      });
      hapticTap(22);
      resetDrag();
      saveState();
      renderAll();
    }

    document.addEventListener(
      "pointerdown",
      function (event) {
        if (event.button != null && event.button !== 0) return;
        // Trwający drag — nie przejmuj gestu przez „Wolne” / inny slot (Safari).
        if (drag.armed) return;
        // Uchwyt resize szkicu — osobna gestyka, nie drag całego bloku.
        if (event.target.closest && event.target.closest('[data-role="prov-cal-resize"]')) return;
        const el = event.target.closest && event.target.closest('[data-role="prov-cal-slot"]');
        if (!el) return;
        if (!el.closest('[data-role="prov-cal-body"]')) return;
        const fromMin = Number(el.getAttribute("data-from-min"));
        const toMin = Number(el.getAttribute("data-to-min"));
        if (!(toMin > fromMin)) return;
        const kind = el.getAttribute("data-kind") || "booking";
        drag.active = true;
        drag.el = el;
        drag.kind = kind;
        drag.allowMove = kind === "booking" || kind === "free" || kind === "proposal";
        drag.bookingId = el.getAttribute("data-booking-id");
        drag.slotId = el.getAttribute("data-slot");
        drag.dateISO = el.getAttribute("data-date") || ensureProvCalDate();
        drag.startDate = drag.dateISO;
        drag.startFrom = fromMin;
        drag.startTo = toMin;
        drag.duration = toMin - fromMin;
        drag.originX = event.clientX;
        drag.originY = event.clientY;
        drag.lastClientX = event.clientX;
        drag.lastClientY = event.clientY;
        drag.pointerId = event.pointerId;
        drag.pointerType = event.pointerType || "mouse";
        drag.moved = false;
        drag.armed = false;
        const startTrack = isWeekView() ? el.closest(".gcal-week__track") : el.closest(".gcal__track");
        drag.grabMinOffset = fromMin - pointerFromMin(event.clientY, startTrack);
        clearHoldTimer();
        stopAutoScroll();
        // Dotyk/pióro: hold 300 ms (nie koliduje ze scrollem). Mysz: brak holdu — próg ruchu.
        // Nie przechwytujemy wskaźnika tutaj — inaczej blokowalibyśmy natywne skrolowanie osi.
        if (drag.allowMove && drag.pointerType !== "mouse") {
          drag.holdTimer = setTimeout(armBookingDrag, HOLD_MS);
        }
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!drag.active || !drag.el || !drag.allowMove) return;
        if (drag.pointerId != null && event.pointerId !== drag.pointerId) return;
        drag.lastClientX = event.clientX;
        drag.lastClientY = event.clientY;
        const dx = event.clientX - drag.originX;
        const dy = event.clientY - drag.originY;
        if (!drag.armed) {
          if (drag.pointerType === "mouse") {
            // Mysz: uzbrój po przekroczeniu progu ruchu (klik nadal zaznacza).
            if (Math.abs(dx) < MOUSE_THRESHOLD && Math.abs(dy) < MOUSE_THRESHOLD) return;
            armBookingDrag();
          } else {
            // Dotyk przed upływem holdu = scroll/swipe — porzuć przeciąganie.
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) resetDrag();
            return;
          }
        }
        if (!drag.armed) return;
        event.preventDefault();
        drag.moved = true;
        updateDragLayout();
        updateAutoScroll(event.clientY);
        ensureDragAnimLoop();
      },
      { capture: true, passive: false }
    );

    // Fallback Safari: gdy Pointer Events umrą (pointercancel), kontynuuj przez touchmove.
    document.addEventListener(
      "touchmove",
      function (event) {
        if (!drag.armed || !drag.el || !drag.allowMove) return;
        if (event.touches.length !== 1) return;
        const t = event.touches[0];
        drag.lastClientX = t.clientX;
        drag.lastClientY = t.clientY;
        event.preventDefault();
        drag.moved = true;
        updateDragLayout();
        updateAutoScroll(t.clientY);
        ensureDragAnimLoop();
      },
      { capture: true, passive: false }
    );

    document.addEventListener(
      "touchend",
      function (event) {
        if (!drag.armed || !drag.active) return;
        if (event.touches.length > 0) return;
        endPointer(event);
      },
      { capture: true, passive: false }
    );

    function endPointer(event) {
      if (!drag.active || !drag.el) return;
      if (event && event.pointerId != null && drag.pointerId != null && event.pointerId !== drag.pointerId) {
        return;
      }
      stopAutoScroll();
      window._provCalSlotIgnoreClick = true;
      setTimeout(function () {
        window._provCalSlotIgnoreClick = false;
      }, 0);
      if (drag.moved && drag.allowMove && drag.armed) {
        commitBookingDrag();
      } else if (drag.armed) {
        resetDrag();
      } else {
        const sel = selectionFromSlotEl(drag.el);
        const tapKind = drag.kind;
        const tapSlotId = drag.slotId;
        resetDrag();
        // Tap na ducha obsługujemy tu — klik stłumiony flagą, by nie odpalić się 2× ani po dragu.
        if (tapKind === "proposal") {
          if (tapSlotId) setProvCalAddSlot(tapSlotId);
        } else if (sel && sel.kind === "booking" && sel.bookingId) openProvCalEdit(sel.bookingId);
        else if (sel && sel.kind === "free") selectProvCalSlot(sel);
        else selectProvCalSlot(sel);
      }
    }

    document.addEventListener("pointerup", endPointer, true);
    document.addEventListener(
      "pointercancel",
      function (event) {
        if (!drag.active) return;
        if (drag.pointerId != null && event.pointerId !== drag.pointerId) return;
        // Safari: cancel przy najechaniu na „Wolne” / inną kolumnę — nie urywaj uzbrojonego dragu;
        // touchmove fallback kontynuuje gest, a touchend/pointerup go domknie.
        if (drag.armed) {
          captureDragPointer();
          return;
        }
        resetDrag();
      },
      true
    );

    // Escape w trakcie przeciągania — anuluj i przywróć pierwotną pozycję.
    document.addEventListener(
      "keydown",
      function (event) {
        if (event.key !== "Escape" || !drag.active) return;
        event.preventDefault();
        event.stopPropagation();
        const wasMoved = drag.moved && drag.armed;
        const kind = drag.kind;
        const bookingId = drag.bookingId;
        const startFrom = drag.startFrom;
        const startTo = drag.startTo;
        const startDate = drag.startDate;
        resetDrag();
        if (!wasMoved) return;
        // Edge-shift zapisuje pozycję na żywo w AppState — trzeba cofnąć.
        if (kind === "booking" && bookingId && startDate) {
          moveBookingTimes(bookingId, startFrom, startTo, startDate);
        } else if (kind === "free" && startDate) {
          window.AppState.provCalSelection = normalizeProvCalSelection({
            kind: "free",
            dateISO: startDate,
            fromMin: startFrom,
            toMin: startTo,
          });
        }
        renderAll();
      },
      true
    );
  }

  function bindProvCalPinchZoom() {
    if (bindProvCalPinchZoom.done) return;
    bindProvCalPinchZoom.done = true;
    const pinch = {
      active: false,
      /** "v" = wysokość godziny, "h" = liczba dni */
      axis: null,
      startDist: 0,
      startH: 60,
      startDays: 7,
      lastDays: 7,
      anchorMin: null,
      anchorClientY: null,
      body: null,
      raf: 0,
      pendingH: null,
    };
    let wheelSaveTimer = null;
    let daysWheelAcc = 0;

    function touchVertDist(a, b) {
      return Math.abs(a.clientY - b.clientY);
    }

    function touchHorizDist(a, b) {
      return Math.abs(a.clientX - b.clientX);
    }

    function flushPinchZoom() {
      pinch.raf = 0;
      if (pinch.pendingH == null) return;
      const h = pinch.pendingH;
      pinch.pendingH = null;
      applyProvCalZoom(h, {
        body: resolveProvCalBody(pinch.body),
        anchorMin: pinch.anchorMin,
        anchorClientY: pinch.anchorClientY,
        persist: false,
      });
    }

    function schedulePinchZoom(nextH) {
      pinch.pendingH = nextH;
      if (pinch.raf) return;
      pinch.raf = requestAnimationFrame(flushPinchZoom);
    }

    function applyHorizontalPinchDays(dist) {
      if (!(pinch.startDist > 0) || !(dist > 0)) return;
      // Rozsuwanie → mniej dni (zoom in); ściskanie → więcej dni (zoom out).
      const next = clampProvCalVisibleDays(Math.round(pinch.startDays * (pinch.startDist / dist)));
      if (next === pinch.lastDays) return;
      pinch.lastDays = next;
      applyProvCalVisibleDays(next, { persist: false, closeMonth: true });
    }

    function beginPinch(body, t0, t1) {
      if (window.AppState.provCalMonthOpen) return;
      const timeline = body.querySelector('[data-role="prov-cal-timeline"]');
      if (!timeline) return;
      const vert = touchVertDist(t0, t1);
      const horiz = touchHorizDist(t0, t1);
      // Oś gestu: dominujący kierunek (lekka histereza na przekątnych).
      let axis = null;
      if (horiz >= vert * 1.15 && horiz >= 28) axis = "h";
      else if (vert >= horiz * 1.15 && vert >= 24) axis = "v";
      else if (horiz >= vert && horiz >= 28) axis = "h";
      else if (vert >= 24) axis = "v";
      else return;

      pinch.active = true;
      pinch.axis = axis;
      pinch.body = body;
      document.body.classList.add("prov-cal-pinching");
      document.body.classList.toggle("prov-cal-pinching--h", axis === "h");
      document.body.classList.toggle("prov-cal-pinching--v", axis === "v");

      if (axis === "h") {
        pinch.startDist = Math.max(28, horiz);
        pinch.startDays = ensureProvCalVisibleDays();
        pinch.lastDays = pinch.startDays;
        return;
      }

      const hourH = ensureProvCalHourH();
      const midY = (t0.clientY + t1.clientY) / 2;
      const rect = timeline.getBoundingClientRect();
      const contentY = midY - rect.top;
      pinch.startDist = Math.max(24, vert);
      pinch.startH = hourH;
      pinch.anchorClientY = midY;
      pinch.anchorMin = PROV_CAL_HOUR_START * 60 + (contentY / hourH) * 60;
    }

    function endPinch() {
      if (!pinch.active) return;
      pinch.active = false;
      pinch.axis = null;
      pinch.body = null;
      document.body.classList.remove("prov-cal-pinching", "prov-cal-pinching--h", "prov-cal-pinching--v");
      if (pinch.raf) {
        cancelAnimationFrame(pinch.raf);
        flushPinchZoom();
      }
      saveState();
    }

    // Pinch: MUSI być passive:false + preventDefault — inaczej przeglądarka
    // przejmuje gest (scroll / page-zoom) i nasza oś się nie skaluje.
    document.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length !== 2) return;
        // Tylko gdy gest zaczyna się NAD kalendarzem (bez fallbacku do innego body).
        const body = event.target && event.target.closest && event.target.closest('[data-role="prov-cal-body"]');
        if (!body) return;
        beginPinch(body, event.touches[0], event.touches[1]);
        if (pinch.active) event.preventDefault();
      },
      { passive: false, capture: true }
    );

    document.addEventListener(
      "touchmove",
      function (event) {
        if (!pinch.active) return;
        if (event.touches.length !== 2) {
          endPinch();
          return;
        }
        event.preventDefault();
        const t0 = event.touches[0];
        const t1 = event.touches[1];
        if (pinch.axis === "h") {
          applyHorizontalPinchDays(touchHorizDist(t0, t1));
          return;
        }
        const dist = touchVertDist(t0, t1);
        if (!(pinch.startDist > 0) || !(dist > 0)) return;
        pinch.anchorClientY = (t0.clientY + t1.clientY) / 2;
        schedulePinchZoom(pinch.startH * (dist / pinch.startDist));
      },
      { passive: false, capture: true }
    );

    document.addEventListener(
      "touchend",
      function (event) {
        if (!pinch.active) return;
        if (event.touches.length < 2) endPinch();
      },
      { passive: true, capture: true }
    );

    document.addEventListener("touchcancel", endPinch, { passive: true, capture: true });

    // Desktop: Shift+scroll = liczba dni; Ctrl/⌘/Alt+scroll = wysokość godziny.
    document.addEventListener(
      "wheel",
      function (event) {
        const body = event.target && event.target.closest && event.target.closest('[data-role="prov-cal-body"]');
        if (!body) return;
        if (window.AppState.provCalMonthOpen) return;

        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
          daysWheelAcc += delta;
          if (Math.abs(daysWheelAcc) < 40) return;
          const step = daysWheelAcc > 0 ? 1 : -1;
          daysWheelAcc = 0;
          // Scroll w dół / w prawo → więcej dni; w górę → mniej (jak zoom out / in).
          applyProvCalVisibleDays(ensureProvCalVisibleDays() + step, { persist: false });
          clearTimeout(wheelSaveTimer);
          wheelSaveTimer = setTimeout(function () {
            saveState();
          }, 180);
          return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
        event.preventDefault();
        const cur = ensureProvCalHourH();
        const timeline = body.querySelector('[data-role="prov-cal-timeline"]');
        let anchorMin = null;
        if (timeline) {
          const rect = timeline.getBoundingClientRect();
          const contentY = event.clientY - rect.top;
          anchorMin = PROV_CAL_HOUR_START * 60 + (contentY / cur) * 60;
        }
        const next = cur * Math.exp(-event.deltaY * 0.0018);
        applyProvCalZoom(next, {
          body: body,
          anchorMin: anchorMin,
          anchorClientY: event.clientY,
          persist: false,
        });
        clearTimeout(wheelSaveTimer);
        wheelSaveTimer = setTimeout(function () {
          saveState();
        }, 180);
      },
      { passive: false, capture: true }
    );
  }

  /** Swipe w lewo/prawo → następny / poprzedni dzień (dzień i widok wielodniowy), z animacją. */
  /**
   * Swipe jak Google Calendar:
   * — oś godzin (.gcal__hours) NIE jest w transformie → zostaje przy krawędzi,
   * — przesuwane są tylko nagłówki + kolumny dni w clipach,
   * — 1–6 dni: krok ±1 dzień (przesunięcie o szerokość 1 kolumny),
   * — 7 dni: krok ±7 (przesunięcie o pełną szerokość widoku).
   */
  function bindProvCalDaySwipe() {
    if (bindProvCalDaySwipe.done) return;
    bindProvCalDaySwipe.done = true;

    const DIST_THRESHOLD = 0.28;
    const VELOCITY_THRESHOLD = 0.45;
    const swipe = {
      active: false,
      startX: 0,
      startY: 0,
      dx: 0,
      lastX: 0,
      lastT: 0,
      velocity: 0,
      locked: false,
      built: false,
      settling: false,
      gcal: null,
      body: null,
      colsTrack: null,
      headsTrack: null,
      shiftPx: 0,
      stepDays: 1,
      scrollTop: 0,
    };

    function canSwipe(target) {
      if (!target || !target.closest) return false;
      if (window.AppState.provCalMonthOpen) return false;
      if (document.body.classList.contains("prov-cal-dragging")) return false;
      if (document.body.classList.contains("prov-cal-pinching")) return false;
      const body = target.closest('[data-role="prov-cal-body"]');
      if (body && body.classList.contains("prov-cal-body--animating-days")) return false;
      return !!target.closest("[data-prov-cal-day-swipe]");
    }

    function elFromHtml(html) {
      const host = document.createElement("div");
      host.innerHTML = String(html || "").trim();
      return host.firstElementChild;
    }

    function styleSwipeTrack(track, totalCols, colWidth, shiftPx) {
      if (!track) return;
      track.classList.add("prov-cal-swipe-extended");
      track.style.display = "grid";
      track.style.gridTemplateColumns = "repeat(" + totalCols + ", " + colWidth + "px)";
      track.style.width = totalCols * colWidth + "px";
      track.style.maxWidth = "none";
      track.style.transition = "none";
      track.style.transform = "translate3d(" + -shiftPx + "px,0,0)";
    }

    function setTracksX(x, withTransition, durationMs) {
      const t = withTransition
        ? "transform " + durationMs + "ms cubic-bezier(0.22, 1, 0.36, 1)"
        : "none";
      const transform = "translate3d(" + x + "px,0,0)";
      if (swipe.colsTrack) {
        swipe.colsTrack.style.transition = t;
        swipe.colsTrack.style.transform = transform;
      }
      if (swipe.headsTrack) {
        swipe.headsTrack.style.transition = t;
        swipe.headsTrack.style.transform = transform;
      }
    }

    /**
     * Rozszerz tory o stepDays kolumn z każdej strony (oś godzin zostaje).
     * initial translate = -shiftPx, gdzie shiftPx = stepDays * colWidth.
     */
    function buildExtendedTracks() {
      const gcal = swipe.gcal;
      const body = swipe.body;
      if (!gcal || !body) return false;
      const colsTrack = gcal.querySelector('[data-role="prov-cal-cols-track"]');
      const colsClip = gcal.querySelector('[data-role="prov-cal-cols-clip"]');
      const headsTrack = gcal.querySelector('[data-role="prov-cal-heads-track"]');
      if (!colsTrack || !colsClip) return false;

      const visibleDays = ensureProvCalVisibleDays();
      const stepDays = provCalSwipeStepDays();
      const clipWidth = colsClip.clientWidth || Math.max(gcal.clientWidth - 40, 200);
      if (clipWidth < 8) return false;
      const colWidth = clipWidth / visibleDays;
      const shiftPx = stepDays * colWidth;

      const cur = ensureProvCalDate();
      const visible = provCalVisibleDayList(cur, visibleDays);
      if (!visible.length) return false;
      const first = visible[0];
      const last = visible[visible.length - 1];
      const visits = providerVisits();

      for (let i = stepDays; i >= 1; i--) {
        const d = isoAddDays(first, -i);
        colsTrack.insertBefore(elFromHtml(renderProvCalDayColumnHtml(d, visits)), colsTrack.firstChild);
        if (headsTrack) {
          headsTrack.insertBefore(elFromHtml(renderProvCalDayHeadButton(d, cur)), headsTrack.firstChild);
        }
      }
      for (let i = 1; i <= stepDays; i++) {
        const d = isoAddDays(last, i);
        colsTrack.appendChild(elFromHtml(renderProvCalDayColumnHtml(d, visits)));
        if (headsTrack) {
          headsTrack.appendChild(elFromHtml(renderProvCalDayHeadButton(d, cur)));
        }
      }

      const totalCols = visibleDays + stepDays * 2;
      styleSwipeTrack(colsTrack, totalCols, colWidth, shiftPx);
      styleSwipeTrack(headsTrack, totalCols, colWidth, shiftPx);

      swipe.colsTrack = colsTrack;
      swipe.headsTrack = headsTrack;
      swipe.shiftPx = shiftPx;
      swipe.stepDays = stepDays;
      swipe.scrollTop = body.scrollTop;
      swipe.built = true;
      body.classList.add("prov-cal-body--day-swipe");
      return true;
    }

    function commit(deltaDays) {
      const body = swipe.body;
      const scrollTop = swipe.scrollTop;
      if (body) body.classList.remove("prov-cal-body--day-swipe", "prov-cal-body--animating-days");
      clearSwipeState();
      if (deltaDays) {
        shiftProvCalWindow(deltaDays);
        const nextISO = isoAddDays(ensureProvCalDate(), deltaDays);
        window.AppState.provCalDate = nextISO;
        window.AppState.provCalPickerMonth = nextISO.slice(0, 7);
        if (ensureProvCalVisibleDays() === 1) window.AppState.provCalWindowStart = nextISO;
        window.AppState.provCalSelection = null;
        saveState();
        hapticTap(12);
      }
      renderAll();
      requestAnimationFrame(function () {
        const b = resolveProvCalBody(body);
        if (b) b.scrollTop = scrollTop;
      });
    }

    function clearSwipeState() {
      swipe.active = false;
      swipe.locked = false;
      swipe.built = false;
      swipe.settling = false;
      swipe.colsTrack = null;
      swipe.headsTrack = null;
      swipe.gcal = null;
      swipe.body = null;
      swipe.dx = 0;
      swipe.velocity = 0;
      swipe.shiftPx = 0;
      swipe.stepDays = 1;
    }

    /** direction: -1 prev / 0 cancel / +1 next → deltaDays = direction * stepDays */
    function settle(direction) {
      const shiftPx = swipe.shiftPx;
      if (!swipe.colsTrack || !shiftPx) {
        commit(direction * swipe.stepDays);
        return;
      }
      swipe.settling = true;
      if (swipe.body) swipe.body.classList.add("prov-cal-body--animating-days");
      const target = direction > 0 ? -2 * shiftPx : direction < 0 ? 0 : -shiftPx;
      const dist = Math.abs(target - (-shiftPx + swipe.dx));
      const dur = Math.max(160, Math.min(360, 200 + dist * 0.35));
      let done = false;
      function finalize() {
        if (done) return;
        done = true;
        commit(direction * swipe.stepDays);
      }
      if (swipe.colsTrack) {
        swipe.colsTrack.addEventListener(
          "transitionend",
          function (ev) {
            if (ev.target !== swipe.colsTrack) return;
            if (ev.propertyName && ev.propertyName.indexOf("transform") === -1) return;
            finalize();
          },
          { once: true }
        );
      }
      void (swipe.colsTrack && swipe.colsTrack.offsetWidth);
      setTracksX(target, true, dur);
      window.setTimeout(finalize, dur + 80);
    }

    document.addEventListener(
      "touchstart",
      function (event) {
        if (swipe.settling) return;
        if (event.touches.length !== 1) return;
        if (!canSwipe(event.target)) return;
        // Wizyta lub szkic wolnego przedziału (z uchwytami) — nie startuj swipe dnia.
        if (event.target.closest('[data-role="prov-cal-slot"], [data-role="prov-cal-resize"]')) return;
        const gcal = event.target.closest("[data-prov-cal-day-swipe]");
        if (!gcal || gcal.classList.contains("gcal--sliding")) return;
        swipe.active = true;
        swipe.locked = false;
        swipe.built = false;
        swipe.dx = 0;
        swipe.gcal = gcal;
        swipe.body = gcal.closest('[data-role="prov-cal-body"]');
        swipe.startX = event.touches[0].clientX;
        swipe.startY = event.touches[0].clientY;
        swipe.lastX = swipe.startX;
        swipe.lastT = event.timeStamp || Date.now();
        swipe.velocity = 0;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      function (event) {
        if (!swipe.active || event.touches.length !== 1) return;
        const x = event.touches[0].clientX;
        const dx = x - swipe.startX;
        const dy = event.touches[0].clientY - swipe.startY;
        if (!swipe.locked) {
          if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
          if (Math.abs(dy) >= Math.abs(dx) * 0.85) {
            swipe.active = false;
            swipe.gcal = null;
            swipe.body = null;
            return;
          }
          swipe.locked = true;
          if (!buildExtendedTracks()) {
            swipe.active = false;
            clearSwipeState();
            return;
          }
        }
        if (event.cancelable) event.preventDefault();

        const now = event.timeStamp || Date.now();
        const dt = now - swipe.lastT;
        if (dt > 0) {
          swipe.velocity = swipe.velocity * 0.7 + ((x - swipe.lastX) / dt) * 0.3;
        }
        swipe.lastX = x;
        swipe.lastT = now;
        swipe.dx = dx;
        setTracksX(-swipe.shiftPx + dx, false, 0);
      },
      { passive: false }
    );

    function endGesture() {
      if (!swipe.active) return;
      const wasBuilt = swipe.built;
      const dx = swipe.dx;
      const shiftPx = swipe.shiftPx || 1;
      const velocity = swipe.velocity;
      swipe.active = false;

      if (!wasBuilt) {
        clearSwipeState();
        return;
      }

      const passedDist = Math.abs(dx) > shiftPx * DIST_THRESHOLD;
      const passedFlick = Math.abs(velocity) > VELOCITY_THRESHOLD && Math.abs(dx) > 12;
      let direction = 0;
      if (passedDist || passedFlick) {
        direction = dx < 0 ? 1 : -1;
      }

      if (direction) {
        window._provCalSwipeSuppressClick = true;
        window.setTimeout(function () {
          window._provCalSwipeSuppressClick = false;
        }, 450);
      }
      settle(direction);
    }

    document.addEventListener("touchend", endGesture, { passive: true });

    document.addEventListener(
      "touchcancel",
      function () {
        if (!swipe.active) return;
        swipe.active = false;
        if (swipe.built) settle(0);
        else clearSwipeState();
      },
      { passive: true }
    );
  }

  function bindProvCalMonthSwipe() {
    if (bindProvCalMonthSwipe.done) return;
    bindProvCalMonthSwipe.done = true;
    const swipe = { active: false, startX: 0, startY: 0, locked: false, kind: null };

    document.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length !== 1) return;
        if (!event.target.closest) return;
        const prov = event.target.closest('[data-role="prov-cal-month-swipe"]');
        const avail = event.target.closest('[data-role="avail-month-swipe"]');
        const myCal = event.target.closest('[data-role="my-cal-month-swipe"]');
        if (!prov && !avail && !myCal) return;
        swipe.active = true;
        swipe.locked = false;
        swipe.kind = avail ? "avail" : myCal ? "my" : "prov";
        swipe.startX = event.touches[0].clientX;
        swipe.startY = event.touches[0].clientY;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      function (event) {
        if (!swipe.active || event.touches.length !== 1) return;
        const dx = event.touches[0].clientX - swipe.startX;
        const dy = event.touches[0].clientY - swipe.startY;
        if (!swipe.locked) {
          if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            swipe.active = false;
            return;
          }
          swipe.locked = true;
        }
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      function (event) {
        if (!swipe.active) return;
        const t = event.changedTouches && event.changedTouches[0];
        const dx = t ? t.clientX - swipe.startX : 0;
        const wasLocked = swipe.locked;
        const kind = swipe.kind;
        swipe.active = false;
        swipe.locked = false;
        swipe.kind = null;
        if (!wasLocked || Math.abs(dx) < 48) return;
        if (kind === "avail") {
          shiftAvailPickerMonth(dx < 0 ? 1 : -1);
          return;
        }
        if (kind === "my") {
          if (!window.AppState.myCalMonthOpen) return;
          shiftMyCalMonth(dx < 0 ? 1 : -1);
          return;
        }
        if (!window.AppState.provCalMonthOpen) return;
        shiftProvCalPickerMonth(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );

    document.addEventListener(
      "touchcancel",
      function () {
        swipe.active = false;
        swipe.locked = false;
        swipe.kind = null;
      },
      { passive: true }
    );
  }

  /** Select godziny/minuty → ukryte name=from/to (działa na iOS/Android). */
  function bindAvailTimePickers() {
    if (bindAvailTimePickers.done) return;
    bindAvailTimePickers.done = true;

    // Na mobile natywny input[type=time] otwiera picker sam po tapnięciu.
    // showPicker() to progresywne ulepszenie głównie dla desktopu (klik = otwórz picker).
    document.addEventListener(
      "click",
      function (event) {
        const input = event.target.closest("input.avail-edit__time[type='time']");
        if (!input || input.disabled || input.readOnly) return;
        if (typeof input.showPicker !== "function") return;
        try {
          input.showPicker();
        } catch (err) {
          /* iOS/brak gestu — natywne tapnięcie i tak otwiera picker */
        }
      },
      false
    );
  }

  /**
   * Swipe-to-delete na wierszu dnia (odsłoń kosz w lewo; dalej = usuń dostępności).
   */
  function bindAvailDaySwipe() {
    if (bindAvailDaySwipe.done) return;
    bindAvailDaySwipe.done = true;

    // Krótszy gest: ~56px na kosz (jak wąski action w iOS), pełne usunięcie ~28% szerokości.
    const REVEAL = 56;
    const DELETE_RATIO = 0.28;
    let drag = null;

    function frontOf(swipe) {
      return swipe && swipe.querySelector('[data-role="avail-day-swipe-front"]');
    }

    function setOffset(swipe, x, animate) {
      const front = frontOf(swipe);
      if (!front) return;
      front.style.transition = animate ? "transform 0.22s ease" : "none";
      front.style.transform = x ? "translate3d(" + x + "px,0,0)" : "";
      swipe.classList.toggle("is-open", x <= -REVEAL + 1);
      swipe.classList.toggle("is-dragging", !animate && !!drag);
    }

    function closeAll(except) {
      document.querySelectorAll('[data-role="avail-day-swipe"].is-open, [data-role="avail-day-swipe"].is-dragging').forEach(function (el) {
        if (except && el === except) return;
        setOffset(el, 0, true);
      });
    }

    function finishDelete(swipe) {
      const dateISO = swipe.getAttribute("data-date");
      const front = frontOf(swipe);
      if (!dateISO || !front) return;
      swipe.classList.add("is-deleting");
      front.style.transition = "transform 0.2s ease";
      front.style.transform = "translate3d(-110%,0,0)";
      window.setTimeout(function () {
        clearAvailDay(dateISO, { closeEdit: true });
      }, 180);
    }

    document.addEventListener(
      "pointerdown",
      function (event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const swipe = event.target.closest('[data-role="avail-day-swipe"]');
        if (!swipe || swipe.classList.contains("avail-day__swipe--locked")) return;
        if (event.target.closest(".avail-day__swipe-action")) return;
        if (event.target.closest(".avail-day__edit-btn")) return;
        // Nie przejmuj gestu na polach godzin / selectach w edytorze.
        if (
          event.target.closest(
            ".avail-edit__time-wrap, select, .avail-loc-pick, .avail-repeat-pick"
          )
        )
          return;
        closeAll(swipe);
        const front = frontOf(swipe);
        if (!front) return;
        const opened = swipe.classList.contains("is-open");
        drag = {
          swipe: swipe,
          front: front,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          base: opened ? -REVEAL : 0,
          dx: 0,
          locked: false,
          moved: false,
        };
        try {
          swipe.setPointerCapture(event.pointerId);
        } catch (err) {
          /* ignore */
        }
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.locked) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            drag = null;
            return;
          }
          drag.locked = true;
        }
        event.preventDefault();
        drag.moved = true;
        let x = drag.base + dx;
        if (x > 0) x = x * 0.2;
        const min = -Math.max(REVEAL * 2.2, drag.swipe.offsetWidth * DELETE_RATIO);
        if (x < min) x = min + (x - min) * 0.15;
        drag.dx = x;
        setOffset(drag.swipe, x, false);
        drag.swipe.classList.toggle("is-armed", x <= -drag.swipe.offsetWidth * DELETE_RATIO);
      },
      { passive: false, capture: true }
    );

    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const swipe = drag.swipe;
      const x = drag.dx;
      const width = Math.max(swipe.offsetWidth, 1);
      const moved = drag.moved;
      drag = null;
      swipe.classList.remove("is-armed", "is-dragging");
      if (!moved) {
        setOffset(swipe, swipe.classList.contains("is-open") ? -REVEAL : 0, true);
        return;
      }
      if (x <= -width * DELETE_RATIO) {
        finishDelete(swipe);
        return;
      }
      if (x <= -REVEAL * 0.45) {
        setOffset(swipe, -REVEAL, true);
        return;
      }
      setOffset(swipe, 0, true);
    }

    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);

    document.addEventListener(
      "click",
      function (event) {
        const swipe = event.target.closest('[data-role="avail-day-swipe"]');
        if (!swipe) {
          closeAll();
          return;
        }
        if (event.target.closest(".avail-day__swipe-action")) return;
        if (!swipe.classList.contains("is-open")) closeAll(swipe);
      },
      true
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindFilterScroll();
    bindMyCalStatusRail();
    bindProvCalEmptyTap();
    bindProvCalDraftResize();
    bindProvCalEventDrag();
    bindProvCalPinchZoom();
    bindProvCalDaySwipe();
    bindProvCalMonthSwipe();
    bindProvCalTimeLabels();
    bindAvailWeekScrollBridge();
    bindAvailDaySwipe();
    bindAvailTimePickers();
    loadState();
    // Najpierw wejdź w appę — inaczej przy opóźnionym/starym JS widać landing „Zaloguj się”.
    try {
      if (window.AppState.loggedIn && window.AppState.activeRole) {
        updateAppHeader(window.AppState.activeRole);
        showPage("app");
        renderAll();
      } else {
        goMarketplace();
      }
    } catch (err) {
      showPage("app");
      try {
        renderAll();
      } catch (err2) {
        /* ignore */
      }
    }
    handleRouteHash();
    bindPwaInstallPrompt();
    registerServiceWorker();

    if (window.LokalnieApi && window.LokalnieApi.enabled) {
      void window.LokalnieApi.syncFromServer().then(function (result) {
        if (result && result.ok) {
          saveState();
          renderAll();
        }
      });
    }

    window.matchMedia("(min-width: 900px)").addEventListener("change", function () {
      renderAll();
    });

    window.addEventListener("resize", function () {
      syncBottomNavIndicators(null);
      const serviceSheet = document.getElementById("prov-cal-add-service-sheet");
      if (serviceSheet && serviceSheet.classList.contains("is-open")) {
        syncProvCalAddServiceSheetDeskBounds(serviceSheet);
      }
    });
  });

  window.addEventListener("hashchange", handleRouteHash);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const viewCloud = document.getElementById("prov-cal-view-cloud");
      if (viewCloud && !viewCloud.hidden) {
        closeProvCalViewCloud();
        return;
      }
      if (window.AppState.provCalMonthOpen) {
        setProvCalMonthOpen(false);
        return;
      }
      if (window.AppState.myCalMonthOpen) {
        setMyCalMonthOpen(false);
        return;
      }
      if (window.AppState.provCalAddDraft && window.AppState.provCalAddDraft.servicePickOpen) {
        closeProvCalAddServicePick();
        return;
      }
      if (window.AppState.provCalAddDraft && window.AppState.provCalAddDraft.clientPickOpen) {
        closeProvCalAddClientPick();
        return;
      }
      closeProviderCardMenu();
    }
  });

  window.addEventListener("resize", function () {
    closeProviderCardMenu();
    closeProvCalViewCloud();
  });
  window.addEventListener(
    "scroll",
    function () {
      closeProviderCardMenu();
      closeProvCalViewCloud();
    },
    true
  );
})();
