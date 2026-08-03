// api.js — klient API Lokalnie (sesja OAuth albo tryb demo: X-Demo-User).
// Wystawia: window.LokalnieApi
(function () {
  "use strict";

  const BASE = "https://api.lokalnie.app";
  const TOKEN_KEY = "lokalnie.authToken";
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

  function getAuthToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function setAuthToken(token) {
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
    if (isProductionHostname()) return {};
    return Object.assign({}, DEMO_HEADER);
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

  /** Mapowanie ID usługodawcy: mock frontu ↔ D1. */
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

  function toApiProviderId(id) {
    if (!id) return id;
    return APP_TO_API_PROVIDER[id] || id;
  }

  function mediaUrl(mediaId) {
    return BASE + "/media/" + encodeURIComponent(mediaId);
  }

  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, authHeaders(), opts.headers || {});
    if (opts.json) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.json ? JSON.stringify(opts.json) : opts.body || undefined,
    });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = { raw: text };
    }
    if (res.status === 401) {
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
    const providers = (window.LOKALNIE_DATA && window.LOKALNIE_DATA.PROVIDERS) || [];
    const p = providers.find(function (x) {
      return x.id === providerId || x.slug === providerId;
    });
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
    const providers = (window.LOKALNIE_DATA && window.LOKALNIE_DATA.PROVIDERS) || [];
    const p = providers.find(function (x) {
      return x.id === providerId || x.slug === providerId;
    });
    return {
      id: r.id,
      providerId: providerId,
      providerName: (p && p.name) || "",
      clientName: r.clientName || "",
      clientPhone: r.clientPhone || "",
      clientEmail: r.clientEmail || "",
      clientAddress: "",
      serviceIds: Array.isArray(r.serviceIds) ? r.serviceIds : [],
      serviceNames: Array.isArray(r.serviceNames) ? r.serviceNames : [],
      days: Array.isArray(r.days) ? r.days : [],
      proposals: Array.isArray(r.proposals) ? r.proposals : [],
      acceptedProposalId: r.acceptedProposalId || null,
      status: r.status || "pending",
      _fromApi: true,
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

  async function syncFromServer() {
    if (!window.AppState) return { ok: false, reason: "no_state" };
    // Gość bez sesji — nie ciągnij demo-usera z API do lokalnego stanu.
    if (!getAuthToken()) return { ok: false, reason: "guest" };
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
      const appProviderId = toAppProviderId(apiProviderId) || (apiProviderId ? apiProviderId : "grzesiu-barber");
      let clients = [];

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
        try {
          const clientsRes = await request("/provider/me/clients");
          clients = (clientsRes.clients || []).map(mapClientToApp).filter(Boolean);
          if (!window.AppState.providerClients || typeof window.AppState.providerClients !== "object") {
            window.AppState.providerClients = {};
          }
          window.AppState.providerClients[appProviderId] = clients;
          if (apiProviderId !== appProviderId) {
            window.AppState.providerClients[apiProviderId] = clients.slice();
          }
        } catch (err) {
          console.warn("[LokalnieApi] clients sync skipped", err);
        }
      }

      const bookingsRes = await request("/bookings");
      const serverBookings = (bookingsRes.bookings || []).map(mapBookingToApp).filter(Boolean);
      const otherBookings = (window.AppState.bookings || []).filter(function (b) {
        if (!b) return false;
        if (b._fromApi) return false;
        // Demo zostaje lokalnie/testowo, ale nigdy w prawdziwej sesji produkcyjnej.
        if (b._demo) return !isProductionHostname();
        const pid = b.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.bookings = isProductionHostname()
        ? serverBookings
        : otherBookings.concat(serverBookings);

      const requestsRes = await request("/requests");
      const serverRequests = (requestsRes.requests || []).map(mapRequestToApp).filter(Boolean);
      const otherRequests = (window.AppState.requests || []).filter(function (r) {
        if (!r) return false;
        if (r._fromApi) return false;
        if (r._demo) return !isProductionHostname();
        const pid = r.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.requests = isProductionHostname()
        ? serverRequests
        : otherRequests.concat(serverRequests);

      window.AppState._apiSyncedAt = new Date().toISOString();
      window.AppState._apiOnline = true;
      return {
        ok: true,
        appProviderId: appProviderId,
        hasProvider: !!apiProviderId,
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
    if (!profile || !getAuthToken()) return null;
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

  async function upsertClient(appProviderId, client) {
    if (!client || !client.name) return null;
    try {
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
    } catch (err) {
      console.warn("[LokalnieApi] upsertClient failed", err);
      return null;
    }
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
      return res.booking;
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
    return res && res.booking;
  }

  async function uploadAvatar(file) {
    try {
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

  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch (err) {
      /* ignore */
    }
    clearAuthToken();
  }

  window.LokalnieApi = {
    BASE: BASE,
    enabled: true,
    TOKEN_KEY: TOKEN_KEY,
    isProductionHostname: isProductionHostname,
    getAuthToken: getAuthToken,
    setAuthToken: setAuthToken,
    clearAuthToken: clearAuthToken,
    googleLoginUrl: googleLoginUrl,
    toAppProviderId: toAppProviderId,
    toApiProviderId: toApiProviderId,
    mediaUrl: mediaUrl,
    request: request,
    syncFromServer: syncFromServer,
    updateMe: updateMe,
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
    logout: logout,
  };
})();
