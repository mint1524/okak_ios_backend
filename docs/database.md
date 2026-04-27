# База данных

PostgreSQL 16. Миграции лежат в `src/db/migrations/*.sql` и применяются по алфавиту имени.

## Таблицы

### users
- `id UUID PK`
- `email TEXT UNIQUE`
- `password_hash TEXT`
- `date_of_birth DATE`
- `email_verified BOOLEAN`
- `role TEXT` (`user`/`admin`)
- `subscription_status TEXT` (`free`/`active`/`cancelled`)
- `created_at`, `updated_at`

### user_profiles
- `user_id UUID PK -> users(id)`
- `display_name TEXT`
- `language TEXT` (`ru`/`en`)
- `theme TEXT` (`system`/`light`/`dark`)
- `communication_style TEXT`
- `interests TEXT[]`
- `ai_personalization_enabled BOOLEAN`

### user_settings
- `user_id UUID PK -> users(id)`
- `language`, `theme`
- `notifications_enabled`, `analytics_enabled`

### sessions
- `id UUID PK`
- `user_id UUID FK`
- `refresh_token_hash TEXT` — sha256 от refresh JWT
- `device_name`, `device_type`, `ip_address`, `user_agent`
- `expires_at`, `revoked_at`

### email_verification_codes, password_reset_tokens
- Хранят хеш-значения, срок действия, флаг использования.

### chats / messages / message_attachments / quotas
- `chats` владеет `user_id`, хранит `model`, `reasoning_level`, `search_enabled`, `streaming_enabled`.
- `messages` хранят `role`, `content`, `status` (`pending`/`streaming`/`completed`/`failed`), `token_count`.
- `message_attachments` — file references к сообщению.
- `quotas` — счётчик AI-запросов на пользователя с `reset_at`.

### subscriptions / user_subscriptions / orders / payments / recommendations
- `subscriptions` — каталог тарифов (`features TEXT[]`, `quota_limit`).
- `user_subscriptions` — оформленные тарифы (`status`, `auto_renew`, `end_date`).
- `orders` — `pending`/`paid`/`failed`/`cancelled`.
- `payments` — провайдер + state machine; уникальный `provider_payment_id`.
- `recommendations` — кэш персональных рекомендаций.

## Индексы

- `idx_chats_user (user_id, updated_at DESC)`
- `idx_messages_chat (chat_id, created_at)`
- `idx_orders_user (user_id, created_at DESC)`
- `idx_payments_order (order_id)`
- `idx_user_subs_user (user_id, status)`

## Бизнес-инварианты

- Refresh JWT валиден только при наличии живой сессии с тем же `sha256` от токена.
- При оплате (`payments.status='success'`) создаётся `user_subscriptions` и обновляется `quotas`.
- Квоты не могут опускаться ниже `0` и не превышают `"limit"`.
- При `reset_at < now()` следующий запрос автоматически сбрасывает `used` и сдвигает `reset_at` на 30 дней.
