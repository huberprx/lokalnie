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

  const STATUS_LABEL = {
    confirmed: "Potwierdzona",
    pending: "Oczekująca",
    proposed: "Zaproponowany termin",
    rejected: "Odrzucona",
    cancelled: "Odwołana",
  };

  const APP_VERSION = "1.0.0";

  const PWA = {
    registration: null,
    waitingWorker: null,
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
      requests: [],
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
      provCalDate: null,
      provCalHourH: 60,
      provCalView: "week",
      /** Ile kolumn dni widać (1–7); zoom poziomy. Domyślnie pełny tydzień. */
      provCalVisibleDays: 7,
      provCalMonthOpen: false,
      provCalPickerMonth: null,
      provCalSearchOpen: false,
      provCalSearchQ: "",
      provCalSelection: null,
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
    const schedule = strip.closest(".booking__schedule");
    const label = schedule && schedule.querySelector('[data-role="booking-mobile-month"]');
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

  function timeToMinutes(hhmm) {
    const parts = String(hhmm || "0:0").split(":");
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    return timeToMinutes(aFrom) < timeToMinutes(bTo) && timeToMinutes(bFrom) < timeToMinutes(aTo);
  }

  function searchFilterDateOptions() {
    const start = demoTodayISO();
    const parts = start.split("-").map(Number);
    let t = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const out = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(t + i * 86400000);
      out.push(d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()));
    }
    return out;
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
    const multiHint = p.multiSelect
      ? `<span class="booking__multi-hint">Możesz wybrać kilka</span>`
      : "";
    const labelClass = mobile ? "booking__label booking__label--caps" : "booking__panel-label";
    return `
      <div class="booking__panel-head${mobile ? " booking__panel-head--mobile" : ""}">
        <h3 class="${labelClass}">Usługi</h3>
        ${multiHint}
      </div>`;
  }

  function refreshBookingPanelElement(panel, p, ctx) {
    const servicesAside = panel.querySelector(".booking__services");
    if (servicesAside) {
      const head = servicesAside.querySelector(".booking__panel-head");
      const headHtml = renderServicesPanelHead(p, ctx.draft);
      if (head) head.outerHTML = headHtml;
      else servicesAside.insertAdjacentHTML("afterbegin", headHtml);
    }

    const servicesList = panel.querySelector(".booking__services-list");
    if (servicesList) servicesList.innerHTML = ctx.services;

    const calendar = panel.querySelector(".booking__calendar");
    if (calendar) {
      calendar.innerHTML = `
        <h3 class="booking__panel-label">Wybierz dzień</h3>
        ${ctx.availDates.length ? ctx.calendarGrid : `<p class="empty-note">Brak dostępnych terminów.</p>`}`;
    }

    const times = panel.querySelector(".booking__times");
    if (times) {
      times.innerHTML = `
        <h3 class="booking__panel-label">${ctx.activeDate ? `Wolne terminy · ${escapeHtml(formatDateLong(ctx.activeDate))}` : "Wolne terminy"}</h3>
        <div class="time-list time-list--vertical">
          ${ctx.activeDate ? ctx.timeList || `<p class="empty-note">Brak wolnych godzin tego dnia.</p>` : `<p class="empty-note">Wybierz dzień w kalendarzu.</p>`}
        </div>`;
    }

    const summary = panel.querySelector(".selection-summary--inline");
    if (summary) summary.remove();
    const mode = p.bookingMode === "approval" ? "approval" : "auto";
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

  function renderDateStripHtml(availDates, activeDate) {
    if (!availDates.length) return `<p class="empty-note">Brak dostępnych terminów.</p>`;
    const availSet = new Set(availDates);
    const today = demoTodayISO();
    const stripDates = eachDateISO(availDates[0], availDates[availDates.length - 1]);
    return stripDates
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T12:00:00");
        const on = dateISO === activeDate;
        const red = isRedCalendarDay(dateISO);
        const open = availSet.has(dateISO);
        // Wyszarzanie tylko dla dni przeszłych (już nie da się rezerwować).
        // Dni wolne / bez slotów w przyszłości wyglądają jak zwykłe, ale są nieklikalne.
        const past = dateISO < today;
        const bookable = open && !past;
        return `
        <button type="button" class="date-chip${on ? " date-chip--active" : ""}${red ? " date-chip--holiday" : ""}${past ? " date-chip--closed" : ""}${!bookable && !past ? " date-chip--unavailable" : ""}"
          data-date="${escapeHtml(dateISO)}"${bookable ? ` data-action="pick-date"` : " disabled aria-disabled=\"true\""}>
          <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
          <span class="date-chip__day">${dt.getDate()}</span>
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
      mobile.scrollTop = scrollTop;
    }
    const layoutList = screen.querySelector(".booking-layout .booking__services-list");
    if (layoutList) layoutList.innerHTML = html;
  }

  function clearBookingPickModeUI() {}

  function refreshMobileBookingScreen(screen, p, ctx) {
    const providerWrap = screen.querySelector(".booking__provider-card");
    if (providerWrap) {
      const infoOpen = !!ctx.draft.providerInfoOpen;
      providerWrap.classList.toggle("booking__provider-card--info-open", infoOpen);
      providerWrap.innerHTML =
        renderProviderCard(p, false, { staticMain: true, bookingHeader: true, showBack: true }) +
        (infoOpen ? renderBookingProviderInfoPanel(p) : "");
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
        timeList.innerHTML = ctx.timeListMobile || `<p class="empty-note">Brak wolnych godzin tego dnia.</p>`;
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

    let updated = false;

    document.querySelectorAll(".provider-item--open .provider-booking-panel").forEach(function (panel) {
      refreshBookingPanelElement(panel, p, ctx);
      updated = true;
    });

    if (window.AppState.screen.client === "booking") {
      document.querySelectorAll(".app-screen--booking").forEach(function (bookingScreen) {
        if (clientUsesDesktopBookingLayout()) {
          const layout = bookingScreen.querySelector(".booking-layout");
          if (layout) {
            layout.outerHTML = renderBookingLayoutBlock(p, ctx);
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
      profileServices.innerHTML = renderServiceRows(p, draft.serviceIds || []);
      updated = true;
    }

    return updated;
  }

  function applyServiceRowExpanded(serviceId, expanded) {
    document.querySelectorAll('.service-row[data-service-id="' + serviceId + '"]').forEach(function (row) {
      row.classList.toggle("service-row--expanded", expanded);
      row.querySelectorAll('[data-action="toggle-service-desc"]').forEach(function (btn) {
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
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
      expandedServiceIds: [],
      dateISO: null,
      slotId: null,
      calMonth: null,
      multiSelectMode: false,
      providerInfoOpen: false,
    };
  }

  function serviceDetailText(s) {
    return s.description || s.subtitle || "";
  }

  function servicePhotos(s) {
    return Array.isArray(s && s.photos) ? s.photos.filter(Boolean) : [];
  }

  function serviceHasDetail(s) {
    return !!serviceDetailText(s) || servicePhotos(s).length > 0;
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
    const availDates = resolveAvailDates(p, totals.duration || 15);
    ensureDraftCalendar(draft, availDates);

    const activeDate =
      draft.dateISO && availDates.indexOf(draft.dateISO) !== -1 ? draft.dateISO : availDates[0] || null;
    if (activeDate && draft.dateISO !== activeDate) draft.dateISO = activeDate;

    const calMonth = draft.calMonth || (activeDate ? activeDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
    const slots = activeDate ? computeSlots(p, activeDate, totals.duration || 15) : [];

    return {
      draft: draft,
      totals: totals,
      availDates: availDates,
      activeDate: activeDate,
      calMonth: calMonth,
      slots: slots,
      timeList: renderTimeSlots(slots, draft),
      timeListMobile: renderTimeSlots(slots, draft, { mobile: true }),
      services: renderServiceRows(p, draft.serviceIds || []),
      calendarGrid: renderCalendarGrid(p, activeDate, calMonth, availDates, totals),
      svcNames: draftServices(p).map((s) => s.name).join(", "),
      canConfirm: !!draft.slotId,
    };
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

    if (mode === "approval") {
      return `
        <div class="selection-summary selection-summary--inline${hasSelection ? "" : " selection-summary--empty"}">
          <div class="selection-summary__info">
            <span class="selection-summary__duration">${escapeHtml(durationText)}</span>
            <span class="selection-summary__price">${escapeHtml(priceText)}</span>
          </div>
          <button type="button" class="btn btn--primary selection-summary__cta" data-action="send-request" data-slug="${escapeHtml(p.slug)}"${hasSelection ? "" : " disabled"}>Wyślij prośbę o termin</button>
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
    const totals = ctx.totals;
    return `
      <div class="booking-layout">
        <aside class="booking__services">
          ${renderServicesPanelHead(p, ctx.draft)}
          <div class="booking__services-list service-list">${ctx.services}</div>
        </aside>

        <section class="booking__calendar">
          <h3 class="booking__panel-label">Wybierz dzień</h3>
          ${ctx.availDates.length ? ctx.calendarGrid : `<p class="empty-note">Brak dostępnych terminów.</p>`}
        </section>

        <aside class="booking__times">
          <h3 class="booking__panel-label">${ctx.activeDate ? `Wolne terminy · ${escapeHtml(formatDateLong(ctx.activeDate))}` : "Wolne terminy"}</h3>
          <div class="time-list time-list--vertical">
            ${ctx.activeDate ? ctx.timeList || `<p class="empty-note">Brak wolnych godzin tego dnia.</p>` : `<p class="empty-note">Wybierz dzień w kalendarzu.</p>`}
          </div>
        </aside>
      </div>`;
  }

  function renderInlineBookingPanel(p) {
    const ctx = buildBookingContext(p);
    if (!ctx) return "";

    const isApproval = p.bookingMode === "approval";
    return `
      <div class="provider-booking-panel${isApproval ? " provider-booking-panel--approval" : ""}${window.AppState.bookingPanelEnterSlug === p.slug ? " provider-booking-panel--enter" : ""}">
        ${isApproval ? `<p class="profile__mode">Rezerwacja na akceptację — usługodawca zaproponuje termin.</p>` : ""}
        ${renderBookingLayoutBlock(p, ctx)}
        ${renderSelectionSummaryBar(p, ctx, isApproval ? "approval" : "auto")}
      </div>`;
  }

  function mapsSearchUrl(address) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  }

  function providerShareUrl(slug) {
    return location.origin + location.pathname + "#provider/" + slug;
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

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          showToast("Link do profilu skopiowany ✓");
        },
        function () {
          showToast(url);
        }
      );
      return;
    }

    showToast(url);
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

  function renderProviderActionItems(p, opts) {
    opts = opts || {};
    const itemClass = opts.itemClass || "provider-card-popover__item";
    const iconClass = opts.iconClass || "provider-card-popover__item-icon";
    const role = opts.role || "menuitem";

    const navItem = p.address
      ? `<a href="${escapeHtml(mapsSearchUrl(p.address))}" class="${itemClass}" role="${role}" target="_blank" rel="noopener noreferrer">
          <span class="${iconClass} ${iconClass}--nav" aria-hidden="true"></span>
          Nawiguj
        </a>`
      : "";

    const callItem = p.phone
      ? `<a href="tel:${escapeHtml(String(p.phone).replace(/\s/g, ""))}" class="${itemClass}" role="${role}">
          <span class="${iconClass} ${iconClass}--call" aria-hidden="true"></span>
          Zadzwoń
        </a>`
      : `<button type="button" class="${itemClass}" role="${role}" data-action="call-provider" data-slug="${escapeHtml(p.slug)}">
          <span class="${iconClass} ${iconClass}--call" aria-hidden="true"></span>
          Zadzwoń
        </button>`;

    return `
      <button type="button" class="${itemClass}" role="${role}" data-action="open-provider-info" data-slug="${escapeHtml(p.slug)}">
        <span class="${iconClass} ${iconClass}--info" aria-hidden="true"></span>
        Więcej informacji
      </button>
      ${callItem}
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

  function renderBookingProviderInfoPanel(p) {
    return `
      <div class="provider-card__info-panel" id="booking-provider-info" role="region" aria-label="Informacje o ${escapeHtml(p.name)}">
        <div class="provider-card__info-panel-actions">
          ${renderProviderActionItems(p, {
            itemClass: "provider-card__info-action",
            iconClass: "provider-card-popover__item-icon",
            role: "button",
          })}
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

  function toggleBookingProviderInfo(slug) {
    const draft = window.AppState.draft;
    const p = getProviderBySlug(slug);
    if (!draft || !p || draft.slug !== p.slug) return;
    closeProviderCardMenu();
    draft.providerInfoOpen = !draft.providerInfoOpen;
    saveState();
    if (!refreshBookingDraftUI()) renderAll();
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

  function renderProviderCard(p, isOpen, opts) {
    opts = opts || {};
    const fav = window.AppState.favorites.indexOf(p.slug) !== -1;
    const dist = p.address ? p.distanceKm.toFixed(1) + " km" : "Online";
    const hours = p.openHoursToday || "";
    const metaParts = [];
    if (hours) metaParts.push(hours);
    if (p.bookingMode === "approval") metaParts.push("na akceptację");
    const metaLine = metaParts.join(" · ");
    const addrLine = p.address ? p.address + " · " + dist : dist;

    const nameHtml = opts.staticMain
      ? `<span class="provider-card__name">${escapeHtml(p.name)}</span>`
      : `<button type="button" class="provider-card__name" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">${escapeHtml(p.name)}</button>`;

    const detailsInner = `
            ${opts.bookingHeader ? "" : `<span class="provider-card__cat">${escapeHtml(providerCategoryLine(p))}</span>`}
            ${metaLine ? `<span class="provider-card__meta">${escapeHtml(metaLine)}</span>` : ""}
            <span class="provider-card__addr">${escapeHtml(addrLine)}</span>`;

    const detailsBlock = opts.staticMain
      ? `<div class="provider-card__details">${detailsInner}</div>`
      : `<button type="button" class="provider-card__details" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">${detailsInner}</button>`;

    const backHtml = opts.showBack
      ? `<button type="button" class="provider-card__back" data-action="close-provider" aria-label="Wróć"><span class="provider-card__back-icon" aria-hidden="true"></span></button>`
      : "";

    const infoOpen = !!(opts.bookingHeader && window.AppState.draft && window.AppState.draft.providerInfoOpen);
    const favBtn = `<button type="button" class="provider-card__action provider-card__fav${fav ? " provider-card__fav--on" : ""}" data-action="toggle-fav" data-slug="${escapeHtml(p.slug)}" aria-label="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}" aria-pressed="${fav ? "true" : "false"}" title="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}"><span class="provider-card__action-icon provider-card__fav-icon" aria-hidden="true"></span></button>`;
    const infoBtn = `<button type="button" class="provider-card__action provider-card__info${infoOpen ? " provider-card__info--open" : ""}" data-action="toggle-booking-provider-info" data-slug="${escapeHtml(p.slug)}" aria-expanded="${infoOpen ? "true" : "false"}" aria-controls="booking-provider-info" aria-label="Informacje o ${escapeHtml(p.name)}" title="Informacje"><span class="provider-card__action-icon provider-card__info-icon" aria-hidden="true"></span></button>`;
    const menuBtn = `<button type="button" class="provider-card__action provider-card__menu" data-action="open-provider-menu" data-slug="${escapeHtml(p.slug)}" aria-haspopup="menu" aria-expanded="false" aria-label="Więcej opcji dla ${escapeHtml(p.name)}" title="Więcej opcji"><span class="provider-card__action-icon provider-card__menu-icon" aria-hidden="true"></span></button>`;

    return `
      <div class="provider-card${isOpen ? " provider-card--open" : ""}${opts.bookingHeader ? " provider-card--booking-header" : ""}${opts.staticMain ? " provider-card--static" : ""}${opts.showBack ? " provider-card--with-back" : ""}${infoOpen ? " provider-card--info-open" : ""}">
        <div class="provider-card__head">
          ${backHtml}
          ${nameHtml}
          <div class="provider-card__toolbar">
            ${favBtn}
          </div>
        </div>
        ${renderAvatarTrigger(p, "provider-card__avatar")}
        ${detailsBlock}
        <div class="provider-card__menu-slot">
          ${opts.bookingHeader ? infoBtn : menuBtn}
        </div>
      </div>`;
  }

  function renderProviderListItem(p, isOpen) {
    return `
      <div class="provider-item${isOpen ? " provider-item--open" : ""}">
        ${renderProviderCard(p, isOpen)}
        ${isOpen ? renderInlineBookingPanel(p) : ""}
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

  /** Stały indeks koloru miejsca (0–5) wg kolejności w profilu. */
  function locationToneIndex(provider, locId) {
    const locs = (provider && provider.locations) || [];
    const idx = locs.findIndex(function (l) {
      return l.id === locId;
    });
    return (idx < 0 ? 0 : idx) % 6;
  }

  function locationToneClass(provider, locId) {
    return "loc-tone-" + locationToneIndex(provider, locId);
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
        searchFiltersOpen: !!stored.searchFiltersOpen,
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
        provCalDate: typeof stored.provCalDate === "string" ? stored.provCalDate : base.provCalDate,
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
      };
    } else {
      window.AppState = base;
    }

    // Dopnij brakujące wizyty demo (np. po starym localStorage).
    const demoBookings = data().DEMO_BOOKINGS || [];
    if (demoBookings.length) {
      const existing = {};
      (window.AppState.bookings || []).forEach(function (b) {
        if (b && b.id) existing[b.id] = true;
      });
      demoBookings.forEach(function (b) {
        if (!b || !b.id || existing[b.id]) return;
        window.AppState.bookings.push(Object.assign({}, b));
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
  function computeSlots(provider, dateISO, totalDurationMin) {
    const day = (provider.availability || []).find((d) => d.dateISO === dateISO);
    if (!day) return [];

    const busy = [];
    (provider.busy || []).forEach((b) => {
      if (String(b.startISO).slice(0, 10) === dateISO) {
        busy.push([minFromISO(b.startISO), minFromISO(b.endISO)]);
      }
    });
    (window.AppState.bookings || []).forEach((bk) => {
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
      const bStart = timeToMin(block.from);
      const bEnd = timeToMin(block.to);
      for (let s = bStart; s + totalDurationMin <= bEnd; s += 15) {
        const e = s + totalDurationMin;
        const overlaps = busy.some((iv) => s < iv[1] && e > iv[0]);
        if (!overlaps) {
          slots.push({
            id: `slot-${dateISO}-${s}`,
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

  function draftTotals(provider) {
    const svcs = draftServices(provider);
    const duration = svcs.reduce((a, s) => a + s.durationMin, 0);
    const hasNullPrice = svcs.some((s) => s.price == null);
    const price = svcs.reduce((a, s) => a + (s.price || 0), 0);
    return { duration, price, hasNullPrice, count: svcs.length };
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
            return `
          <button type="button" class="bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}"
            data-action="go-screen" data-screen="${it.tab}" aria-label="${it.label}" ${isActive ? 'aria-current="page"' : ""}>
            <span class="bottom-nav__icon bottom-nav__icon--${it.icon}" aria-hidden="true"></span>
          </button>`;
          })
          .join("")}`;
  }

  function renderClientMenuAvatar() {
    const user = data().CURRENT_USER || {};
    const url = window.AppState.clientAvatarUrl;
    if (url) {
      return `<img class="app-menu__avatar-img" src="${escapeHtml(url)}" alt="" />`;
    }
    return `<span class="app-menu__avatar-initials">${escapeHtml(accountInitials(user.name))}</span>`;
  }

  function renderAppMenu() {
    const user = data().CURRENT_USER || {};
    const activeRole = window.AppState.activeRole || "client";
    const clientActive = activeRole === "client";
    const providerActive = activeRole === "provider";
    const hasProvider = !!(user.providerRole && user.providerRole.active);
    const provider = hasProvider ? myProvider() : null;
    const check = `<span class="app-menu__check" aria-hidden="true"></span>`;

    const providerBlock = provider
      ? `<button type="button" class="app-menu__profile app-menu__profile--provider${providerActive ? " app-menu__profile--active" : ""}" data-action="switch-role" data-role="provider" aria-pressed="${providerActive ? "true" : "false"}">
           <span class="app-menu__avatar app-menu__avatar--provider">${
             provider.avatarUrl
               ? `<img class="app-menu__avatar-img" src="${escapeHtml(provider.avatarUrl)}" alt="" />`
               : `<span class="app-menu__avatar-initials">${escapeHtml(provider.avatarInitials || "?")}</span>`
           }</span>
           <span class="app-menu__profile-text">
             <span class="app-menu__profile-label">Usługodawca</span>
             <span class="app-menu__profile-name">${escapeHtml(provider.name)}</span>
           </span>
           ${providerActive ? check : ""}
         </button>`
      : `<button type="button" class="app-menu__profile app-menu__profile--add" data-action="add-provider-profile">
           <span class="app-menu__avatar app-menu__avatar--add" aria-hidden="true">+</span>
           <span class="app-menu__profile-text">
             <span class="app-menu__profile-label">Usługodawca</span>
             <span class="app-menu__profile-name">Dodaj profil</span>
           </span>
         </button>`;

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
            <p class="app-menu__profiles-label">Profile</p>
            <button type="button" class="app-menu__profile app-menu__profile--client${clientActive ? " app-menu__profile--active" : ""}" data-action="switch-role" data-role="client" aria-pressed="${clientActive ? "true" : "false"}">
              <span class="app-menu__avatar app-menu__avatar--client">${renderClientMenuAvatar()}</span>
              <span class="app-menu__profile-text">
                <span class="app-menu__profile-label">Klient</span>
                <span class="app-menu__profile-name">${escapeHtml(user.name || "Użytkownik")}</span>
              </span>
              ${clientActive ? check : ""}
            </button>
            <label class="app-menu__photo-btn">
              <span class="app-menu__photo-btn-label">Zmień zdjęcie profilu klienta</span>
              <input type="file" class="app-menu__file" accept="image/*" data-action="change-client-avatar" tabindex="-1" />
            </label>
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
            <button type="button" class="app-menu__link app-menu__link--version" data-action="check-pwa-update" title="Sprawdź aktualizacje">
              <span>Wersja aplikacji</span>
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
    document.querySelectorAll('[data-action="toggle-app-menu"]').forEach(function (btn) {
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

  /** Automatyczna aktualizacja — bez pytania użytkownika. */
  function applyPwaUpdateAutomatically(worker) {
    if (!worker || PWA.updateNotified) return;
    PWA.updateNotified = true;
    showToast("Aktualizuję aplikację…");
    activateWaitingWorker(worker);
  }

  function trackServiceWorker(reg) {
    if (!reg) return;
    PWA.registration = reg;

    reg.addEventListener("updatefound", function () {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", function () {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          applyPwaUpdateAutomatically(installing);
        }
      });
    });
  }

  /** Przy każdym starcie: sprawdź i od razu wdróż nową wersję, jeśli jest. */
  function checkPwaUpdateOnLaunch(reg) {
    if (!reg) return;
    if (reg.waiting) {
      applyPwaUpdateAutomatically(reg.waiting);
      return;
    }
    reg
      .update()
      .then(function () {
        if (reg.waiting) applyPwaUpdateAutomatically(reg.waiting);
      })
      .catch(function () {});
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        trackServiceWorker(reg);
        checkPwaUpdateOnLaunch(reg);
        setInterval(function () {
          reg.update().then(function () {
            if (reg.waiting) applyPwaUpdateAutomatically(reg.waiting);
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
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration("./").then(function (reg) {
      if (!reg) {
        registerServiceWorker();
        return;
      }
      trackServiceWorker(reg);
      PWA.updateNotified = false;
      if (reg.waiting || PWA.waitingWorker) {
        applyPwaUpdateAutomatically(reg.waiting || PWA.waitingWorker);
        return;
      }
      reg
        .update()
        .then(function () {
          if (reg.waiting) applyPwaUpdateAutomatically(reg.waiting);
        })
        .catch(function () {});
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
    const isApproval = !!(p && p.bookingMode === "approval");
    if (isApproval) {
      return {
        action: "send-request",
        label: "Wyślij prośbę",
        enabled: !!(totals && totals.count),
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

  function renderAccount() {
    const user = data().CURRENT_USER || {};
    const hasProvider = user.providerRole && user.providerRole.active;

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Profil</h2>
            <p class="screen-head__sub">Twoje konto w Lokalnie.</p>
          </header>
          <div class="account-card">
            <span class="account-card__avatar">${
              window.AppState.clientAvatarUrl
                ? `<img class="account-card__avatar-img" src="${escapeHtml(window.AppState.clientAvatarUrl)}" alt="" />`
                : escapeHtml(accountInitials(user.name))
            }</span>
            <p class="account-card__name">${escapeHtml(user.name || "Użytkownik")}</p>
          </div>
          <div class="account-actions">
            ${
              hasProvider
                ? `<button type="button" class="btn btn--ghost account-actions__btn" data-action="switch-role" data-role="provider">Przełącz na usługodawcę</button>`
                : ""
            }
            <button type="button" class="btn btn--ghost account-actions__btn account-actions__btn--logout" data-action="logout">Wyloguj</button>
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

    const dateChips = searchFilterDateOptions()
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T12:00:00");
        const on = selectedDates.indexOf(dateISO) !== -1;
        const red = isRedCalendarDay(dateISO);
        return `
          <button type="button" class="date-chip${on ? " date-chip--active" : ""}${red ? " date-chip--holiday" : ""}"
            data-action="toggle-filter-date" data-date="${escapeHtml(dateISO)}" aria-pressed="${on ? "true" : "false"}">
            <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
            <span class="date-chip__day">${dt.getDate()}</span>
          </button>`;
      })
      .join("");

    const periodChips = SEARCH_PERIODS.map(function (period) {
      const on = selectedPeriods.indexOf(period.id) !== -1;
      return `
        <button type="button" class="period-chip${on ? " period-chip--active" : ""}"
          data-action="toggle-filter-period" data-period="${escapeHtml(period.id)}" aria-pressed="${on ? "true" : "false"}">
          ${escapeHtml(period.label)}
        </button>`;
    }).join("");

    return `
      <div class="search-filters${open ? " search-filters--open" : ""}" id="search-filters-panel" data-role="search-filters"${open ? "" : " hidden"}>
        ${subRow}
        <div class="search-filters__section">
          <p class="search-filters__label">Dzień</p>
          <div class="filter-scroll filter-scroll--dates" data-filter-scroll>
            <div class="filter-scroll__track date-strip date-strip--filters">${dateChips}</div>
          </div>
        </div>
        <div class="search-filters__section">
          <p class="search-filters__label">Pora dnia</p>
          <div class="period-chips">${periodChips}</div>
        </div>
      </div>`;
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
                aria-expanded="${filtersOpen ? "true" : "false"}" aria-controls="search-filters-panel">
                <span class="filter-toggle__icon" aria-hidden="true"></span>
              </button>
            </div>
            ${renderSearchExtraFilters()}
          </div>
          <div class="provider-list">
            ${providers.length ? providers.map(function (p) { return renderProviderListItem(p, p.slug === openSlug); }).join("") : `<p class="empty-note">Brak wyników dla wybranych filtrów.</p>`}
          </div>
        </div>
        ${bottomNav("search", { withHome: true })}
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

  function ensureMyCalMonth(visits) {
    if (window.AppState.myCalMonth) return window.AppState.myCalMonth;
    const next = visits.find(function (b) {
      return b.dateISO >= new Date().toISOString().slice(0, 10);
    });
    const ref = (next && next.dateISO) || (visits[0] && visits[0].dateISO) || new Date().toISOString().slice(0, 10);
    window.AppState.myCalMonth = ref.slice(0, 7);
    return window.AppState.myCalMonth;
  }

  function renderMyVisitCalendar(calMonth, visitDates, selectedDate) {
    const visitSet = new Set(visitDates);
    const parts = String(calMonth || "").split("-");
    const year = Number(parts[0]) || new Date().getFullYear();
    const month = Number(parts[1]) || new Date().getMonth() + 1;
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;
    const todayISO = new Date().toISOString().slice(0, 10);

    const totalCells = 7 * 6;
    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${pad(month)}-${pad(day)}`;
      const hasVisit = visitSet.has(dateISO);
      const selected = dateISO === selectedDate;
      const isToday = dateISO === todayISO;
      const red = isRedCalendarDay(dateISO);
      cells += `
        <button type="button"
          class="cal__day cal__day--selectable${hasVisit ? " cal__day--visit" : ""}${selected ? " cal__day--selected" : ""}${isToday && !selected ? " cal__day--today" : ""}${red ? " cal__day--holiday" : ""}"
          data-action="my-cal-pick-date" data-date="${escapeHtml(dateISO)}"
          aria-pressed="${selected ? "true" : "false"}"
          aria-label="${day}${hasVisit ? ", wizyty" : ""}">
          <span class="cal__day-num">${day}</span>
          ${hasVisit ? `<span class="cal__day-dot" aria-hidden="true"></span>` : ""}
        </button>`;
    }
    const filled = startPad + daysInMonth;
    for (let i = filled; i < totalCells; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }

    return `
      <div class="cal my-cal">
        <div class="cal__nav">
          <button type="button" class="cal__nav-btn" data-action="my-cal-prev" aria-label="Poprzedni miesiąc">‹</button>
          <span class="cal__title">${escapeHtml(MONTHS[month - 1])} ${year}</span>
          <button type="button" class="cal__nav-btn" data-action="my-cal-next" aria-label="Następny miesiąc">›</button>
        </div>
        <div class="cal__weekdays">${CAL_WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="cal__grid">${cells}</div>
      </div>`;
  }

  function renderMyCalendar() {
    const list = clientVisits();
    const visitDates = list.map(function (b) {
      return b.dateISO;
    });
    const calMonth = ensureMyCalMonth(list);
    const selectedDate = window.AppState.myCalDate || null;
    const filtered = selectedDate
      ? list.filter(function (b) {
          return b.dateISO === selectedDate;
        })
      : list;

    const listTitle = selectedDate
      ? `Wizyty · ${formatDateLong(selectedDate)}`
      : "Wizyty";

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <header class="screen-head screen-head--with-back">
            <button type="button" class="screen-head__back" data-action="go-screen" data-screen="search" aria-label="Wróć">
              <span class="screen-head__back-icon" aria-hidden="true"></span>
            </button>
            <h2 class="screen-head__title">Mój kalendarz</h2>
          </header>
          <section class="my-cal-section" aria-label="Kalendarz wizyt">
            ${renderMyVisitCalendar(calMonth, visitDates, selectedDate)}
          </section>
          <section class="my-cal-visits" aria-label="${escapeHtml(listTitle)}">
            <h3 class="booking__label booking__label--caps">${escapeHtml(listTitle)}</h3>
            <div class="visit-list">
              ${
                filtered.length
                  ? filtered.map(renderClientVisitCard).join("")
                  : selectedDate
                    ? `<p class="empty-note">Brak wizyt w tym dniu.</p>`
                    : `<p class="empty-note">Brak rezerwacji. Zarezerwuj usługę w zakładce „Szukaj”.</p>`
              }
            </div>
          </section>
        </div>
        ${bottomNav("myCalendar")}
      </div>`;
  }

  function shiftMyCalMonth(delta) {
    const ref = window.AppState.myCalMonth || new Date().toISOString().slice(0, 7);
    const parts = ref.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    window.AppState.myCalMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    saveState();
    renderAll();
  }

  function pickMyCalDate(dateISO) {
    if (!dateISO) return;
    window.AppState.myCalDate = window.AppState.myCalDate === dateISO ? null : dateISO;
    window.AppState.myCalMonth = dateISO.slice(0, 7);
    saveState();
    renderAll();
  }

  function resolveAvailDates(p, durationMin) {
    const dur = durationMin || 15;
    return (p.availability || [])
      .filter((d) => computeSlots(p, d.dateISO, dur).length)
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

  function renderServiceRows(p, selectedIds) {
    const draft = window.AppState.draft;
    const expandedIds = (draft && draft.expandedServiceIds) || [];

    return (p.services || [])
      .map((s) => {
        const on = selectedIds.indexOf(s.id) !== -1;
        const expanded = expandedIds.indexOf(s.id) !== -1;
        const detail = serviceDetailText(s);
        const hasDetail = serviceHasDetail(s);
        const selectLabel = (on ? "Odznacz" : "Wybierz") + " " + s.name;

        return `
        <article class="service-row${on ? " service-row--selected" : ""}${expanded ? " service-row--expanded" : ""}" data-service-id="${escapeHtml(s.id)}">
          <div class="service-row__content${p.multiSelect ? " service-row__content--with-check" : ""}">
            <button type="button" class="service-row__main" data-action="toggle-service" data-service-id="${escapeHtml(s.id)}" aria-pressed="${on ? "true" : "false"}" aria-label="${escapeHtml(selectLabel)}" title="${escapeHtml(selectLabel)}">
              <span class="service-row__name">${escapeHtml(s.name)}</span>
              ${s.subtitle ? `<span class="service-row__sub">${escapeHtml(s.subtitle)}</span>` : ""}
            </button>
            <div class="service-row__meta">
              <span class="service-row__dur">${escapeHtml(formatDuration(s.durationMin))}</span>
              <span class="service-row__price">${escapeHtml(formatPrice(s.price))}</span>
            </div>
            ${
              hasDetail || p.multiSelect
                ? `<div class="service-row__foot">
                    ${
                      hasDetail
                        ? `<button type="button" class="service-row__more" data-action="toggle-service-desc" data-service-id="${escapeHtml(s.id)}" aria-expanded="${expanded ? "true" : "false"}">
                            <span class="service-row__more-label">${expanded ? "Mniej" : "Więcej"}</span>
                            <span class="service-row__chev" aria-hidden="true"></span>
                          </button>`
                        : `<span class="service-row__foot-spacer" aria-hidden="true"></span>`
                    }
                    ${
                      p.multiSelect
                        ? `<button type="button" class="service-row__check${on ? " service-row__check--on" : ""}" data-action="toggle-service-check" data-service-id="${escapeHtml(s.id)}" aria-pressed="${on ? "true" : "false"}" aria-label="${escapeHtml(selectLabel)}">
                            <span class="service-row__check-visual" aria-hidden="true"></span>
                          </button>`
                        : ""
                    }
                  </div>`
                : ""
            }
            ${
              hasDetail
                ? `<div class="service-row__detail"${expanded ? "" : " hidden"}>
                    ${detail ? `<p class="service-row__detail-text">${escapeHtml(detail)}</p>` : ""}
                    ${renderServicePhotoStrip(s)}
                  </div>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("");
  }

  function renderCalendarGrid(p, activeDate, calMonth, availDates, totals) {
    const availSet = new Set(availDates);
    const parts = String(calMonth || "").split("-");
    const year = Number(parts[0]) || new Date().getFullYear();
    const month = Number(parts[1]) || new Date().getMonth() + 1;
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;

    const totalCells = 7 * 6;
    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${pad(month)}-${pad(day)}`;
      const available = availSet.has(dateISO);
      const selected = dateISO === activeDate;
      const red = isRedCalendarDay(dateISO);
      cells += `
        <button type="button"
          class="cal__day${selected ? " cal__day--selected" : ""}${red ? " cal__day--holiday" : ""}${available ? " cal__day--available" : " cal__day--disabled"}"
          data-action="${available ? "pick-date" : ""}" data-date="${escapeHtml(dateISO)}" ${available ? "" : "disabled"}>
          ${day}
        </button>`;
    }
    const filled = startPad + daysInMonth;
    for (let i = filled; i < totalCells; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }

    return `
      <div class="cal">
        <div class="cal__nav">
          <button type="button" class="cal__nav-btn" data-action="cal-prev" aria-label="Poprzedni miesiąc">‹</button>
          <span class="cal__title">${escapeHtml(MONTHS[month - 1])} ${year}</span>
          <button type="button" class="cal__nav-btn" data-action="cal-next" aria-label="Następny miesiąc">›</button>
        </div>
        <div class="cal__weekdays">${CAL_WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="cal__grid">${cells}</div>
      </div>`;
  }

  function renderTimeSlots(slots, draft, opts) {
    opts = opts || {};
    const mobile = !!opts.mobile;
    return slots
      .map(function (s) {
        const range = `${escapeHtml(s.from)}→${escapeHtml(s.to)}`;
        const place = escapeHtml(s.locationLabel || "—");
        if (mobile) {
          const selected = draft && draft.slotId === s.id;
          return `
        <button type="button" class="time-row time-row--chip${selected ? " time-row--selected" : ""}" data-action="pick-slot" data-slot="${escapeHtml(s.id)}"
          aria-label="Wybierz ${escapeHtml(s.from)}–${escapeHtml(s.to)}" aria-pressed="${selected ? "true" : "false"}">
          <span class="time-row__info">
            <span class="time-row__range">${range}</span>
            <span class="time-row__place">${place}</span>
          </span>
        </button>`;
        }
        return `
        <div class="time-row">
          <div class="time-row__info">
            <span class="time-row__range">${range}</span>
            <span class="time-row__place">${place}</span>
          </div>
          <button type="button" class="btn btn--primary btn--sm time-row__btn" data-action="book-slot" data-slot="${escapeHtml(s.id)}">Rezeruj</button>
        </div>`;
      })
      .join("");
  }

  function renderClientVisitCard(b) {
    const canReschedule = b.status === "rejected" || b.status === "cancelled";
    const canAccept = b.status === "proposed";
    return `
      <div class="visit-card" data-booking-id="${escapeHtml(b.id)}">
        <div class="visit-card__top">
          <span class="visit-card__name">${escapeHtml(b.providerName)}</span>
          <span class="status-badge" data-status="${escapeHtml(b.status)}">${escapeHtml(STATUS_LABEL[b.status] || b.status)}</span>
        </div>
        <div class="visit-card__svc">${escapeHtml(b.serviceNames.join(", "))}</div>
        <div class="visit-card__when">${escapeHtml(formatDateLong(b.dateISO))} · ${escapeHtml(b.from)}→${escapeHtml(b.to)}${b.locationLabel ? " · " + escapeHtml(b.locationLabel) : ""}</div>
        ${
          canAccept
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--primary btn--sm" data-action="accept-proposal" data-booking-id="${escapeHtml(b.id)}">Akceptuj termin</button>
                 <button type="button" class="btn btn--ghost btn--sm" data-action="reject-proposal" data-booking-id="${escapeHtml(b.id)}">Odrzuć</button>
               </div>`
            : ""
        }
        ${
          canReschedule
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--ghost btn--sm" data-action="open-profile" data-slug="${escapeHtml(getProviderById(b.providerId) ? getProviderById(b.providerId).slug : "")}">Wybierz inny termin</button>
               </div>`
            : ""
        }
      </div>`;
  }

  function renderProfile(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return renderSearch();

    const fav = window.AppState.favorites.indexOf(p.slug) !== -1;
    const totals = draftTotals(p);
    const selectedIds = (window.AppState.draft && window.AppState.draft.serviceIds) || [];
    const services = renderServiceRows(p, selectedIds);

    const ctaLabel = p.bookingMode === "approval" ? "Wyślij prośbę o termin" : "Rezerwuj termin";
    const ctaAction = p.bookingMode === "approval" ? "send-request" : "start-booking";

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
            ${p.bookingMode === "approval" ? `<p class="profile__mode">Rezerwacja na akceptację — usługodawca zaproponuje termin.</p>` : ""}

            <h3 class="profile__section">Usługi ${p.multiSelect ? '<span class="profile__hint">(możesz wybrać kilka)</span>' : ""}</h3>
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

    return `
      <div class="app-screen app-screen--client app-screen--booking">
        <div class="booking-mobile">
          <div class="booking booking--mobile-split">
            <div class="booking__main">
              <div class="booking__provider-card${ctx.draft.providerInfoOpen ? " booking__provider-card--info-open" : ""}">
                ${renderProviderCard(p, false, { staticMain: true, bookingHeader: true, showBack: true })}
                ${ctx.draft.providerInfoOpen ? renderBookingProviderInfoPanel(p) : ""}
              </div>

              ${p.bookingMode === "approval" ? `<p class="profile__mode">Rezerwacja na akceptację — usługodawca zaproponuje termin.</p>` : ""}

              ${renderServicesPanelHead(p, ctx.draft, { mobile: true })}
              <div class="booking__services-list service-list" data-role="booking-mobile-services">${ctx.services}</div>
            </div>

            <div class="booking__schedule" data-role="booking-mobile-schedule">
              <div class="booking__label-row">
                <h3 class="booking__label booking__label--caps">Wybierz datę</h3>
                <span class="booking__month" data-role="booking-mobile-month">${escapeHtml(monthLabelFromISO(ctx.activeDate || ctx.availDates[0]))}</span>
              </div>
              <div class="date-strip" data-role="booking-date-strip">${renderDateStripHtml(ctx.availDates, ctx.activeDate)}</div>

              <h3 class="booking__label booking__label--caps" data-role="booking-mobile-time-label"${ctx.activeDate ? "" : " hidden"}>Wolne terminy</h3>
              <div class="time-list time-list--horizontal" data-role="booking-mobile-times"${ctx.activeDate ? "" : " hidden"}>${ctx.activeDate ? ctx.timeListMobile || `<p class="empty-note">Brak wolnych godzin tego dnia.</p>` : ""}</div>
            </div>
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
      { tab: "settings", label: "Ustawienia", icon: "settings" },
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

  function renderDashboard() {
    const upcoming = (window.AppState.bookings || [])
      .filter((b) => b.providerId === MY_PROVIDER_ID && (b.status === "confirmed" || b.status === "proposed"))
      .sort((a, b) => (a.dateISO + a.from).localeCompare(b.dateISO + b.from));

    const pendingCount = (window.AppState.requests || []).filter((r) => r.providerId === MY_PROVIDER_ID && r.status === "pending").length;

    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Pulpit</h2>
            <p class="screen-head__sub">${escapeHtml(myProvider() ? myProvider().name : "")}</p>
          </header>
          <div class="stat-row">
            <div class="stat-card"><span class="stat-card__num">${upcoming.length}</span><span class="stat-card__lbl">Nadchodzące wizyty</span></div>
            <div class="stat-card"><span class="stat-card__num">${pendingCount}</span><span class="stat-card__lbl">Oczekujące prośby</span></div>
          </div>
          <h3 class="prov-section">Nadchodzące wizyty</h3>
          <div class="visit-list">
            ${
              upcoming.length
                ? upcoming.map(renderProviderVisitCard).join("")
                : `<p class="empty-note">Brak nadchodzących wizyt. Zarezerwuj coś jako klient, aby zobaczyć synchronizację.</p>`
            }
          </div>
        </div>
        ${providerBottomNav("dashboard")}
      </div>`;
  }

  function renderProviderVisitCard(b) {
    return `
      <div class="visit-card" data-booking-id="${escapeHtml(b.id)}">
        <div class="visit-card__top">
          <span class="visit-card__name">${escapeHtml(b.clientName || "Klient")}</span>
          <span class="status-badge" data-status="${escapeHtml(b.status)}">${escapeHtml(STATUS_LABEL[b.status] || b.status)}</span>
        </div>
        <div class="visit-card__svc">${escapeHtml((b.serviceNames || []).join(", "))}</div>
        <div class="visit-card__when">${escapeHtml(formatDateLong(b.dateISO))} · ${escapeHtml(b.from)}→${escapeHtml(b.to)}${b.locationLabel ? " · " + escapeHtml(b.locationLabel) : ""}</div>
        ${
          b.status === "confirmed"
            ? `<div class="visit-card__actions">
                 <button type="button" class="btn btn--ghost btn--sm" data-action="cancel-visit" data-booking-id="${escapeHtml(b.id)}">Odwołaj</button>
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
          (b.status === "confirmed" || b.status === "proposed")
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

  /** Okno N dni: przy 7 = tydzień pon–ndz; inaczej wyśrodkowane na wybranej dacie. */
  function provCalVisibleDayList(selectedISO, count) {
    const n = clampProvCalVisibleDays(count);
    if (n === 7) return availWeekDays(mondayISOFrom(selectedISO));
    const before = Math.floor((n - 1) / 2);
    const start = isoAddDays(selectedISO, -before);
    const out = [];
    for (let i = 0; i < n; i++) out.push(isoAddDays(start, i));
    return out;
  }

  /** Zoom poziomy: ile kolumn dni (1–7). */
  function applyProvCalVisibleDays(nextDays, opts) {
    opts = opts || {};
    const n = clampProvCalVisibleDays(nextDays);
    const prev = clampProvCalVisibleDays(window.AppState.provCalVisibleDays);
    let changed = n !== prev || !!opts.force;
    window.AppState.provCalVisibleDays = n;
    window.AppState.provCalView = n <= 1 ? "day" : "week";
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
    if (!opts.keepSelection) window.AppState.provCalSelection = null;
    saveState();
    renderAll();
  }

  /** ±1 dzień w kalendarzu usługodawcy (gest swipe / nawigacja). */
  function shiftProvCalDate(deltaDays) {
    const cur = ensureProvCalDate();
    const iso = isoAddDays(cur, deltaDays);
    pickProvCalDate(iso, { keepView: true });
    hapticTap(12);
  }

  /**
   * Swipe dnia ze standardową animacją (jak Google/Apple Calendar):
   * content wyjeżdża w kierunku gestu, nowy wjeżdża z przeciwnej strony.
   */
  function shiftProvCalDateAnimated(deltaDays) {
    const dir = deltaDays > 0 ? 1 : -1;
    const gcal = document.querySelector('[data-role="prov-cal-gcal"]');
    if (!gcal || Math.abs(deltaDays) < 1) {
      shiftProvCalDate(deltaDays);
      return;
    }
    if (gcal.classList.contains("gcal--sliding")) return;

    const body = document.querySelector('[data-role="prov-cal-body"]');
    if (body) body.classList.add("prov-cal-body--day-swipe");

    gcal.classList.add("gcal--sliding");
    gcal.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease";
    gcal.style.transform = "translate3d(" + (dir > 0 ? "-42%" : "42%") + ",0,0)";
    gcal.style.opacity = "0.35";

    window.setTimeout(function () {
      shiftProvCalDate(deltaDays);
      requestAnimationFrame(function () {
        const next = document.querySelector('[data-role="prov-cal-gcal"]');
        const body2 = document.querySelector('[data-role="prov-cal-body"]');
        if (body2) body2.classList.add("prov-cal-body--day-swipe");
        if (!next) {
          if (body2) body2.classList.remove("prov-cal-body--day-swipe");
          return;
        }
        next.classList.add("gcal--sliding");
        next.style.transition = "none";
        next.style.transform = "translate3d(" + (dir > 0 ? "48%" : "-48%") + ",0,0)";
        next.style.opacity = "0.4";
        void next.offsetWidth;
        next.style.transition =
          "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.28s ease";
        next.style.transform = "translate3d(0,0,0)";
        next.style.opacity = "1";

        function clear() {
          next.classList.remove("gcal--sliding");
          next.style.transition = "";
          next.style.transform = "";
          next.style.opacity = "";
          if (body2) body2.classList.remove("prov-cal-body--day-swipe");
        }
        next.addEventListener(
          "transitionend",
          function (event) {
            if (event.propertyName && event.propertyName.indexOf("transform") === -1) return;
            clear();
          },
          { once: true }
        );
        window.setTimeout(clear, 380);
      });
    }, 200);
  }

  function setProvCalView(view) {
    if (view === "week") {
      const cur = ensureProvCalVisibleDays();
      applyProvCalVisibleDays(cur <= 1 ? 7 : cur);
      return;
    }
    applyProvCalVisibleDays(1);
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
      const on = isProvCalSlotSelected(el);
      el.classList.toggle("gcal__event--selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
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

  function subtractMinuteRange(segments, from, to) {
    const next = [];
    (segments || []).forEach(function (seg) {
      if (to <= seg.from || from >= seg.to) {
        next.push({ from: seg.from, to: seg.to });
        return;
      }
      if (from > seg.from) next.push({ from: seg.from, to: from });
      if (to < seg.to) next.push({ from: to, to: seg.to });
    });
    return next.filter(function (s) {
      return s.to > s.from;
    });
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
    const columns = scope.querySelectorAll(
      '.gcal-week__col, .gcal[data-role="prov-cal-gcal"]:not(.gcal--week) .gcal__track'
    );
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
        document
          .querySelectorAll('.gcal-week__col, .gcal[data-role="prov-cal-gcal"]:not(.gcal--week) .gcal__track')
          .forEach(function (el) {
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
    window.setTimeout(finish, 320);
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
  const PROV_CAL_HOUR_START = 8;
  const PROV_CAL_HOUR_END = 20;

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

  /** Etykieta / liczba widoku: tylko 1 / 3 / 7. */
  function snapProvCalViewBadge(days) {
    const n = clampProvCalVisibleDays(days);
    if (n <= 1) return 1;
    if (n <= 4) return 3;
    return 7;
  }

  function provCalViewBadgeLabel(days) {
    const n = snapProvCalViewBadge(days);
    if (n === 1) return "Widok: 1 dzień";
    if (n === 7) return "Widok: tydzień";
    return "Widok: 3 dni";
  }

  const PROV_CAL_VIEW_OPTIONS = [
    { days: 1, label: "1 dzień", icon: "day" },
    { days: 3, label: "3 dni", icon: "days3" },
    { days: 7, label: "Tydzień", icon: "week" },
  ];

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
    if (!trigger || window.AppState.provCalMonthOpen) return;
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
          <span class="prov-cal-view-cloud__icon prov-cal-view-cloud__icon--${escapeHtml(opt.icon)}" aria-hidden="true"></span>
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

  /**
   * Sticky nagłówki dni — zawsze w DOM.
   * Przy otwartym miesiącu są schowane CSS-em i simultaneousnie wracają przy zamykaniu panelu
   * (żeby nie było „pustki” z samym separatorem).
   */
  function renderProvCalStickyDayHeads(daysHtml) {
    const days = ensureProvCalVisibleDays();
    const badge = String(snapProvCalViewBadge(days));
    const underMonth = !!window.AppState.provCalMonthOpen;
    return `
      <div class="gcal-week__sticky${underMonth ? " gcal-week__sticky--under-month" : ""}"${
        underMonth ? ' aria-hidden="true"' : ""
      }>
        <div class="gcal-week__head">
          <button type="button" class="gcal-week__corner" data-action="prov-cal-view-menu"
            aria-label="${escapeHtml(provCalViewBadgeLabel(days))}"
            aria-haspopup="menu" aria-expanded="false">
            <span class="gcal-week__view-badge" aria-hidden="true">
              <svg class="gcal-week__view-badge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="3" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span class="gcal-week__view-badge-num">${escapeHtml(badge)}</span>
            </span>
          </button>
          <div class="gcal-week__days">${daysHtml}</div>
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
    return `
      <button type="button" class="gcal-week__dayhead${isToday ? " gcal-week__dayhead--today" : ""}${
        isSel ? " gcal-week__dayhead--sel" : ""
      }${sun ? " gcal-week__dayhead--sun" : ""}"
        data-action="prov-cal-pick-date" data-date="${escapeHtml(dateISO)}"
        aria-label="${escapeHtml(PROV_CAL_DOW_SHORT[d.getDay()] + " " + d.getDate())}">
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
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = year + "-" + pad(month) + "-" + pad(day);
      const selected = dateISO === selectedISO;
      const isToday = dateISO === today;
      const hasVisit = visitDays.has(dateISO);
      const red = isSunday(dateISO) || isRedCalendarDay(dateISO);
      cells += `
        <button type="button"
          class="gcal-month__day${selected ? " gcal-month__day--on" : ""}${isToday && !selected ? " gcal-month__day--today" : ""}${hasVisit ? " gcal-month__day--busy" : ""}${red ? " gcal-month__day--red" : ""}"
          data-action="prov-cal-pick-date" data-date="${escapeHtml(dateISO)}"
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

  /**
   * Wolne odcinki = tylko w ramach zdefiniowanej dostępności dnia, minus wizyty.
   * Bez bloków dostępności → brak „Wolne” (nawet gdy są wizyty).
   */
  function providerFreeGapsForDate(dateISO, dayVisits) {
    const availBlocks = providerAvailBlocksForDate(dateISO);
    if (!availBlocks.length) return [];

    let segments = mergeTimeIntervals(
      availBlocks
        .map(function (block) {
          return { from: timeToMinutes(block.from), to: timeToMinutes(block.to) };
        })
        .filter(function (b) {
          return !isNaN(b.from) && !isNaN(b.to) && b.to > b.from;
        })
    );
    if (!segments.length) return [];

    const busy = mergeTimeIntervals(
      (dayVisits || [])
        .map(function (b) {
          return { from: timeToMinutes(b.from), to: timeToMinutes(b.to) };
        })
        .filter(function (b) {
          return !isNaN(b.from) && !isNaN(b.to) && b.to > b.from;
        })
    );

    busy.forEach(function (bk) {
      const next = [];
      segments.forEach(function (seg) {
        // zajętość poza tym odcinkiem dostępności — bez zmian
        if (bk.to <= seg.from || bk.from >= seg.to) {
          next.push(seg);
          return;
        }
        // lewy wolny fragment w ramach dostępności
        if (bk.from > seg.from) next.push({ from: seg.from, to: bk.from });
        // prawy wolny fragment w ramach dostępności
        if (bk.to < seg.to) next.push({ from: bk.to, to: seg.to });
      });
      segments = next;
    });

    return segments.filter(function (s) {
      return s.to > s.from;
    });
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

  /** Widok dnia jak Google Calendar: oś godzin + bloki wizyt i wolnych. */
  function renderProvCalGoogleDay(dateISO, dayVisits) {
    const isToday = dateISO === demoTodayISO();
    const hourStart = PROV_CAL_HOUR_START;
    const hourEnd = PROV_CAL_HOUR_END;
    const hourH = ensureProvCalHourH();
    const dayStartMin = hourStart * 60;
    const dayEndMin = hourEnd * 60;
    const totalH = (hourEnd - hourStart) * hourH;

    let hours = "";
    for (let h = hourStart; h <= hourEnd; h++) {
      const top = (h - hourStart) * hourH;
      hours += `
        <div class="gcal__hour" style="top:${top}px" data-hour="${h}">
          <span class="gcal__hour-label">${h === hourStart ? "" : pad(h) + ":00"}</span>
        </div>`;
    }

    const events = (dayVisits || [])
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
        const q = String(window.AppState.provCalSearchQ || "")
          .trim()
          .toLowerCase();
        const hay = (svc + " " + client).toLowerCase();
        const dim = q && hay.indexOf(q) === -1;
        const selected = !!(
          window.AppState.provCalSelection &&
          window.AppState.provCalSelection.kind === "booking" &&
          window.AppState.provCalSelection.bookingId === b.id
        );
        const densityCls = provCalDensityCls(height);
        return `
          <article class="gcal__event gcal__event--${escapeHtml(b.status)}${densityCls ? " " + densityCls : ""}${
            dim ? " gcal__event--dim" : ""
          }${selected ? " gcal__event--selected" : ""}"
            style="top:${top}px;height:${height}px"
            data-role="prov-cal-slot" data-kind="booking" data-date="${escapeHtml(dateISO)}"
            data-action="select-prov-cal-slot" data-booking-id="${escapeHtml(b.id)}"
            data-from-min="${clampedFrom}" data-to-min="${clampedTo}"
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

    return `
      <div class="gcal" data-role="prov-cal-gcal" data-prov-cal-day-swipe style="--gcal-days:1">
        ${renderProvCalStickyDayHeads(renderProvCalDayHeadButton(dateISO, dateISO))}
        <div class="gcal__timeline" style="height:${totalH}px;--gcal-hour-h:${hourH}px" data-role="prov-cal-timeline">
          <div class="gcal__hours">${hours}</div>
          <div class="gcal__track">
            ${renderProvCalAvailBars(dateISO, hourH, dayStartMin, dayEndMin)}
            ${nowLine}
            ${events || `<p class="gcal__empty">Brak wizyt w tym dniu</p>`}
          </div>
        </div>
      </div>`;
  }

  /** Widok wielodniowy: N kolumn (2–7) — te same kafle wizyt co w widoku dnia. */
  function renderProvCalGoogleWeek(selectedISO, visits) {
    const dayCount = ensureProvCalVisibleDays();
    const weekDays = provCalVisibleDayList(selectedISO, dayCount);
    const today = demoTodayISO();
    const hourStart = PROV_CAL_HOUR_START;
    const hourEnd = PROV_CAL_HOUR_END;
    const hourH = ensureProvCalHourH();
    const dayStartMin = hourStart * 60;
    const dayEndMin = hourEnd * 60;
    const totalH = (hourEnd - hourStart) * hourH;
    const q = String(window.AppState.provCalSearchQ || "")
      .trim()
      .toLowerCase();

    let hours = "";
    for (let h = hourStart; h <= hourEnd; h++) {
      const top = (h - hourStart) * hourH;
      hours += `
        <div class="gcal__hour" style="top:${top}px" data-hour="${h}">
          <span class="gcal__hour-label">${h === hourStart ? "" : pad(h) + ":00"}</span>
        </div>`;
    }

    const headCols = weekDays
      .map(function (dateISO) {
        return renderProvCalDayHeadButton(dateISO, selectedISO);
      })
      .join("");

    const cols = weekDays
      .map(function (dateISO) {
        const dayVisits = (visits || []).filter(function (b) {
          return b.dateISO === dateISO;
        });
        const isToday = dateISO === today;
        const events = dayVisits
          .map(function (b, idx) {
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
            return `
              <article class="gcal__event gcal__event--${escapeHtml(b.status)}${densityCls ? " " + densityCls : ""}${
                dim ? " gcal__event--dim" : ""
              }${selected ? " gcal__event--selected" : ""}"
                style="top:${top}px;height:${height}px"
                data-role="prov-cal-slot" data-kind="booking" data-date="${escapeHtml(dateISO)}"
                data-action="select-prov-cal-slot" data-booking-id="${escapeHtml(b.id)}"
                data-from-min="${clampedFrom}" data-to-min="${clampedTo}"
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

        return `
          <div class="gcal-week__col${isToday ? " gcal-week__col--today" : ""}" data-date="${escapeHtml(dateISO)}">
            <div class="gcal__track gcal-week__track" data-action="prov-cal-pick-date" data-date="${escapeHtml(dateISO)}">
              ${renderProvCalAvailBars(dateISO, hourH, dayStartMin, dayEndMin)}
              ${nowLine}
              ${events}
            </div>
          </div>`;
      })
      .join("");

    return `
      <div class="gcal gcal--week" data-role="prov-cal-gcal" data-prov-cal-day-swipe style="--gcal-days:${weekDays.length}">
        ${renderProvCalStickyDayHeads(headCols)}
        <div class="gcal__timeline gcal-week__timeline" style="height:${totalH}px;--gcal-hour-h:${hourH}px" data-role="prov-cal-timeline">
          <div class="gcal__hours">${hours}</div>
          <div class="gcal-week__cols">${cols}</div>
        </div>
      </div>`;
  }

  function renderProviderCalendar() {
    const selected = ensureProvCalDate();
    const visits = providerVisits();
    const dayVisits = visits.filter(function (b) {
      return b.dateISO === selected;
    });
    const visibleDays = ensureProvCalVisibleDays();
    // Nie pozwól, by zapisany zbyt mały zoom nakładał wizyty po odświeżeniu.
    const dynMinHourH = provCalNoOverlapMinHourH();
    if (ensureProvCalHourH() < dynMinHourH) window.AppState.provCalHourH = clampProvCalHourH(dynMinHourH);
    const weekView = visibleDays > 1;
    const monthOpen = !!window.AppState.provCalMonthOpen;
    const selectedD = new Date(selected + "T12:00:00");
    const monthLabel = isNaN(selectedD.getTime())
      ? "Miesiąc"
      : MONTHS_NOM[selectedD.getMonth()] || "Miesiąc";
    return `
      <div class="app-screen app-screen--provider app-screen--prov-cal">
        <div class="prov-cal-top">
          <header class="screen-head screen-head--prov-cal">
            <div class="prov-cal-head">
              <div class="prov-cal-head__title-row">
                <button type="button" class="screen-head__back" data-action="provider-tab" data-tab="dashboard" aria-label="Wróć">
                  <span class="screen-head__back-icon" aria-hidden="true"></span>
                </button>
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
          ${renderProvCalMonthPanel(selected, visits)}
        </div>
        <div class="prov-cal-body" data-role="prov-cal-body">
          ${weekView ? renderProvCalGoogleWeek(selected, visits) : renderProvCalGoogleDay(selected, dayVisits)}
        </div>
        ${providerBottomNav("calendar")}
      </div>`;
  }

  function renderRequests() {
    const reqs = (window.AppState.requests || []).filter((r) => r.providerId === MY_PROVIDER_ID && r.status === "pending");
    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Prośby o termin</h2>
            <p class="screen-head__sub">Tryb „na akceptację” — zaproponuj termin klientowi.</p>
          </header>
          <div class="request-list">
            ${
              reqs.length
                ? reqs
                    .map(
                      (r) => `
              <div class="request-card" data-request-id="${escapeHtml(r.id)}">
                <div class="visit-card__top">
                  <span class="visit-card__name">${escapeHtml(r.clientName || "Klient")}</span>
                  <span class="status-badge" data-status="pending">Oczekująca</span>
                </div>
                <div class="visit-card__svc">${escapeHtml(r.serviceNames.join(", "))}</div>
                <div class="visit-card__actions">
                  <button type="button" class="btn btn--primary btn--sm" data-action="propose-open" data-request-id="${escapeHtml(r.id)}">Zaproponuj termin</button>
                </div>
              </div>`
                    )
                    .join("")
                : `<p class="empty-note">Brak oczekujących próśb.</p>`
            }
          </div>
        </div>
        ${providerBottomNav("requests")}
      </div>`;
  }

  function renderProposeScreen(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    const p = myProvider();
    if (!req || !p) return renderRequests();

    const totalDur = (req.serviceIds || []).reduce((a, id) => {
      const s = (p.services || []).find((x) => x.id === id);
      return a + (s ? s.durationMin : 0);
    }, 0) || 30;

    const availDays = (p.availability || []).filter((d) => computeSlots(p, d.dateISO, totalDur).length);
    const activeDate = req._proposeDate && availDays.some((d) => d.dateISO === req._proposeDate) ? req._proposeDate : (availDays[0] && availDays[0].dateISO);
    const slots = activeDate ? computeSlots(p, activeDate, totalDur) : [];

    const dateStrip = availDays
      .map((d) => {
        const dt = new Date(d.dateISO + "T00:00:00");
        const on = d.dateISO === activeDate;
        const red = isRedCalendarDay(d.dateISO);
        return `<button type="button" class="date-chip${on ? " date-chip--active" : ""}${red ? " date-chip--holiday" : ""}" data-action="propose-date" data-request-id="${escapeHtml(req.id)}" data-date="${escapeHtml(d.dateISO)}">
          <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span><span class="date-chip__day">${dt.getDate()}</span></button>`;
      })
      .join("");

    const timeList = slots
      .map(
        (s) => `<button type="button" class="time-row${req._proposeSlot === s.id ? " time-row--selected" : ""}" data-action="propose-slot" data-request-id="${escapeHtml(req.id)}" data-slot="${escapeHtml(s.id)}" data-date="${escapeHtml(activeDate)}">
          <span class="time-row__range">${escapeHtml(s.from)}→${escapeHtml(s.to)}</span>${s.locationLabel ? `<span class="time-row__place">${escapeHtml(s.locationLabel)}</span>` : ""}</button>`
      )
      .join("");

    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <div class="topbar">
            <button type="button" class="topbar__back" data-action="provider-tab" data-tab="requests" aria-label="Wróć">‹</button>
            <span class="topbar__title">Zaproponuj termin</span><span class="topbar__spacer"></span>
          </div>
          <div class="booking">
            <div class="booking__header">
              <span class="booking__prov">${escapeHtml(req.clientName || "Klient")}</span>
              <span class="booking__svc">${escapeHtml(req.serviceNames.join(", "))}</span>
            </div>
            <h3 class="booking__label">Dzień</h3>
            <div class="date-strip">${dateStrip || `<p class="empty-note">Brak dostępności.</p>`}</div>
            ${activeDate ? `<h3 class="booking__label">Godzina · ${escapeHtml(formatDateLong(activeDate))}</h3><div class="time-list">${timeList || `<p class="empty-note">Brak wolnych godzin.</p>`}</div>` : ""}
          </div>
        </div>
        <div class="selection-summary">
          <div class="selection-summary__info"><span class="selection-summary__duration">${escapeHtml(formatDuration(totalDur))}</span></div>
          <button type="button" class="btn btn--primary selection-summary__cta" data-action="propose-confirm" data-request-id="${escapeHtml(req.id)}" ${req._proposeSlot ? "" : "disabled"}>Wyślij propozycję</button>
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
      subtitle: "",
      description: "",
      durationMin: 30,
      price: null,
      photos: [],
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

  function captureServiceEditDraft() {
    const form = document.querySelector("form.service-edit");
    if (!form) return;
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceDraft: {
        name: String(form.elements.name && form.elements.name.value || ""),
        subtitle: String(form.elements.subtitle && form.elements.subtitle.value || ""),
        description: String(form.elements.description && form.elements.description.value || ""),
        durationMin: Number(form.elements.durationMin && form.elements.durationMin.value) || 30,
        price:
          form.elements.price && form.elements.price.value === ""
            ? null
            : Number(form.elements.price && form.elements.price.value),
      },
    });
  }

  function applyServiceEditDraft(s) {
    const draft = window.AppState.params.provider && window.AppState.params.provider.editServiceDraft;
    if (!draft || !s) return s;
    return Object.assign({}, s, draft);
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

  function renderServiceEditForm(s, isNew) {
    const priceVal = s.price == null ? "" : String(s.price);
    const serviceId = isNew ? "__new__" : s.id;
    const photos = getEditServicePhotos();
    return `
      <form class="service-edit" data-service-id="${escapeHtml(serviceId)}" data-new="${isNew ? "true" : "false"}" onsubmit="return false;">
        <header class="screen-head screen-head--with-back">
          <button type="button" class="screen-head__back" data-action="cancel-edit-service" aria-label="Wróć">
            <span class="screen-head__back-icon" aria-hidden="true"></span>
          </button>
          <h2 class="screen-head__title">${isNew ? "Nowa usługa" : "Edytuj usługę"}</h2>
        </header>
        <label class="service-edit__field">
          <span class="service-edit__label">Nazwa</span>
          <input class="service-edit__input" name="name" type="text" required maxlength="80" value="${escapeHtml(s.name || "")}" />
        </label>
        <label class="service-edit__field">
          <span class="service-edit__label">Krótki opis</span>
          <input class="service-edit__input" name="subtitle" type="text" maxlength="120" value="${escapeHtml(s.subtitle || "")}" />
        </label>
        <label class="service-edit__field">
          <span class="service-edit__label">Opis szczegółowy</span>
          <textarea class="service-edit__input service-edit__textarea" name="description" rows="6" maxlength="500">${escapeHtml(s.description || "")}</textarea>
        </label>
        ${renderServiceEditPhotos(photos)}
        <div class="service-edit__row">
          <label class="service-edit__field">
            <span class="service-edit__label">Czas (min)</span>
            <input class="service-edit__input" name="durationMin" type="number" required min="5" max="480" step="5" value="${escapeHtml(String(s.durationMin || 30))}" />
          </label>
          <label class="service-edit__field">
            <span class="service-edit__label">Cena (zł)</span>
            <input class="service-edit__input" name="price" type="number" min="0" max="99999" step="1" value="${escapeHtml(priceVal)}" placeholder="Indywidualna" />
          </label>
        </div>
        <div class="service-edit__actions">
          <button type="button" class="btn btn--primary" data-action="save-service" data-service-id="${escapeHtml(serviceId)}">${isNew ? "Dodaj" : "Zapisz"}</button>
          <button type="button" class="btn btn--ghost" data-action="cancel-edit-service">Anuluj</button>
        </div>
      </form>`;
  }

  function renderServices() {
    const p = myProvider();
    const editId = window.AppState.params.provider && window.AppState.params.provider.editServiceId;
    const isNew = editId === "__new__";
    const base = isNew ? newServiceDraft() : editId ? getProviderService(editId) : null;
    const editing = base ? applyServiceEditDraft(base) : null;

    if (editing) {
      return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          ${renderServiceEditForm(editing, isNew)}
        </div>
        ${providerBottomNav("services")}
      </div>`;
    }

    const list = (p ? p.services : [])
      .map(function (s) {
        const thumb = servicePhotos(s)[0];
        return `
      <div class="service-row service-row--static">
        ${
          thumb
            ? `<img class="service-row__thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
            : `<span class="service-row__thumb service-row__thumb--empty" aria-hidden="true"></span>`
        }
        <div class="service-row__static-main">
          <span class="service-row__body">
            <span class="service-row__name">${escapeHtml(s.name)}</span>
            <span class="service-row__sub">${escapeHtml(s.subtitle || "")}</span>
          </span>
          <span class="service-row__meta">
            <span class="service-row__dur">${escapeHtml(formatDuration(s.durationMin))}</span>
            <span class="service-row__price">${escapeHtml(formatPrice(s.price))}</span>
          </span>
        </div>
        <button type="button" class="service-row__edit" data-action="edit-service" data-service-id="${escapeHtml(s.id)}" aria-label="Edytuj ${escapeHtml(s.name)}" title="Edytuj">
          <span class="service-row__edit-icon" aria-hidden="true"></span>
        </button>
      </div>`;
      })
      .join("");
    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <header class="screen-head"><h2 class="screen-head__title">Usługi</h2><p class="screen-head__sub">Oferta widoczna dla klientów.</p></header>
          <div class="service-list">${list || `<p class="empty-note">Brak usług w ofercie.</p>`}</div>
          <button type="button" class="btn btn--primary service-list__add" data-action="add-service">Dodaj usługę</button>
        </div>
        ${providerBottomNav("services")}
      </div>`;
  }

  function openEditService(serviceId) {
    const s = getProviderService(serviceId);
    if (!s) return;
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceId: serviceId,
      editServicePhotos: Array.isArray(s.photos) ? s.photos.slice() : [],
      editServiceDraft: null,
    });
    window.AppState.screen.provider = "services";
    saveState();
    renderAll();
  }

  function openAddService() {
    window.AppState.params.provider = Object.assign({}, window.AppState.params.provider || {}, {
      editServiceId: "__new__",
      editServicePhotos: [],
      editServiceDraft: null,
    });
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
    const subtitle = String(form.elements.subtitle && form.elements.subtitle.value || "").trim();
    const description = String(form.elements.description && form.elements.description.value || "").trim();
    const durationMin = Number(form.elements.durationMin && form.elements.durationMin.value);
    const priceRaw = form.elements.price && form.elements.price.value;
    const price = priceRaw === "" || priceRaw == null ? null : Number(priceRaw);
    const photos = getEditServicePhotos();

    if (!name) {
      showToast("Podaj nazwę usługi.");
      return;
    }
    if (!Number.isFinite(durationMin) || durationMin < 5) {
      showToast("Podaj poprawny czas trwania.");
      return;
    }
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      showToast("Podaj poprawną cenę.");
      return;
    }

    if (isNew) {
      if (!Array.isArray(p.services)) p.services = [];
      s = {
        id: "svc-" + Date.now().toString(36),
        name: name,
        subtitle: subtitle,
        durationMin: Math.round(durationMin),
        price: price,
        photos: photos,
      };
      if (description) s.description = description;
      p.services.push(s);
    } else {
      s.name = name;
      s.subtitle = subtitle;
      s.description = description || undefined;
      s.durationMin = Math.round(durationMin);
      s.price = price;
      s.photos = photos;
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
  function availStripDays() {
    const today = demoTodayISO();
    const d = new Date(today + "T12:00:00");
    const from = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 3, 0);
    return eachDateISO(
      from.getFullYear() + "-" + pad(from.getMonth() + 1) + "-" + pad(from.getDate()),
      to.getFullYear() + "-" + pad(to.getMonth() + 1) + "-" + pad(to.getDate())
    );
  }

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

  function scrollAvailStripToDate(dateISO) {
    const grid = document.querySelector('[data-role="avail-week-grid"]');
    if (!grid || !dateISO) return;
    const col = grid.querySelector('.avail-week__col[data-date="' + dateISO + '"]');
    if (!col) return;
    const left = Math.max(0, col.offsetLeft - 8);
    grid.scrollTo({ left: left, behavior: "smooth" });
    window.AppState.availStripScrollLeft = left;
    handleAvailStripScroll(grid);
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
  function shiftAvailListWeek(deltaWeeks) {
    const delta = Number(deltaWeeks) || 0;
    if (!delta) return;
    const focus = ensureAvailFocusDate() || demoTodayISO();
    const prevMonth = ensureAvailPickerMonth();
    const d = new Date(focus + "T12:00:00");
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + delta * 7);
    const next = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    window.AppState.availFocusDate = next;
    window.AppState.availWeekStart = mondayISOFrom(next);
    window.AppState.availPickerMonth = next.slice(0, 7);
    window.AppState.availEditDate = null;
    saveState();
    const nextMonth = window.AppState.availPickerMonth;
    const monthChanged = prevMonth !== nextMonth;
    // Soft refresh — bez renderAll, żeby siatka miesiąca nie migała i pasek mógł się animować.
    refreshAvailWeekView({
      rebuildMonth: monthChanged,
      monthDir: monthChanged ? (nextMonth > prevMonth ? 1 : -1) : 0,
      weekDir: delta > 0 ? 1 : -1,
    });
  }

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

  function renderAvailMonthPanel(provider, selectedISO, availByDate) {
    if (!window.AppState.availMonthOpen) return "";
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
          <span class="gcal-month__day-num">${day}</span>
          <span class="gcal-month__day-dots" aria-hidden="true">${dotsHtml}</span>
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
      document.querySelectorAll(".app-screen--avail .avail-top").forEach(function (top) {
        const host = document.createElement("div");
        host.innerHTML = panelHtml;
        const next = host.firstElementChild;
        if (next) top.appendChild(next);
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
    swapAvailMonthPanels(renderAvailMonthPanel(p, focusDate, availByDate), opts && opts.monthDir);
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
    return `<span class="avail-edit__time-wrap" data-role="avail-time-field">
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

  function toggleAvailDayEdit(dateISO) {
    if (!dateISO) return;
    if (window.AppState.availEditDate === dateISO) {
      // Przycisk w stanie otwartym = Zapisz i zamknij.
      saveAvailDayEdit(dateISO, { quiet: true });
      window.AppState.availEditDate = null;
      saveState();
      refreshAvailListOnly();
      patchAvailMonthBusyDots();
      return;
    }
    openAvailDayEdit(dateISO);
  }

  function syncAvailDraftFromForm(dateISO) {
    const draft = ensureAvailDraft(dateISO);
    if (!draft) return null;
    const form = document.querySelector('[data-role="avail-edit-form"][data-date="' + dateISO + '"]');
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

  function blocksFromAvailForm(dateISO) {
    const p = myProvider();
    if (!p || !dateISO) return [];
    const form = document.querySelector('[data-role="avail-edit-form"][data-date="' + dateISO + '"]');
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

  function addAvailEditBlock(dateISO) {
    const p = myProvider();
    if (!p || !dateISO) return;
    window.AppState.availEditDate = dateISO;
    const draft = syncAvailDraftFromForm(dateISO) || ensureAvailDraft(dateISO);
    if (!draft) return;
    if ((draft.blocks || []).length >= AVAIL_MAX_BLOCKS_PER_DAY) return;
    draft.blocks.push(defaultAvailBlock(p));
    persistAvailDraft(dateISO);
    saveState();
    refreshAvailListOnly();
  }

  function removeAvailEditBlock(dateISO, index) {
    const draft = syncAvailDraftFromForm(dateISO) || ensureAvailDraft(dateISO);
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
    const blocks = blocksFromAvailForm(dateISO);
    writeAvailDayBlocks(dateISO, blocks);
    expandAvailRepeats(dateISO, blocks);
    // Po ekspansji przywróć draft/edycję źródłowego dnia (expand pisał inne daty).
    if (window.AppState.availEditDrafts) {
      window.AppState.availEditDraft = window.AppState.availEditDrafts[dateISO] || null;
    }
    window.AppState.availEditDate = dateISO;
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
        const btn = pick.querySelector('[data-action="toggle-avail-loc"], [data-action="toggle-avail-repeat"]');
        const menu = pick.querySelector('[data-role="avail-loc-menu"], [data-role="avail-repeat-menu"]');
        if (btn) btn.setAttribute("aria-expanded", "false");
        if (menu) menu.hidden = true;
      });
  }

  function closeAvailLocMenus(except) {
    closeAvailPickMenus(except);
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

  function setAvailBlockLocation(dateISO, index, locationId) {
    const p = myProvider();
    if (!p || !dateISO || !locationId) return;
    const form = document.querySelector('[data-role="avail-edit-form"][data-date="' + dateISO + '"]');
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
    saveAvailDayEdit(dateISO, { quiet: true });
  }

  function setAvailBlockRepeat(dateISO, index, repeatId) {
    if (!dateISO) return;
    const repeat = normalizeAvailRepeat({ repeat: repeatId });
    const form = document.querySelector('[data-role="avail-edit-form"][data-date="' + dateISO + '"]');
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
    saveAvailDayEdit(dateISO, { quiet: true });
  }

  /** Edytor dnia w stylu Calendly: [od]–[do] ×  +  oraz miejsce / powtarzaj. */
  function renderAvailDayEditor(p, dateISO, draft) {
    const locs = p.locations || [];
    const blockList = draft.blocks || [];
    const dateAttr = escapeHtml(dateISO);

    if (!blockList.length) {
      return `
      <form class="avail-edit avail-edit--day" data-role="avail-edit-form" data-date="${dateAttr}" onsubmit="return false;">
        <div class="avail-edit__unavailable">
          <span class="avail-edit__unavailable-label">Niedostępne</span>
          <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="add-avail-block" data-date="${dateAttr}" aria-label="Dodaj godziny dostępności" title="Dodaj">
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </form>`;
    }

    const slots = blockList
      .map(function (b, i) {
        const locTone = locationToneClass(p, b.locationId);
        const hasLoc = !!(b.locationId && locationLabel(p, b.locationId));
        const locLabel = hasLoc ? locationLabel(p, b.locationId) : "wybierz lokalizację";
        const isLast = i === blockList.length - 1;
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
        <div class="avail-edit__slot" data-avail-block data-index="${i}">
          <div class="avail-edit__slot-row">
            <div class="avail-edit__slot-times ${locTone}" data-role="avail-edit-times">
              <span class="avail-edit__time-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3.2 1.8" />
                </svg>
              </span>
              ${renderAvailTimeField("from", b.from || "09:00", "Od")}
              <span class="avail-edit__dash" aria-hidden="true">–</span>
              ${renderAvailTimeField("to", b.to || "17:00", "Do")}
            </div>
            <button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--remove" data-action="open-avail-remove-cloud" data-date="${dateAttr}" data-index="${i}"
              aria-label="Usuń" title="Usuń dzień lub serię" aria-haspopup="menu">
              <span aria-hidden="true">×</span>
            </button>
            ${
              isLast && blockList.length < AVAIL_MAX_BLOCKS_PER_DAY
                ? `<button type="button" class="avail-edit__icon-btn avail-edit__icon-btn--add" data-action="add-avail-block" data-date="${dateAttr}" aria-label="Dodaj godziny dostępności" title="Dodaj">
              <span aria-hidden="true">+</span>
            </button>`
                : `<span class="avail-edit__icon-spacer" aria-hidden="true"></span>`
            }
          </div>
          <div class="avail-edit__slot-loc">
            <div class="avail-loc-pick avail-loc-pick--compact" data-role="avail-loc-pick">
              <input type="hidden" name="locationId" value="${escapeHtml(b.locationId || "")}" />
              <button type="button" class="avail-loc-pick__btn" data-action="toggle-avail-loc"
                aria-haspopup="listbox" aria-expanded="false" aria-label="Wybierz lokalizację">
                <span class="avail-edit__loc-lead" aria-hidden="true">
                  <span class="avail-edit__loc-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.6 12 21 12 21z" />
                      <circle cx="12" cy="10.5" r="2.2" />
                    </svg>
                  </span>
                </span>
                <span class="avail-edit__loc-content">
                  <span class="avail-edit__loc-dot ${locTone}${hasLoc ? "" : " is-hidden"}" data-role="avail-loc-tone-dot" aria-hidden="true"${hasLoc ? "" : " hidden"}></span>
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

    return `
      <form class="avail-edit avail-edit--day" data-role="avail-edit-form" data-date="${dateAttr}" onsubmit="return false;">
        <div class="avail-edit__slots">${slots}</div>
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
    swapAvailMonthPanels(renderAvailMonthPanel(p, focusDate, availByDate), monthDir);
  }

  function renderAvailability() {
    const p = myProvider();
    const focusDate = ensureAvailFocusDate();
    const weekStart = mondayISOFrom(focusDate);
    window.AppState.availWeekStart = weekStart;
    const pickerMonth = ensureAvailPickerMonth();
    const availByDate = collectAvailByDate(p);

    const monthLabel = monthLabelFromISO(pickerMonth + "-01");
    const monthOpen = !!window.AppState.availMonthOpen;
    const editDate = window.AppState.availEditDate || null;
    const list = renderAvailWeekListHtml(p, weekStart, availByDate, editDate);

    return `
      <div class="app-screen app-screen--provider app-screen--avail">
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
                  <button type="button" class="prov-cal__tool prov-cal__tool--month-label${monthOpen ? " is-on" : ""}"
                    data-action="avail-month-toggle"
                    aria-label="${escapeHtml(monthLabel)}" aria-pressed="${monthOpen ? "true" : "false"}">
                    <span class="prov-cal__month-name" data-role="avail-week-month">${escapeHtml(monthLabel)}</span>
                    <span class="prov-cal__month-chevron" aria-hidden="true"></span>
                  </button>
                </div>
                <button type="button" class="prov-cal__today-btn" data-action="avail-today">Dzisiaj</button>
              </div>
            </div>
          </header>
          ${renderAvailMonthPanel(p, focusDate, availByDate)}
        </div>
        <div class="avail-body" data-role="avail-body">
          <div class="avail-list__head">
            <h3 class="avail-list__heading">Godziny dostępności</h3>
          </div>
          <div class="avail-list-viewport" data-role="avail-list-viewport">
            <div class="avail-list" data-role="avail-list">${list}</div>
          </div>
        </div>
        ${providerBottomNav("availability")}
      </div>`;
  }

  function renderSettings() {
    const p = myProvider();
    if (!p) return renderDashboard();
    const rows = [
      ["Nazwa", p.name],
      ["Slug (link)", "/" + p.slug],
      ["Adres", p.address || "— (usługa online)"],
      ["Tryb rezerwacji", p.bookingMode === "approval" ? "Na akceptację" : "Automatyczny"],
      ["Widoczność w katalogu", p.visibleInSearch ? "Widoczny" : "Ukryty (tylko z linku)"],
      ["Lokalizacje", (p.locations || []).map((l) => l.label).join(", ")],
    ];
    return `
      <div class="app-screen app-screen--provider">
        <div class="app-scroll">
          <header class="screen-head"><h2 class="screen-head__title">Ustawienia</h2><p class="screen-head__sub">Dane profilu usługodawcy.</p></header>
          <div class="settings">
            ${rows
              .map(
                (r) => `<div class="settings__row"><span class="settings__key">${escapeHtml(r[0])}</span><span class="settings__val">${escapeHtml(r[1])}</span></div>`
              )
              .join("")}
          </div>
        </div>
        ${providerBottomNav("settings")}
      </div>`;
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

  function renderAll() {
    closeProviderCardMenu();
    const prevBottomNavTab = captureBottomNavTab();
    INSTANCES.forEach(render);
    renderFullscreen();
    syncAppMenus();
    // Po layoutcie — inaczej przy flex itemach szerokość bywa jeszcze 0.
    requestAnimationFrame(function () {
      syncBottomNavIndicators(prevBottomNavTab);
    });
    document.querySelectorAll('[data-role="booking-date-strip"]').forEach(updateBookingMonthLabel);
    requestAnimationFrame(function () {
      const availGrid = document.querySelector('[data-role="avail-week-grid"]');
      if (availGrid) initAvailStripScroll(availGrid);
      const body = document.querySelector('[data-role="prov-cal-body"]');
      if (body && !window.AppState.provCalMonthOpen) {
        const nowEl = body.querySelector(".gcal__now");
        const firstEvent = body.querySelector(".gcal__event");
        const target = nowEl || firstEvent;
        if (target) {
          body.scrollTop = Math.max(0, target.offsetTop - 48);
        }
      }
      refreshProvCalTimeLabels();
      // Drugi frame — po layoutcie siatki miesiąca (inaczej pasek pada na top:0).
      requestAnimationFrame(animateAvailWeekHighlight);
    });
  }

  // Poziome przewijanie wierszy filtrów — delegacja (przetrwa re-render).
  const filterDrag = { active: false, el: null, startX: 0, startScroll: 0, moved: false };

  function bindFilterScroll() {
    if (bindFilterScroll.done) return;
    bindFilterScroll.done = true;

    document.addEventListener(
      "pointerdown",
      function (event) {
        const el = event.target.closest("[data-filter-scroll]");
        if (!el || event.button !== 0) return;
        filterDrag.active = true;
        filterDrag.el = el;
        filterDrag.startX = event.clientX;
        filterDrag.startScroll = el.scrollLeft;
        filterDrag.moved = false;
        el.classList.add("filter-scroll--dragging");
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!filterDrag.active || !filterDrag.el) return;
        const dx = event.clientX - filterDrag.startX;
        if (Math.abs(dx) > 3) filterDrag.moved = true;
        filterDrag.el.scrollLeft = filterDrag.startScroll - dx;
      },
      true
    );

    function endFilterDrag() {
      if (!filterDrag.active) return;
      if (filterDrag.el) filterDrag.el.classList.remove("filter-scroll--dragging");
      filterDrag.active = false;
      filterDrag.el = null;
    }

    document.addEventListener("pointerup", endFilterDrag, true);
    document.addEventListener("pointercancel", endFilterDrag, true);

    document.addEventListener(
      "click",
      function (event) {
        if (!filterDrag.moved) return;
        event.preventDefault();
        event.stopPropagation();
        filterDrag.moved = false;
      },
      true
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

  function openProvider(slug) {
    if (window.AppState.closingProvider) return;
    const p = getProviderBySlug(slug);
    if (!p) return;

    if (
      clientUsesDesktopBookingLayout() &&
      window.AppState.searchOpenSlug === slug &&
      (window.AppState.screen.client === "search" || window.AppState.screen.client === "favorites")
    ) {
      closeProvider();
      return;
    }

    initDraftForProvider(p);
    window.AppState.params.client = { slug: slug };

    if (clientUsesDesktopBookingLayout()) {
      window.AppState.searchOpenSlug = slug;
      window.AppState.screen.client =
        window.AppState.screen.client === "favorites" ? "favorites" : "search";
      window.AppState.bookingPanelEnterSlug = slug;
    } else {
      window.AppState.searchOpenSlug = null;
      window.AppState.screen.client = "booking";
    }

    saveState();
    renderAll();
    window.AppState.bookingPanelEnterSlug = null;
  }

  function openProfile(slug) {
    openProvider(slug);
  }

  function toggleFav(slug) {
    const i = window.AppState.favorites.indexOf(slug);
    if (i === -1) window.AppState.favorites.push(slug);
    else window.AppState.favorites.splice(i, 1);
    saveState();
    renderAll();
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

    const ids = draft.serviceIds || [];
    const idx = ids.indexOf(serviceId);
    const multi =
      mode === "multi" || (mode !== "single" && (!!p.multiSelect || !!draft.multiSelectMode));

    if (!multi) {
      draft.serviceIds = idx === -1 ? [serviceId] : [];
    } else {
      if (idx === -1) ids.push(serviceId);
      else ids.splice(idx, 1);
      draft.serviceIds = ids;
    }
    draft.slotId = null;
    if (!draft.serviceIds.length) {
      window.AppState.searchOpenSlug = null;
      saveState();
      if (clientUsesDesktopBookingLayout()) {
        closeProvider();
      } else if (window.AppState.screen.client === "booking") {
        if (!refreshBookingDraftUI()) renderAll();
      } else {
        renderAll();
      }
      return;
    }
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
    else if (!pickOn) clearBookingPickModeUI();
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

    const slots = computeSlots(p, draft.dateISO, draftTotals(p).duration || 15);
    const slot = slots.find((s) => s.id === draft.slotId);
    if (!slot) {
      showToast("Ten termin jest już zajęty — wybierz inny.");
      renderAll();
      return;
    }

    const svcs = draftServices(p);
    const booking = {
      id: "bk-" + Date.now(),
      providerId: p.id,
      providerName: p.name,
      clientName: (data().CURRENT_USER && data().CURRENT_USER.name) || "Klient",
      serviceIds: svcs.map((s) => s.id),
      serviceNames: svcs.map((s) => s.name),
      dateISO: draft.dateISO,
      from: slot.from,
      to: slot.to,
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
  }

  function sendRequest(slug) {
    const draft = window.AppState.draft;
    const p = getProviderBySlug(slug);
    if (!p) return;
    if (!draft || !draft.serviceIds || !draft.serviceIds.length) {
      showToast("Wybierz co najmniej jedną usługę.");
      return;
    }
    const svcs = draftServices(p);
    const req = {
      id: "rq-" + Date.now(),
      providerId: p.id,
      providerName: p.name,
      clientName: (data().CURRENT_USER && data().CURRENT_USER.name) || "Klient",
      serviceIds: svcs.map((s) => s.id),
      serviceNames: svcs.map((s) => s.name),
      status: "pending",
    };
    window.AppState.requests.push(req);

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
    window.AppState.screen.client = "search";
    saveState();
    renderAll();
    showToast("Prośba wysłana — czekaj na propozycję terminu.");
  }

  // Usługodawca proponuje termin
  function proposeOpen(requestId) {
    window.AppState.params.provider = { requestId: requestId };
    window.AppState.screen.provider = "propose";
    saveState();
    renderAll();
  }

  function proposeDate(requestId, dateISO) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    req._proposeDate = dateISO;
    req._proposeSlot = null;
    saveState();
    renderAll();
  }

  function proposeSlot(requestId, slotId, dateISO) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    if (!req) return;
    req._proposeSlot = slotId;
    req._proposeDate = dateISO;
    saveState();
    renderAll();
  }

  function proposeConfirm(requestId) {
    const req = (window.AppState.requests || []).find((r) => r.id === requestId);
    const p = myProvider();
    if (!req || !p || !req._proposeSlot || !req._proposeDate) return;

    const totalDur = (req.serviceIds || []).reduce((a, id) => {
      const s = (p.services || []).find((x) => x.id === id);
      return a + (s ? s.durationMin : 0);
    }, 0) || 30;
    const slot = computeSlots(p, req._proposeDate, totalDur).find((s) => s.id === req._proposeSlot);
    if (!slot) return;

    // Zaktualizuj wizytę klienta na "proposed" z terminem
    const bk = (window.AppState.bookings || []).find((b) => b.requestId === req.id);
    if (bk) {
      bk.dateISO = req._proposeDate;
      bk.from = slot.from;
      bk.to = slot.to;
      bk.locationLabel = slot.locationLabel;
      bk.status = "proposed";
    }
    req.status = "proposed";
    window.AppState.screen.provider = "requests";
    if (window.AppState.screen.client === "myCalendar" || window.AppState.screen.client === "profile") {
      window.AppState.screen.client = "search";
    }
    saveState();
    renderAll();
    showToast("Propozycja wysłana klientowi.");
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

  function cancelVisit(bookingId) {
    const bk = (window.AppState.bookings || []).find((b) => b.id === bookingId);
    if (!bk) return;
    bk.status = "cancelled";
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

  function handleRouteHash() {
    const hash = (location.hash || "").replace(/^#/, "");
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

  function updateAppHeader(activeRole) {
    const user = data().CURRENT_USER;
    const userEl = document.getElementById("app-header-user");
    if (userEl && user) userEl.textContent = user.name || "";

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

    const onMyCalendar = activeRole === "client" && window.AppState.screen.client === "myCalendar";
    document.querySelectorAll('[data-action="open-my-calendar"]').forEach(function (btn) {
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
    showSimulator();
  }

  function switchRole(role) {
    if (INSTANCES.indexOf(role) === -1) return;
    const wasMenuOpen = !!window.AppState.appMenuOpen;
    window.AppState.activeRole = role;
    window.AppState.appMenuOpen = false;
    saveState();
    updateAppHeader(role);
    syncAppMenuNavButtons(false);
    if (wasMenuOpen) {
      setAppMenuOpenClass(false);
      // Po animacji schowania menu — przełącz widok profilu.
      setTimeout(function () {
        if (window.AppState.appMenuOpen) return;
        renderAll();
      }, 380);
    } else {
      renderAll();
    }
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
    if (event.key === "Escape") {
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
        selectProvCalSlot(selectionFromSlotEl(slot));
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
      shiftProvCalDate(event.key === "ArrowLeft" ? -1 : 1);
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
    if (
      !event.target.closest('[data-role="avail-loc-pick"]') &&
      !event.target.closest('[data-role="avail-repeat-pick"]')
    ) {
      closeAvailPickMenus();
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
      case "show-simulator":
        event.preventDefault();
        showSimulator();
        break;
      case "switch-role": switchRole(d.role); break;

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
      case "report-provider":
        event.preventDefault();
        reportProvider(d.slug);
        closeProviderCardMenu();
        closeBookingProviderInfo({ render: true });
        break;
      case "toggle-service": toggleService(d.serviceId); break;
      case "toggle-service-check": toggleServiceCheck(d.serviceId); break;
      case "toggle-service-desc": toggleServiceDesc(d.serviceId); break;
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
      case "my-cal-pick-date": pickMyCalDate(d.date); break;
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
        toggleAvailDayEdit(d.date);
        if (d.date && window.AppState.availEditDate === d.date) {
          scrollAvailListToDate(d.date);
        }
        break;
      case "add-avail-block":
        event.preventDefault();
        {
          const dateISO = d.date || ensureAvailFocusDate();
          addAvailEditBlock(dateISO);
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
        removeAvailEditBlock(d.date, d.index);
        break;
      case "clear-avail-recurring-series":
        event.preventDefault();
        clearAvailRecurringSeries(d.date, d.index);
        break;
      case "save-avail-day":
        event.preventDefault();
        saveAvailDayEdit(d.date);
        break;
      case "toggle-avail-loc":
        event.preventDefault();
        toggleAvailPickMenu(btn.closest('[data-role="avail-loc-pick"]'), btn, "avail-loc-menu");
        break;
      case "pick-avail-loc":
        event.preventDefault();
        setAvailBlockLocation(d.date, d.index, d.locationId);
        break;
      case "toggle-avail-repeat":
        event.preventDefault();
        toggleAvailPickMenu(btn.closest('[data-role="avail-repeat-pick"]'), btn, "avail-repeat-menu");
        break;
      case "pick-avail-repeat":
        event.preventDefault();
        setAvailBlockRepeat(d.date, d.index, d.repeat);
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

      case "provider-tab":
        if (d.tab === "availability") openAvailability();
        else if (d.tab === "calendar") {
          ensureProvCalDate();
          navigate("provider", "calendar", {});
        } else navigate("provider", d.tab, {});
        break;
      case "select-prov-cal-slot":
        event.preventDefault();
        event.stopPropagation();
        if (window._provCalSlotIgnoreClick) {
          window._provCalSlotIgnoreClick = false;
          break;
        }
        selectProvCalSlot({
          kind: d.kind || (d.bookingId ? "booking" : "free"),
          bookingId: d.bookingId,
          dateISO: d.date || ensureProvCalDate(),
          fromMin: Number(d.fromMin),
          toMin: Number(d.toMin),
        });
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
      case "propose-open": proposeOpen(d.requestId); break;
      case "propose-date": proposeDate(d.requestId, d.date); break;
      case "propose-slot": proposeSlot(d.requestId, d.slot, d.date); break;
      case "propose-confirm": proposeConfirm(d.requestId); break;
      case "edit-service":
        event.preventDefault();
        openEditService(d.serviceId);
        break;
      case "add-service":
        event.preventDefault();
        openAddService();
        break;
      case "remove-service-photo":
        event.preventDefault();
        removeServicePhoto(d.index);
        break;
      case "cancel-edit-service":
        event.preventDefault();
        cancelEditService();
        break;
      case "save-service":
        event.preventDefault();
        {
          const form = btn.closest("form.service-edit");
          saveService(d.serviceId, form);
        }
        break;
      case "cancel-visit": cancelVisit(d.bookingId); break;
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
        renderAll();
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

  });

  document.addEventListener("change", function (event) {
    const radiusSel = event.target.closest('[data-role="search-radius"]');
    if (radiusSel) {
      window.AppState.searchRadiusKm = Number(radiusSel.value) || 15;
      saveState();
      updateProviderLists();
      return;
    }

    const availField = event.target.closest('.avail-edit input:not([type="hidden"]), .avail-edit select');
    if (availField) {
      const form = availField.closest('[data-role="avail-edit-form"]');
      const dateISO = form && form.getAttribute("data-date");
      if (dateISO) {
        // Godziny: zapis bez przebudowy DOM (mobile picker gubi wartość przy re-renderze).
        const isTime = availField.matches && availField.matches("input.avail-edit__time");
        saveAvailDayEdit(dateISO, { quiet: true, noRender: isTime });
      }
    }
  });

  document.addEventListener(
    "scroll",
    function (event) {
      const target = event.target;
      if (!target || !target.closest) return;
      const bookingStrip = target.closest('[data-role="booking-date-strip"]');
      if (bookingStrip) updateBookingMonthLabel(bookingStrip);
      const availGrid = target.closest('[data-role="avail-week-grid"]');
      if (availGrid) handleAvailStripScroll(availGrid);
    },
    true
  );

  /**
   * Zaznaczanie wolnych/zajętych + przeciąganie WIZYT na wolne sloty (snap 5 min).
   * „Wolne” da się tylko zaznaczyć — nie przesuwa się; przyjmuje upuszczoną wizytę.
   */
  function bindProvCalEventDrag() {
    if (bindProvCalEventDrag.done) return;
    bindProvCalEventDrag.done = true;
    const HOLD_MS = 300;
    const MOUSE_THRESHOLD = 4;
    const AUTO_EDGE = 52;
    const AUTO_STEP = 14;
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
    };

    function isWeekView() {
      return ensureProvCalVisibleDays() > 1;
    }

    function dragRootGcal() {
      return (drag.el && drag.el.closest && drag.el.closest('[data-role="prov-cal-gcal"]')) || null;
    }

    function trackForDate(dateISO) {
      if (isWeekView()) {
        const root = dragRootGcal();
        const scope = root || document;
        const col = scope.querySelector('.gcal-week__col[data-date="' + dateISO + '"]');
        return col ? col.querySelector(".gcal-week__track") : null;
      }
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

    function stopAutoScroll() {
      if (drag.autoRAF) {
        cancelAnimationFrame(drag.autoRAF);
        drag.autoRAF = 0;
      }
      drag.autoDir = 0;
    }

    function resetDrag() {
      clearHoldTimer();
      stopAutoScroll();
      if (drag.el) drag.el.classList.remove("gcal__event--dragging", "gcal__event--invalid");
      clearProvCalDropTargets();
      hideProvCalDragTime();
      document.body.classList.remove("prov-cal-dragging");
      document.querySelectorAll(".gcal--drag-active").forEach(function (el) {
        el.classList.remove("gcal--drag-active");
      });
      drag.active = false;
      drag.el = null;
      drag.pointerId = null;
      drag.moved = false;
      drag.allowMove = false;
      drag.armed = false;
      drag.weekView = false;
    }

    function armBookingDrag() {
      drag.holdTimer = 0;
      if (!drag.active || !drag.allowMove || !drag.el) return;
      drag.armed = true;
      drag.weekView = isWeekView();
      drag.el.classList.add("gcal__event--dragging");
      // Przechwyć wskaźnik i zablokuj natywny scroll / hit-test obcych slotów (Safari).
      document.body.classList.add("prov-cal-dragging");
      const gcal = dragRootGcal();
      if (gcal) gcal.classList.add("gcal--drag-active");
      captureDragPointer();
      if (!isProvCalSlotSelected(drag.el)) {
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
      } else {
        hapticTap(16);
      }
      if (!drag.weekView) {
        highlightProvCalDropTargets(drag.bookingId, drag.dateISO, drag.duration);
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
        const d = columnDateUnderPoint(drag.lastClientX, drag.lastClientY);
        if (d) targetDate = d;
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
      if (!drag.weekView) updateProvCalDragTime(newFrom);
      drag.el.classList.toggle(
        "gcal__event--invalid",
        bookingOverlapsOthers(drag.bookingId, drag.dateISO, newFrom, newTo)
      );
    }

    function autoScrollTick() {
      drag.autoRAF = 0;
      if (!drag.armed || !drag.autoDir) return;
      const body = document.querySelector('[data-role="prov-cal-body"]');
      if (!body) return;
      const before = body.scrollTop;
      const max = body.scrollHeight - body.clientHeight;
      body.scrollTop = Math.max(0, Math.min(max, before + AUTO_STEP * drag.autoDir));
      if (body.scrollTop !== before) updateDragLayout();
      drag.autoRAF = requestAnimationFrame(autoScrollTick);
    }

    function updateAutoScroll(clientY) {
      const body = document.querySelector('[data-role="prov-cal-body"]');
      if (!body) {
        stopAutoScroll();
        return;
      }
      const rect = body.getBoundingClientRect();
      let dir = 0;
      if (clientY < rect.top + AUTO_EDGE) dir = -1;
      else if (clientY > rect.bottom - AUTO_EDGE) dir = 1;
      drag.autoDir = dir;
      if (dir === 0) {
        stopAutoScroll();
        return;
      }
      if (!drag.autoRAF) drag.autoRAF = requestAnimationFrame(autoScrollTick);
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
        drag.allowMove = kind === "booking";
        drag.bookingId = el.getAttribute("data-booking-id");
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
        resetDrag();
        selectProvCalSlot(sel);
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
        resetDrag();
        if (wasMoved) renderAll();
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
  function bindProvCalDaySwipe() {
    if (bindProvCalDaySwipe.done) return;
    bindProvCalDaySwipe.done = true;

    const THRESHOLD = 56;
    const swipe = {
      active: false,
      startX: 0,
      startY: 0,
      dx: 0,
      locked: false,
      moved: false,
      gcal: null,
    };

    function canSwipe(target) {
      if (!target || !target.closest) return false;
      if (window.AppState.provCalMonthOpen) return false;
      if (document.body.classList.contains("prov-cal-dragging")) return false;
      if (document.body.classList.contains("prov-cal-pinching")) return false;
      return !!target.closest("[data-prov-cal-day-swipe]");
    }

    function resetVisual(spring) {
      const gcal = swipe.gcal || document.querySelector('[data-role="prov-cal-gcal"]');
      if (!gcal) return;
      if (spring) {
        gcal.classList.add("gcal--sliding");
        gcal.style.transition =
          "transform 0.24s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease";
        gcal.style.transform = "translate3d(0,0,0)";
        gcal.style.opacity = "1";
        window.setTimeout(function () {
          gcal.classList.remove("gcal--sliding");
          gcal.style.transition = "";
          gcal.style.transform = "";
          gcal.style.opacity = "";
        }, 260);
      } else {
        gcal.classList.remove("gcal--sliding");
        gcal.style.transition = "";
        gcal.style.transform = "";
        gcal.style.opacity = "";
      }
    }

    document.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length !== 1) return;
        if (!canSwipe(event.target)) return;
        if (event.target.closest('[data-role="prov-cal-slot"][data-kind="booking"]')) return;
        const gcal = event.target.closest("[data-prov-cal-day-swipe]");
        if (!gcal || gcal.classList.contains("gcal--sliding")) return;
        swipe.active = true;
        swipe.locked = false;
        swipe.moved = false;
        swipe.dx = 0;
        swipe.gcal = gcal;
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
          // Pionowy scroll osi czasu wygrywa, jeśli dominuje.
          if (Math.abs(dy) >= Math.abs(dx) * 0.85) {
            swipe.active = false;
            resetVisual(false);
            return;
          }
          swipe.locked = true;
        }
        swipe.moved = true;
        swipe.dx = dx;
        const gcal = swipe.gcal;
        if (!gcal) return;
        // Lekki opór poza progiem (rubber-band).
        const resisted = Math.abs(dx) > THRESHOLD ? Math.sign(dx) * (THRESHOLD + (Math.abs(dx) - THRESHOLD) * 0.35) : dx;
        gcal.style.transition = "none";
        gcal.style.transform = "translate3d(" + resisted + "px,0,0)";
        gcal.style.opacity = String(Math.max(0.55, 1 - Math.abs(resisted) / 420));
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      function () {
        if (!swipe.active) return;
        const dx = swipe.dx;
        const wasLocked = swipe.locked;
        const moved = swipe.moved;
        swipe.active = false;
        swipe.locked = false;
        swipe.moved = false;
        swipe.dx = 0;

        if (!wasLocked || Math.abs(dx) < THRESHOLD) {
          resetVisual(moved);
          return;
        }

        // Blokuj przypadkowy tap w kolumnę po swipe.
        window._provCalSwipeSuppressClick = true;
        window.setTimeout(function () {
          window._provCalSwipeSuppressClick = false;
        }, 450);

        // w lewo → następny dzień, w prawo → poprzedni (standard kalendarzy mobilnych)
        shiftProvCalDateAnimated(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );

    document.addEventListener(
      "touchcancel",
      function () {
        if (!swipe.active) return;
        swipe.active = false;
        swipe.locked = false;
        swipe.moved = false;
        resetVisual(true);
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
        if (!prov && !avail) return;
        swipe.active = true;
        swipe.locked = false;
        swipe.kind = avail ? "avail" : "prov";
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
    bindProvCalEventDrag();
    bindProvCalPinchZoom();
    bindProvCalDaySwipe();
    bindProvCalMonthSwipe();
    bindProvCalTimeLabels();
    bindAvailWeekScrollBridge();
    bindAvailDaySwipe();
    bindAvailTimePickers();
    loadState();
    renderAll();
    showPage("home");
    if (window.AppState.loggedIn && window.AppState.activeRole) {
      updateAppHeader(window.AppState.activeRole);
    }
    handleRouteHash();
    bindPwaInstallPrompt();
    registerServiceWorker();

    window.matchMedia("(min-width: 900px)").addEventListener("change", function () {
      renderAll();
    });

    window.addEventListener("resize", function () {
      syncBottomNavIndicators(null);
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
