# Архитектура backend

## Слои

```
┌────────────────────────────┐
│         iOS клиент         │
└──────────────┬─────────────┘
               │ HTTPS / SSE
┌──────────────▼─────────────┐
│        Fastify app         │  publicapi 0.0.0.0:3000
│  ─ Auth / Sessions         │
│  ─ Chats / Messages / SSE  │
│  ─ Quota / Catalog         │
│  ─ Orders / Payments       │
│  ─ Recommendations         │
└──────────────┬─────────────┘
               │ pg (pool)
┌──────────────▼─────────────┐
│      PostgreSQL 16         │
└────────────────────────────┘

┌────────────────────────────┐
│  Admin Fastify (loopback)  │ 127.0.0.1:3001 + Basic Auth
└────────────────────────────┘

┌────────────────────────────┐
│   LLM провайдер (внешний)  │  Mock или OpenAI-совместимый
└────────────────────────────┘
```

## Каталоги

- `src/app.ts` — публичный Fastify-инстанс, регистрирует все плагины и модули.
- `src/admin/app.ts` — отдельный Fastify-инстанс, привязан к loopback, Basic Auth.
- `src/plugins/` — fastify-plugin обёртки: PostgreSQL pool, JWT auth, унифицированные ошибки, OpenAPI.
- `src/modules/<feature>/` — модуль фичи: `service.ts` (бизнес-логика) + `routes.ts` (HTTP-обработчики) + Zod-схемы.
- `src/db/migrations/` — SQL миграции (выполняются по порядку имени файла).
- `src/db/seed.ts` — демо-данные.
- `src/utils/` — общие утилиты (логгер, пароли, коды, mailer-stub).

## Аутентификация

JWT HS256 access (15 мин) + refresh (30 дней). Refresh-токен хранится только как `sha256` хеш в `sessions`. На каждом успешном `login` создаётся запись `sessions`, она же логически и есть «устройство». Logout = пометка `revoked_at`. SecureStorage iOS хранит access+refresh в Keychain.

## SSE стриминг

`POST /chats/:id/messages/stream`:

1. Проверка квоты (`ensureAvailable`).
2. Сохранение `user`-сообщения.
3. Создание `assistant`-плейсхолдера со статусом `streaming`.
4. Получение `AsyncIterable` от LLM-провайдера, форвардинг событий `delta`/`tool_use` в SSE.
5. Финальное обновление сообщения (`completed`/`failed`) и инкремент квоты.

iOS использует `SSEClient`, который разбирает `data:`-блоки и публикует события через `AsyncThrowingStream`.

## Платежи

Mock-провайдер реализует state machine `pending → success|failed|cancelled`. При успехе:

- Заказ переходит в `paid`.
- Создаётся запись `user_subscriptions` (`active`, `end_date = now + duration_days`).
- `users.subscription_status = active`.
- Квота пользователя расширяется до `quota_limit` подписки, `used` сбрасывается.

Webhook `POST /payments/webhook` принимает уведомления от провайдера без авторизации, но проверяет `provider_payment_id`.

## Админ API

Изолированный Fastify, принимающий запросы только с `127.0.0.1`/`::1`. Все маршруты защищены HTTP Basic Auth (`ADMIN_USERNAME`/`ADMIN_PASSWORD`). Доступны KPI, список пользователей, заказы и CRUD над тарифами. Простая HTML-страница на `/` визуализирует данные через тот же API.
