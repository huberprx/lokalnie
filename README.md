# Lokalnie

Komunikator do rezerwacji usług lokalnych — podgląd interfejsu + szkielet API na Cloudflare.

## Frontend (prototyp)

Otwórz `index.html` w przeglądarce lub uruchom lokalny serwer:

```bash
npm start
# albo: python3 -m http.server 8080 --bind 127.0.0.1
```

### Testy E2E (Playwright)

```bash
npm install
npx playwright install chromium
npm test
```

Scenariusze w `e2e/flows.spec.js`: prośba→propozycja→rezerwacja, zmiana terminu, kolizja slotów.

## Backend API (Cloudflare Workers Free)

- URL: https://api.lokalnie.app
- Kod: katalog [`worker/`](worker/)
- Health: https://api.lokalnie.app/health
- Auth: Google OAuth (`Zaloguj przez Google`) albo demo (`X-Demo-User: demo`)
- Frontend (`api.js`) synchronizuje CRM, rezerwacje, prośby i awatar z API
- Działa: CRM klientów, rezerwacje, prośby o termin, upload zdjęć (R2), kolejka maili

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

Szczegóły: [`worker/README.md`](worker/README.md).

## Google Calendar klienta

W ustawieniach konta klient może kliknąć **Połącz Google Calendar** i udzielić
Lokalnie osobnej zgody OAuth na tworzenie wydarzeń. Po potwierdzeniu rezerwacji
Lokalnie automatycznie zapisuje prywatne wydarzenie w kalendarzu `primary`
klienta, a zmianę terminu lub anulowanie synchronizuje z tym wydarzeniem.

Do uruchomienia integracji ustaw dodatkowo sekrety:

```bash
cd worker
npx wrangler secret put GOOGLE_CALENDAR_TOKEN_KEY
npx wrangler secret put PII_ENCRYPTION_KEY
```

`PII_ENCRYPTION_KEY` szyfruje numery telefonu w D1 (AES-GCM, `enc:v1:…`).

W Google Cloud dodaj redirect URI:
`https://api.lokalnie.app/auth/google/calendar/callback`.
