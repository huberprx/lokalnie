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
- Auth demo: nagłówek `X-Demo-User: demo`
- Frontend (`api.js`) synchronizuje CRM, rezerwacje, prośby i awatar z API
- Działa: CRM klientów, rezerwacje, prośby o termin, upload zdjęć (R2), kolejka maili

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

Szczegóły: [`worker/README.md`](worker/README.md).

## Kalendarz Google

Pod każdym ekranem aplikacji jest pole do podpięcia kalendarza:

1. W [Google Calendar](https://calendar.google.com) otwórz **Ustawienia kalendarza** → **Integracja kalendarza**.
2. Skopiuj **Identyfikator kalendarza** (np. `twoj@email.com`).
3. Wklej go w odpowiednie pole (użytkownik po lewej, usługodawca po prawej) i kliknij **Połącz**.

Kalendarz musi być ustawiony jako **publiczny** albo **dostępny dla wszystkich z linkiem**, żeby embed działał na stronie.

Wybrane ID są zapisywane w przeglądarce (localStorage).
