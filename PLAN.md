## Jak rozumiem zadanie

Budujemy **klikalny prototyp UI/UX (bez backendu)** aplikacji **Lokalnie** — platformy rezerwacji usług lokalnych w modelu à la Booksy, gdzie jeden użytkownik ma dwie role (klient ↔ usługodawca), a profil usługodawcy jest zarazem publiczną stroną z linkiem.

Obecny stan repo to statyczna „makieta podglądu": dwie kolumny (telefon klienta po lewej, telefon usługodawcy po prawej), lista usług Grzesiu Barber, czat synchronizowany między stronami (`chat.js`) i osadzony Kalendarz Google pod każdym ekranem (`calendar.js`). Ciemny motyw, DM Sans, wszystko na jednym `index.html`.

Zadanie ma dwa poziomy:

1. **Nowy, wyróżniony wymóg — symulator na stronie głównej.** Dwa podglądy obok siebie (ekran klienta + ekran usługodawcy) pokazujące ten sam proces z obu perspektyw, w pomniejszonej skali. Nad każdym podglądem przełącznik **desktop / mobile** z **płynną animacją** (zmiana szerokości i układu jak w prawdziwej responsywnej aplikacji). Reguła: **tylko jeden podgląd może być desktopowy** — przełączenie drugiego na desktop automatycznie cofa pierwszy do mobile; **dwa mobile mogą współistnieć**. Na wąskich ekranach podglądy **układają się jeden pod drugim**. Symulator jest **demonstracyjny** — gość realnie steruje widokiem (i klika przez zamockowany flow), ale nie wykonuje prawdziwych operacji (brak backendu).

2. **Cała faza UI/UX prototypu** (sekcja 13 spec) — kompletny, klikalny szkielet ekranów na danych mockowych: przełącznik ról + dolne menu (Ulubione / Szukaj / Mój kalendarz), katalog (wyszukiwarka + kategorie + firmy z mock-dystansem), profil usługodawcy z listą usług (jedna/wiele, checkmarki, suma czasu i ceny), ekran rezerwacji (desktop 3-kolumnowy + mobile pionowy, kalendarz + lista godzin start→koniec, kolor po wyborze, etykieta miejsca), potwierdzenie + popup „Zapisz do kalendarza" (.ics), panel usługodawcy (pulpit, kalendarz rezerwacji, prośby, usługi, dostępność tygodniowa z ↻/X/miejscami, ustawienia) oraz oba tryby rezerwacji (automatyczny i „na akceptację").

Kluczowa decyzja spajająca oba poziomy: **te same ekrany aplikacji renderowane wewnątrz podglądów symulatora są jednocześnie klikalnym prototypem.** Podgląd klienta i podgląd usługodawcy współdzielą jeden stan mockowy w pamięci, więc akcja u klienta (np. wysłanie prośby o termin) natychmiast pojawia się u usługodawcy — dokładnie tak, jak dziś działa synchronizacja czatu. To realizuje „pokazuje, co widzi każda strona w tym samym procesie" i utrzymuje najkrótszą ścieżkę UX (wszystko na jednej stronie, bez przeładowań).

---

## Decyzje (pytania rozstrzygnięte przez użytkownika)

1. **Relacja symulator ↔ pełny prototyp — DECYZJA:** podglądy symulatora **są** prototypem i są w pełni klikalne w pomniejszonej skali (CSS `transform: scale`), przy zachowaniu realnej klikalności. Dodatkowo CTA „Otwórz w pełnej skali", które wyłącza skalowanie wybranego podglądu (klient albo usługodawca) na całą szerokość.

2. **Zakres interaktywności w symulatorze na home — DECYZJA:** **pełna, swobodna klikalność wszystkich ekranów już w pomniejszonych podglądach** (bez zaskryptowanego autoplay). „Demonstracyjność" = brak realnych operacji backendowych (wszystko na mockach). Krok 7 modułu M1 (autoplay `playDemoFlow()`) — WYKREŚLONY z zakresu.

3. **Struktura plików — DECYZJA:** dokładamy modularne pliki (`data.js`, `simulator.js`, `app.js`, `booking.js`, `provider.js`), zachowując `chat.js` i `calendar.js`.

4. **Kalendarz Google — przyjęte założenie:** kalendarze dostępności/rezerwacji rysujemy **własnym mockiem**; istniejący embed Google zostaje jako opcjonalna sekcja „Podłącz swój kalendarz Google" (zajętość symulowana).

5. **Dane mockowe — przyjęte założenie:** 6–8 firm w 4–5 kategoriach (Fryzjer/Barber, Kosmetyka/Paznokcie, Masaż/Fizjo, Auto/Detailing, Korepetycje), mock-dystans w km; „Grzesiu Barber" profilem wiodącym.

6. **Trwałość stanu — przyjęte założenie:** zapis do `localStorage` (klucz `lokalnie.state`) + przycisk „Zresetuj demo".

7. **Logowanie — przyjęte założenie:** mockowy ekran logowania (bez walidacji) w drodze bezpośredniej; ekran aktywacji roli usługodawcy (trial/subskrypcja) tylko wizualny, bez Stripe.

8. **Animacja przełącznika — przyjęte założenie:** animowana szerokość ramki + płynne przejście układu (mobile pionowy ↔ desktop wielokolumnowy), z `prefers-reduced-motion`; bez „magic move" pojedynczych elementów.

9. **Język/waluta/strefa — przyjęte założenie:** PL / „zł" / Europe/Warsaw.

10. **Święta — przyjęte założenie:** statyczna lista polskich świąt 2026 w `data.js`.

---

## Najkrótsza ścieżka UX

**A. Symulator na stronie głównej (cel: zobaczyć obie strony + przełączyć widok)**
- Wejście na stronę → symulator widoczny od razu (0 kliknięć).
- Zmiana widoku podglądu: **1 klik** (Desktop/Mobile nad danym podglądem). Reguła „jeden desktop" egzekwowana automatycznie (0 dodatkowych kliknięć).
- Wejście w pełny prototyp: **1 klik** („Wypróbuj" / „Otwórz w pełnej skali").

**B. Klient — droga bezpośrednia (z linku, najkrótsza do rezerwacji) — tryb automatyczny**
- Profil usługodawcy → usługa → godzina → „Potwierdź" = **3 kliknięcia** do rezerwacji (logowanie mock jako 1 ekran pośredni: +1 klik „Zaloguj").
- Popup „Zapisz do kalendarza" → „Pobierz .ics" = **1 klik**.

**C. Klient — droga katalogowa**
- Szukaj → firma z listy → usługa → godzina → Potwierdź = **4 kliknięcia**.

**D. Klient — tryb „na akceptację"**
- Profil → usługa → „Wyślij prośbę o termin" = **2 kliknięcia** (klient nie widzi slotów). Później akceptacja propozycji = **1 klik**.

**E. Usługodawca — obsługa prośby (tryb 2)**
- Panel → „Prośby" → wybór prośby → godzina → „Zaproponuj termin" = **3 kliknięcia**.

**F. Usługodawca — ustawienie dostępności**
- Panel → „Dostępność" → dzień → godziny od–do (+ ↻ cykl / X wyczyść / etykieta miejsca) = **2–3 kliknięcia** na dzień.

---

## Plan wdrożenia (kroki)

Plan podzielony na moduły (M0–M9). Zalecana kolejność realizacji: M0 → M1 → M2 → M3–M8 (ekrany app) → M9. Symulator (M1) i szkielet danych (M0) są fundamentem.

### M0. Fundament: dane mockowe + stan + router ekranów
1. **[plik: `data.js` — nowy]** Model danych mockowych.
   - Eksporty (globalne `window.LOKALNIE_DATA` lub `const`): `PROVIDERS`, `CATEGORIES`, `HOLIDAYS_2026`, `CURRENT_USER`.
   - Kształt: `Provider { id, slug, name, category, avatarInitials, city, address?, distanceKm, bookingMode: 'auto'|'approval', visibleInSearch: boolean, multiSelect: boolean, locations: string[], services: Service[], availability: DayAvailability[], busy: BusyBlock[] }`; `Service { id, name, durationMin, price?|null, subtitle }`; `DayAvailability { dateISO, blocks: [{ from, to, locationId, recurring: boolean }] }`; `BusyBlock { startISO, endISO }`.
   - Oczekiwany efekt: jedno źródło prawdy dla katalogu, profilu, slotów.
2. **[plik: `app.js` — nowy]** Warstwa stanu + prosty router ekranów wewnątrz „aplikacji".
   - Sygnatury: `const AppState = { role:'client'|'provider', screen:string, params:object, favorites:Set, bookings:[], requests:[], view:{client, provider} }`; `function navigate(screen, params)`; `function setRole(role)`; `function renderApp(instance)`; `function loadState()/saveState()` (localStorage `lokalnie.state`).
   - Oczekiwany efekt: zmiana `AppState` → przerysowanie odpowiednich ekranów w obu instancjach (klient/usługodawca).
3. **[plik: `index.html`]** Dodanie `<script src="data.js">`, `app.js`, `simulator.js`, `booking.js`, `provider.js` przed `chat.js`/`calendar.js`; kontenery `#app-client` i `#app-provider` (montaż ekranów).
   - Oczekiwany efekt: szkielet montażu bez błędów w konsoli.

### M1. Symulator na stronie głównej (NOWY WYMÓG) — priorytet
4. **[plik: `index.html`]** Sekcja hero + `<section class="simulator" id="simulator">` z dwoma podglądami.
   - Struktura: `.simulator__stage` → `.sim-preview[data-side="client"]` i `.sim-preview[data-side="provider"]`; każdy zawiera `.sim-toolbar` (`.sim-viewtoggle` = 2 przyciski `[data-view="desktop"]` / `[data-view="mobile"]`, `role="radiogroup"`, `aria-pressed`) oraz `.sim-viewport` → `.device-frame[data-view="mobile"]` z zamontowanym ekranem app.
   - CTA: „Wypróbuj pełny prototyp" (przełącza na tryb pełnej skali / scroll do app).
   - Oczekiwany efekt: dwa podglądy obok siebie, każdy z własnym przełącznikiem.
5. **[plik: `simulator.js` — nowy]** Logika przełącznika i reguł.
   - Sygnatury: `function setView(side:'client'|'provider', view:'desktop'|'mobile')`; `function enforceSingleDesktop(changedSide)`; `function initSimulator()`; stan `const simView = { client:'mobile', provider:'mobile' }` (+ zapis do localStorage).
   - Reguła: w `setView`, jeśli `view==='desktop'` i drugi podgląd jest `desktop` → ustaw drugi na `mobile` (animowane). Dwa `mobile` dozwolone.
   - Oczekiwany efekt: klik desktop w jednym podglądzie cofa drugi do mobile; stan `aria-pressed` i `data-view` aktualizowane.
6. **[plik: `styles.css`]** Style + animacja symulatora.
   - Klasy: `.simulator__stage` (grid 2 kolumny), `.device-frame` z transition na `width`/`max-width` (np. mobile `--w:320px`, desktop `--w:760px`) i płynną zmianą układu wewnętrznego; `[data-view="desktop"]` vs `[data-view="mobile"]`; skalowanie `transform: scale(var(--sim-scale))` + `transform-origin`.
   - Reguła responsywna: `@media (max-width: 900px) { .simulator__stage { grid-template-columns: 1fr } }` (podglądy jeden pod drugim).
   - `@media (prefers-reduced-motion: reduce)` — wyłączenie transition.
   - Oczekiwany efekt: płynna zmiana szerokości/układu; na telefonie podglądy w pionie.
7. ~~Autoplay demo~~ — WYKREŚLONY decyzją #2: podglądy są w pełni klikalne, bez zaskryptowanego przebiegu.

### M2. Szkielet nawigacji + role
8. **[plik: `index.html` / render w `app.js`]** Górny przełącznik ról (klient/usługodawca) w ramce app + dolne menu klienta.
   - Elementy: `.role-switch` (Klient | Usługodawca), `.bottom-nav` z 3 pozycjami: `Ulubione` · `Szukaj` · `Mój kalendarz` (ikony + label).
   - Sygnatury: `renderBottomNav(activeTab)`, `renderRoleSwitch(role)`.
   - Oczekiwany efekt: przełączanie roli zmienia zestaw ekranów; dolne menu przełącza zakładki klienta.
9. **[plik: `styles.css`]** Style nawigacji dolnej i przełącznika ról spójne z motywem (akcent klienta = niebieski, usługodawcy = zielony).

### M3. Katalog klienta (Szukaj)
10. **[plik: `app.js`]** Ekran `search`: pole wyszukiwania + kategorie + lista firm z dystansem.
    - Sygnatury: `renderSearch(query, category)`, `filterProviders({query, category})`, `renderProviderCard(provider)` (nazwa, kategoria, `distanceKm`, avatar).
    - Reguła: firmy bez adresu **nie** pojawiają się w wyszukiwaniu po miejscowości+odległości; z `visibleInSearch:false` — ukryte w katalogu, dostępne tylko z linku/slug.
    - Oczekiwany efekt: filtrowana lista, klik firmy → `navigate('profile', {slug})`.

### M4. Profil usługodawcy + usługi (= strona/slug)
11. **[plik: `app.js`]** Ekran `profile`: nagłówek firmy, serduszko ulubionych, lista usług, przyciski udostępniania.
    - Sygnatury: `renderProfile(slug)`, `toggleFavorite(providerId)`, `renderShareLinks(provider)` (3 formy: podgląd kalendarza / pełna strona / widget — mock linki `?slug=...`).
    - Usługi: wielo/pojedynczy wybór wg `provider.multiSelect`; checkmarki; suma czasu i ceny (z adnotacją przy usługach bez ceny). Reuse istniejącej mechaniki `service-card--selected` z `chat.js` (przeniesienie/uogólnienie).
    - Rozgałęzienie trybu: `bookingMode==='auto'` → CTA „Wybierz termin" (→ ekran rezerwacji ze slotami); `bookingMode==='approval'` → CTA „Wyślij prośbę o termin" (bez slotów).
    - Oczekiwany efekt: profil działa też z `?slug=` (droga bezpośrednia); suma czasu/ceny aktualizowana na żywo.
12. **[plik: `styles.css`]** Ikona serca (stan aktywny/nieaktywny), sekcja udostępniania, pasek podsumowania wyboru (suma czas/cena).

### M5. Ekran rezerwacji (wspólny wizualnie desktop/mobile)
13. **[plik: `booking.js` — nowy]** Ekran `booking` + logika slotów.
    - Sygnatury: `renderBooking({provider, selectedServices, role})`; `computeSlots(provider, dateISO, totalDurationMin)`; `renderTimeList(slots)`; `selectSlot(slotId)`; `confirmBooking()` (klient) / `proposeSlot()` (usługodawca).
    - Logika slotów: siatka co 15 min; długość = suma czasów usług; `wolne = dostępność − busy(Google mock) − istniejące rezerwacje`; domyślnie zaznaczony najbliższy wolny termin.
    - Układ: **desktop 3-kolumnowy** (lewa: lista usług przewijana / środek: kalendarz z dostępnością / prawa: lista godzin po kliknięciu dnia); **mobile pionowo** (góra: nazwa usługi+czas+cena + strzałka powrotu / kalendarz / lista godzin). Te same elementy wizualne — różnica tylko w rozkładzie (CSS grid/flow), sterowana `data-view`.
    - Lista godzin (wspólna): wiersz = `start→koniec` (np. 14:15→15:15) + przycisk (klient „Potwierdź" / usługodawca „Zaproponuj termin", domyślnie szary) + etykieta miejsca. Po wyborze wiersz zmienia kolor.
    - Oczekiwany efekt: identyczny zestaw elementów w obu widokach; potwierdzenie natychmiastowe.
14. **[plik: `styles.css`]** Layout 3-kolumnowy (desktop) i pionowy (mobile) sterowany `.device-frame[data-view]`; stany slotu (szary → wybrany kolor); etykieta miejsca.

### M6. Potwierdzenie + popup „Zapisz do kalendarza" (.ics)
15. **[plik: `booking.js`]** Popup po rezerwacji + generowanie .ics.
    - Sygnatury: `showSaveToCalendarModal(booking)`; `generateICS(booking)` → `Blob` typu `text/calendar` (VEVENT: tytuł, DTSTART/DTEND = czas usługi, LOCATION=adres, DESCRIPTION=usługa/czas/cena/usługodawca, VALARM przypomnienie, STATUS); `downloadICS(booking)`.
    - Oczekiwany efekt: „Pobierz .ics" pobiera plik działający w Google/Apple/Outlook; popup w mobile i desktop.
16. **[plik: `styles.css`]** Modal (overlay + karta), spójny z motywem.

### M7. Panel usługodawcy (MVP)
17. **[plik: `provider.js` — nowy]** Ekrany panelu + zakładki.
    - Zakładki/ekrany: `dashboard` (Dziś — nadchodzące wizyty), `calendar` (dzień/tydzień/miesiąc — mock), `requests` (lista próśb, tryb 2), `services` (zarządzanie usługami), `availability` (widok tygodniowy), `settings` (adres, slug, tryb rezerwacji, widoczność, lokalizacje, udostępnianie).
    - Sygnatury: `renderProviderPanel(tab)`, `renderDashboard()`, `renderRequests()`, `renderProviderCalendar(mode)`, `renderVisitDetails(bookingId)` (potwierdź/odrzuć/odwołaj + opcjonalny powód), `renderServicesEditor()`, `renderSettings()`.
    - Oczekiwany efekt: pełna, klikalna nawigacja panelu na danych mock.
18. **[plik: `provider.js`]** Zakładka **Dostępność** — widok tygodniowy.
    - Sygnatury: `renderWeek(weekOffset)` (u góry daty, poniżej dni tygodnia; przewijanie ←/→ między tygodniami), `setDayHours(dateISO, from, to)`, `toggleRecurring(dateISO)` (ikona ↻ jako toggle), `clearDay(dateISO)` (ikona X), `assignLocationToBlock(blockId, locationId)`; oznaczanie świąt z `HOLIDAYS_2026`.
    - Oczekiwany efekt: ustawianie godzin od–do, cykliczność, czyszczenie, różne miejsca w blokach tego samego dnia, święta widoczne.
19. **[plik: `styles.css`]** Style panelu: zakładki, widok tygodniowy (nagłówek dat + dni), przyciski ↻/X, znacznik święta, karty wizyt/próśb.

### M8. Dwa tryby rezerwacji (logika przepływu + statusy)
20. **[plik: `booking.js` / `app.js`]** Tryb 1 (automatyczny) i Tryb 2 (na akceptację) end-to-end na mockach.
    - Tryb 1: klient `confirmBooking()` → wizyta natychmiast w kalendarzu usługodawcy (status „Potwierdzona"); usługodawca `rejectVisit(id, reason?)` / `cancelVisit(id)`.
    - Tryb 2: klient `sendRequest(providerId, services)` → prośba „Oczekująca" u usługodawcy; usługodawca `proposeSlot(requestId, slot)` → status „Zaproponowany termin"; klient `acceptProposal(id)` (blokuje termin, zapisuje wizytę) / `rejectProposal(id)` (pętla propozycji).
    - Ekran doboru terminu (tryb 2, usługodawca): ten sam układ co widok klienta (usługa+klient po lewej, kalendarz w środku, godziny po prawej + „Zaproponuj termin").
    - Statusy jako etykieta+kolor: Potwierdzona / Oczekująca / Zaproponowany termin / Odrzucona / Odwołana.
    - Oczekiwany efekt: pełne pętle obu trybów działają między instancją klienta i usługodawcy.

### M9. Powiadomienia, „Mój kalendarz", spójność, sprzątanie
21. **[plik: `app.js`]** Ekran klienta „Mój kalendarz" + powiadomienia w aplikacji.
    - Sygnatury: `renderMyCalendar()` (lista wizyt ze statusem/kolorem + akcja „Wybierz inny termin" przy odrzuceniu/odwołaniu), `pushInAppNotification(text)`.
    - Oczekiwany efekt: statusy i akcja ponownego wyboru terminu; (e-mail i anulujący .ics — poza fazą, patrz „Co pominąć").
22. **[plik: `chat.js`]** Uogólnienie/porządek: przeniesienie mechaniki wyboru usług do wspólnego modułu, zachowanie synchronizacji klient↔usługodawca; usunięcie martwego kodu po refaktorze.
23. **[plik: `README.md`]** Aktualizacja: nowe ekrany, jak uruchomić (`python3 -m http.server 8080`), reset demo.

---

## Podział pracy

- **frontend** (HTML/CSS + weryfikacja wizualna zrzutem):
  - M1 kroki 4, 6 (symulator: markup + animacja/responsywność), M2 krok 9, M4 krok 12, M5 krok 14, M6 krok 16, M7 krok 19.
  - Odpowiada za: layout desktop 3-kol / mobile pionowy, animacja przełącznika (width + re-layout + `prefers-reduced-motion`), stacking na mobile, spójność motywu (DM Sans, kolory ról).
- **backend** (logika JS na mockach — bez serwera):
  - M0 (kroki 1–2), M1 krok 5 (reguła „jeden desktop"), M3 krok 10, M4 krok 11, M5 krok 13 (sloty), M6 krok 15 (.ics), M7 kroki 17–18, M8 krok 20, M9 kroki 21–22.
  - Odpowiada za: model danych, router ekranów, `computeSlots`, generowanie .ics, obie pętle trybów, stan w localStorage.
- **test-runner**:
  - Uruchomienie `python3 -m http.server 8080`, przejście wszystkich ścieżek UX (A–F), sprawdzenie konsoli bez błędów, weryfikacja reguły „jeden desktop", stackingu na wąskim viewporcie, pobierania .ics, obu trybów rezerwacji end-to-end. Naprawa błędów w pętli do zieleni.

---

## Co pominąć (poza zakresem)

- **Backend i infrastruktura:** Supabase (Auth, Postgres, PostGIS), Vercel/Netlify.
- **Realne płatności:** Stripe, trial 14 dni, subskrypcja 5 zł/mies, webhooki — tylko ekrany-atrapy.
- **Realne Google Calendar API / OAuth** — zajętość zasilana mockiem; istniejący embed pozostaje jako opcja demonstracyjna, bez realnej synchronizacji.
- **Geokodowanie/mapy:** Nominatim, Leaflet+OSM — dystans jest wartością mock (km).
- **E-maile i anulujący .ics wysyłany mailem** — w prototypie tylko powiadomienie w aplikacji + status; generujemy jedynie plik .ics „zapisu do kalendarza" po rezerwacji.
- **Realna walidacja logowania / unikalność slugów po stronie serwera** — sprawdzenia tylko wizualne/mock.
- **Statystyki i baza klientów** w panelu (spec: „później").
- **Animacje typu „magic move" pojedynczych elementów** przy przełączaniu widoku — animujemy szerokość i re-layout, nie mikro-morfing komponentów.

---

## Checklista wymagań (do weryfikacji)

**Symulator (nowy wymóg — ZADANIE)**
- [ ] Na stronie głównej są **dwa podglądy obok siebie**: ekran klienta i ekran usługodawcy.
- [ ] Podglądy pokazują **ten sam proces** z obu perspektyw (współdzielony stan mock).
- [ ] Podglądy renderowane w **pomniejszonej skali** i **w pełni klikalne** (decyzja #2).
- [ ] CTA „Otwórz w pełnej skali" powiększa wybrany podgląd na pełną szerokość (decyzja #1).
- [ ] Nad **każdym** podglądem jest przełącznik **desktop / mobile**.
- [ ] Przełączenie jest **płynnie animowane** (zmiana szerokości + układu).
- [ ] Widok desktop faktycznie zmienia **układ** interfejsu (nie tylko szerokość ramki).
- [ ] Reguła: **tylko jeden** podgląd może być desktopowy jednocześnie.
- [ ] Przełączenie drugiego na desktop **automatycznie** cofa pierwszy na mobile.
- [ ] **Dwa mobile** mogą być widoczne równocześnie.
- [ ] Na wąskich ekranach (telefon) podglądy układają się **jeden pod drugim**.
- [ ] Symulator jest demonstracyjny (brak realnych operacji/zapisów backendowych).
- [ ] `prefers-reduced-motion` respektowane (brak animacji przy preferencji).

**Role i nawigacja (spec 2, 10, 13)**
- [ ] Przełącznik ról **klient ↔ usługodawca**.
- [ ] Dolne menu klienta: **Ulubione · Szukaj · Mój kalendarz**.
- [ ] Mock ekran logowania w drodze bezpośredniej (bez realnego auth).
- [ ] Ekran/atrapa aktywacji roli usługodawcy (trial/subskrypcja — wizualnie).

**Katalog (spec 3, 10, 13)**
- [ ] Wyszukiwarka + kategorie + lista firm z **mock-dystansem (km)**.
- [ ] Firmy bez adresu **nie** pojawiają się w wyszukiwaniu po miejscowości+odległości.
- [ ] `visibleInSearch:false` → ukryte w katalogu, dostępne tylko z linku/slug.

**Profil usługodawcy = strona (spec 3, 6)**
- [ ] Profil dostępny przez **slug** (`?slug=`), domyślny slug = znormalizowana nazwa.
- [ ] Ikona **serduszka** (dodaj/usuń z ulubionych).
- [ ] Lista usług: nazwa + czas (wymagane), cena opcjonalna.
- [ ] Wybór **jednej lub wielu** usług wg ustawienia (checkmarki).
- [ ] **Suma czasu i ceny**; adnotacja przy usługach bez ceny.
- [ ] Udostępnianie w **3 formach**: podgląd kalendarza / pełna strona / widget.

**Ekran rezerwacji (spec 6, 7)**
- [ ] Desktop **3-kolumnowy** (usługi / kalendarz / godziny) — te same elementy wizualne co mobile.
- [ ] Mobile **pionowy** (nagłówek usługi + strzałka powrotu / kalendarz / lista godzin).
- [ ] Siatka slotów **co 15 min**; długość = suma czasów usług.
- [ ] Domyślnie zaznaczony **najbliższy wolny termin**.
- [ ] Lista godzin: wiersz `start→koniec` + przycisk (klient „Potwierdź" / usługodawca „Zaproponuj termin", domyślnie szary).
- [ ] Po wyborze wiersz **zmienia kolor**; potwierdzenie natychmiastowe w obu widokach.
- [ ] **Etykieta miejsca** przy slocie.
- [ ] `wolne = dostępność − zajętość(mock) − istniejące rezerwacje`.

**Po rezerwacji (spec 8)**
- [ ] Popup „**Zapisz termin do kalendarza**" (mobile + desktop).
- [ ] Pobranie **.ics** z: tytuł, start/koniec, adres, opis (usługa/czas/cena/usługodawca), przypomnienie, status.

**Tryby rezerwacji i statusy (spec 5, 9)**
- [ ] Tryb 1 (auto): rezerwacja natychmiast → wizyta u usługodawcy; usługodawca może **odrzucić/odwołać** (X, opcjonalny powód).
- [ ] Tryb 2 (na akceptację): klient widzi **tylko usługi**, wysyła „Prośbę o termin" (status **Oczekująca**).
- [ ] Usługodawca ma **listę próśb** (klient + usługa) i dobiera termin na ekranie o **tym samym układzie** co widok klienta, z „Zaproponuj termin".
- [ ] Klient **akceptuje/odrzuca**; akceptacja blokuje termin i zapisuje wizytę; odrzucenie → **pętla propozycji**.
- [ ] Statusy widoczne jako **etykieta + kolor**: Potwierdzona / Oczekująca / Zaproponowany termin / Odrzucona / Odwołana.
- [ ] Powiadomienie w aplikacji + akcja „**Wybierz inny termin**" przy odrzuceniu/odwołaniu.

**Panel usługodawcy (spec 4, 11)**
- [ ] Pulpit „**Dziś**" (nadchodzące wizyty).
- [ ] Kalendarz rezerwacji **dzień/tydzień/miesiąc** (mock).
- [ ] Szczegóły wizyty: **potwierdź / odrzuć / odwołaj**.
- [ ] Lista **próśb** (tryb 2).
- [ ] Zarządzanie **usługami**.
- [ ] Zakładka **Dostępność**: widok tygodniowy (u góry daty, poniżej dni), przewijanie ←/→ między tygodniami.
- [ ] Godziny **od–do** dla dnia; **↻** cykliczność (toggle); **X** wyczyść dzień.
- [ ] **Święta** oznaczone w widoku.
- [ ] **Miejsce** przypisywane do bloku godzin (różne miejsca tego samego dnia; kilka stałych adresów).
- [ ] Ustawienia profilu-strony: adres, slug, tryb rezerwacji, widoczność, lokalizacje, udostępnianie.

**Ogólne / techniczne**
- [ ] Wszystko działa jako statyka pod `python3 -m http.server 8080`.
- [ ] Spójny motyw (DM Sans, ciemne tło, akcenty ról); responsywność mobile.
- [ ] Brak błędów w konsoli; stan mock w `localStorage` + „Zresetuj demo".
- [ ] Zaktualizowany `README.md`.