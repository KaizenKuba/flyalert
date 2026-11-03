# ✈️ FlyAlert – monitor cen lotów (Netlify)

Panel w przeglądarce (tablet, telefon, komputer) i skaner cen w chmurze Netlify.
Wybierasz skąd lecisz (lotnisko, region albo cały kraj), dokąd, w jakim terminie i za ile.
FlyAlert sam sprawdza ceny, zapisuje ich historię i wysyła alert na Telegram, gdy cena spadnie
albo wejdzie w Twój budżet.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/KaizenKuba/flyalert)

## Instalacja (2 minuty)
1. Kliknij przycisk **Deploy to Netlify** powyżej i zaloguj się (najprościej kontem GitHub).
2. Kliknij **Save & Deploy** i poczekaj 1–2 minuty.
3. Otwórz adres strony (np. `https://twoja-nazwa.netlify.app`) i ustaw hasło.
4. W **Ustawieniach** wybierz źródło cen i podłącz Telegram.

Szczegółowa instrukcja ze zrzutami ekranu: `FlyAlert-instrukcja.pdf`.

## Jak to działa
| Element | Gdzie |
|---|---|
| Panel (HTML/JS, PWA) | `public/index.html` |
| API panelu | `netlify/functions/api.mjs` → `/api/*` |
| Skaner w tle (do 15 min) | `netlify/functions/scan.mjs` → `/internal/scan` |
| Harmonogram (co godzinę) | `netlify/functions/scheduler.mjs` |
| Dane (obserwacje, historia, ustawienia) | Netlify Blobs |
| Źródła cen | `lib/providers.mjs`: Demo, Travelpayouts, Google Flights (SerpApi), Hybryda |
| Lotniska, kraje, regiony | `lib/airports-data.mjs` |

Klucze API i token Telegrama wpisujesz w panelu (Ustawienia). Nie trzeba ustawiać zmiennych
środowiskowych w Netlify.

## Limity darmowego Netlify
Plan Free ma 300 kredytów miesięcznie. Skaner zużywa ich niewiele, ale każde wdrożenie (deploy)
kosztuje 15 kredytów, więc nie wdrażaj zmian kilkadziesiąt razy w miesiącu. Po wyczerpaniu
kredytów Netlify wstrzymuje stronę do następnego miesiąca.

## Test lokalny
```
npm install
node dev.mjs        # http://localhost:8888 (dane w .local-data/)
```
