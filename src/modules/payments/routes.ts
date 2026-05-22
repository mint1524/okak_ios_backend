import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../plugins/errors.js';
import { logger } from '../../utils/logger.js';
import { planNameFromSubscription } from '../quota/service.js';

const createPaymentSchema = z.object({
  order_id: z.string().uuid()
});

const confirmSchema = z.object({
  provider_payment_id: z.string().min(1),
  outcome: z.enum(['success', 'failed', 'cancelled'])
});

const webhookSchema = z.object({
  provider: z.string(),
  provider_payment_id: z.string(),
  status: z.enum(['success', 'failed', 'cancelled'])
});

interface PaymentRow {
  id: string;
  order_id: string;
  provider: string;
  provider_payment_id: string;
  amount: string;
  currency: string;
  status: string;
}

interface SubscriptionOrderRow {
  user_id: string;
  subscription_id: string;
  name: string;
  duration_days: number;
  quota_limit: number;
}

async function activateSubscription(app: FastifyInstance, orderId: string): Promise<void> {
  const orderRes = await app.pg.query<SubscriptionOrderRow>(
    `SELECT o.user_id, o.subscription_id, s.name, s.duration_days, s.quota_limit
     FROM orders o JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.id = $1`,
    [orderId]
  );
  const order = orderRes.rows[0];
  if (!order) return;
  const endDate = new Date(Date.now() + order.duration_days * 24 * 60 * 60 * 1000);
  await app.pg.query(
    `UPDATE user_subscriptions
     SET status = 'cancelled', auto_renew = FALSE, updated_at = now()
     WHERE user_id = $1 AND status = 'active'`,
    [order.user_id]
  );
  await app.pg.query(
    `INSERT INTO user_subscriptions (user_id, subscription_id, status, end_date, auto_renew)
     VALUES ($1, $2, 'active', $3, FALSE)`,
    [order.user_id, order.subscription_id, endDate]
  );
  await app.pg.query(
    `UPDATE users SET subscription_status = 'active', updated_at = now() WHERE id = $1`,
    [order.user_id]
  );
  await app.pg.query(
    `INSERT INTO quotas (user_id, plan_name, "limit", used, reset_at)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET plan_name = EXCLUDED.plan_name,
         "limit" = EXCLUDED."limit",
         used = 0,
         reset_at = EXCLUDED.reset_at`,
    [order.user_id, planNameFromSubscription(order.name), order.quota_limit, endDate]
  );
}

function paymentDTO(p: PaymentRow) {
  return {
    id: p.id,
    provider_payment_id: p.provider_payment_id,
    amount: Number(p.amount),
    currency: p.currency,
    status: p.status
  };
}

export function registerPaymentsRoutes(app: FastifyInstance): void {
  app.post('/payments/mock/create', { preHandler: app.authenticate }, async (req) => {
    const body = createPaymentSchema.parse(req.body);
    const { rows } = await app.pg.query<PaymentRow>(
      `SELECT p.* FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.order_id = $1 AND o.user_id = $2
       ORDER BY p.created_at DESC LIMIT 1`,
      [body.order_id, req.user!.sub]
    );
    if (!rows[0]) throw Errors.notFound('Платёж не найден');
    return paymentDTO(rows[0]);
  });

  app.post('/payments/mock/confirm', { preHandler: app.authenticate }, async (req) => {
    const body = confirmSchema.parse(req.body);
    const result = await app.pg.query<PaymentRow & { order_id: string; user_id: string }>(
      `SELECT p.*, o.user_id FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.provider_payment_id = $1 AND o.user_id = $2`,
      [body.provider_payment_id, req.user!.sub]
    );
    const payment = result.rows[0];
    if (!payment) throw Errors.notFound('Платёж не найден');
    const targetStatus = body.outcome;
    const updated = await app.pg.query<PaymentRow>(
      `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [targetStatus, payment.id]
    );
    const orderStatus = targetStatus === 'success' ? 'paid' : targetStatus;
    await app.pg.query(
      `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2`,
      [orderStatus, payment.order_id]
    );
    if (targetStatus === 'success') {
      await activateSubscription(app, payment.order_id);
    }
    return paymentDTO(updated.rows[0]!);
  });

  app.post('/payments/webhook', async (req, reply) => {
    const body = webhookSchema.parse(req.body);
    logger.info({ provider: body.provider }, 'payment webhook');
    const result = await app.pg.query<PaymentRow & { order_id: string }>(
      `SELECT * FROM payments WHERE provider_payment_id = $1`,
      [body.provider_payment_id]
    );
    const payment = result.rows[0];
    if (!payment) return reply.code(404).send({ message: 'unknown payment' });
    const orderStatus = body.status === 'success' ? 'paid' : body.status;
    await app.pg.query(`UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`, [body.status, payment.id]);
    await app.pg.query(`UPDATE orders SET status = $1, updated_at = now() WHERE id = $2`, [orderStatus, payment.order_id]);
    if (body.status === 'success') {
      await activateSubscription(app, payment.order_id);
    }
    return { message: 'processed' };
  });
}
