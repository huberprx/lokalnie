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

  const WEEKDAYS = ["nd", "pon", "wt", "śr", "czw", "pt", "sob"];
  const CAL_WEEKDAYS = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];
  const MONTHS = [
    "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
    "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
  ];

  const STATUS_LABEL = {
    confirmed: "Potwierdzona",
    pending: "Oczekująca",
    proposed: "Zaproponowany termin",
    rejected: "Odrzucona",
    cancelled: "Odwołana",
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
      bookings: [],
      requests: [],
      notifications: [],
      simView: { client: "mobile", provider: "mobile" },
      loggedIn: false,
      activeRole: null,
      draft: null, // { slug, serviceIds:[], dateISO, slotId }
      searchQuery: "",
      searchCategory: "",
      searchSubcategory: "",
      searchLocation: "",
      searchUseCurrentLocation: true,
      searchRadiusKm: 15,
      searchOpenSlug: null,
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

  function formatDateLong(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function isHoliday(dateISO) {
    return (data().HOLIDAYS_2026 || []).indexOf(dateISO) !== -1;
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

  function filterProviders() {
    const q = (window.AppState.searchQuery || "").toLowerCase();
    const cat = window.AppState.searchCategory || "";
    const sub = window.AppState.searchSubcategory || "";
    return (data().PROVIDERS || []).filter((p) => {
      if (!p.visibleInSearch) return false;
      if (cat && p.category !== cat) return false;
      if (sub && p.subcategory !== sub) return false;
      if (!matchesSearchLocation(p)) return false;
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

  function defaultServiceIds(p) {
    if (p.bookingMode === "approval" || !p.services || !p.services.length) return [];
    return [p.services[0].id];
  }

  function initDraftForProvider(p) {
    window.AppState.draft = {
      slug: p.slug,
      serviceIds: defaultServiceIds(p),
      dateISO: null,
      slotId: null,
      calMonth: null,
    };
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
      services: renderServiceRows(p, draft.serviceIds || []),
      calendarGrid: renderCalendarGrid(p, activeDate, calMonth, availDates, totals),
      svcNames: draftServices(p).map((s) => s.name).join(", "),
      canConfirm: !!draft.slotId,
    };
  }

  function renderSelectionSummaryBar(p, ctx, mode) {
    const totals = ctx.totals;
    if (!totals.count && mode === "approval") return "";

    if (mode === "approval") {
      return `
        <div class="selection-summary selection-summary--inline">
          <div class="selection-summary__info">
            <span class="selection-summary__duration">${escapeHtml(formatDuration(totals.duration))}</span>
            <span class="selection-summary__price">${totals.hasNullPrice ? "wycena indyw." : escapeHtml(totals.price + " zł")}</span>
          </div>
          <button type="button" class="btn btn--primary selection-summary__cta" data-action="send-request" data-slug="${escapeHtml(p.slug)}">Wyślij prośbę o termin</button>
        </div>`;
    }

    return `
      <div class="selection-summary selection-summary--inline selection-summary--info">
        <div class="selection-summary__info">
          <span class="selection-summary__duration">${escapeHtml(formatDuration(totals.duration))}</span>
          <span class="selection-summary__price">${totals.hasNullPrice ? "wycena indyw." : escapeHtml(totals.price + " zł")}</span>
        </div>
      </div>`;
  }

  function renderBookingLayoutBlock(p, ctx) {
    const totals = ctx.totals;
    return `
      <div class="booking-layout">
        <aside class="booking__services">
          <div class="booking__services-head">
            <button type="button" class="topbar__back" data-action="close-provider" aria-label="Zwiń">‹</button>
            <div class="booking__services-info">
              <span class="booking__prov">${escapeHtml(p.name)}</span>
              <span class="booking__cat">${escapeHtml(providerCategoryLine(p))}</span>
            </div>
          </div>
          <h3 class="booking__panel-label">Usługi</h3>
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

    if (p.bookingMode === "approval") {
      return `
        <div class="provider-booking-panel provider-booking-panel--approval">
          <p class="profile__mode">Rezerwacja na akceptację — usługodawca zaproponuje termin.</p>
          <div class="provider-booking-panel__services service-list">${ctx.services}</div>
          ${renderSelectionSummaryBar(p, ctx, "approval")}
        </div>`;
    }

    return `
      <div class="provider-booking-panel">
        ${renderBookingLayoutBlock(p, ctx)}
        ${ctx.totals.count ? renderSelectionSummaryBar(p, ctx, "auto") : ""}
      </div>`;
  }

  function renderProviderCard(p, isOpen) {
    const fav = window.AppState.favorites.indexOf(p.slug) !== -1;
    const dist = p.address ? `${p.distanceKm.toFixed(1)} km` : "Online";
    return `
      <button type="button" class="provider-card${isOpen ? " provider-card--open" : ""}" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">
        <span class="provider-card__avatar">${escapeHtml(p.avatarInitials)}</span>
        <span class="provider-card__body">
          <span class="provider-card__name">${escapeHtml(p.name)}</span>
          <span class="provider-card__cat">${escapeHtml(providerCategoryLine(p))}</span>
          <span class="provider-card__distance">${escapeHtml(dist)}${p.bookingMode === "approval" ? " · na akceptację" : ""}</span>
        </span>
        <span class="provider-card__fav${fav ? " provider-card__fav--on" : ""}" aria-hidden="true">♥</span>
      </button>`;
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
      };
    } else {
      window.AppState = base;
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
  function bottomNav(active) {
    const items = [
      { tab: "favorites", label: "Ulubione", icon: "♥" },
      { tab: "search", label: "Szukaj", icon: "⌕" },
      { tab: "myCalendar", label: "Mój kalendarz", icon: "▦" },
    ];
    return `
      <nav class="bottom-nav" aria-label="Menu klienta">
        ${items
          .map(
            (it) => `
          <button type="button" class="bottom-nav__item${active === it.tab ? " bottom-nav__item--active" : ""}"
            data-action="go-screen" data-screen="${it.tab}" ${active === it.tab ? 'aria-current="page"' : ""}>
            <span class="bottom-nav__icon" aria-hidden="true">${it.icon}</span>
            <span class="bottom-nav__label">${it.label}</span>
          </button>`
          )
          .join("")}
      </nav>`;
  }

  function renderSearch() {
    const cat = window.AppState.searchCategory || "";
    const sub = window.AppState.searchSubcategory || "";
    const providers = filterProviders();
    const openSlug = window.AppState.searchOpenSlug;

    const chips = (data().CATEGORIES || [])
      .map(
        (c) => `
        <button type="button" class="category-chip${cat === c.id ? " category-chip--active" : ""}"
          data-action="filter-category" data-category="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`
      )
      .join("");

    const mainChipsHtml = `
            <button type="button" class="category-chip${cat === "" ? " category-chip--active" : ""}"
              data-action="filter-category" data-category="">Wszystkie</button>
            ${chips}`;

    const subs = subcategoriesFor(cat);
    const subChips = subs.length
      ? `
          <div class="filter-scroll filter-scroll--sub" data-filter-scroll>
            <div class="filter-scroll__track subcategory-chips">
              <button type="button" class="subcategory-chip${sub === "" ? " subcategory-chip--active" : ""}"
                data-action="filter-subcategory" data-subcategory="">Wszystkie</button>
              ${subs
                .map(
                  (s) => `
              <button type="button" class="subcategory-chip${sub === s.id ? " subcategory-chip--active" : ""}"
                data-action="filter-subcategory" data-subcategory="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`
                )
                .join("")}
            </div>
          </div>`
      : "";

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <div class="search-wrap">
            ${renderSearchDesktopBar()}
            ${renderSearchMobileBar()}
          </div>
          <div class="filter-scroll filter-scroll--main" data-filter-scroll>
            <div class="filter-scroll__track category-chips">${mainChipsHtml}</div>
          </div>
          ${subChips}
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

  function renderMyCalendar() {
    const list = (window.AppState.bookings || [])
      .filter((b) => b.side === "client")
      .slice()
      .sort((a, b) => (a.dateISO + a.from).localeCompare(b.dateISO + b.from));

    return `
      <div class="app-screen app-screen--client">
        <div class="app-scroll">
          <header class="screen-head">
            <h2 class="screen-head__title">Mój kalendarz</h2>
            <p class="screen-head__sub">Twoje rezerwacje i prośby.</p>
          </header>
          <div class="visit-list">
            ${
              list.length
                ? list.map(renderClientVisitCard).join("")
                : `<p class="empty-note">Brak rezerwacji. Zarezerwuj usługę w zakładce „Szukaj”.</p>`
            }
          </div>
        </div>
        ${bottomNav("myCalendar")}
      </div>`;
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
    return (p.services || [])
      .map((s) => {
        const on = selectedIds.indexOf(s.id) !== -1;
        return `
        <button type="button" class="service-row${on ? " service-row--selected" : ""}"
          data-action="toggle-service" data-service-id="${escapeHtml(s.id)}" aria-pressed="${on ? "true" : "false"}">
          <span class="service-row__check" aria-hidden="true">${on ? "✓" : ""}</span>
          <span class="service-row__body">
            <span class="service-row__name">${escapeHtml(s.name)}</span>
            <span class="service-row__sub">${escapeHtml(s.subtitle)}</span>
          </span>
          <span class="service-row__meta">
            <span class="service-row__dur">${escapeHtml(formatDuration(s.durationMin))}</span>
            <span class="service-row__price">${escapeHtml(formatPrice(s.price))}</span>
          </span>
        </button>`;
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

    let cells = "";
    for (let i = 0; i < startPad; i++) {
      cells += `<span class="cal__day cal__day--pad" aria-hidden="true"></span>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${pad(month)}-${pad(day)}`;
      const available = availSet.has(dateISO);
      const selected = dateISO === activeDate;
      const hol = isHoliday(dateISO);
      cells += `
        <button type="button"
          class="cal__day${selected ? " cal__day--selected" : ""}${hol ? " cal__day--holiday" : ""}${available ? " cal__day--available" : " cal__day--disabled"}"
          data-action="${available ? "pick-date" : ""}" data-date="${escapeHtml(dateISO)}" ${available ? "" : "disabled"}>
          ${day}
        </button>`;
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
        ${totals.duration ? `<p class="cal__hint">${escapeHtml(formatDuration(totals.duration))} · ${totals.hasNullPrice ? "wycena indyw." : escapeHtml(totals.price + " zł")}</p>` : ""}
      </div>`;
  }

  function renderTimeSlots(slots, draft) {
    return slots
      .map(function (s) {
        return `
        <div class="time-row">
          <span class="time-row__range">${escapeHtml(s.from)}→${escapeHtml(s.to)}</span>
          <span class="time-row__place">${escapeHtml(s.locationLabel || "—")}</span>
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
            <button type="button" class="topbar__back" data-action="go-screen" data-screen="search" aria-label="Wróć">‹</button>
            <span class="topbar__title">Profil</span>
            <button type="button" class="fav-btn${fav ? " fav-btn--on" : ""}" data-action="toggle-fav" data-slug="${escapeHtml(p.slug)}"
              aria-pressed="${fav ? "true" : "false"}" aria-label="Dodaj do ulubionych">♥</button>
          </div>

          <div class="profile">
            <div class="profile__header">
              <span class="profile__avatar">${escapeHtml(p.avatarInitials)}</span>
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
        ${bottomNav("search")}
      </div>`;
  }

  function renderBooking(slug) {
    const p = getProviderBySlug(slug);
    if (!p) return renderSearch();

    const ctx = buildBookingContext(p);
    if (!ctx) return renderSearch();

    const dateStrip = ctx.availDates
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T00:00:00");
        const on = dateISO === ctx.activeDate;
        const hol = isHoliday(dateISO);
        return `
        <button type="button" class="date-chip${on ? " date-chip--active" : ""}${hol ? " date-chip--holiday" : ""}"
          data-action="pick-date" data-date="${escapeHtml(dateISO)}">
          <span class="date-chip__dow">${WEEKDAYS[dt.getDay()]}</span>
          <span class="date-chip__day">${dt.getDate()}</span>
        </button>`;
      })
      .join("");

    return `
      <div class="app-screen app-screen--client app-screen--booking">
        <div class="booking-mobile app-scroll">
          <div class="topbar">
            <button type="button" class="topbar__back" data-action="close-provider" aria-label="Wróć">‹</button>
            <span class="topbar__title">Rezerwacja</span>
            <span class="topbar__spacer"></span>
          </div>

          <div class="booking">
            <div class="booking__header">
              <span class="booking__prov">${escapeHtml(p.name)}</span>
              <span class="booking__svc">${escapeHtml(ctx.svcNames)}</span>
              <span class="booking__meta">${escapeHtml(formatDuration(ctx.totals.duration))} · ${ctx.totals.hasNullPrice ? "wycena indyw." : escapeHtml(ctx.totals.price + " zł")}</span>
            </div>

            <h3 class="booking__label">Wybierz dzień</h3>
            <div class="date-strip">${dateStrip || `<p class="empty-note">Brak dostępnych terminów.</p>`}</div>

            ${ctx.activeDate ? `<h3 class="booking__label">Wybierz godzinę · ${escapeHtml(formatDateLong(ctx.activeDate))}</h3>
            <div class="time-list">${ctx.timeList || `<p class="empty-note">Brak wolnych godzin tego dnia.</p>`}</div>` : ""}
          </div>
        </div>

        ${renderBookingLayoutBlock(p, ctx)}

        ${renderSelectionSummaryBar(p, ctx, "auto")}
        ${bottomNav("search")}
      </div>`;
  }

  function renderClient(screen) {
    switch (screen) {
      case "favorites":
        return renderFavorites();
      case "myCalendar":
        return renderMyCalendar();
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
  function providerTabs(active) {
    const tabs = [
      { tab: "dashboard", label: "Pulpit" },
      { tab: "requests", label: "Prośby" },
      { tab: "services", label: "Usługi" },
      { tab: "availability", label: "Dostępność" },
      { tab: "settings", label: "Ustawienia" },
    ];
    return `
      <nav class="provider-tabs" aria-label="Menu usługodawcy">
        ${tabs
          .map(
            (t) => `
          <button type="button" class="provider-tabs__item${active === t.tab ? " provider-tabs__item--active" : ""}"
            data-action="provider-tab" data-tab="${t.tab}" ${active === t.tab ? 'aria-current="page"' : ""}>${t.label}</button>`
          )
          .join("")}
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
        ${providerTabs("dashboard")}
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
      </div>`;
  }

  function renderProviderVisitCard(b) {
    return `
      <div class="visit-card" data-booking-id="${escapeHtml(b.id)}">
        <div class="visit-card__top">
          <span class="visit-card__name">${escapeHtml(b.clientName || "Klient")}</span>
          <span class="status-badge" data-status="${escapeHtml(b.status)}">${escapeHtml(STATUS_LABEL[b.status] || b.status)}</span>
        </div>
        <div class="visit-card__svc">${escapeHtml(b.serviceNames.join(", "))}</div>
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

  function renderRequests() {
    const reqs = (window.AppState.requests || []).filter((r) => r.providerId === MY_PROVIDER_ID && r.status === "pending");
    return `
      <div class="app-screen app-screen--provider">
        ${providerTabs("requests")}
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
        return `<button type="button" class="date-chip${on ? " date-chip--active" : ""}" data-action="propose-date" data-request-id="${escapeHtml(req.id)}" data-date="${escapeHtml(d.dateISO)}">
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
        ${providerTabs("requests")}
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
      </div>`;
  }

  function renderServices() {
    const p = myProvider();
    const list = (p ? p.services : [])
      .map(
        (s) => `
      <div class="service-row service-row--static">
        <span class="service-row__body">
          <span class="service-row__name">${escapeHtml(s.name)}</span>
          <span class="service-row__sub">${escapeHtml(s.subtitle)}</span>
        </span>
        <span class="service-row__meta">
          <span class="service-row__dur">${escapeHtml(formatDuration(s.durationMin))}</span>
          <span class="service-row__price">${escapeHtml(formatPrice(s.price))}</span>
        </span>
      </div>`
      )
      .join("");
    return `
      <div class="app-screen app-screen--provider">
        ${providerTabs("services")}
        <div class="app-scroll">
          <header class="screen-head"><h2 class="screen-head__title">Usługi</h2><p class="screen-head__sub">Oferta widoczna dla klientów.</p></header>
          <div class="service-list">${list}</div>
        </div>
      </div>`;
  }

  function renderAvailability() {
    const p = myProvider();
    const days = (p ? p.availability : []).slice(0, 10);
    const list = days
      .map((d) => {
        const dt = new Date(d.dateISO + "T00:00:00");
        const hol = isHoliday(d.dateISO);
        const blocks = d.blocks
          .map((b) => `<span class="avail-block">${escapeHtml(b.from)}–${escapeHtml(b.to)} · ${escapeHtml(locationLabel(p, b.locationId))}${b.recurring ? " ↻" : ""}</span>`)
          .join("");
        return `
        <div class="avail-day${hol ? " avail-day--holiday" : ""}">
          <div class="avail-day__head">
            <span class="avail-day__date">${WEEKDAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]}</span>
            ${hol ? `<span class="avail-day__holiday">święto</span>` : ""}
          </div>
          <div class="avail-day__blocks">${blocks}</div>
        </div>`;
      })
      .join("");
    return `
      <div class="app-screen app-screen--provider">
        ${providerTabs("availability")}
        <div class="app-scroll">
          <header class="screen-head"><h2 class="screen-head__title">Dostępność</h2><p class="screen-head__sub">Godziny pracy na najbliższe dni.</p></header>
          <div class="avail-list">${list || `<p class="empty-note">Brak zdefiniowanej dostępności.</p>`}</div>
        </div>
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
        ${providerTabs("settings")}
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
    INSTANCES.forEach(render);
    renderFullscreen();
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
    if (screen !== "search" && screen !== "favorites") {
      window.AppState.searchOpenSlug = null;
    }
    window.AppState.screen.client = screen;
    saveState();
    renderAll();
  }

  function clientUsesDesktopBookingLayout() {
    const pageApp = document.getElementById("page-app");
    if (pageApp && !pageApp.hidden) {
      return window.matchMedia("(min-width: 900px)").matches;
    }
    return !!(window.AppState.simView && window.AppState.simView.client === "desktop");
  }

  function closeProvider() {
    window.AppState.searchOpenSlug = null;
    window.AppState.draft = null;
    if (window.AppState.screen.client === "booking" || window.AppState.screen.client === "profile") {
      window.AppState.screen.client = "search";
    }
    saveState();
    renderAll();
  }

  function openProvider(slug) {
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
    } else if (p.bookingMode === "approval") {
      window.AppState.searchOpenSlug = null;
      window.AppState.screen.client = "profile";
    } else {
      window.AppState.searchOpenSlug = null;
      window.AppState.screen.client = "booking";
    }

    saveState();
    renderAll();
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

  function toggleService(serviceId) {
    const draft = window.AppState.draft;
    if (!draft) return;
    const p = getProviderBySlug(draft.slug);
    if (!p) return;

    const ids = draft.serviceIds || [];
    const idx = ids.indexOf(serviceId);

    if (!p.multiSelect) {
      draft.serviceIds = idx === -1 ? [serviceId] : [];
    } else {
      if (idx === -1) ids.push(serviceId);
      else ids.splice(idx, 1);
      draft.serviceIds = ids;
    }
    draft.slotId = null;
    if (!draft.serviceIds.length) {
      window.AppState.searchOpenSlug = null;
    }
    saveState();
    renderAll();
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
    renderAll();
  }

  function shiftCalMonth(delta) {
    const draft = window.AppState.draft;
    if (!draft) return;
    const ref = draft.calMonth || (draft.dateISO || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const parts = ref.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    draft.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    saveState();
    renderAll();
  }

  function pickSlot(slotId) {
    if (!window.AppState.draft) return;
    window.AppState.draft.slotId = slotId;
    saveState();
    renderAll();
  }

  function bookSlot(slotId) {
    if (!window.AppState.draft) return;
    window.AppState.draft.slotId = slotId;
    confirmBooking();
  }

  function confirmBooking() {
    const draft = window.AppState.draft;
    if (!draft || !draft.slotId) return;
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
    window.AppState.screen.client = "myCalendar";
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
    showPage("home");
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

  function updateAppHeader(activeRole) {
    const user = data().CURRENT_USER;
    const userEl = document.getElementById("app-header-user");
    if (userEl && user) userEl.textContent = user.name || "";

    const hasProviderRole = user && user.providerRole && user.providerRole.active;
    const roleSwitch = document.getElementById("app-role-switch");
    if (roleSwitch) roleSwitch.hidden = !hasProviderRole;

    if (hasProviderRole && roleSwitch) {
      roleSwitch.querySelectorAll(".app-role-btn").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.role === activeRole ? "true" : "false");
      });
    }
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
    showPage("home");
  }

  function switchRole(role) {
    if (INSTANCES.indexOf(role) === -1) return;
    window.AppState.activeRole = role;
    saveState();
    updateAppHeader(role);
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
    testLogin: testLogin,
    logout: logout,
    switchRole: switchRole,
    showPage: showPage,
    computeSlots: computeSlots,
  };

  // ─────────────────────────────────────────────────────────
  // Delegacja zdarzeń
  // ─────────────────────────────────────────────────────────
  document.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    const d = btn.dataset;

    switch (a) {
      case "reset-demo": resetDemo(); break;
      case "test-login": event.preventDefault(); testLogin(d.target); break;
      case "logout": logout(); break;
      case "go-home": event.preventDefault(); logout(); break;
      case "switch-role": switchRole(d.role); break;

      case "go-screen": goScreen(d.screen); break;
      case "open-provider": openProvider(d.slug); break;
      case "open-profile": openProvider(d.slug); break;
      case "close-provider": closeProvider(); break;
      case "toggle-fav": toggleFav(d.slug); break;
      case "toggle-service": toggleService(d.serviceId); break;
      case "start-booking": startBooking(d.slug); break;
      case "send-request": sendRequest(d.slug); break;
      case "pick-date": pickDate(d.date); break;
      case "pick-slot": pickSlot(d.slot); break;
      case "book-slot": bookSlot(d.slot); break;
      case "cal-prev": shiftCalMonth(-1); break;
      case "cal-next": shiftCalMonth(1); break;
      case "confirm-booking": confirmBooking(); break;
      case "accept-proposal": acceptProposal(d.bookingId); break;
      case "reject-proposal": rejectProposal(d.bookingId); break;

      case "provider-tab": navigate("provider", d.tab, {}); break;
      case "propose-open": proposeOpen(d.requestId); break;
      case "propose-date": proposeDate(d.requestId, d.date); break;
      case "propose-slot": proposeSlot(d.requestId, d.slot, d.date); break;
      case "propose-confirm": proposeConfirm(d.requestId); break;
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
    }
  });

  document.addEventListener("change", function (event) {
    const radiusSel = event.target.closest('[data-role="search-radius"]');
    if (!radiusSel) return;
    window.AppState.searchRadiusKm = Number(radiusSel.value) || 15;
    saveState();
    updateProviderLists();
  });

  document.addEventListener("DOMContentLoaded", function () {
    bindFilterScroll();
    loadState();
    renderAll();
    if (window.AppState.loggedIn && window.AppState.activeRole) {
      updateAppHeader(window.AppState.activeRole);
      showPage("app");
    }
  });
})();
