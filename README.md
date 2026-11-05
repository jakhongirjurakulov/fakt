# FAKT

Приёмка строительных работ с фотофиксацией для малых и средних подрядчиков Узбекистана.
**F**oto · **A**kt · **K**ontrol · **T**oʻlov.

Задачи, решения, спецификация, модель данных и контракт API — в Notion (проект FAKT). Здесь только код.

## Структура

```
apps/
  api/   Node.js + Fastify, TypeScript — REST API /api/v1
  web/   React + Vite — PWA прораба, веб руководителя, страница заказчика
docker-compose.yml   PostgreSQL и S3-хранилище (SeaweedFS) для разработки
```

## Что нужно

- Node.js 22 или новее
- Docker Desktop (запущен)

## Первый запуск

```bash
cp .env.example .env
npm install
npm run db:up        # PostgreSQL на :5432, S3 (SeaweedFS) на :8333
npm run dev:api      # API на http://localhost:3000
npm run dev:web      # веб на http://localhost:3100
```

Проверка: http://localhost:3000/api/v1/health отвечает `{"status":"ok","db":"ok","storage":"ok"}`.
Страница http://localhost:3100 показывает тот же ответ через прокси Vite.

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run db:up` / `npm run db:down` | Поднять / остановить базу и хранилище |
| `npm run typecheck` | Проверка типов во всех приложениях |
| `npm test` | Тесты |
| `npm run build` | Сборка |

Данные базы и хранилища лежат в томах Docker и переживают перезапуск.
Стереть всё и начать с нуля: `docker compose down -v`.

## Правила

- Секреты и ключи в репозиторий не коммитим. `.env` в `.gitignore`, в `.env.example` — только значения для локальной машины.
- Время — UTC в базе и API, показ в Asia/Tashkent на клиенте. Деньги — целые сумы.
