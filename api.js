// api.js — klient API Lokalnie (tryb demo: X-Demo-User).
// Wystawia: window.LokalnieApi
(function () {
  "use strict";

  const BASE = "https://api.lokalnie.app";
  const DEMO_HEADER = { "X-Demo-User": "demo" };

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
    const headers = Object.assign({}, DEMO_HEADER, opts.headers || {});
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
    try {
      const me = await request("/me");
      const apiProviderId = me.provider && me.provider.id;
      const appProviderId = toAppProviderId(apiProviderId) || "grzesiu-barber";

      if (me.user) {
        if (!window.AppState.clientProfile || typeof window.AppState.clientProfile !== "object") {
          window.AppState.clientProfile = {};
        }
        const cp = window.AppState.clientProfile;
        if (me.user.name) cp.name = me.user.name;
        if (me.user.phone) cp.phone = me.user.phone;
        if (me.user.email) cp.email = me.user.email;
        if (me.user.avatarKey && me.user.id) {
          // Avatar z R2 — jeśli mamy media id w stanie, zostaw; inaczej zostaw URL jeśli już ustawiony.
        }
      }

      const clientsRes = await request("/provider/me/clients");
      const clients = (clientsRes.clients || []).map(mapClientToApp).filter(Boolean);
      if (!window.AppState.providerClients || typeof window.AppState.providerClients !== "object") {
        window.AppState.providerClients = {};
      }
      window.AppState.providerClients[appProviderId] = clients;
      if (apiProviderId && apiProviderId !== appProviderId) {
        window.AppState.providerClients[apiProviderId] = clients.slice();
      }

      const bookingsRes = await request("/bookings");
      const serverBookings = (bookingsRes.bookings || []).map(mapBookingToApp).filter(Boolean);
      const otherBookings = (window.AppState.bookings || []).filter(function (b) {
        if (!b) return false;
        if (b._fromApi) return false;
        // Zachowaj lokalne przykłady demo (np. odwołane/odrzucone), których nie ma na serwerze.
        if (b._demo) return true;
        const pid = b.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.bookings = otherBookings.concat(serverBookings);

      const requestsRes = await request("/requests");
      const serverRequests = (requestsRes.requests || []).map(mapRequestToApp).filter(Boolean);
      const otherRequests = (window.AppState.requests || []).filter(function (r) {
        if (!r) return false;
        if (r._fromApi) return false;
        const pid = r.providerId;
        return pid !== appProviderId && pid !== apiProviderId;
      });
      window.AppState.requests = otherRequests.concat(serverRequests);

      window.AppState._apiSyncedAt = new Date().toISOString();
      window.AppState._apiOnline = true;
      return { ok: true, appProviderId: appProviderId, clients: clients.length, bookings: serverBookings.length, requests: serverRequests.length };
    } catch (err) {
      console.warn("[LokalnieApi] sync failed", err);
      window.AppState._apiOnline = false;
      return { ok: false, error: String(err && err.message ? err.message : err) };
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
      const res = await request("/bookings", {
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
      return null;
    }
  }

  async function createRequestFromApp(req) {
    if (!req) return null;
    try {
      const res = await request("/requests", {
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
      return null;
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
      const res = await request("/requests/" + encodeURIComponent(req.id) + "/propose", {
        method: "POST",
        json: { proposals: proposals },
      });
      if (res.request) {
        req.status = res.request.status;
        req.proposals = res.request.proposals || proposals;
        req._fromApi = true;
      }
      return res.request;
    } catch (err) {
      console.warn("[LokalnieApi] proposeRequest failed", err);
      return null;
    }
  }

  async function acceptRequestFromApp(requestId, proposalId) {
    try {
      const res = await request("/requests/" + encodeURIComponent(requestId) + "/accept", {
        method: "POST",
        json: { proposalId: proposalId },
      });
      return res;
    } catch (err) {
      console.warn("[LokalnieApi] acceptRequest failed", err);
      return null;
    }
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

  window.LokalnieApi = {
    BASE: BASE,
    enabled: true,
    toAppProviderId: toAppProviderId,
    toApiProviderId: toApiProviderId,
    mediaUrl: mediaUrl,
    request: request,
    syncFromServer: syncFromServer,
    upsertClient: upsertClient,
    createBookingFromApp: createBookingFromApp,
    createRequestFromApp: createRequestFromApp,
    proposeRequestFromApp: proposeRequestFromApp,
    acceptRequestFromApp: acceptRequestFromApp,
    uploadAvatar: uploadAvatar,
  };
})();
