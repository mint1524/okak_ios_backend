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

export function registerCatalogRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { type?: string } }>('/catalog/subscriptions', async (req) => {
    const params: unknown[] = [];
    let where = "WHERE status = 'active'";
    if (req.query.type) {
      params.push(req.query.type);
      where += ` AND type = $${params.length}`;
    }
    const { rows } = await app.pg.query<SubscriptionRow>(
      `SELECT id, name, description, price, currency, duration_days, type, status, quota_limit, features
       FROM (
         SELECT s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY lower(name), type
                  ORDER BY price ASC, duration_days DESC, id ASC
                ) AS rn
         FROM subscriptions s
         ${where} AND price > 0
       ) ranked
       WHERE rn = 1
       ORDER BY price ASC, duration_days ASC`,
      params
    );
    return { items: rows.map(toDTO) };
  });

  app.get<{ Params: { id: string } }>('/catalog/subscriptions/:id', async (req) => {
    const { rows } = await app.pg.query<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw Errors.notFound('Подписка не найдена');
    return toDTO(rows[0]);
  });
}
