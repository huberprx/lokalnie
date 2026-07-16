# CONTRACT — wspólny interfejs dla backend (JS) i frontend (HTML/CSS)

To jest ŹRÓDŁO PRAWDY dla nazw klas, atrybutów `data-*`, ID kontenerów i API JS.
Backend i frontend pracują RÓWNOLEGLE, więc obie strony MUSZĄ trzymać się tych nazw
DOSŁOWNIE. Jeśli musisz odstąpić od kontraktu — NIE zgaduj: zatrzymaj się i zgłoś to
w podsumowaniu jako "ZMIANA KONTRAKTU", żeby orkiestrator zsynchronizował drugą stronę.

Aplikacja to statyczny prototyp (bez backendu serwerowego). Uruchomienie:
`python3 -m http.server 8080` → http://localhost:8080

---

## 1. Podział własności plików
- **frontend**: `index.html` (cała statyczna struktura strony, sekcja symulatora,
  paski narzędzi, PUSTE kontenery montażu, tagi `<script>`), `styles.css` (wszystkie style,
  animacje, responsywność, `prefers-reduced-motion`).
- **backend**: `data.js`, `app.js`, `simulator.js`, `booking.js`, `provider.js`,
  oraz refaktor `chat.js` (M9). Backend renderuje CAŁĄ zawartość wnętrza kontenerów montażu
  przez `innerHTML`/DOM. Backend NIE zmienia `index.html` ani `styles.css`.
- Wspólne: obie strony czytają `PLAN.md` i ten `CONTRACT.md`.

## 2. Ładowanie skryptów (index.html, kolejność na końcu <body>)
```html
<script src="data.js"></script>
<script src="app.js"></script>
<script src="simulator.js"></script>
<script src="booking.js"></script>
<script src="provider.js"></script>
<script src="chat.js"></script>
<script src="calendar.js"></script>
```
Każdy moduł JS wystawia swoje API na `window` (bez modułów ES/importów — czysta statyka).

## 3. Struktura symulatora (frontend w index.html)
```html
<section class="simulator" id="simulator">
  <div class="simulator__stage">
    <!-- Podgląd KLIENTA -->
    <div class="sim-preview" data-side="client">
      <div class="sim-toolbar">
        <div class="sim-viewtoggle" role="radiogroup" aria-label="Widok podglądu klienta">
          <button type="button" data-side="client" data-view="mobile"  aria-pressed="true">Mobile</button>
          <button type="button" data-side="client" data-view="desktop" aria-pressed="false">Desktop</button>
        </div>
      </div>
      <div class="sim-viewport">
        <div class="device-frame" data-view="mobile" data-instance="client">
          <div class="app-mount" id="app-client"></div>
        </div>
      </div>
    </div>
    <!-- Podgląd USŁUGODAWCY (analogicznie, data-side="provider", id="app-provider") -->
    <div class="sim-preview" data-side="provider"> … #app-provider … </div>
  </div>
  <div class="simulator__cta">
    <button type="button" class="btn btn--primary" data-action="open-fullscale" data-side="client">Otwórz w pełnej skali</button>
  </div>
</section>
```
- Mount pointy: **`#app-client`** i **`#app-provider`** (backend renderuje do nich).
- Ramka: **`.device-frame[data-view="mobile"|"desktop"]`** — CSS steruje układem po `data-view`.
- Toggle: przyciski **`.sim-viewtoggle button[data-side][data-view]`**, stan przez `aria-pressed`.
- Pełna skala: element z **`[data-action="open-fullscale"]`** i `data-side`.

## 4. simulator.js (backend) — API i reguły
- `window.Simulator.init()` — podpina listenery do `.sim-viewtoggle button` i `[data-action="open-fullscale"]`.
- `window.Simulator.setView(side, view)` — side ∈ `'client'|'provider'`, view ∈ `'mobile'|'desktop'`.
  Ustawia `data-view` na właściwej `.device-frame`, aktualizuje `aria-pressed` obu przycisków danego side.
- Reguła "jeden desktop": jeśli ustawiasz `desktop` dla jednej strony, a druga jest `desktop`,
  przełącz drugą na `mobile`. Dwa `mobile` dozwolone.
- Klasa `.device-frame--fullscale` na ramce włącza pełną skalę (frontend stylizuje). Toggle przez `[data-action="open-fullscale"]`.
- Stan widoku zapisywany w `localStorage` pod kluczem globalnego stanu (patrz §6).

## 5. app.js (backend) — stan, router, render
- `window.AppState` = `{ role:{client:'client', provider:'provider'}, screen:{client, provider}, params:{client, provider}, favorites:[], bookings:[], requests:[], notifications:[], simView:{client:'mobile', provider:'mobile'} }`.
  (Każda instancja "client"/"provider" ma własny bieżący ekran; obie współdzielą dane bookings/requests/favorites.)
- `window.App.navigate(instance, screen, params)` — instance ∈ `'client'|'provider'`.
- `window.App.render(instance)` — rerenderuje zawartość `#app-<instance>`.
- `window.App.renderAll()` — rerenderuje obie instancje (wołane po każdej mutacji stanu).
- `window.App.setRole(instance, role)`, `window.App.loadState()`, `window.App.saveState()`, `window.App.resetDemo()`.
- Ekrany (nazwy `screen`): `home` (nie dotyczy — home to symulator), `search`, `profile`, `booking`,
  `login`, `myCalendar`, `favorites`, `providerPanel`.
- Po KAŻDEJ mutacji stanu backend woła `saveState()` + `renderAll()` → to daje współdzielenie
  między podglądem klienta a usługodawcy (jak dzisiejsza synchronizacja czatu).

## 6. localStorage
- Klucz stanu aplikacji: **`lokalnie.state`** (JSON całego `AppState`).
- Reset: `window.App.resetDemo()` czyści `lokalnie.state` i przeładowuje stan z `data.js`.
- Istniejący klucz `lokalnie.googleCalendars` (calendar.js) zostaje bez zmian.

## 7. Kanoniczne nazwy klas UI (frontend stylizuje, backend generuje)
Nawigacja/role:
- `.app-shell` (root wnętrza mountu), `.app-shell[data-role="client"|"provider"]`.
- `.role-switch` + `.role-switch__btn[data-role]` (aria-pressed).
- `.bottom-nav` + `.bottom-nav__item[data-tab="favorites"|"search"|"myCalendar"]` (klient).
- `.provider-tabs` + `.provider-tabs__item[data-tab="dashboard"|"calendar"|"requests"|"services"|"availability"|"settings"]`.
- `.topbar`, `.topbar__title`, `.topbar__back` (strzałka powrotu).

Katalog / profil:
- `.search`, `.search__input`, `.category-chips` + `.category-chip[data-category]`.
- `.provider-card[data-slug]` z `.provider-card__name`, `.provider-card__cat`, `.provider-card__distance`, `.provider-card__avatar`.
- `.profile`, `.profile__header`, `.fav-btn[aria-pressed]` (serce), `.share-links` + `.share-link[data-share="calendar"|"page"|"widget"]`.
- Usługi: `.service-card[data-service-id]`, stan wyboru `.service-card--selected`, checkmark `.service-card__check`.
- Pasek podsumowania wyboru: `.selection-summary` z `.selection-summary__duration`, `.selection-summary__price`, `.selection-summary__cta`.

Rezerwacja (te SAME elementy w mobile i desktop; różni tylko układ przez `.device-frame[data-view]`):
- Root: `.booking` z sekcjami `.booking__services`, `.booking__calendar`, `.booking__times`.
- Nagłówek mobile: `.booking__header` (nazwa usługi + czas + cena + `.topbar__back`).
- Kalendarz: `.cal`, `.cal__nav`, `.cal__grid`, `.cal__day[data-date]`, `.cal__day--holiday`, `.cal__day--selected`.
- Lista godzin: `.time-list` + `.time-row[data-slot]` z `.time-row__range` (np. `14:15→15:15`),
  `.time-row__place` (etykieta miejsca), `.time-row__btn` (domyślnie szary; wybrany `.time-row--selected`).

Modal / .ics:
- `.modal` (overlay) + `.modal__card`, `.modal__close`, przycisk `[data-action="download-ics"]`.

Panel usługodawcy:
- `.dashboard`, `.visit-card[data-booking-id]`, `.status-badge[data-status]` (statusy: `confirmed|pending|proposed|rejected|cancelled`).
- Prośby: `.request-card[data-request-id]`.
- Dostępność: `.week`, `.week__nav`, `.week__days`, `.week__day[data-date]`, `.week__day--holiday`,
  przyciski `[data-action="recurring"]` (↻), `[data-action="clear-day"]` (X), pola godzin `[data-field="from"]`/`[data-field="to"]`,
  wybór miejsca `[data-field="location"]`.
- Ustawienia: `.settings` z polami `[data-field="slug"|"address"|"bookingMode"|"visibleInSearch"|"locations"]`.

Wspólne przyciski/statusy:
- `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--danger`.
- `.status-badge[data-status]` — kolor wg `data-status`.
- Powiadomienia w aplikacji: `.toast` / `.notif-item`.

## 8. data.js (backend) — kształt danych
`window.LOKALNIE_DATA = { PROVIDERS:[…], CATEGORIES:[…], HOLIDAYS_2026:[…], CURRENT_USER:{…} }`
- `Provider { id, slug, name, category, avatarInitials, city, address|null, distanceKm,
  bookingMode:'auto'|'approval', visibleInSearch:bool, multiSelect:bool,
  locations:[{id,label,address}], services:[Service], availability:[DayAvailability], busy:[BusyBlock] }`
- `Service { id, name, durationMin, price|null, subtitle }`
- `DayAvailability { dateISO, blocks:[{ id, from:'HH:MM', to:'HH:MM', locationId, recurring:bool }] }`
- `BusyBlock { startISO, endISO }`
- `CATEGORIES: [{ id, label }]`, `HOLIDAYS_2026: ['YYYY-MM-DD', …]`, `CURRENT_USER:{ name, loggedIn:bool, providerRole:{active:bool, trialDaysLeft:number} }`.
- 6–8 providerów, „Grzesiu Barber" jako wiodący. Co najmniej jeden `bookingMode:'approval'`,
  co najmniej jeden bez `address`, co najmniej jeden `visibleInSearch:false`.

## 9. Akcenty kolorów ról
- Klient = niebieski (`--accent-client`), usługodawca = zielony (`--accent-provider`).
  Zmienne definiuje frontend w `:root`; backend używa klas, nie kolorów inline.

## 10. Kontrakt slotów (booking.js — backend)
- `window.Booking.computeSlots(provider, dateISO, totalDurationMin) -> [{ id, startISO, endISO, label:'HH:MM→HH:MM', locationLabel }]`
- Siatka co 15 min; `wolne = dostępność − busy − istniejące bookings`. Domyślnie zaznacz najbliższy wolny.
- `window.Booking.generateICS(booking) -> string` (VCALENDAR/VEVENT), `window.Booking.downloadICS(booking)`.
