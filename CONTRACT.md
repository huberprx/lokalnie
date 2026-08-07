# CONTRACT — wspólny interfejs frontendu i API

Źródło prawdy dla nazw klas UI, atrybutów `data-*`, ID kontenerów oraz kontraktu
klienta API (`window.LokalnieApi`). Jeśli musisz odstąpić od kontraktu — zgłoś
to jako **ZMIANA KONTRAKTU**.

Aplikacja: statyczny SPA + Cloudflare Worker (`worker/`).
Uruchomienie frontu: `npm start` → http://127.0.0.1:8080
API lokalnie: `cd worker && npm run dev` → http://localhost:8787

---

## 1. Podział własności plików

- **UI / shell**: `index.html`, `styles.css`, `legal.css`, PWA (`sw.js`, `manifest.webmanifest`).
- **Stan i render**: `data.js` (mocki / kategorie — tylko poza produkcją w katalogu),
  `api.js` (`window.LokalnieApi`), `app.js` (stan, router, booking, panel usługodawcy).
- **Backend**: katalog `worker/` (Workers + D1 + R2). Szczegóły endpointów: `worker/README.md`.
- Logika frontu renderuje zawartość `#app-fullscreen` przez `innerHTML`/DOM.
  Nie zmieniaj `index.html` / `styles.css` poza bumpem `?v=` i `APP_VERSION` / `CACHE` w `sw.js`.

## 2. Ładowanie skryptów (`index.html`, koniec `<body>`)

```html
<script src="data.js?v=…"></script>
<script src="api.js?v=…"></script>
<script src="app.js?v=…"></script>
```

Każdy moduł wystawia API na `window` (bez ES modules).

## 3. Mount i shell

- Root aplikacji: `#page-app`, montaż: `#app-fullscreen`.
- Toast: `#app-toast`.
- Publiczne trasy SPA: `/:slug`, `/embed/:slug` (obsługa w `app.js` → `openProvider`).

## 4. `window.LokalnieApi` (api.js)

Ważniejsze metody:

| Metoda | Opis |
|---|---|
| `syncFromServer()` | `/me` + usługi/dostępność/CRM + bookings/requests |
| `loadCatalog(params)` | `GET /providers` → `AppState.catalogProviders` |
| `fetchProviderBySlug(slug)` | `GET /providers/:slug` (+ services, availability) |
| `updateMe` / `updateProviderMe` / `createProviderMe` | Profil |
| `createBookingFromApp` / `createRequestFromApp` | Mutacje z `Idempotency-Key` |
| `uploadAvatar` / `uploadServicePhoto` | `POST /media` |
| `toApiProviderId` / `toAppProviderId` | Mostek demo `grzesiu-barber` ↔ `provider-demo-gb` |

Sesja: produkcja = cookie HttpOnly (`credentials: "include"`);
poza produkcją opcjonalnie Bearer / `X-Demo-User: demo`.

## 5. Publiczne API katalogu

- `GET /providers` — tylko `visible_in_search=1` i nie dezaktywowane; bez prywatnego e-maila gdy `emailVisible=false`.
  - Parametry tekstowe: `q`, `city`, `category`, `subcategory`, `limit`, `offset`.
  - Parametry geo (łącznie): `latitude`, `longitude`, `radiusKm` (allowlista: 5–50).
  - Przy geo: bounding box + Haversine po stronie Workera; sortowanie po `distanceKm`; lokale online (bez adresu) zawsze widoczne; paginacja po filtracji.
  - Odpowiedź może zawierać `distanceKm`, `distanceLabel`, `location`, `search`.
- `GET /geo/suggest?q=` — podpowiedzi miejsc (geokoder po stronie API; rate limit).
- `GET /providers/:slug` — profil aktywny (także ukryty w wyszukiwaniu), z `services` i `availability`.
- `avatar_key` w API = `media.id`; URL = `/media/:id`.
- Lokalizacja użytkownika (GPS) jest używana wyłącznie do wyszukiwania; nie jest logowana ani wymagana przy serwisie.

## 6. Stan (`AppState`)

- Klucz localStorage: `lokalnie.state`.
- `catalogProviders` — cache katalogu z API; **nie** persystowany.
- Na produkcji bookings/requests/CRM/profile nie są trzymane lokalnie jako źródło prawdy — pochodzą z API.
- `clientAddress` na bookingu/requestcie jest lokalne / mostkiem do CRM (`provider_clients.address`); API rezerwacji nie ma kolumny adresu klienta.
- `requestMode` wyprowadzany po sync: puste `days` → `request`, niepuste → `approval`.

## 7. Kanoniczne nazwy klas UI

Nawigacja/role:

- `.app-shell`, `.app-shell[data-role="client"|"provider"]`
- `.role-switch` + `.role-switch__btn[data-role]`
- `.bottom-nav` + `.bottom-nav__item[data-tab="favorites"|"search"|"myCalendar"]`
- `.provider-tabs` + `.provider-tabs__item[data-tab="dashboard"|"calendar"|"requests"|"services"|"availability"|"settings"]`
- `.topbar`, `.topbar__title`, `.topbar__back`

Listy / karty usługodawcy: `.provider-list`, `.provider-card`, `[data-action="open-provider"][data-slug]`.

Booking: `.provider-booking-panel`, `[data-booking-mode]`, CTA `[data-action="send-request"|"confirm-booking"]`.

Pełniejszy katalog klas historycznych: patrz wcześniejsze sekcje PLAN.md; nowe klasy
uzgadniać przed użyciem po obu stronach UI.

## 8. Wersjonowanie cache

Przy zmianie `app.js` / `api.js` / `data.js` / `styles.css`:

1. Podbij `?v=` w `index.html`
2. Podbij `APP_VERSION` w `app.js`
3. Podbij `CACHE` w `sw.js` (ten sam numer)
