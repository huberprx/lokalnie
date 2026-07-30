# lokalnie-api

Backend Lokalnie na Cloudflare Workers (Free) + D1 (EU) + R2.

## URL

- Produkcja: https://api.lokalnie.app
- Health: https://api.lokalnie.app/health

## Auth (tymczasowo — demo)

OAuth Google/Facebook później. Na razie:

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
2. **Google / Facebook OAuth** — Client ID/Secret → zamiana trybu demo  
