import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Errors } from '../../plugins/errors.js';

const createOrderSchema = z.object({
  subscription_id: z.string().uuid()
});

interface OrderRow {
  id: string;
  user_id: string;
  subscription_id: string;
  amount: string;
  currency: string;
  status: string;
  created_at: Date;
}

interface OrderWithDetails extends OrderRow {
  subscription_name: string;
  payment_id: string | null;
  payment_status: string | null;
}

function toDTO(row: OrderWithDetails) {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    subscription_name: row.subscription_name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    created_at: row.created_at,
    payment_id: row.payment_id,
    payment_status: row.payment_status
  };
}

export function registerOrdersRoutes(app: FastifyInstance): void {
  app.post('/orders', { preHandler: app.authenticate }, async (req) => {
    const body = createOrderSchema.parse(req.body);
    const subRes = await app.pg.query<{ id: string; price: string; currency: string; name: string; status: string }>(
      'SELECT id, price, currency, name, status FROM subscriptions WHERE id = $1',
      [body.subscription_id]
    );
    const sub = subRes.rows[0];
    if (!sub) throw Errors.notFound('Подписка не найдена');
    if (sub.status !== 'active') throw Errors.validation('Подписка недоступна');
    const orderRes = await app.pg.query<OrderRow>(
      `INSERT INTO orders (user_id, subscription_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.user!.sub, sub.id, sub.price, sub.currency]
    );
    const order = orderRes.rows[0]!;
    const providerPaymentId = `mock_${randomUUID()}`;
    const paymentRes = await app.pg.query<{
      id: string;
      provider_payment_id: string;
      amount: string;
      currency: string;
      status: string;
    }>(
      `INSERT INTO payments (order_id, provider, provider_payment_id, amount, currency, status)
       VALUES ($1, 'mock', $2, $3, $4, 'pending')
       RETURNING id, provider_payment_id, amount, currency, status`,
      [order.id, providerPaymentId, sub.price, sub.currency]
    );
    const payment = paymentRes.rows[0]!;
    return {
      order: toDTO({
        ...order,
        subscription_name: sub.name,
        payment_id: payment.id,
        payment_status: payment.status
      }),
      payment: {
        id: payment.id,
        provider_payment_id: payment.provider_payment_id,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status
      }
    };
  });

  app.get('/orders', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<OrderWithDetails>(
      `SELECT o.id, o.user_id, o.subscription_id, o.amount, o.currency, o.status, o.created_at,
              s.name AS subscription_name,
              p.id AS payment_id, p.status AS payment_status
       FROM orders o
       JOIN subscriptions s ON s.id = o.subscription_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) p ON TRUE
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [req.user!.sub]
    );
    return { items: rows.map(toDTO) };
  });

  app.get<{ Params: { id: string } }>('/orders/:id', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<OrderWithDetails>(
      `SELECT o.id, o.user_id, o.subscription_id, o.amount, o.currency, o.status, o.created_at,
              s.name AS subscription_name,
              p.id AS payment_id, p.status AS payment_status
       FROM orders o
       JOIN subscriptions s ON s.id = o.subscription_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) p ON TRUE
       WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    if (!rows[0]) throw Errors.notFound('Заказ не найден');
    return toDTO(rows[0]);
  });
}
