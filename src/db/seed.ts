import pkg from 'pg';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';
import { sha256 } from '../utils/codes.js';
import { logger } from '../utils/logger.js';

const { Pool } = pkg;

const SUBSCRIPTIONS = [
  {
    name: 'Free AI',
    description: 'Базовый тариф с ограниченным числом AI-запросов в месяц.',
    price: 0,
    duration_days: 30,
    type: 'ai',
    quota_limit: 20,
    features: ['20 запросов в месяц', 'OKAK Mini модель', 'История диалогов']
  },
  {
    name: 'Pro AI',
    description: 'Продвинутый тариф для активного использования AI.',
    price: 499,
    duration_days: 30,
    type: 'ai',
    quota_limit: 250,
    features: ['250 запросов в месяц', 'OKAK Standard', 'Reasoning medium', 'Streaming-ответы']
  },
  {
    name: 'Premium AI',
    description: 'Премиум-тариф с расширенными возможностями и приоритетом.',
    price: 1290,
    duration_days: 30,
    type: 'ai',
    quota_limit: 1000,
    features: ['1000 запросов в месяц', 'OKAK Pro', 'Reasoning high', 'Поиск в интернете', 'Приоритетная очередь']
  },
  {
    name: 'Business AI',
    description: 'Тариф для команд и интенсивного использования AI.',
    price: 3990,
    duration_days: 30,
    type: 'ai',
    quota_limit: 5000,
    features: ['5000 запросов в месяц', 'OKAK Pro', 'Команды до 10 пользователей', 'SLA 99.9%']
  }
];

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: env.databaseUrl });
  try {
    await pool.query('BEGIN');

    // clean up duplicates before creating unique index (index creation fails if dupes exist)
    await pool.query(
      `DELETE FROM subscriptions s
       WHERE s.id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY lower(trim(name)), type
             ORDER BY price ASC, duration_days DESC, id ASC
           ) AS rn
           FROM subscriptions
         ) ranked
         WHERE rn = 1
       )`
    );

    // ensure unique index so ON CONFLICT works on subscription name
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_name_uniq ON subscriptions(name)`
    );

    // prevent duplicate active subscriptions per user — keep latest, drop the rest
    await pool.query(
      `DELETE FROM user_subscriptions us
       WHERE status = 'active'
         AND id NOT IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY end_date DESC, id DESC) AS rn
             FROM user_subscriptions WHERE status = 'active'
           ) ranked
           WHERE rn = 1
         )`
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_one_active
         ON user_subscriptions(user_id) WHERE status = 'active'`
    );

    for (const sub of SUBSCRIPTIONS) {
      const updated = await pool.query(
        `UPDATE subscriptions
         SET name = $1,
             description = $2,
             price = $3,
             currency = 'RUB',
             duration_days = $4,
             type = $5,
             status = 'active',
             quota_limit = $6,
             features = $7
         WHERE lower(trim(name)) = lower($1) AND type = $5`,
        [sub.name, sub.description, sub.price, sub.duration_days, sub.type, sub.quota_limit, sub.features]
      );
      if (updated.rowCount && updated.rowCount > 0) continue;
      await pool.query(
        `INSERT INTO subscriptions (name, description, price, currency, duration_days, type, status, quota_limit, features)
         VALUES ($1, $2, $3, 'RUB', $4, $5, 'active', $6, $7)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           duration_days = EXCLUDED.duration_days,
           type = EXCLUDED.type,
           quota_limit = EXCLUDED.quota_limit,
           features = EXCLUDED.features`,
        [sub.name, sub.description, sub.price, sub.duration_days, sub.type, sub.quota_limit, sub.features]
      );
    }

    const demoEmail = 'demo@okak.app';
    const passwordHash = await hashPassword('Okak1Demo!!!');
    const existing = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [demoEmail]);
    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    } else {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, date_of_birth, email_verified, subscription_status)
         VALUES ($1, $2, '1995-04-12', TRUE, 'free') RETURNING id`,
        [demoEmail, passwordHash]
      );
      userId = result.rows[0]!.id;
    }

    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, language, theme, interests, ai_personalization_enabled)
       VALUES ($1, 'Demo', 'ru', 'system', ARRAY['ai','productivity','swift'], TRUE)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    await pool.query(
      `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    await pool.query(
      `INSERT INTO quotas (user_id, plan_name, "limit", used, reset_at)
       VALUES ($1, 'free', $2, 7, now() + INTERVAL '20 days')
       ON CONFLICT (user_id) DO UPDATE SET used = 7, reset_at = EXCLUDED.reset_at, "limit" = EXCLUDED."limit"`,
      [userId, env.freeQuotaLimit]
    );

    // demo sessions — skip if demo already has sessions
    const demoSessions = await pool.query('SELECT 1 FROM sessions WHERE user_id = $1 LIMIT 1', [userId]);
    if (!demoSessions.rows[0]) {
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      await pool.query(
        `INSERT INTO sessions (user_id, refresh_token_hash, device_name, device_type, ip_address, expires_at)
         VALUES
           ($1, $2, 'iPhone Demo', 'ios', '127.0.0.1', $3),
           ($1, $4, 'MacBook Pro', 'macos', '192.168.1.42', $3)`,
        [userId, sha256('demo-current-token'), expires, sha256('demo-other-token')]
      );
    }

    // demo chats — skip if demo already has chats
    const demoChats = await pool.query('SELECT 1 FROM chats WHERE user_id = $1 LIMIT 1', [userId]);
    if (!demoChats.rows[0]) {
      const filledChat = await pool.query<{ id: string }>(
        `INSERT INTO chats (user_id, title, model, reasoning_level, search_enabled, streaming_enabled)
         VALUES ($1, 'Знакомство с OKAK', 'okak-standard', 'medium', FALSE, TRUE)
         RETURNING id`,
        [userId]
      );
      if (filledChat.rows[0]) {
        const chatId = filledChat.rows[0].id;
        await pool.query(
          `INSERT INTO messages (chat_id, role, content, status, token_count)
           VALUES
             ($1, 'user', 'Привет! Что ты умеешь?', 'completed', 7),
             ($1, 'assistant', 'Привет! Я помогаю писать тексты, отвечать на вопросы и подбирать подписки OKAK. Спрашивайте о чем угодно.', 'completed', 32)`,
          [chatId]
        );
      }
    }

    // demo order — skip if demo already has orders
    const demoOrders = await pool.query('SELECT 1 FROM orders WHERE user_id = $1 LIMIT 1', [userId]);
    if (!demoOrders.rows[0]) {
      const proSub = await pool.query<{ id: string; price: string; currency: string }>(
        `SELECT id, price, currency FROM subscriptions WHERE name = 'Pro AI' LIMIT 1`
      );
      if (proSub.rows[0]) {
        const sub = proSub.rows[0];
        const order = await pool.query<{ id: string }>(
          `INSERT INTO orders (user_id, subscription_id, amount, currency, status)
           VALUES ($1, $2, $3, $4, 'paid') RETURNING id`,
          [userId, sub.id, sub.price, sub.currency]
        );
        await pool.query(
          `INSERT INTO payments (order_id, provider, provider_payment_id, amount, currency, status)
           VALUES ($1, 'mock', $2, $3, $4, 'success')`,
          [order.rows[0]!.id, 'mock_demo_payment', sub.price, sub.currency]
        );
        await pool.query(
          `INSERT INTO user_subscriptions (user_id, subscription_id, status, start_date, end_date, auto_renew)
           VALUES ($1, $2, 'active', now() - INTERVAL '5 days', now() + INTERVAL '25 days', FALSE)`,
          [userId, sub.id]
        );
      }
    }

    // ensure at least one admin account
    const adminEmail = 'admin@okak.app';
    const adminExists = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (!adminExists.rows[0]) {
      const passwordHash = await hashPassword(env.adminPassword);
      await pool.query(
        `INSERT INTO users (email, password_hash, date_of_birth, email_verified, role, subscription_status)
         VALUES ($1, $2, '1990-01-01', TRUE, 'admin', 'active')`,
        [adminEmail, passwordHash]
      );
    }

    await pool.query('COMMIT');
    logger.info('seed complete');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('seed.js'))) {
  seed().catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  });
}
