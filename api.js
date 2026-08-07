// api.js — klient API Lokalnie (sesja OAuth; lokalny demo auth tylko w trybie testera).
// Wystawia: window.LokalnieApi
(function () {
  "use strict";

  const BASE = "https://api.lokalnie.app";
  const TOKEN_KEY = "lokalnie.authToken";
  const TESTER_KEY = "lokalnie.testerMode";
  const REQUEST_TIMEOUT_MS = 10000;
  const MAX_GET_RETRIES = 1;
  const DEMO_HEADER = { "X-Demo-User": "demo" };
  const IDEMPOTENCY_SESSION_KEY = "lokalnie.pendingIdempotency";
  const LEGACY_IDEMPOTENCY_PREFIX = "lokalnie.idempotency.";
  let unauthorizedHookRunning = false;
  let pendingIdempotencyKeys = loadPendingIdempotencyKeys();

  function loadPendingIdempotencyKeys() {
    try {
      const value = JSON.parse(sessionStorage.getItem(IDEMPOTENCY_SESSION_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (err) {
      return {};
    }
  }

  function persistPendingIdempotencyKeys() {
    try {
      const keys = Object.keys(pendingIdempotencyKeys);
      if (keys.length) {
        sessionStorage.setItem(IDEMPOTENCY_SESSION_KEY, JSON.stringify(pendingIdempotencyKeys));
      } else {
        sessionStorage.removeItem(IDEMPOTENCY_SESSION_KEY);
      }
    } catch (err) {
      /* pamięć procesu nadal zapewnia współdzielenie klucza */
    }
  }

  function clearLegacyIdempotencyKeys() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && key.indexOf(LEGACY_IDEMPOTENCY_PREFIX) === 0) {
          localStorage.removeItem(key);
        }
      }
    } catch (err) {
      /* ignore */
    }
  }

  clearLegacyIdempotencyKeys();

  function isProductionHostname(hostname) {
    const host = String(hostname == null ? window.location.hostname : hostname)
      .toLowerCase()
      .replace(/\.$/, "");
    return host === "lokalnie.app" || host.endsWith(".lokalnie.app");
  }

  /** Lokalny podgląd testera — świadomy opt-in; nigdy na produkcji. */
  function isTesterMode() {
    if (isProductionHostname()) return false;
    try {
      return localStorage.getItem(TESTER_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function getAuthToken() {
    if (isProductionHostname()) return "";
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function setAuthToken(token) {
    if (isProductionHostname()) return;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function clearAuthToken() {
    setAuthToken("");
  }

  function authHeaders() {
    const token = getAuthToken();
    if (token) return { Authorization: "Bearer " + token };
    // Demo auth tylko po „Kontynuuj jako tester” — lokalnie domyślnie jak produkcja (gość / Google).
    if (isTesterMode()) return Object.assign({}, DEMO_HEADER);
    return {};
  }

  function newIdempotencyKey(action) {
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    return "lokalnie-" + action + "-" + random;
  }

  function idempotencyOperationId(action, identity) {
    return String(action || "mutation") + "." + String(identity || "unknown");
  }

  function idempotencyKey(action, identity) {
    const operationId = idempotencyOperationId(action, identity);
    let value = pendingIdempotencyKeys[operationId] || "";
    if (!value) {
      value = newIdempotencyKey(action);
      pendingIdempotencyKeys[operationId] = value;
      persistPendingIdempotencyKeys();
    }
    return value;
  }

  function releaseIdempotencyKey(action, identity) {
    const operationId = idempotencyOperationId(action, identity);
    if (!pendingIdempotencyKeys[operationId]) return;
    delete pendingIdempotencyKeys[operationId];
    persistPendingIdempotencyKeys();
  }

  async function idempotentRequest(action, identity, path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {}, {
      "Idempotency-Key": idempotencyKey(action, identity),
    });
    const result = await request(path, Object.assign({}, opts, { headers: headers }));
    releaseIdempotencyKey(action, identity);
    return result;
  }

  function notifyUnauthorized() {
    if (unauthorizedHookRunning) return;
    unauthorizedHookRunning = true;
    try {
      if (window.App && typeof window.App.onApiUnauthorized === "function") {
        window.App.onApiUnauthorized();
      }
    } catch (err) {
      console.warn("[LokalnieApi] unauthorized hook failed", err);
    } finally {
      window.setTimeout(function () {
        unauthorizedHookRunning = false;
      }, 0);
    }
  }

  function googleLoginUrl(returnTo) {
    const u = new URL(BASE + "/auth/google");
    u.searchParams.set("return_to", returnTo || window.location.origin + window.location.pathname);
    return u.toString();
  }

  function googleCalendarConnectUrl(returnTo) {
    const u = new URL(BASE + "/calendar/google/connect");
    u.searchParams.set("return_to", returnTo || window.location.origin + window.location.pathname);
    return u.toString();
  }

  /**
   * Mostek demo: lokalny slug mocka ↔ ID w D1 (seed).
   * Pozostali usługodawcy używają ID/slug z API bez mapowania.
   */
  const APP_TO_API_PROVIDER = {
    "grzesiu-barber": "provider-demo-gb",
  };
  const API_TO_APP_PROVIDER = {
    "provider-demo-gb": "grzesiu-barber",
  };

  function toAppProviderId(id) {
    if (!id) return id;
    return API_TO_APP_PROVIDER[id] || id;
  }

  function findKnownProvider(idOrSlug) {
    if (!idOrSlug || !window.AppState) return null;
    const key = String(idOrSlug);
    const pools = [
      window.AppState.providerProfiles,
      window.AppState.catalogProviders,
      window.LOKALNIE_DATA && window.LOKALNIE_DATA.PROVIDERS,
    ];
    for (let i = 0; i < pools.length; i++) {
      const list = pools[i];
      if (!Array.isArray(list)) continue;
      const found = list.find(function (p) {
        return (
          p &&
          (p.id === key ||
            p.slug === key ||
            p.apiId === key ||
            toAppProviderId(p.id) === key ||
            toAppProviderId(p.apiId) === key)
        );
      });
      if (found) return found;
    }
    return null;
  }

  function toApiProviderId(id) {
    if (!id) return id;
    if (APP_TO_API_PROVIDER[id]) return APP_TO_API_PROVIDER[id];
    const known = findKnownProvider(id);
    if (known) {
      if (known.apiId) return known.apiId;
      if (known._fromApi && known.id) return known.id;
      if (APP_TO_API_PROVIDER[known.slug]) return APP_TO_API_PROVIDER[known.slug];
      if (APP_TO_API_PROVIDER[known.id]) return APP_TO_API_PROVIDER[known.id];
    }
    return id;
  }

  function mediaUrl(mediaId) {
    if (!mediaId) return "";
    if (String(mediaId).indexOf("http") === 0) return String(mediaId);
    if (String(mediaId).charAt(0) === "/") return BASE + mediaId;
    return BASE + "/media/" + encodeURIComponent(mediaId);
  }

  function mediaIdFromUrl(value) {
    const text = String(value || "");
    const match = text.match(/\/media\/([^/?#]+)(?:[?#]|$)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function request(path, opts) {
    opts = opts || {};
    const method = String(opts.method || "GET").toUpperCase();
    const canRetry = method === "GET" || method === "OPTIONS";
    let attempt = 0;
    let res;
    while (true) {
      const headers = Object.assign({}, authHeaders(), opts.headers || {});
      if (opts.json) headers["Content-Type"] = "application/json";
      const controller = new AbortController();
      const timeout = window.setTimeout(function () {
        controller.abort();
      }, opts.timeoutMs || REQUEST_TIMEOUT_MS);
      if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener("abort", function () { controller.abort(); }, { once: true });
      }
      try {
        res = await fetch(BASE + path, {
          method: method,
          headers: headers,
          body: opts.json ? JSON.stringify(opts.json) : opts.body || undefined,
          credentials: "include",
          signal: controller.signal,
        });
      } catch (err) {
        if (canRetry && attempt < MAX_GET_RETRIES && !(err && err.name === "AbortError")) {
          attempt += 1;
          continue;
        }
        if (err && err.name === "AbortError") {
          const timeoutError = new Error("request_timeout");
          timeoutError.code = "request_timeout";
          throw timeoutError;
        }
        throw err;
      } finally {
        window.clearTimeout(timeout);
      }
      break;
    }
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = { raw: text };
    }
    if (
      !opts.suppressUnauthorized &&
      (res.status === 401 ||
        (res.status === 403 && data && data.error === "account_blocked"))
    ) {
      clearAuthToken();
      notifyUnauthorized();
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || (data && data.error) || "api_error");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function mapBookingToApp(b) {
    if (!b) return null;
    const providerId = toAppProviderId(b.providerId);
    const p = findKnownProvider(providerId) || findKnownProvider(b.providerId);
    return {
      id: b.id,
      providerId: providerId,
      providerName: (p && p.name) || b.providerName || "",
      clientUserId: b.clientUserId || null,
      providerClientId: b.providerClientId || null,
      clientName: b.clientName || "",
      clientPhone: b.clientPhone || "",
      clientEmail: b.clientEmail || "",
      clientAddress: b.clientAddress || "",
      serviceIds: Array.isArray(b.serviceIds) ? b.serviceIds : [],
      serviceNames: Array.isArray(b.serviceNames) ? b.serviceNames : [],
      dateISO: b.dateISO || "",
      from: b.from || "",
      to: b.to || "",
      locationId: b.locationId || null,
      locationLabel: b.locationLabel || "",
      status: b.status || "pending",
      requestId: b.requestId || null,
      side: "client",
      _fromApi: true,
    };
  }

  function mapRequestToApp(r) {
    if (!r) return null;
    const providerId = toAppProviderId(r.providerId);
    const known = findKnownProvider(providerId) || findKnownProvider(r.providerId);
    const days = Array.isArray(r.days) ? r.days : [];
    // Puste days = prośba „dowolny termin” (request); niepuste = approval z preferencjami.
    const requestMode =
      r.requestMode === "approval" || r.requestMode === "request"
        ? r.requestMode
        : days.length
          ? "approval"
          : "request";
    return {
      id: r.id,
      providerId: providerId,
      providerName: (known && known.name) || r.providerName || "",
      clientName: r.clientName || "",
      clientPhone: r.clientPhone || "",
      clientEmail: r.clientEmail || "",
      clientAddress: "",
      serviceIds: Array.isArray(r.serviceIds) ? r.serviceIds : [],
      serviceNames: Array.isArray(r.serviceNames) ? r.serviceNames : [],
      days: days,
      requestMode: requestMode,
      proposals: Array.isArray(r.proposals) ? r.proposals : [],
      acceptedProposalId: r.acceptedProposalId || null,
      status: r.status || "pending",
      _fromApi: true,
    };
  }

  function mapServiceToApp(service) {
    if (!service) return null;
    return {
      id: service.id,
      name: service.name || "",
      description: service.description || "",
      bookingMode: service.bookingMode || "auto",
      durationMin: Number(service.durationMin) || 30,
      price: service.price == null ? null : Number(service.price),
      photos: (service.photoIds || []).map(mediaUrl),
      locationIds: Array.isArray(service.locationIds) ? service.locationIds : [],
      variants: Array.isArray(service.variants) ? service.variants : [],
      _fromApi: true,
    };
  }

  function mapProviderToApp(provider, opts) {
    if (!provider) return null;
    opts = opts || {};
    const apiId = provider.id;
    // Demo: zachowaj slug mocka jako id, żeby UI/favorites nie rozjechały się z data.js.
    const appId = toAppProviderId(apiId) || provider.slug || apiId;
    const name = provider.name || "Mój profil";
    const avatarUrl = provider.avatarUrl
      ? mediaUrl(provider.avatarUrl)
      : provider.avatarKey
        ? mediaUrl(provider.avatarKey)
        : null;
    return {
      id: appId,
      apiId: apiId,
      slug: provider.slug || appId,
      name: name,
      category: provider.category || "",
      subcategory: provider.subcategory || "",
      city: provider.city || "",
      address: provider.address || "",
      about: provider.about || "",
      email: provider.email || "",
      emailVisible: !!provider.emailVisible,
      phone: provider.phone || "",
      bookingMode: provider.bookingMode || "auto",
      visibleInSearch: provider.visibleInSearch !== false,
      multiSelect: provider.multiSelect !== false,
      distanceKm:
        typeof provider.distanceKm === "number" && Number.isFinite(provider.distanceKm)
          ? provider.distanceKm
          : null,
      distanceLabel: provider.distanceLabel || null,
      locations: Array.isArray(provider.locations) ? provider.locations : [],
      socialLinks: Array.isArray(provider.socialLinks) ? provider.socialLinks : [],
      bookingRules:
        provider.bookingRules && typeof provider.bookingRules === "object"
          ? provider.bookingRules
          : {},
      deactivated: !!provider.deactivated,
      avatarUrl: avatarUrl,
      avatarInitials: String(name)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (part) {
          return part.charAt(0);
        })
        .join("")
        .toUpperCase() || "MP",
      services: Array.isArray(opts.services) ? opts.services : [],
      availability: Array.isArray(opts.availability) ? opts.availability : [],
      _mine: !!opts.mine,
      _fromApi: true,
      _detailsLoaded: opts.detailsLoaded === true,
    };
  }

  function providerToApi(profile) {
    return {
      slug: profile.slug || "",
      name: profile.name || "",
      category: profile.category || "",
      subcategory: profile.subcategory || "",
      city: profile.city || "",
      address: profile.address || "",
      about: profile.about || "",
      email: profile.email || "",
      phone: profile.phone || "",
      emailVisible: !!profile.emailVisible,
      bookingMode: profile.bookingMode || "auto",
      visibleInSearch: !!profile.visibleInSearch,
      multiSelect: profile.multiSelect !== false,
      locations: Array.isArray(profile.locations) ? profile.locations : [],
      socialLinks: Array.isArray(profile.socialLinks) ? profile.socialLinks : [],
      bookingRules:
        profile.bookingRules && typeof profile.bookingRules === "object"
          ? profile.bookingRules
          : {},
      deactivated: !!profile.deactivated,
    };
  }

  function serviceToApi(service) {
    return {
      name: service.name || "",
      description: service.description || "",
      bookingMode: service.bookingMode || "auto",
      durationMin: Number(service.durationMin),
      price: service.price == null || service.price === "" ? null : Number(service.price),
      photoIds: (service.photos || []).map(mediaIdFromUrl).filter(Boolean),
      locationIds: Array.isArray(service.locationIds) ? service.locationIds : [],
      variants: Array.isArray(service.variants)
        ? service.variants.map(function (variant) {
            return {
              durationMin: Number(variant.durationMin),
              price: variant.price == null || variant.price === "" ? null : Number(variant.price),
              label: variant.label || "",
            };
          })
        : [],
    };
  }

  function mapClientToApp(c) {
    if (!c) return null;
    return {
      id: c.id,
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      notes: c.notes || "",
      _fromApi: true,
    };
  }

  let syncFromServerInFlight = null;

  async function syncFromServer() {
    if (!window.AppState) return { ok: false, reason: "no_state" };
    // Gość bez sesji — nie ciągnij demo-usera z API do lokalnego stanu.
    if (!isProductionHostname() && !getAuthToken()) return { ok: false, reason: "guest" };
    if (syncFromServerInFlight) return syncFromServerInFlight;
    syncFromServerInFlight = syncFromServerOnce().finally(function () {
      syncFromServerInFlight = null;
    });
    return syncFromServerInFlight;
  }

  async function syncFromServerOnce() {
    try {
      const me = await request("/me");
      if (window.App && typeof window.App.applyApiAuth === "function") {
        try {
          window.App.applyApiAuth(me);
        } catch (err) {
          /* ignore */
        }
      }
      const apiProviderId = me.provider && me.provider.id;
      const appProviderId =
        toAppProviderId(apiProviderId) || apiProviderId || null;
      let clients = [];
      let providerServices = [];
      const syncErrors = [];

      if (me.user) {
        if (!window.AppState.clientProfile || typeof window.AppState.clientProfile !== "object") {
          window.AppState.clientProfile = {
            name: "",
            phone: "",
            email: "",
            notifications: { visitReminders: true, statusChanges: true, marketing: false },
          };
        }
        const cp = window.AppState.clientProfile;
        if (me.user.name) cp.name = me.user.name;
        if (me.user.phone) cp.phone = me.user.phone;
        if (me.user.email) cp.email = me.user.email;
        if (me.user.avatarKey) {
          window.AppState.clientAvatarUrl = mediaUrl(me.user.avatarKey);
        }
      }

      if (apiProviderId) {
        const serverProvider = mapProviderToApp(me.provider, {
          mine: true,
          detailsLoaded: true,
        });
        const profiles = window.AppState.providerProfiles || [];
        let ownedProvider = profiles.find(function (profile) {
          return (
            profile &&
            (profile.apiId === apiProviderId ||
              profile.id === apiProviderId ||
              profile.id === appProviderId ||
              (me.provider.slug && profile.slug === me.provider.slug))
          );
        });
        if (!ownedProvider && profiles.length === 1) ownedProvider = profiles[0];
        if (ownedProvider && serverProvider) {
          Object.keys(serverProvider).forEach(function (key) {
            if (key !== "services" && key !== "availability") ownedProvider[key] = serverProvider[key];
          });
        }
        try {
          const servicesRes = await request("/provider/me/services");
          providerServices = (servicesRes.services || []).map(mapServiceToApp).filter(Boolean);
          if (ownedProvider) {
            ownedProvider.apiId = apiProviderId;
            ownedProvider.services = providerServices;
            if (window.AppState.activeProviderId === ownedProvider.id) {
              window.AppState.myProvider = ownedProvider;
            }
          }
        } catch (err) {
          console.warn("[LokalnieApi] services sync skipped", err);
          syncErrors.push("services");
        }
        try {
          const availabilityRes = await request("/provider/me/availability");
          if (ownedProvider) {
            ownedProvider.availability = Array.isArray(availabilityRes.availability)
              ? availabilityRes.availability
              : [];
          }
        } catch (err) {
          console.warn("[LokalnieApi] availability sync skipped", err);
          syncErrors.push("availability");
        }
        try {
          const clientsRes = await request("/provider/me/clients");
          clients = (clientsRes.clients || []).map(mapClientToApp).filter(Boolean);
          if (!window.AppState.providerClients || typeof window.AppState.providerClients !== "object") {
            window.AppState.providerClients = {};
          }
          if (appProviderId) window.AppState.providerClients[appProviderId] = clients;
          if (apiProviderId && apiProviderId !== appProviderId) {
            window.AppState.providerClients[apiProviderId] = clients.slice();
          }
        } catch (err) {
          console.warn("[LokalnieApi] clients sync skipped", err);
          syncErrors.push("clients");
        }
      }

      const bookingsRes = await request("/bookings");
      const serverBookings = (bookingsRes.bookings || []).map(mapBookingToApp).filter(Boolean);
      const otherBookings = (window.AppState.bookings || []).filter(function (b) {
        if (!b) return false;
        if (b._fromApi) return false;
        // Demo zostaje wyłącznie w świadomym trybie testera.
        if (b._demo || (b.id && String(b.id).indexOf("bk-demo-") === 0)) return isTesterMode();
        const pid = b.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.bookings = isProductionHostname() || !isTesterMode()
        ? serverBookings
        : otherBookings.concat(serverBookings);

      const requestsRes = await request("/requests");
      const serverRequests = (requestsRes.requests || []).map(mapRequestToApp).filter(Boolean);
      const otherRequests = (window.AppState.requests || []).filter(function (r) {
        if (!r) return false;
        if (r._fromApi) return false;
        if (r._demo || (r.id && String(r.id).indexOf("rq-demo-") === 0)) return isTesterMode();
        const pid = r.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.requests = isProductionHostname() || !isTesterMode()
        ? serverRequests
        : otherRequests.concat(serverRequests);

      const calendarRes = await request("/calendar/connections");
      window.AppState.calendarConnections = Array.isArray(calendarRes.connections)
        ? calendarRes.connections
        : [];

      window.AppState._apiSyncedAt = new Date().toISOString();
      window.AppState._apiOnline = true;
      return {
        ok: syncErrors.length === 0,
        partial: syncErrors.length > 0,
        errors: syncErrors,
        appProviderId: appProviderId,
        hasProvider: !!apiProviderId,
        services: providerServices.length,
        clients: clients.length,
        bookings: serverBookings.length,
        requests: serverRequests.length,
      };
    } catch (err) {
      console.warn("[LokalnieApi] sync failed", err);
      window.AppState._apiOnline = false;
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /** Zapis profilu klienta na serwerze (e-mail zostaje z konta Google). */
  async function updateMe(profile) {
    if (!profile || (!isProductionHostname() && !getAuthToken())) return null;
    const notes = profile.notifications || {};
    try {
      const res = await request("/me", {
        method: "PATCH",
        json: {
          name: profile.name || "",
          phone: profile.phone || "",
          notifications: {
            reminder: !!notes.visitReminders,
            booking: !!notes.statusChanges,
            marketing: !!notes.marketing,
          },
        },
      });
      return (res && res.user) || null;
    } catch (err) {
      console.warn("[LokalnieApi] updateMe failed", err);
      return null;
    }
  }

  /** Zapis profilu usługodawcy na serwerze (pola obsługiwane przez PATCH /provider/me). */
  async function updateProviderMe(profile) {
    if (!profile || (!isProductionHostname() && !getAuthToken())) return null;
    try {
      const res = await request("/provider/me", {
        method: "PATCH",
        json: providerToApi(profile),
      });
      return mapProviderToApp(res && res.provider, { mine: true });
    } catch (err) {
      console.warn("[LokalnieApi] updateProviderMe failed", err);
      return null;
    }
  }

  async function createProviderMe(profile) {
    if (!profile || (!isProductionHostname() && !getAuthToken())) return null;
    const res = await request("/provider/me", {
      method: "POST",
      json: providerToApi(profile),
    });
    return mapProviderToApp(res && res.provider, { mine: true });
  }

  async function listProviders(params) {
    params = params || {};
    const u = new URL(BASE + "/providers");
    ["q", "city", "category", "subcategory", "limit", "offset", "latitude", "longitude", "radiusKm"].forEach(
      function (key) {
        if (params[key] != null && params[key] !== "") {
          u.searchParams.set(key, String(params[key]));
        }
      }
    );
    const path = u.pathname + u.search;
    const res = await request(path, { suppressUnauthorized: true });
    const providers = (res.providers || [])
      .map(function (p) {
        return mapProviderToApp(p, { mine: false });
      })
      .filter(Boolean);
    return {
      providers: providers,
      total: Number(res.total || providers.length),
      limit: Number(res.limit || 0),
      offset: Number(res.offset || 0),
      search: res.search || null,
    };
  }

  async function suggestPlaces(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    const u = new URL(BASE + "/geo/suggest");
    u.searchParams.set("q", q);
    const res = await request(u.pathname + u.search, { suppressUnauthorized: true });
    return Array.isArray(res && res.suggestions) ? res.suggestions : [];
  }

  async function fetchProviderBySlug(slug) {
    if (!slug) return null;
    const res = await request("/providers/" + encodeURIComponent(slug), {
      suppressUnauthorized: true,
    });
    if (!res || !res.provider) return null;
    const services = (res.services || []).map(mapServiceToApp).filter(Boolean);
    const availability = Array.isArray(res.availability) ? res.availability : [];
    return mapProviderToApp(res.provider, {
      mine: false,
      services: services,
      availability: availability,
      detailsLoaded: true,
    });
  }

  function catalogEntryHasDetails(p) {
    return !!(
      p &&
      (p._detailsLoaded ||
        p._mine ||
        (Array.isArray(p.services) && p.services.length > 0) ||
        (Array.isArray(p.availability) && p.availability.length > 0))
    );
  }

  /** Lista katalogu nie może wycierać services/availability z wcześniej dociągniętego profilu. */
  function mergeCatalogListEntry(prev, next) {
    if (!next) return prev || null;
    if (!prev) return next;
    const prevLoaded = catalogEntryHasDetails(prev);
    const nextLoaded = catalogEntryHasDetails(next);
    if (prevLoaded && !nextLoaded) {
      return Object.assign({}, prev, next, {
        services: Array.isArray(prev.services) ? prev.services : [],
        availability: Array.isArray(prev.availability) ? prev.availability : [],
        _detailsLoaded: prev._detailsLoaded != null ? !!prev._detailsLoaded : true,
        _mine: !!(prev._mine || next._mine),
      });
    }
    return Object.assign({}, prev, next);
  }

  function providerCatalogKey(p) {
    if (!p) return "";
    return String(p.apiId || p.id || p.slug || "");
  }

  async function loadCatalog(params) {
    if (!window.AppState) return { ok: false, reason: "no_state" };
    try {
      const options = Object.assign({}, params || {});
      const pageSize = Math.min(50, Math.max(1, Number(options.limit) || 50));
      const allProviders = [];
      let total = 0;
      let offset = Number(options.offset) || 0;

      while (true) {
        const result = await listProviders(
          Object.assign({}, options, { limit: pageSize, offset: offset })
        );
        const pageProviders = result.providers || [];
        allProviders.push.apply(allProviders, pageProviders);
        total = Math.max(total, result.total || 0);

        if (
          !pageProviders.length ||
          allProviders.length >= total ||
          pageProviders.length < pageSize
        ) {
          break;
        }
        offset += pageProviders.length;
      }

      const prevList = Array.isArray(window.AppState.catalogProviders)
        ? window.AppState.catalogProviders
        : [];
      const prevByKey = {};
      prevList.forEach(function (p) {
        const key = providerCatalogKey(p);
        if (key) prevByKey[key] = p;
        if (p && p.slug) prevByKey["slug:" + p.slug] = p;
      });
      window.AppState.catalogProviders = allProviders.map(function (next) {
        const byId = prevByKey[providerCatalogKey(next)];
        const bySlug = next && next.slug ? prevByKey["slug:" + next.slug] : null;
        return mergeCatalogListEntry(byId || bySlug || null, next);
      });
      window.AppState._catalogSyncedAt = new Date().toISOString();
      return { ok: true, count: allProviders.length, total: total || allProviders.length };
    } catch (err) {
      console.warn("[LokalnieApi] loadCatalog failed", err);
      if (!Array.isArray(window.AppState.catalogProviders)) {
        window.AppState.catalogProviders = [];
      }
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  async function getProviderAvailability() {
    const res = await request("/provider/me/availability");
    return Array.isArray(res && res.availability) ? res.availability : [];
  }

  async function updateProviderAvailability(availability) {
    const res = await request("/provider/me/availability", {
      method: "PUT",
      json: { availability: Array.isArray(availability) ? availability : [] },
    });
    return Array.isArray(res && res.availability) ? res.availability : [];
  }

  async function upsertService(service, isNew) {
    if (!service || (!isProductionHostname() && !getAuthToken())) return null;
    const path = isNew
      ? "/provider/me/services"
      : "/provider/me/services/" + encodeURIComponent(service.id);
    const payload = serviceToApi(service);
    const res = await idempotentRequest(
      isNew ? "create-service" : "update-service",
      String(service.id || service.name) + "." + JSON.stringify(payload),
      path,
      {
        method: isNew ? "POST" : "PATCH",
        json: payload,
      }
    );
    return mapServiceToApp(res && res.service);
  }

  async function deleteService(serviceId) {
    if (!serviceId || (!isProductionHostname() && !getAuthToken())) return false;
    await idempotentRequest(
      "delete-service",
      String(serviceId),
      "/provider/me/services/" + encodeURIComponent(serviceId),
      { method: "DELETE" }
    );
    return true;
  }

  async function deleteServices(serviceIds) {
    const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
    if (!ids.length || (!isProductionHostname() && !getAuthToken())) return false;
    await idempotentRequest(
      "delete-services",
      ids.slice().sort().join(","),
      "/provider/me/services",
      { method: "DELETE", json: { serviceIds: ids } }
    );
    return true;
  }

  async function updateServicesBookingMode(serviceIds, bookingMode) {
    const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
    if (!ids.length || (!isProductionHostname() && !getAuthToken())) return false;
    await idempotentRequest(
      "update-services-booking-mode",
      ids.slice().sort().join(",") + "." + String(bookingMode || ""),
      "/provider/me/services/booking-mode",
      {
        method: "PATCH",
        json: { serviceIds: ids, bookingMode: bookingMode },
      }
    );
    return true;
  }

  async function upsertClient(appProviderId, client) {
    if (!client || !client.name) return null;
    const isLocalId = !client.id || /^cli(-virt)?-/.test(String(client.id));
    if (!isLocalId) {
      const patched = await request("/provider/me/clients/" + encodeURIComponent(client.id), {
        method: "PATCH",
        json: {
          name: client.name,
          phone: client.phone || "",
          email: client.email || "",
          address: client.address || "",
          notes: client.notes || "",
        },
      });
      if (patched.client) {
        client.id = patched.client.id;
        client._fromApi = true;
      }
      return patched.client;
    }
    const created = await request("/provider/me/clients", {
      method: "POST",
      json: {
        name: client.name,
        phone: client.phone || "",
        email: client.email || "",
        address: client.address || "",
        notes: client.notes || "",
      },
    });
    if (created.client) {
      client.id = created.client.id;
      client._fromApi = true;
    }
    return created.client;
  }

  async function createBookingFromApp(booking) {
    if (!booking) return null;
    try {
      const identity = String(booking.id || "local-booking");
      const res = await idempotentRequest("create-booking", identity, "/bookings", {
        method: "POST",
        json: {
          providerId: toApiProviderId(booking.providerId),
          clientName: booking.clientName,
          clientPhone: booking.clientPhone || "",
          clientEmail: booking.clientEmail || "",
          serviceIds: booking.serviceIds || [],
          serviceNames: booking.serviceNames || [],
          dateISO: booking.dateISO || null,
          from: booking.from || null,
          to: booking.to || null,
          locationLabel: booking.locationLabel || null,
          status: booking.status || "confirmed",
          requestId: booking.requestId || null,
        },
      });
      if (res.booking && booking) {
        booking.id = res.booking.id;
        booking._fromApi = true;
        booking.providerId = toAppProviderId(res.booking.providerId) || booking.providerId;
      }
      return { booking: res.booking, calendar: res.calendar || null };
    } catch (err) {
      console.warn("[LokalnieApi] createBooking failed", err);
      throw err;
    }
  }

  async function createRequestFromApp(req) {
    if (!req) return null;
    try {
      const identity = String(req.id || "local-request");
      const res = await idempotentRequest("create-request", identity, "/requests", {
        method: "POST",
        json: {
          providerId: toApiProviderId(req.providerId),
          clientName: req.clientName,
          clientPhone: req.clientPhone || "",
          clientEmail: req.clientEmail || "",
          serviceIds: req.serviceIds || [],
          serviceNames: req.serviceNames || [],
          days: req.days || [],
        },
      });
      if (res.request) {
        const oldId = req.id;
        req.id = res.request.id;
        req._fromApi = true;
        req.providerId = toAppProviderId(res.request.providerId) || req.providerId;
        (window.AppState.bookings || []).forEach(function (b) {
          if (b && b.requestId === oldId) b.requestId = req.id;
        });
      }
      return res.request;
    } catch (err) {
      console.warn("[LokalnieApi] createRequest failed", err);
      throw err;
    }
  }

  async function proposeRequestFromApp(req) {
    if (!req || !req.id) return null;
    try {
      const proposals = (req.proposals || []).map(function (p, i) {
        return {
          id: p.id || "prop_" + (i + 1),
          dateISO: p.dateISO,
          from: p.from,
          to: p.to,
          locationLabel: p.locationLabel || null,
        };
      });
      const identity = String(req.id);
      const res = await idempotentRequest(
        "propose-request",
        identity,
        "/requests/" + encodeURIComponent(req.id) + "/propose",
        {
        method: "POST",
        json: { proposals: proposals },
        }
      );
      if (res.request) {
        req.status = res.request.status;
        req.proposals = res.request.proposals || proposals;
        req._fromApi = true;
      }
      return res.request;
    } catch (err) {
      console.warn("[LokalnieApi] proposeRequest failed", err);
      throw err;
    }
  }

  async function acceptRequestFromApp(requestId, proposalId) {
    try {
      const identity = String(requestId) + "." + String(proposalId);
      const res = await idempotentRequest(
        "accept-request",
        identity,
        "/requests/" + encodeURIComponent(requestId) + "/accept",
        {
          method: "POST",
          json: { proposalId: proposalId },
        }
      );
      return res;
    } catch (err) {
      console.warn("[LokalnieApi] acceptRequest failed", err);
      throw err;
    }
  }

  async function declineRequestFromApp(requestId, action) {
    if (!requestId) return null;
    const mutationAction = action || "decline-request";
    const res = await idempotentRequest(
      mutationAction,
      String(requestId),
      "/requests/" + encodeURIComponent(requestId) + "/decline",
      { method: "POST" }
    );
    return res && res.request;
  }

  async function requestMoreRequestFromApp(requestId) {
    if (!requestId) return null;
    const res = await idempotentRequest(
      "request-more",
      String(requestId),
      "/requests/" + encodeURIComponent(requestId) + "/request-more",
      { method: "POST" }
    );
    return res && res.request;
  }

  async function updateBookingStatusFromApp(bookingId, status) {
    if (!bookingId || !status) return null;
    return patchBookingFromApp(
      { id: bookingId },
      { status: status },
      "booking-" + status
    );
  }

  async function patchBookingFromApp(booking, patch, action) {
    if (!booking || !booking.id || !patch) return null;
    const stablePatch = JSON.stringify(patch);
    const mutationAction = action || "patch-booking";
    const identity = String(booking.id) + "." + stablePatch;
    const res = await idempotentRequest(
      mutationAction,
      identity,
      "/bookings/" + encodeURIComponent(booking.id),
      { method: "PATCH", json: patch }
    );
    return { booking: res && res.booking, calendar: (res && res.calendar) || null };
  }

  async function resizeImageForUpload(file, maxDimension) {
    const max = maxDimension || 1024;
    const source = await (typeof createImageBitmap === "function"
      ? createImageBitmap(file)
      : new Promise(function (resolve, reject) {
          const image = new Image();
          const objectUrl = URL.createObjectURL(file);
          image.onload = function () {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
          };
          image.onerror = function () {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("image_decode_failed"));
          };
          image.src = objectUrl;
        }));
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) {
      if (typeof source.close === "function") source.close();
      throw new Error("image_decode_failed");
    }
    const scale = Math.min(1, max / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    if (scale === 1) {
      if (typeof source.close === "function") source.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      if (typeof source.close === "function") source.close();
      throw new Error("image_resize_failed");
    }
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    if (typeof source.close === "function") source.close();

    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, "image/webp", 0.85);
    });
    if (!blob) {
      const jpeg = await new Promise(function (resolve) {
        canvas.toBlob(resolve, "image/jpeg", 0.85);
      });
      if (!jpeg) throw new Error("image_resize_failed");
      return new File([jpeg], "avatar.jpg", { type: "image/jpeg", lastModified: Date.now() });
    }
    return new File([blob], "avatar.webp", { type: "image/webp", lastModified: Date.now() });
  }

  async function uploadAvatar(file) {
    if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(String(file.type || ""))) {
      throw new Error("unsupported_image_type");
    }
    try {
      file = await resizeImageForUpload(file, 1024);
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("image_too_large");
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "avatar");
      const res = await request("/media", { method: "POST", body: fd });
      if (res.media && res.media.id) {
        return mediaUrl(res.media.id);
      }
      return null;
    } catch (err) {
      console.warn("[LokalnieApi] uploadAvatar failed", err);
      return null;
    }
  }

  async function uploadServicePhoto(file) {
    if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(String(file.type || ""))) {
      throw new Error("unsupported_image_type");
    }
    file = await resizeImageForUpload(file, 1600);
    if (file.size > 5 * 1024 * 1024) throw new Error("image_too_large");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "service");
    const res = await request("/media", { method: "POST", body: fd });
    return res && res.media && res.media.id ? mediaUrl(res.media.id) : null;
  }

  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch (err) {
      /* ignore */
    }
    clearAuthToken();
  }

  /** Trwałe usunięcie / anonimizacja konta zalogowanego użytkownika. */
  async function deleteAccount() {
    if (!isProductionHostname() && !getAuthToken()) {
      throw Object.assign(new Error("unauthorized"), { status: 401, data: { error: "unauthorized" } });
    }
    await request("/me", { method: "DELETE" });
    clearAuthToken();
    return true;
  }

  /** Usunięcie klienta z CRM usługodawcy (z anonimizacją powiązanych rezerwacji). */
  async function deleteClient(clientId) {
    if (!clientId || (!isProductionHostname() && !getAuthToken())) return false;
    await request("/provider/me/clients/" + encodeURIComponent(clientId), { method: "DELETE" });
    return true;
  }

  async function listCalendarConnections() {
    const res = await request("/calendar/connections");
    return Array.isArray(res.connections) ? res.connections : [];
  }

  async function disconnectCalendar(connectionId) {
    if (!connectionId) return false;
    await request("/calendar/connections/" + encodeURIComponent(connectionId), { method: "DELETE" });
    return true;
  }

  window.LokalnieApi = {
    BASE: BASE,
    enabled: true,
    TOKEN_KEY: TOKEN_KEY,
    isProductionHostname: isProductionHostname,
    isTesterMode: isTesterMode,
    getAuthToken: getAuthToken,
    setAuthToken: setAuthToken,
    clearAuthToken: clearAuthToken,
    googleLoginUrl: googleLoginUrl,
    googleCalendarConnectUrl: googleCalendarConnectUrl,
    toAppProviderId: toAppProviderId,
    toApiProviderId: toApiProviderId,
    mediaUrl: mediaUrl,
    request: request,
    syncFromServer: syncFromServer,
    updateMe: updateMe,
    mapProviderToApp: mapProviderToApp,
    createProviderMe: createProviderMe,
    updateProviderMe: updateProviderMe,
    listProviders: listProviders,
    suggestPlaces: suggestPlaces,
    fetchProviderBySlug: fetchProviderBySlug,
    loadCatalog: loadCatalog,
    getProviderAvailability: getProviderAvailability,
    updateProviderAvailability: updateProviderAvailability,
    upsertService: upsertService,
    deleteService: deleteService,
    deleteServices: deleteServices,
    updateServicesBookingMode: updateServicesBookingMode,
    upsertClient: upsertClient,
    createBookingFromApp: createBookingFromApp,
    createRequestFromApp: createRequestFromApp,
    proposeRequestFromApp: proposeRequestFromApp,
    acceptRequestFromApp: acceptRequestFromApp,
    declineRequestFromApp: declineRequestFromApp,
    requestMoreRequestFromApp: requestMoreRequestFromApp,
    updateBookingStatusFromApp: updateBookingStatusFromApp,
    patchBookingFromApp: patchBookingFromApp,
    releaseIdempotencyKey: releaseIdempotencyKey,
    uploadAvatar: uploadAvatar,
    uploadServicePhoto: uploadServicePhoto,
    logout: logout,
    deleteAccount: deleteAccount,
    deleteClient: deleteClient,
    listCalendarConnections: listCalendarConnections,
    disconnectCalendar: disconnectCalendar,
  };
})();
