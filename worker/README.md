# lokalnie-api

Backend Lokalnie na Cloudflare Workers (Free) + D1 (EU) + R2.

## URL

- Produkcja: https://api.lokalnie.app
- Health: https://api.lokalnie.app/health

## Auth

### Google OAuth

1. Secrety (raz):
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put PII_ENCRYPTION_KEY
   ```
2. Redirect URI w Google Cloud:
   - `https://api.lokalnie.app/auth/google/callback`
   - `https://api.lokalnie.app/auth/google/calendar/callback`
   - `http://localhost:8787/auth/google/callback` (lokalnie)
   - `http://localhost:8787/auth/google/calendar/callback` (lokalnie)
3. Start: `GET /auth/google?return_to=https://lokalnie.app/`
4. Po sukcesie (produkcja): redirect na front + `Set-Cookie: lokalnie_session` (HttpOnly, SameSite=Lax, Secure).
5. Front ładuje sesję przez `GET /me` z `credentials: "include"` (cookie same-site `lokalnie.app` ↔ `api.lokalnie.app`).
6. Wylogowanie: `POST /auth/logout` — kasuje sesję w D1 i wygasza cookie.
7. Poza produkcją (`ENVIRONMENT != production`) callback dodatkowo dokłada `#access_token=...` na potrzeby lokalnych testów cross-site (localhost → API); Bearer w `localStorage` działa tylko poza produkcyjnym hostname.

Ochrona logowania:
- jednorazowy `state` w tabeli D1 `oauth_states` (TTL 10 min),
- PKCE `S256` (`code_challenge` / `code_verifier`),
- OIDC `nonce` + weryfikacja podpisu i claimów `id_token` (JWKS Google),
- łączenie kont po e-mailu tylko gdy `email_verified=true`.

Lokalnie (opcjonalnie) skopiuj `.dev.vars.example` → `.dev.vars`.

### Demo (E2E / makieta)

```http
X-Demo-User: demo
```

albo:

```http
Authorization: Bearer demo
```

Demo jest dostępne tylko poza produkcją. Dane demonstracyjne są w `seed/demo.sql`
i muszą być załadowane jawnie wyłącznie do lokalnej bazy.

## Endpointy

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/me` | Profil (demo) |
| PATCH | `/me` | Edycja profilu |
| GET | `/providers` | Publiczny katalog (q, city, category, subcategory, latitude, longitude, radiusKm, limit, offset) |
| GET | `/geo/suggest` | Podpowiedzi lokalizacji (q) — geokoder po stronie API |
| GET | `/providers/:slug` | Publiczny profil + usługi + dostępność |
| GET | `/calendar/google/connect` | Rozpoczęcie OAuth Google Calendar |
| GET | `/auth/google/calendar/callback` | Powrót OAuth Google Calendar |
| GET | `/calendar/connections` | Podłączone kalendarze |
| DELETE | `/calendar/connections/:id` | Odłączenie kalendarza |
| GET/POST/PATCH | `/provider/me` | Odczyt, utworzenie i edycja profilu usługodawcy |
| GET/PUT | `/provider/me/availability` | Odczyt lub atomowa podmiana całej dostępności |
| GET/POST | `/provider/me/clients` | CRM klientów |
| GET/PATCH/DELETE | `/provider/me/clients/:id` | Klient |
| GET/POST | `/bookings` | Rezerwacje |
| GET/PATCH | `/bookings/:id` | Rezerwacja |
| GET/POST | `/requests` | Prośby o termin |
| POST | `/requests/:id/propose` | Propozycje godzin |
| POST | `/requests/:id/accept` | Akceptacja propozycji |
| POST | `/requests/:id/decline` | Odrzucenie |
| POST | `/requests/:id/request-more` | Prośba klienta o nowe propozycje |
| POST | `/media` | Upload (multipart: `file`, `kind`) |
| GET | `/media/:id` | Odczyt pliku |
| GET | `/emails/outbox` | Kolejka maili (bez wysyłki, admin) |
| GET | `/admin/stats` | Liczby platformy (admin) |
| GET | `/admin/users` | Lista użytkowników (admin) |
| POST | `/admin/users/:id/block` | Blokada konta + unieważnienie sesji |
| POST | `/admin/users/:id/unblock` | Odblokowanie konta |
| GET | `/admin/providers` | Lista firm (admin) |
| PATCH | `/admin/providers/:id` | Widoczność w katalogu (`visibleInSearch`) |
| GET | `/admin/bookings` | Podgląd rezerwacji (admin) |
| GET | `/admin/audit` | Log działań admina |

### Profil usługodawcy

`POST /provider/me` tworzy maksymalnie jeden profil dla zalogowanego użytkownika i
w tej samej transakcji ustawia `users.role_provider=1`. Pole `name` może zostać
pominięte, jeśli zalogowany użytkownik ma już niepustą nazwę konta.
Opcjonalny `slug` musi mieć 3–80 małych znaków ASCII (`a-z`, `0-9`, `-`) i być
unikalny; bez niego serwer generuje slug z nazwy i bezpiecznie rozwiązuje kolizję.
Ponowienie żądania dla użytkownika mającego profil zwraca istniejący profil z
`created: false` (HTTP 200). Nowy profil zwraca HTTP 201 i `created: true`.

`PATCH /provider/me` obsługuje dotychczasowe pola profilu oraz `slug`, `category`,
`subcategory`, `locations`, `socialLinks`, `bookingRules` i `deactivated`.
`bookingMode` profilu przyjmuje te same wartości co usługi:
`auto | queue | approval | request`. Zmiana `slug` wymaga unikalności (409 przy kolizji).
`locations` zawiera maksymalnie 20 pozycji `{ id, label, address, toneIndex }`,
`socialLinks` maksymalnie 8 pozycji `{ id, kind, value }`, a `bookingRules` pola
`futureDays`, `minLeadHours`, `cancelHours`, `proposeHoldHours` i `policy`.

Upload avatara (`POST /media` z `kind=avatar|provider`) zapisuje w `avatar_key`
identyfikator rekordu `media` (nie klucz R2). Odczyt: `GET /media/:id`.

### Dostępność

`PUT /provider/me/availability` atomowo zastępuje cały harmonogram zalogowanego
usługodawcy. Identyfikator usługodawcy z body jest ignorowany. Kontrakt:

```json
{
  "availability": [
    {
      "dateISO": "2026-10-01",
      "blocks": [
        {
          "from": "09:00",
          "to": "12:00",
          "locationId": "loc-main",
          "repeat": "weekly"
        }
      ]
    }
  ]
}
```

Dozwolone wartości `repeat` to `none`, `weekly` i `biweekly`. API przyjmuje
maksymalnie 366 unikalnych dni i 3 niepokrywające się bloki na dzień.
Niepuste `locationId` musi wskazywać lokalizację z profilu. `GET` i `PUT`
zwracają znormalizowane `{ availability }`, posortowane po dacie i godzinie.

### Wyszukiwanie geo

`GET /providers?latitude=&longitude=&radiusKm=` liczy odległość Haversine po stronie Workera
(po bounding boxie na `provider_locations`). `radiusKm` musi być z listy:
`5, 10, 15, 20, 25, 30, 40, 50`. Lokale bez adresu ulicznego (online) są zawsze dołączane.
Współrzędne użytkownika nie są logowane ani zapisywane po stronie API.

`GET /geo/suggest?q=` korzysta z Nominatim (OpenStreetMap) z cache D1 `geocode_cache`.
Podpowiedzi mają format marketplace: **nazwa miejscowości** + druga linia
**powiat, województwo** (bez prefiksów „powiat”/„województwo”).
Opcjonalnie ustaw User-Agent:

```bash
npx wrangler secret put GEOCODER_USER_AGENT
```

Po migracji `0013_provider_locations_geo.sql` uruchom lokalnie:

```bash
npm run db:migrate:local
```

## Zasoby

| Zasób | Nazwa |
|---|---|
| Worker | `lokalnie-api` |
| D1 | `lokalnie-db` (EU) |
| R2 | `lokalnie-media` |

## Lokalnie

```bash
cd worker
npm install
npx wrangler login
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

`db:seed:local` tworzy użytkownika `Hubert Z` i firmę `Grzesiu Barber`.
Nigdy nie uruchamiaj `seed/demo.sql` z `--remote`. Migracje produkcyjne nie zawierają
danych demo, a migracja `0004_cleanup_demo_seed.sql` usuwa historyczny seed ze zdalnych baz.

Deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

Wdrożenie zdalne wykonuje wyłącznie migracje — bez seeda demo.

Mutacje `POST /bookings`, `POST /requests`, `propose`, `accept`, `decline`,
`request-more` oraz `PATCH /bookings/:id` wymagają nagłówka `Idempotency-Key`.
Zakres klucza obejmuje użytkownika, metodę i endpoint. Zakończone rekordy
idempotencji są usuwane przez cron po 7 dniach, a porzucone po 24 godzinach.

Mutacja biznesowa i odpowiadający jej wpis do `email_outbox` są wykonywane w jednym
transakcyjnym `DB.batch`. Błąd outbox wycofuje mutację zamiast pozostawiać częściowy stan.

## Szyfrowanie numerów telefonu (PII)

Numery w `users.phone`, `provider_profiles.phone`, `provider_clients.phone`,
`bookings.client_phone` i `booking_requests.client_phone` są zapisywane jako
`enc:v1:…` (AES-GCM) gdy ustawiony jest sekret `PII_ENCRYPTION_KEY`.

API zawsze zwraca odszyfrowany numer uprawnionemu użytkownikowi. Stare wpisy
bez prefiksu (plaintext) nadal działają i zostaną zaszyfrowane przy kolejnym zapisie.

```bash
npx wrangler secret put PII_ENCRYPTION_KEY
```

Bez klucza Worker zapisuje plaintext (dev / awaryjnie). Ustaw klucz przed produkcją.

## Co wymaga Ciebie później

1. **Resend** — konto + domena `lokalnie.app` (SPF/DKIM) → prawdziwa wysyłka maili  
2. **Google OAuth** — przełączenie consent screen z testowego na produkcję (gdy gotowe)  
3. **Facebook OAuth** — opcjonalnie później
4. **`PII_ENCRYPTION_KEY`** — sekret do szyfrowania numerów telefonu w D1
