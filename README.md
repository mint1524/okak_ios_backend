# OKAK AI Mobile — backend

REST API для мобильного приложения OKAK AI Mobile. Реализует аутентификацию, AI-чат, квоты, каталог подписок, заказы, mock-платежи, рекомендации и админ-эндпоинты.

## Стек

- Node.js 20+
- Fastify 5
- PostgreSQL 16
- TypeScript (ESM)
- JWT (HS256), bcryptjs
- pg, zod, pino, jose
- Docker / Docker Compose

## Быстрый старт

```bash
cp .env.example .env
docker compose up --build
```

После старта:

- public API: `http://127.0.0.1:3000`
- admin API: `http://127.0.0.1:3001` (только localhost)
- OpenAPI: `http://127.0.0.1:3000/docs`
- health: `GET /health`

## Локальная разработка без Docker

```bash
npm install
docker compose up -d postgres
npm run migrate
npm run seed
npm run dev
```

## Скрипты

- `npm run dev` — fastify в watch-режиме
- `npm run build` — компиляция TS в `dist/`
- `npm run start` — запуск собранного билда
- `npm run migrate` — применить миграции
- `npm run migrate:reset` — пересоздать схему
- `npm run seed` — вставить демо-данные
- `npm test` — unit-тесты

## LLM провайдер

В `.env`:

- `LLM_PROVIDER=mock` — встроенный mock streaming-провайдер (по умолчанию)
- `LLM_PROVIDER=openai` + `LLM_BASE_URL` + `LLM_API_KEY` — OpenAI-совместимый эндпоинт

## Безопасность

- Пароли хранятся как bcrypt-хеш.
- Платёжные реквизиты не сохраняются.
- Админ-API слушает только на `127.0.0.1` (см. `ADMIN_HOST`).
- LLM ключ хранится только в backend, в iOS клиент не передаётся.
