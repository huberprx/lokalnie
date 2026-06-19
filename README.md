# Lokalnie

Komunikator do rezerwacji usług lokalnych — podgląd interfejsu.

## Uruchomienie

Otwórz `index.html` w przeglądarce lub uruchom lokalny serwer:

```bash
python3 -m http.server 8080
```

## Kalendarz Google

Pod każdym ekranem aplikacji jest pole do podpięcia kalendarza:

1. W [Google Calendar](https://calendar.google.com) otwórz **Ustawienia kalendarza** → **Integracja kalendarza**.
2. Skopiuj **Identyfikator kalendarza** (np. `twoj@email.com`).
3. Wklej go w odpowiednie pole (użytkownik po lewej, usługodawca po prawej) i kliknij **Połącz**.

Kalendarz musi być ustawiony jako **publiczny** albo **dostępny dla wszystkich z linkiem**, żeby embed działał na stronie.

Wybrane ID są zapisywane w przeglądarce (localStorage).
