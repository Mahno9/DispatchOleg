# Продакшен-деплой — DispatchOleg

Единственный поддерживаемый способ — `docker compose` из [`../docker/`](../docker/):
образ собирает сервер + player + admin + мини-игры одним multi-stage
Dockerfile, рядом поднимается сайдкар `cloudflared`, дающий приложению
HTTPS-адрес без ручной настройки сертификатов.

## Почему обязательно HTTPS

Сканер QR в терминале игрока использует `getUserMedia` (доступ к камере).
Браузеры разрешают его только на `localhost` или по HTTPS — на голом `http://`
с другого устройства камера не откроется (`NotAllowedError`), и обучалка
покажет экран отказа. Поэтому продакшен-доступ — **только через
cloudflared-туннель**, напрямую по IP:порту снаружи камера работать не будет.

## Настройка

1. Заведите Cloudflare Tunnel (Zero Trust → Networks → Tunnels → Create
   tunnel), привяжите его к своему домену/поддомену, скопируйте токен туннеля.
2. Скопируйте `docker/.env.example` в `docker/.env` и заполните:

   ```
   ADMIN_LOGIN=...
   ADMIN_PASSWORD=...
   COOKIE_SECRET=...            # длинная случайная строка
   QR_SECRET=...                # отдельная длинная случайная строка
   CLOUDFLARE_TUNNEL_TOKEN=...
   ```

   `COOKIE_SECRET` подписывает cookie админ-сессии, `QR_SECRET` — содержимое
   печатных QR-кодов. Их смена инвалидирует все активные сессии/напечатанные
   коды — держите отдельно от репозитория и не теряйте.

3. Запуск:

   ```bash
   cd docker
   docker compose up -d --build
   ```

   Сервер слушает `127.0.0.1:8081` на хосте (наружу не торчит — только через
   `cloudflared`), БД и загруженные ассеты лежат в `../data` (bind-mount,
   переживает пересборку и перезапуск контейнера).

4. Проверка:

   ```bash
   docker compose logs -f cloudflared   # адрес туннеля появится в логах
   curl http://127.0.0.1:8081/api/health
   ```

   Открыть выданный cloudflared-адрес в браузере — должен загрузиться player
   SPA, `/admin/` — админка.

## Обновление

```bash
cd docker
git pull   # или обновите исходники любым способом
docker compose up -d --build
```

Данные в `../data` не затрагиваются пересборкой образа.

## Резервное копирование

Всё состояние — в `../data/app.sqlite` (SQLite) и `../data/assets/` (загруженные
файлы). Остановите `app` перед копированием файла БД, чтобы не словить
запись в процессе:

```bash
docker compose stop app
cp -r ../data /path/to/backup
docker compose start app
```
