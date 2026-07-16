// data.js — jedno źródło prawdy dla katalogu, profilu i slotów (mock, bez backendu).
// Wystawia: window.LOKALNIE_DATA = { PROVIDERS, CATEGORIES, HOLIDAYS_2026, CURRENT_USER }
// Zgodnie z §8 CONTRACT.md. Czysta statyka, wszystko na window (bez modułów ES).

(function () {
  "use strict";

  // Dzisiejsza data w prototypie: 16 lipca 2026 (czwartek).
  // Availability generujemy na ~2 tygodnie od dziś.
  const WINDOW_START = Date.UTC(2026, 6, 16); // 2026-07-16
  const WINDOW_DAYS = 14;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function isoFromDate(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  // weekly: mapa { 0..6 (nd..sob) : [ { from, to, locationId, recurring } ] }
  // Zwraca [DayAvailability] tylko dla dni z blokami w oknie WINDOW_DAYS.
  function buildAvailability(providerId, weekly) {
    const out = [];
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = new Date(WINDOW_START + i * 86400000);
      const dow = d.getUTCDay();
      const templates = weekly[dow];
      if (!templates || !templates.length) continue;
      const iso = isoFromDate(d);
      const blocks = templates.map((t, idx) => ({
        id: `blk-${providerId}-${iso}-${idx}`,
        from: t.from,
        to: t.to,
        locationId: t.locationId,
        recurring: !!t.recurring,
      }));
      out.push({ dateISO: iso, blocks });
    }
    return out;
  }

  const CATEGORIES = [
    { id: "zdrowie", label: "Zdrowie" },
    { id: "edukacja", label: "Edukacja" },
    {
      id: "uroda",
      label: "Uroda",
      subcategories: [
        { id: "fryzjer", label: "Fryzjer" },
        { id: "barber", label: "Barber" },
      ],
    },
    { id: "naprawy", label: "Naprawy" },
    { id: "sport-fitness", label: "Sport i fitness" },
    { id: "inne", label: "Inne" },
  ];

  // Polskie święta ustawowo wolne 2026 (ISO). Wielkanoc 2026 = 5 kwietnia.
  const HOLIDAYS_2026 = [
    "2026-01-01", // Nowy Rok
    "2026-01-06", // Trzech Króli
    "2026-04-05", // Wielkanoc
    "2026-04-06", // Poniedziałek Wielkanocny
    "2026-05-01", // Święto Pracy
    "2026-05-03", // Konstytucji 3 Maja
    "2026-05-24", // Zielone Świątki
    "2026-06-04", // Boże Ciało
    "2026-08-15", // Wniebowzięcie NMP
    "2026-11-01", // Wszystkich Świętych
    "2026-11-11", // Narodowe Święto Niepodległości
    "2026-12-25", // Boże Narodzenie (1. dzień)
    "2026-12-26", // Boże Narodzenie (2. dzień)
  ];

  const CURRENT_USER = {
    name: "Hubert Z",
    loggedIn: true,
    providerRole: { active: true, trialDaysLeft: 12 },
  };

  // --- Providerzy (6–8). „Grzesiu Barber" wiodący. ---
  // Wymagane: min. 1 bookingMode:'approval', min. 1 bez address, min. 1 visibleInSearch:false.
  const PROVIDERS = [
    {
      id: "grzesiu-barber",
      slug: "grzesiu-barber",
      name: "Grzesiu Barber",
      category: "uroda",
      subcategory: "barber",
      avatarInitials: "GB",
      address: "ul. Marszałkowska 12, Warszawa",
      distanceKm: 1.2,
      bookingMode: "auto",
      visibleInSearch: true,
      multiSelect: true,
      locations: [
        { id: "loc-gb-1", label: "Studio główne", address: "ul. Marszałkowska 12, Warszawa" },
        { id: "loc-gb-2", label: "Filia Praga", address: "ul. Ząbkowska 8, Warszawa" },
      ],
      services: [
        { id: "svc-gb-1", name: "Strzyżenie męskie", durationMin: 30, price: 60, subtitle: "Klasyczne strzyżenie maszynką i nożyczkami" },
        { id: "svc-gb-2", name: "Strzyżenie brody", durationMin: 20, price: 40, subtitle: "Modelowanie i wyrównanie linii brody" },
        { id: "svc-gb-3", name: "Combo: włosy + broda", durationMin: 45, price: 85, subtitle: "Strzyżenie i pełna stylizacja brody" },
        { id: "svc-gb-4", name: "Skin fade", durationMin: 35, price: 70, subtitle: "Precyzyjny fade z boków i karku" },
        { id: "svc-gb-5", name: "Strzyżenie damskie", durationMin: 45, price: 80, subtitle: "Krótkie i średnie włosy, mycie w cenie" },
        { id: "svc-gb-6", name: "Golenie brzytwą", durationMin: 25, price: 50, subtitle: "Tradycyjne golenie z gorącym kompresem" },
      ],
      availability: [],
      busy: [
        { startISO: "2026-07-17T11:00:00", endISO: "2026-07-17T11:45:00" },
        { startISO: "2026-07-20T14:00:00", endISO: "2026-07-20T15:00:00" },
      ],
    },
    {
      id: "studio-bella",
      slug: "studio-bella",
      name: "Studio Paznokci Bella",
      category: "uroda",
      avatarInitials: "SB",
      city: "Warszawa",
      address: "ul. Nowy Świat 24, Warszawa",
      distanceKm: 2.8,
      bookingMode: "auto",
      visibleInSearch: true,
      multiSelect: true,
      locations: [
        { id: "loc-sb-1", label: "Salon", address: "ul. Nowy Świat 24, Warszawa" },
      ],
      services: [
        { id: "svc-sb-1", name: "Manicure hybrydowy", durationMin: 60, price: 90, subtitle: "Trwały lakier hybrydowy" },
        { id: "svc-sb-2", name: "Pedicure klasyczny", durationMin: 60, price: 110, subtitle: "Pielęgnacja stóp i paznokci" },
        { id: "svc-sb-3", name: "Żel na naturalną płytkę", durationMin: 90, price: 140, subtitle: "Wzmocnienie i przedłużenie" },
        { id: "svc-sb-4", name: "Zdobienie", durationMin: 15, price: 20, subtitle: "Jeden akcent zdobniczy" },
      ],
      availability: [],
      busy: [
        { startISO: "2026-07-16T10:00:00", endISO: "2026-07-16T11:00:00" },
      ],
    },
    {
      id: "masaz-relaks",
      slug: "masaz-relaks",
      name: "Gabinet Masażu Relaks",
      category: "zdrowie",
      avatarInitials: "MR",
      city: "Warszawa",
      address: "ul. Puławska 100, Warszawa",
      distanceKm: 4.1,
      bookingMode: "auto",
      visibleInSearch: true,
      multiSelect: false,
      locations: [
        { id: "loc-mr-1", label: "Gabinet", address: "ul. Puławska 100, Warszawa" },
      ],
      services: [
        { id: "svc-mr-1", name: "Masaż klasyczny 60 min", durationMin: 60, price: 150, subtitle: "Całe ciało, rozluźniający" },
        { id: "svc-mr-2", name: "Masaż pleców", durationMin: 30, price: 90, subtitle: "Odcinek szyjny i lędźwiowy" },
        { id: "svc-mr-3", name: "Masaż relaksacyjny 90 min", durationMin: 90, price: 210, subtitle: "Aromaterapia i ciepłe olejki" },
      ],
      availability: [],
      busy: [
        { startISO: "2026-07-22T12:00:00", endISO: "2026-07-22T13:30:00" },
      ],
    },
    {
      id: "auto-detailing-pro",
      slug: "auto-detailing-pro",
      name: "Auto Detailing Pro",
      category: "naprawy",
      avatarInitials: "AD",
      city: "Warszawa",
      address: "ul. Wołoska 60, Warszawa",
      distanceKm: 6.5,
      bookingMode: "auto",
      visibleInSearch: true,
      multiSelect: true,
      locations: [
        { id: "loc-ad-1", label: "Myjnia", address: "ul. Wołoska 60, Warszawa" },
      ],
      services: [
        { id: "svc-ad-1", name: "Mycie ręczne", durationMin: 45, price: 60, subtitle: "Zewnątrz + felgi" },
        { id: "svc-ad-2", name: "Pranie tapicerki", durationMin: 120, price: 250, subtitle: "Fotele i dywaniki" },
        { id: "svc-ad-3", name: "Powłoka ceramiczna", durationMin: 180, price: 600, subtitle: "Ochrona lakieru" },
        { id: "svc-ad-4", name: "Detailing wnętrza", durationMin: 90, price: 180, subtitle: "Kompleksowe czyszczenie kabiny" },
      ],
      availability: [],
      busy: [],
    },
    {
      // Korepetycje online → brak adresu (spełnia wymóg „min. 1 bez address").
      // Tryb „na akceptację" (spełnia wymóg „min. 1 approval").
      id: "korki-matma",
      slug: "korki-matma",
      name: "Korepetycje Matematyka",
      category: "edukacja",
      avatarInitials: "KM",
      city: "Warszawa",
      address: null,
      distanceKm: 0,
      bookingMode: "approval",
      visibleInSearch: true,
      multiSelect: false,
      locations: [
        { id: "loc-km-online", label: "Online", address: null },
      ],
      services: [
        { id: "svc-km-1", name: "Konsultacja wstępna", durationMin: 30, price: null, subtitle: "Bezpłatne omówienie potrzeb" },
        { id: "svc-km-2", name: "Korepetycje — 1h", durationMin: 60, price: 80, subtitle: "Matematyka, poziom szkolny" },
        { id: "svc-km-3", name: "Przygotowanie do matury", durationMin: 90, price: 120, subtitle: "Intensywne powtórki" },
      ],
      availability: [],
      busy: [
        { startISO: "2026-07-16T17:00:00", endISO: "2026-07-16T18:00:00" },
      ],
    },
    {
      // Ukryta w katalogu — dostępna tylko z linku/slug (visibleInSearch:false).
      id: "kosmetyka-anna",
      slug: "kosmetyka-anna",
      name: "Kosmetyka Anna",
      category: "uroda",
      avatarInitials: "KA",
      city: "Warszawa",
      address: "ul. Grójecka 5, Warszawa",
      distanceKm: 3.3,
      bookingMode: "auto",
      visibleInSearch: false,
      multiSelect: true,
      locations: [
        { id: "loc-ka-1", label: "Gabinet", address: "ul. Grójecka 5, Warszawa" },
      ],
      services: [
        { id: "svc-ka-1", name: "Oczyszczanie twarzy", durationMin: 60, price: 160, subtitle: "Głębokie oczyszczanie" },
        { id: "svc-ka-2", name: "Peeling kawitacyjny", durationMin: 45, price: 130, subtitle: "Rozświetlenie skóry" },
        { id: "svc-ka-3", name: "Makijaż okolicznościowy", durationMin: 60, price: 150, subtitle: "Na specjalne okazje" },
      ],
      availability: [],
      busy: [],
    },
    {
      id: "fizjo-ruch",
      slug: "fizjo-ruch",
      name: "Fizjoterapia Ruch",
      category: "zdrowie",
      avatarInitials: "FR",
      city: "Warszawa",
      address: "ul. Mokotowska 15, Warszawa",
      distanceKm: 5.0,
      bookingMode: "approval",
      visibleInSearch: true,
      multiSelect: false,
      locations: [
        { id: "loc-fr-1", label: "Gabinet", address: "ul. Mokotowska 15, Warszawa" },
      ],
      services: [
        { id: "svc-fr-1", name: "Konsultacja fizjoterapeutyczna", durationMin: 45, price: 140, subtitle: "Ocena i plan terapii" },
        { id: "svc-fr-2", name: "Terapia manualna", durationMin: 60, price: 170, subtitle: "Praca z kręgosłupem" },
        { id: "svc-fr-3", name: "Rehabilitacja pourazowa", durationMin: 60, price: 160, subtitle: "Powrót do sprawności" },
      ],
      availability: [],
      busy: [
        { startISO: "2026-07-17T09:00:00", endISO: "2026-07-17T10:00:00" },
      ],
    },
  ];

  // Tygodniowe grafiki dostępności → generujemy konkretne dni na okno ~2 tyg.
  // dow: 0=nd, 1=pon … 6=sob.
  const WEEKLY = {
    "grzesiu-barber": {
      1: [{ from: "10:00", to: "18:00", locationId: "loc-gb-1", recurring: true }],
      2: [{ from: "10:00", to: "18:00", locationId: "loc-gb-1", recurring: true }],
      3: [{ from: "10:00", to: "18:00", locationId: "loc-gb-1", recurring: true }],
      4: [{ from: "10:00", to: "18:00", locationId: "loc-gb-1", recurring: true }],
      5: [
        { from: "10:00", to: "14:00", locationId: "loc-gb-1", recurring: true },
        { from: "15:00", to: "19:00", locationId: "loc-gb-2", recurring: false },
      ],
      6: [{ from: "10:00", to: "14:00", locationId: "loc-gb-1", recurring: true }],
    },
    "studio-bella": {
      1: [{ from: "09:00", to: "17:00", locationId: "loc-sb-1", recurring: true }],
      2: [{ from: "09:00", to: "17:00", locationId: "loc-sb-1", recurring: true }],
      3: [{ from: "09:00", to: "17:00", locationId: "loc-sb-1", recurring: true }],
      4: [{ from: "09:00", to: "17:00", locationId: "loc-sb-1", recurring: true }],
      5: [{ from: "09:00", to: "17:00", locationId: "loc-sb-1", recurring: true }],
      6: [{ from: "10:00", to: "15:00", locationId: "loc-sb-1", recurring: false }],
    },
    "masaz-relaks": {
      1: [{ from: "12:00", to: "20:00", locationId: "loc-mr-1", recurring: true }],
      2: [{ from: "08:00", to: "14:00", locationId: "loc-mr-1", recurring: true }],
      3: [{ from: "12:00", to: "20:00", locationId: "loc-mr-1", recurring: true }],
      4: [{ from: "08:00", to: "14:00", locationId: "loc-mr-1", recurring: true }],
      5: [{ from: "12:00", to: "20:00", locationId: "loc-mr-1", recurring: true }],
    },
    "auto-detailing-pro": {
      1: [{ from: "08:00", to: "16:00", locationId: "loc-ad-1", recurring: true }],
      2: [{ from: "08:00", to: "16:00", locationId: "loc-ad-1", recurring: true }],
      3: [{ from: "08:00", to: "16:00", locationId: "loc-ad-1", recurring: true }],
      4: [{ from: "08:00", to: "16:00", locationId: "loc-ad-1", recurring: true }],
      5: [{ from: "08:00", to: "16:00", locationId: "loc-ad-1", recurring: true }],
      6: [{ from: "09:00", to: "13:00", locationId: "loc-ad-1", recurring: false }],
    },
    "korki-matma": {
      1: [{ from: "16:00", to: "20:00", locationId: "loc-km-online", recurring: true }],
      2: [{ from: "16:00", to: "20:00", locationId: "loc-km-online", recurring: true }],
      3: [{ from: "16:00", to: "20:00", locationId: "loc-km-online", recurring: true }],
      4: [{ from: "16:00", to: "20:00", locationId: "loc-km-online", recurring: true }],
      0: [{ from: "10:00", to: "14:00", locationId: "loc-km-online", recurring: false }],
    },
    "kosmetyka-anna": {
      2: [{ from: "11:00", to: "19:00", locationId: "loc-ka-1", recurring: true }],
      3: [{ from: "11:00", to: "19:00", locationId: "loc-ka-1", recurring: true }],
      4: [{ from: "11:00", to: "19:00", locationId: "loc-ka-1", recurring: true }],
      5: [{ from: "11:00", to: "19:00", locationId: "loc-ka-1", recurring: true }],
      6: [{ from: "11:00", to: "19:00", locationId: "loc-ka-1", recurring: true }],
    },
    "fizjo-ruch": {
      1: [{ from: "08:00", to: "15:00", locationId: "loc-fr-1", recurring: true }],
      2: [{ from: "08:00", to: "15:00", locationId: "loc-fr-1", recurring: true }],
      3: [{ from: "08:00", to: "15:00", locationId: "loc-fr-1", recurring: true }],
      4: [{ from: "08:00", to: "15:00", locationId: "loc-fr-1", recurring: true }],
      5: [{ from: "08:00", to: "15:00", locationId: "loc-fr-1", recurring: true }],
    },
  };

  const DEMO_TODAY_ISO = "2026-07-16";

  function todayOpenHoursLabel(weekly) {
    if (!weekly || !Object.keys(weekly).length) return "Brak grafiku";
    const dow = new Date(DEMO_TODAY_ISO + "T00:00:00").getDay();
    const blocks = weekly[dow];
    if (!blocks || !blocks.length) return "Zamknięte dziś";
    return blocks.map(function (b) {
      return b.from + "–" + b.to;
    }).join(", ");
  }

  PROVIDERS.forEach(function (p) {
    const weekly = WEEKLY[p.id] || {};
    p.availability = buildAvailability(p.id, weekly);
    p.openHoursToday = todayOpenHoursLabel(weekly);
  });

  window.LOKALNIE_DATA = {
    PROVIDERS,
    CATEGORIES,
    HOLIDAYS_2026,
    CURRENT_USER,
    DEMO_TODAY_ISO,
  };
})();
