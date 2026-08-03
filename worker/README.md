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
   ```
2. Redirect URI w Google Cloud:
   - `https://api.lokalnie.app/auth/google/callback`
   - `http://localhost:8787/auth/google/callback` (lokalnie)
3. Start: `GET /auth/google?return_to=https://lokalnie.app/`
4. Po sukcesie redirect na front z `#access_token=...`
5. Kolejne requesty: `Authorization: Bearer <token>`
6. Wylogowanie: `POST /auth/logout`

`state` OAuth jest podpisany HMAC (`GOOGLE_CLIENT_SECRET`) — bez cookie, żeby uniknąć `invalid_oauth_state` przy 302.

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
| GET/PATCH | `/provider/me` | Profil usługodawcy |
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

## Co wymaga Ciebie później

1. **Resend** — konto + domena `lokalnie.app` (SPF/DKIM) → prawdziwa wysyłka maili  
2. **Google OAuth** — przełączenie consent screen z testowego na produkcję (gdy gotowe)  
3. **Facebook OAuth** — opcjonalnie później
