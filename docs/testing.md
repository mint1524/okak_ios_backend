# Тестирование

## Unit-тесты

Используется встроенный `node:test` через `tsx`:

```bash
npm test
```

Под капотом запускается:

```
node --import tsx --test src/**/*.test.ts
```

Текущие unit-тесты:

- `src/modules/auth/auth.test.ts` — хеширование пароля, генерация кодов, sha256.
- `src/modules/llm/llm.test.ts` — Mock LLM provider: completion и streaming.

## Ручная интеграционная проверка

С запущенным `docker compose up` (postgres + миграции + seed):

```bash
curl -s http://127.0.0.1:3000/health
curl -s -X POST http://127.0.0.1:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@okak.app","password":"Okak1Demo!!!"}'
```

Чек-лист сценариев:

1. Регистрация → подтверждение email (код в логах backend) → логин.
2. `POST /chats` → `POST /chats/:id/messages/stream` (получить SSE).
3. `POST /orders` с `subscription_id` Pro AI → `POST /payments/mock/confirm` с `outcome=success` → `GET /subscriptions/active`.
4. `DELETE /sessions/:id` для не-текущей сессии → проверка отсутствия в `GET /sessions`.
5. Admin: открыть `http://127.0.0.1:3001/` в браузере, ввести `admin`/`admin_local`.

## iOS

Тесты лежат в `OKAK APPTests`, запускаются из Xcode (Swift Testing). Покрытие — валидация форм, основные сценарии view-model'ей с mock-сервисами.
