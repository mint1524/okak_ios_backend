CREATE TABLE IF NOT EXISTS chats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT 'Новый чат',
  model             TEXT NOT NULL DEFAULT 'okak-standard',
  reasoning_level   TEXT NOT NULL DEFAULT 'medium',
  search_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  streaming_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','streaming','completed','failed')),
  token_count INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS message_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS quotas (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_name  TEXT NOT NULL DEFAULT 'free',
  "limit"    INTEGER NOT NULL DEFAULT 20,
  used       INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);
