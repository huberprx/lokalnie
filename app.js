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
      myCalMonth: null,
      myCalDate: null,
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

  function renderDateStripHtml(availDates, activeDate) {
    if (!availDates.length) return `<p class="empty-note">Brak dostępnych terminów.</p>`;
    return availDates
      .map(function (dateISO) {
        const dt = new Date(dateISO + "T00:00:00");
        const on = dateISO === activeDate;
        const hol = isHoliday(dateISO);
        return `
        <button type="button" class="date-chip${on ? " date-chip--active" : ""}${hol ? " date-chip--holiday" : ""}"
          data-action="pick-date" data-date="${escapeHtml(dateISO)}">
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

    const nav = screen.querySelector(".bottom-nav");
    if (nav) {
      if (nav.classList.contains("bottom-nav--booking-dual")) {
        updateBookingBottomNav(nav, ctx.draft);
      } else {
        nav.outerHTML = bookingBottomNav(ctx.draft);
        if (!(ctx.draft && ctx.draft.serviceIds && ctx.draft.serviceIds.length)) {
          syncBottomNavIndicators(null);
        }
      }
    }
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
    const metaParts = [dist];
    if (hours) metaParts.push(hours);
    if (p.bookingMode === "approval") metaParts.push("na akceptację");
    const metaLine = metaParts.join(" · ");

    const nameHtml = opts.staticMain
      ? `<span class="provider-card__name">${escapeHtml(p.name)}</span>`
      : `<button type="button" class="provider-card__name" data-slug="${escapeHtml(p.slug)}" data-action="open-provider">${escapeHtml(p.name)}</button>`;

    const detailsInner = `
            ${opts.bookingHeader ? "" : `<span class="provider-card__cat">${escapeHtml(providerCategoryLine(p))}</span>`}
            <span class="provider-card__meta">${escapeHtml(metaLine)}</span>
            ${p.address ? `<span class="provider-card__addr">${escapeHtml(p.address)}</span>` : ""}`;

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
        myCalMonth: typeof stored.myCalMonth === "string" ? stored.myCalMonth : base.myCalMonth,
        myCalDate: typeof stored.myCalDate === "string" ? stored.myCalDate : base.myCalDate,
        appMenuOpen: !!stored.appMenuOpen,
        clientAvatarUrl: typeof stored.clientAvatarUrl === "string" ? stored.clientAvatarUrl : base.clientAvatarUrl,
      };
    } else {
      window.AppState = base;
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
    const open = !!window.AppState.appMenuOpen;
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

    return `
      <div class="app-menu${open ? " app-menu--open" : ""}" aria-hidden="${open ? "false" : "true"}">
        <button type="button" class="app-menu__backdrop" data-action="close-app-menu" tabindex="${open ? "0" : "-1"}" aria-label="Zamknij menu"></button>
        <aside class="app-menu__panel" id="app-menu-panel" role="dialog" aria-modal="true" aria-label="Menu konta">
          <div class="app-menu__head">
            <h2 class="app-menu__title">Profile</h2>
            <button type="button" class="app-menu__close" data-action="close-app-menu" aria-label="Zamknij">
              <span class="app-menu__close-icon" aria-hidden="true"></span>
            </button>
          </div>

          <div class="app-menu__profiles" role="group" aria-label="Przełącz profil">
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
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="privacy">Polityka prywatności</button>
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="terms">Regulamin</button>
            <button type="button" class="app-menu__link" data-action="open-legal" data-doc="contact">Kontakt</button>
          </nav>

          <div class="app-menu__footer">
            <button type="button" class="app-menu__link app-menu__link--logout" data-action="logout">Wyloguj</button>
          </div>
        </aside>
      </div>`;
  }

  function openAppMenu() {
    window.AppState.appMenuOpen = true;
    saveState();
    renderAll();
  }

  function closeAppMenu() {
    if (!window.AppState.appMenuOpen) return;
    window.AppState.appMenuOpen = false;
    saveState();
    renderAll();
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

  function syncAppMenus() {
    document.querySelectorAll(".app-screen--client, .app-screen--provider").forEach(function (screen) {
      const existing = screen.querySelector(":scope > .app-menu");
      const html = renderAppMenu();
      if (existing) existing.outerHTML = html;
      else screen.insertAdjacentHTML("beforeend", html);
    });
  }

  function renderBookingConfirmSummary(p, totals, draft) {
    if (!p || !totals || !totals.count) return "";
    const priceText = totals.hasNullPrice ? "wycena indyw." : formatPrice(totals.price);
    return `
      <div class="bottom-nav__summary">
        <span class="bottom-nav__summary-label">Suma:</span>
        <div class="bottom-nav__summary-meta">
          <span class="bottom-nav__summary-dur">${escapeHtml(formatDuration(totals.duration))}</span>
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
      enabled: !!(draft && draft.slotId),
      slugAttr: "",
    };
  }

  function renderBookingConfirmLayer(draft) {
    const p = draft && draft.slug ? getProviderBySlug(draft.slug) : null;
    const totals = p ? draftTotals(p) : { count: 0 };
    const cta = bookingConfirmCTA(p, draft, totals);
    return `
          ${renderBookingConfirmSummary(p, totals, draft)}
          <button type="button" class="bottom-nav__book" data-action="${cta.action}"${cta.slugAttr}${cta.enabled ? "" : " disabled"}>${cta.label}</button>
          <button type="button" class="bottom-nav__clear" data-action="cancel-booking-selection" aria-label="Anuluj wybór usług">
            <span class="bottom-nav__icon bottom-nav__icon--close" aria-hidden="true"></span>
          </button>`;
  }

  function updateBookingBottomNav(nav, draft) {
    if (!nav) return;
    const hasServices = !!(draft && draft.serviceIds && draft.serviceIds.length);
    const hasSlot = !!(draft && draft.slotId);
    const p = draft && draft.slug ? getProviderBySlug(draft.slug) : null;
    const totals = p ? draftTotals(p) : null;
    nav.classList.toggle("bottom-nav--confirm-visible", hasServices);
    nav.setAttribute("aria-label", hasServices ? "Potwierdź rezerwację" : "Menu klienta");

    const menuLayer = nav.querySelector(".bottom-nav__layer--menu");
    const confirmLayer = nav.querySelector(".bottom-nav__layer--confirm");
    if (menuLayer) menuLayer.setAttribute("aria-hidden", hasServices ? "true" : "false");
    if (confirmLayer) confirmLayer.setAttribute("aria-hidden", hasServices ? "false" : "true");

    if (confirmLayer && hasServices && p && totals) {
      const summary = confirmLayer.querySelector(".bottom-nav__summary");
      if (summary) {
        const durEl = summary.querySelector(".bottom-nav__summary-dur");
        const priceEl = summary.querySelector(".bottom-nav__summary-price");
        if (durEl) durEl.textContent = formatDuration(totals.duration);
        if (priceEl) priceEl.textContent = totals.hasNullPrice ? "wycena indyw." : formatPrice(totals.price);
      } else {
        const bookBtn = confirmLayer.querySelector(".bottom-nav__book");
        if (bookBtn) bookBtn.insertAdjacentHTML("beforebegin", renderBookingConfirmSummary(p, totals, draft));
      }
    } else if (confirmLayer) {
      const summary = confirmLayer.querySelector(".bottom-nav__summary");
      if (summary) summary.remove();
    }

    const bookBtn = nav.querySelector(".bottom-nav__book");
    if (bookBtn && p && totals) {
      const cta = bookingConfirmCTA(p, draft, totals);
      bookBtn.setAttribute("data-action", cta.action);
      if (cta.slugAttr) {
        const slugMatch = cta.slugAttr.match(/data-slug="([^"]+)"/);
        if (slugMatch) bookBtn.setAttribute("data-slug", slugMatch[1]);
        else bookBtn.removeAttribute("data-slug");
      } else {
        bookBtn.removeAttribute("data-slug");
      }
      bookBtn.textContent = cta.label;
      if (cta.enabled) bookBtn.removeAttribute("disabled");
      else bookBtn.setAttribute("disabled", "");
    } else if (bookBtn) {
      if (hasSlot) bookBtn.removeAttribute("disabled");
      else bookBtn.setAttribute("disabled", "");
    }

    if (!hasServices) syncBottomNavIndicators(null);
  }

  function bookingBottomNav(draft) {
    const hasServices = !!(draft && draft.serviceIds && draft.serviceIds.length);
    return `
      <nav class="bottom-nav bottom-nav--booking bottom-nav--booking-dual bottom-nav--with-back${hasServices ? " bottom-nav--confirm-visible" : ""}" aria-label="${hasServices ? "Potwierdź rezerwację" : "Menu klienta"}">
        <div class="bottom-nav__layer bottom-nav__layer--menu"${hasServices ? ' aria-hidden="true"' : ""}>
          ${renderBottomNavMenuLayer("search", { backOnSearch: true })}
        </div>
        <div class="bottom-nav__layer bottom-nav__layer--confirm"${hasServices ? "" : ' aria-hidden="true"'}>
          ${hasServices ? renderBookingConfirmLayer(draft) : renderBookingConfirmLayer({ slotId: null })}
        </div>
      </nav>`;
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

      const prevIndex = prevTab
        ? items.findIndex(function (item) {
            return item.getAttribute("data-screen") === prevTab;
          })
        : activeIndex;

      const indicatorSize = 44;

      function indicatorLeft(item) {
        indicator.style.width = indicatorSize + "px";
        indicator.style.height = indicatorSize + "px";
        return item.offsetLeft + (item.offsetWidth - indicatorSize) / 2;
      }

      const fromItem = items[prevIndex >= 0 ? prevIndex : activeIndex];
      const toItem = items[activeIndex];
      const fromLeft = indicatorLeft(fromItem);
      const toLeft = indicatorLeft(toItem);
      const shouldAnimate = prevTab && prevIndex >= 0 && prevIndex !== activeIndex;

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
          <div class="filters-wrap">
            <div class="category-filter-row">
              <div class="filter-scroll filter-scroll--main" data-filter-scroll>
                <div class="filter-scroll__track category-chips">${mainChipsHtml}</div>
              </div>
              <button type="button" class="filter-toggle" aria-label="Filtry">
                <span class="filter-toggle__label">Filtry</span>
                <span class="filter-toggle__icon" aria-hidden="true"></span>
              </button>
            </div>
            ${subChips}
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
      const hol = isHoliday(dateISO);
      cells += `
        <button type="button"
          class="cal__day cal__day--selectable${hasVisit ? " cal__day--visit" : ""}${selected ? " cal__day--selected" : ""}${isToday && !selected ? " cal__day--today" : ""}${hol ? " cal__day--holiday" : ""}"
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
      const hol = isHoliday(dateISO);
      cells += `
        <button type="button"
          class="cal__day${selected ? " cal__day--selected" : ""}${hol ? " cal__day--holiday" : ""}${available ? " cal__day--available" : " cal__day--disabled"}"
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
              <h3 class="booking__label booking__label--caps">Dzień</h3>
              <div class="date-strip">${renderDateStripHtml(ctx.availDates, ctx.activeDate)}</div>

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
      { tab: "requests", label: "Prośby", icon: "requests" },
      { tab: "services", label: "Usługi", icon: "services" },
      { tab: "availability", label: "Dostępność", icon: "calendar" },
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
        <div class="app-scroll">
          <header class="screen-head"><h2 class="screen-head__title">Dostępność</h2><p class="screen-head__sub">Godziny pracy na najbliższe dni.</p></header>
          <div class="avail-list">${list || `<p class="empty-note">Brak zdefiniowanej dostępności.</p>`}</div>
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
    syncBottomNavIndicators(prevBottomNavTab);
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
    const keepMenu = !!window.AppState.appMenuOpen;
    window.AppState.appMenuOpen = keepMenu;
    window.AppState.activeRole = role;
    saveState();
    updateAppHeader(role);
    renderAll();
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
      const preview = document.getElementById("avatar-preview");
      if (preview && !preview.hidden) {
        event.preventDefault();
        closeAvatarPreview();
        return;
      }
      if (window.AppState.appMenuOpen) {
        event.preventDefault();
        closeAppMenu();
      }
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
      case "confirm-booking": confirmBooking(); break;
      case "accept-proposal": acceptProposal(d.bookingId); break;
      case "reject-proposal": rejectProposal(d.bookingId); break;

      case "provider-tab": navigate("provider", d.tab, {}); break;
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
    showPage("home");
    if (window.AppState.loggedIn && window.AppState.activeRole) {
      updateAppHeader(window.AppState.activeRole);
    }
    handleRouteHash();

    window.matchMedia("(min-width: 900px)").addEventListener("change", function () {
      renderAll();
    });

    window.addEventListener("resize", function () {
      syncBottomNavIndicators(null);
    });
  });

  window.addEventListener("hashchange", handleRouteHash);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeProviderCardMenu();
  });

  window.addEventListener("resize", closeProviderCardMenu);
  window.addEventListener("scroll", closeProviderCardMenu, true);
})();
