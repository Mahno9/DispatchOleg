# DispatchOleg

Мета-игра в духе Dispatch / This is the Police: игрок — диспетчер Олег за ретрофутуристическим
терминалом. Мини-игры запускаются сканированием физических QR-кодов через вебкамеру: скан →
проверка подписи и разблокировки на сервере → диалог → мини-игра → пост-диалог → мета-экран.

Монорепа npm workspaces:

```
server/        Fastify 5 + better-sqlite3: API, миграции, статика
web/player/    SPA терминала (мета, диалоги, оболочка мини-игр)
web/admin/     SPA админки (игры, персонажи, диалоги, ассеты, QR)
minigames/*    мини-игры (vanilla TS, Vite lib mode) — контракт в minigame_contract.md
                rescue-catch, task-sort, three-mazes, safe-crack, cooking-orders, tetris-fill
scripts/       sync-minigames.mjs — копирует собранные игры в server/static/minigames/
docker/        Dockerfile (multi-stage) + docker-compose.yml (app + cloudflared)
deploy/        инструкция по прод-деплою — deploy/README.md
```

## Запуск в разработке

```bash
npm install
npm run dev          # server + player + admin через concurrently
```

Сервер поднимается на `PORT` (по умолчанию 8080), БД и загруженные файлы — в `data/`
(создаётся автоматически, миграции применяются на старте).

Прод-сборка:

```bash
npm run build        # все workspace'ы + синк мини-игр в server/static
npm start -w server  # node dist/index.js
npm test             # vitest по всем workspace'ам
npm run lint
```

**HTTPS обязателен** для доступа к камере (`getUserMedia`) где-либо кроме `localhost`. Поэтому
продакшен-доступ — только через cloudflared-туннель (см. «Продакшен» ниже), не по голому
`http://ip:port`.

## Продакшен (Docker)

```bash
cp docker/.env.example docker/.env   # заполнить ADMIN_*, COOKIE_SECRET, QR_SECRET, CLOUDFLARE_TUNNEL_TOKEN
cd docker
docker compose up -d --build
```

Поднимает контейнер приложения (порт 8080 внутри, `127.0.0.1:8081` наружу хоста — не публичный)
и сайдкар `cloudflared`, который выдаёт HTTPS-адрес для туннеля. Данные (`app.sqlite` + загруженные
ассеты) лежат в `../data` bind-mount'ом — переживают пересборку. Полная инструкция, обновление и
бэкап — [`deploy/README.md`](deploy/README.md). Сборка docker-образа требует Docker; сами конфиги
(`docker/`, `deploy/`) не требуют Docker для чтения/правки.

## Переменные окружения

Читаются из `.env` в корне (в dev — через `tsx --env-file=../.env`). Файл обязан существовать —
перед первым `npm run dev` сделайте `cp .env.example .env`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ADMIN_LOGIN` | `admin` | Логин админки |
| `ADMIN_PASSWORD` | `admin` | Пароль админки |
| `COOKIE_SECRET` | `dev-secret-change-me` | Ключ подписи cookie админ-сессии |
| `QR_SECRET` | значение `COOKIE_SECRET` | Ключ подписи содержимого QR-кодов |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Адрес прослушивания |
| `DATA_DIR` | `../data` (в Docker — `/data`) | БД `app.sqlite` и загруженные ассеты |
| `LOG_LEVEL` | `info` | Уровень логов Fastify |

Смена `QR_SECRET` инвалидирует все напечатанные QR-коды.

## QR-коды

Содержимое: `dispatch:<gameId>:<HMAC-SHA256(gameId, QR_SECRET), первые 16 hex-символов>`.
SVG для печати — `GET /api/admin/games/:id/qr.svg` (только для админа).
Проверка скана — `POST /api/qr/verify {payload, userId}`:
`{ok:true, game}` (в `game` есть `isTutorial` — по нему обучалка отличает свой код от чужого) либо
`{ok:false, reason:'bad-signature'|'not-found'|'locked', requiredTitles?}`
(`locked` — не все игры из `requiredGameIds` пройдены с `won: true`).

Сканирование в плеере: `src/camera/QrScanner.ts` — нативный `BarcodeDetector('qr_code')`, фолбэк
`jsQR` через динамический `import()` (отдельный чанк). Стрим берётся из singleton `camera.ts`, при
остановке сканера трек не гасится — его показывает нижняя панель.

### Печать QR из админки

В `/admin/` → раздел «Игры» у каждой строки есть кнопка «QR-код» — открывает модалку с превью
кода. Кнопка печати внутри модалки открывает отдельное окно с одним QR крупным планом и сразу
вызывает `window.print()` (браузер может заблокировать всплывающее окно — тогда придётся разрешить
попапы для admin-адреса). То же самое SVG доступно напрямую под админ-сессией по
`GET /api/admin/games/<id>/qr.svg` — можно скачать/распечатать любым другим способом.

### Как протестировать QR без принтера

1. Заведите игру в админке (для обучалки — с галкой «tutorial»), откройте
   `GET /api/admin/games/<id>/qr.svg` под админ-сессией — это готовый QR.
2. Покажите его вебкамере с экрана: открыть svg на телефоне, на втором мониторе или просто в соседнем
   окне браузера напротив камеры. Полезно увеличить масштаб (QR должен занимать 1/3–1/2 кадра) и
   убрать блики — глянцевый экран под лампой распознаётся хуже бумаги.
3. Если камеры нет вовсе — поднимите Chrome с подставным устройством:

   ```bash
   chrome --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
          --use-file-for-fake-video-capture=qr.y4m --unsafely-treat-insecure-origin-as-secure=http://<host>:5173
   ```

   `--use-fake-ui-for-media-stream` снимает permission-prompt, `--use-file-for-fake-video-capture`
   подсовывает вместо камеры Y4M-ролик (сконвертировать картинку с QR:
   `ffmpeg -loop 1 -i qr.png -t 5 -pix_fmt yuv420p -s 640x480 qr.y4m`). Без файла подставная камера
   показывает крутящийся зелёный квадрат — сканер тогда просто ничего не найдёт.

4. `getUserMedia` работает только на `localhost` или по HTTPS: с другого устройства открывайте плеер
   через HTTPS-туннель, иначе браузер отдаст `NotAllowedError` и обучалка покажет экран отказа.
