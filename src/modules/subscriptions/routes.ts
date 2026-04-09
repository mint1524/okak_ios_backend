import type { FastifyInstance } from 'fastify';
import { Errors } from '../../plugins/errors.js';

interface UserSubscriptionRow {
  id: string;
  user_id: string;
  subscription_id: string;
  name: string;
  status: string;
  start_date: Date;
  end_date: Date;
  auto_renew: boolean;
  quota_limit: number;
}

function toDTO(row: UserSubscriptionRow) {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    name: row.name,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    auto_renew: row.auto_renew,
    quota_limit: row.quota_limit
  };
}

export function registerSubscriptionsRoutes(app: FastifyInstance): void {
  app.get('/subscriptions/active', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<UserSubscriptionRow>(
      `SELECT us.id, us.user_id, us.subscription_id, s.name, us.status,
              us.start_date, us.end_date, us.auto_renew, s.quota_limit
       FROM user_subscriptions us
       JOIN subscriptions s ON s.id = us.subscription_id
       WHERE us.user_id = $1
       ORDER BY us.end_date DESC`,
      [req.user!.sub]
    );
    return { items: rows.map(toDTO) };
  });

  app.post<{ Params: { id: string } }>('/subscriptions/:id/cancel', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<UserSubscriptionRow>(
      `UPDATE user_subscriptions us
       SET status = 'cancelled', auto_renew = FALSE, updated_at = now()
       FROM subscriptions s
       WHERE us.id = $1 AND us.user_id = $2 AND us.subscription_id = s.id
       RETURNING us.id, us.user_id, us.subscription_id, s.name, us.status, us.start_date, us.end_date, us.auto_renew, s.quota_limit`,
      [req.params.id, req.user!.sub]
    );
    if (!rows[0]) throw Errors.notFound('Подписка не найдена');
    return toDTO(rows[0]);
  });

  app.post<{ Params: { id: string } }>('/subscriptions/:id/renew', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<UserSubscriptionRow & { duration_days: number }>(
      `SELECT us.*, s.duration_days, s.name, s.quota_limit
       FROM user_subscriptions us
       JOIN subscriptions s ON s.id = us.subscription_id
       WHERE us.id = $1 AND us.user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    const current = rows[0];
    if (!current) throw Errors.notFound('Подписка не найдена');
    const baseDate = current.end_date.getTime() > Date.now() ? current.end_date : new Date();
    const newEnd = new Date(baseDate.getTime() + current.duration_days * 24 * 60 * 60 * 1000);
    const updated = await app.pg.query<UserSubscriptionRow>(
      `UPDATE user_subscriptions us
       SET status = 'active', end_date = $3, auto_renew = TRUE, updated_at = now()
       FROM subscriptions s
       WHERE us.id = $1 AND us.user_id = $2 AND us.subscription_id = s.id
       RETURNING us.id, us.user_id, us.subscription_id, s.name, us.status, us.start_date, us.end_date, us.auto_renew, s.quota_limit`,
      [req.params.id, req.user!.sub, newEnd]
    );
    return toDTO(updated.rows[0]!);
  });
}
