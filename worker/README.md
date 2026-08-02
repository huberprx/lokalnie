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

Lokalnie (opcjonalnie) skopiuj `.dev.vars.example` → `.dev.vars`.

### Demo (E2E / makieta)

```http
X-Demo-User: demo
```

albo:

```http
Authorization: Bearer demo
```

Seed: użytkownik `Hubert Z` + firma `Grzesiu Barber`.

## Endpointy

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/auth/google` | Start Google OAuth |
| GET | `/auth/google/callback` | Callback OAuth |
| POST | `/auth/logout` | Unieważnij sesję |
| GET | `/me` | Profil |
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
| POST | `/media` | Upload (multipart: `file`, `kind`) |
| GET | `/media/:id` | Odczyt pliku |
| GET | `/emails/outbox` | Kolejka maili (bez wysyłki) |

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
npm run dev
```

Deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

## Co wymaga Ciebie później

1. **Resend** — konto + domena `lokalnie.app` (SPF/DKIM) → prawdziwa wysyłka maili  
2. **Google OAuth** — przełączenie consent screen z testowego na produkcję (gdy gotowe)  
3. **Facebook OAuth** — opcjonalnie później  
