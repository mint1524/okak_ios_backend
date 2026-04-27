# API справочник

OpenAPI описание доступно по `GET /docs` (Swagger UI).

Все защищённые маршруты требуют заголовок `Authorization: Bearer <access_token>`.
Ошибки возвращаются как `{ "error": "CODE", "message": "..." }` с HTTP-статусом.

## Аутентификация

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/register` | Регистрация. Возвращает `email` и `verification_required: true`. |
| POST | `/auth/verify-email` | Подтверждение кодом из email (в dev — лог). |
| POST | `/auth/login` | Логин по email/паролю. Возвращает `access_token`, `refresh_token`, профиль. |
| POST | `/auth/refresh` | Обновление пары токенов. |
| POST | `/auth/password-reset/request` | Запрос ссылки/кода восстановления. |
| POST | `/auth/password-reset/confirm` | Установить новый пароль по токену. |

## Сессии и профиль

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/sessions` | Список активных сессий пользователя. |
| DELETE | `/sessions/current` | Завершить текущую сессию. |
| DELETE | `/sessions/:id` | Завершить указанную сессию. |
| GET | `/profile` | Получить профиль (`display_name`, `language`, `theme`, интересы, AI-персонализация). |
| PATCH | `/profile` | Обновить поля профиля. |
| POST | `/profile/ai-personalization/reset` | Очистить интересы и стиль общения. |
| GET | `/settings` | Получить настройки (язык, тема, уведомления, аналитика). |
| PATCH | `/settings` | Обновить настройки. |

## AI чат

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/chats` | Список чатов пользователя. |
| POST | `/chats` | Создать новый чат. |
| GET | `/chats/:id` | Метаданные чата. |
| PATCH | `/chats/:id` | Переименовать. |
| PATCH | `/chats/:id/parameters` | Сменить модель / reasoning / поиск / streaming. |
| DELETE | `/chats/:id` | Удалить чат. |
| GET | `/chats/:id/messages` | История сообщений. |
| POST | `/chats/:id/messages` | Отправить сообщение, получить ответ синхронно. |
| POST | `/chats/:id/messages/stream` | SSE-стриминг ответа. |
| POST | `/chats/:id/attachments` | Прикрепить файл/превью к новому сообщению. |
| GET | `/quota` | Текущая квота AI-запросов. |

### Формат SSE

```
data: {"type":"start","message_id":"..."}
data: {"type":"delta","content":"..."}
data: {"type":"tool_use","content":"web_search"}
data: {"type":"done","message":{...},"user_message":{...}}
data: {"type":"quota","quota":{...}}
data: {"type":"error","message":"..."}
```

## Каталог, заказы и платежи

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/catalog/subscriptions` | Доступные тарифы (фильтр `type`). |
| GET | `/catalog/subscriptions/:id` | Детали тарифа. |
| GET | `/recommendations` | Персональные рекомендации. |
| POST | `/recommendations/optimal-subscription` | Оптимальный тариф под текущую активность. |
| POST | `/orders` | Создать заказ и `pending` платёж. |
| GET | `/orders` | История заказов. |
| GET | `/orders/:id` | Детали заказа. |
| POST | `/payments/mock/confirm` | Завершить mock-платёж (`success`/`failed`/`cancelled`). |
| POST | `/payments/webhook` | Webhook от платёжного провайдера. |
| GET | `/subscriptions/active` | Активные подписки пользователя. |
| POST | `/subscriptions/:id/cancel` | Отменить. |
| POST | `/subscriptions/:id/renew` | Продлить. |

## Admin (loopback, Basic Auth)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/admin/stats` | Сводные счётчики. |
| GET | `/admin/users` | Список пользователей с поиском. |
| GET | `/admin/users/:id` | Детали пользователя, сессии, квоты. |
| GET | `/admin/orders` | Последние заказы (200). |
| GET/POST/PATCH/DELETE | `/admin/subscriptions[/:id]` | CRUD над тарифами. |
| GET | `/` | HTML-дашборд. |

## Коды ошибок

| Код | HTTP | Когда возникает |
|-----|------|------------------|
| `VALIDATION` | 400 | Ошибка Zod-схемы. |
| `UNAUTHORIZED` | 401 | Нет/невалидный JWT, неверный пароль. |
| `FORBIDDEN` | 403 | Admin не с loopback, либо нет прав. |
| `NOT_FOUND` | 404 | Ресурс отсутствует. |
| `CONFLICT` | 409 | Email уже занят, токен использован. |
| `QUOTA_EXCEEDED` | 429 | Превышена месячная квота AI. |
| `LLM_UNAVAILABLE` | 502 | Ошибка/таймаут LLM-провайдера. |
