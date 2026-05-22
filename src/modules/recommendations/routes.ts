import type { FastifyInstance } from 'fastify';
import { Errors } from '../../plugins/errors.js';

interface SubscriptionRow {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  duration_days: number;
  type: string;
  status: string;
  quota_limit: number;
  features: string[];
}

function toDTO(row: SubscriptionRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    duration_days: row.duration_days,
    type: row.type,
    status: row.status,
    quota_limit: row.quota_limit,
    features: row.features
  };
}

export function registerRecommendationsRoutes(app: FastifyInstance): void {
  app.get('/recommendations', { preHandler: app.authenticate }, async (req) => {
    const messageStats = await app.pg.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE c.user_id = $1 AND m.role = 'user'`,
      [req.user!.sub]
    );
    const totalMessages = Number(messageStats.rows[0]?.total ?? 0);
    const quotaStats = await app.pg.query<{ used: number }>(
      'SELECT used FROM quotas WHERE user_id = $1',
      [req.user!.sub]
    );
    const usedRequests = Number(quotaStats.rows[0]?.used ?? 0);
    const { rows: subs } = await app.pg.query<SubscriptionRow>(
      `SELECT id, name, description, price, currency, duration_days, type, status, quota_limit, features
       FROM (
         SELECT s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY lower(trim(name)), type
                  ORDER BY price ASC, duration_days DESC, id ASC
                ) AS rn
         FROM subscriptions s
         WHERE status = 'active' AND price > 0
       ) ranked
       WHERE rn = 1
       ORDER BY quota_limit ASC, price ASC`
    );
    const items = subs.slice(0, 3).map((sub) => ({
      id: `${req.user!.sub}-${sub.id}`,
      subscription_id: sub.id,
      title: sub.name,
      reason: buildReason(sub, totalMessages),
      confidence: Math.max(0, Math.min(1, usedRequests / sub.quota_limit))
    }));
    return { items };
  });

  app.post('/recommendations/optimal-subscription', { preHandler: app.authenticate }, async (req) => {
    const messageStats = await app.pg.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE c.user_id = $1 AND m.role = 'user'`,
      [req.user!.sub]
    );
    const totalMessages = Number(messageStats.rows[0]?.total ?? 0);
    const { rows } = await app.pg.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE status = 'active' AND price > 0 AND quota_limit >= $1
       ORDER BY price ASC LIMIT 1`,
      [Math.max(50, totalMessages * 2)]
    );
    const optimal = rows[0] ?? (await app.pg.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE status = 'active' AND price > 0 ORDER BY quota_limit DESC LIMIT 1`
    )).rows[0];
    if (!optimal) throw Errors.notFound('Подписки недоступны');
    return {
      subscription: toDTO(optimal),
      explanation: `Исходя из ${totalMessages} ваших сообщений, оптимальный тариф — ${optimal.name} с лимитом ${optimal.quota_limit} запросов.`
    };
  });
}

function buildReason(sub: SubscriptionRow, totalMessages: number): string {
  if (totalMessages > 80 && sub.quota_limit >= 500) {
    return 'Вы активно используете AI Chat — этот тариф снимет ограничения.';
  }
  if (totalMessages > 30 && sub.quota_limit >= 100) {
    return 'Подходит для регулярного использования AI без перерывов.';
  }
  return `Тариф ${sub.name} доступен для оформления за ${Number(sub.price).toLocaleString('ru-RU')} ${sub.currency} и включает ${sub.quota_limit} запросов.`;
}
