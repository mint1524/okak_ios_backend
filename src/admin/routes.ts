import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { basicAuthGuard } from './auth.js';

const userListQuery = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0)
});

const subscriptionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  price: z.number().min(0),
  currency: z.string().min(1).max(8).default('RUB'),
  duration_days: z.number().int().min(1).max(3650).default(30),
  type: z.enum(['ai', 'addon']).default('ai'),
  quota_limit: z.number().int().min(0).default(100),
  status: z.enum(['active', 'archived']).default('active'),
  features: z.array(z.string()).default([])
});

const subscriptionUpdateSchema = subscriptionSchema.partial();

export function registerAdminRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', basicAuthGuard);

  app.get('/admin/stats', async () => {
    const stats = await app.pg.query<{
      users: string;
      paid_orders: string;
      active_subs: string;
      messages: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::TEXT FROM users) AS users,
         (SELECT COUNT(*)::TEXT FROM orders WHERE status = 'paid') AS paid_orders,
         (SELECT COUNT(*)::TEXT FROM user_subscriptions WHERE status = 'active') AS active_subs,
         (SELECT COUNT(*)::TEXT FROM messages) AS messages`
    );
    const row = stats.rows[0]!;
    return {
      users: Number(row.users),
      paid_orders: Number(row.paid_orders),
      active_subs: Number(row.active_subs),
      messages: Number(row.messages)
    };
  });

  app.get<{ Querystring: { q?: string; limit?: number; offset?: number } }>('/admin/users', async (req) => {
    const query = userListQuery.parse(req.query);
    const params: unknown[] = [];
    let where = '';
    if (query.q) {
      params.push(`%${query.q}%`);
      where = `WHERE email ILIKE $${params.length}`;
    }
    params.push(query.limit, query.offset);
    const { rows } = await app.pg.query(
      `SELECT id, email, role, subscription_status, email_verified, created_at
       FROM users ${where} ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const user = await app.pg.query(
      `SELECT id, email, role, subscription_status, email_verified, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    if (!user.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });
    const profile = await app.pg.query('SELECT * FROM user_profiles WHERE user_id = $1', [req.params.id]);
    const sessions = await app.pg.query(
      `SELECT id, device_name, ip_address, last_active_at, expires_at, revoked_at
       FROM sessions WHERE user_id = $1 ORDER BY last_active_at DESC LIMIT 10`,
      [req.params.id]
    );
    const quota = await app.pg.query('SELECT plan_name, "limit", used, reset_at FROM quotas WHERE user_id = $1', [req.params.id]);
    return {
      user: user.rows[0],
      profile: profile.rows[0] ?? null,
      sessions: sessions.rows,
      quota: quota.rows[0] ?? null
    };
  });

  app.get('/admin/orders', async () => {
    const { rows } = await app.pg.query(
      `SELECT o.id, o.user_id, u.email, s.name AS subscription_name, o.amount, o.currency, o.status, o.created_at
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN subscriptions s ON s.id = o.subscription_id
       ORDER BY o.created_at DESC LIMIT 200`
    );
    return { items: rows };
  });

  app.get('/admin/subscriptions', async () => {
    const { rows } = await app.pg.query(
      `SELECT * FROM subscriptions ORDER BY created_at DESC`
    );
    return { items: rows };
  });

  app.post('/admin/subscriptions', async (req, reply) => {
    const body = subscriptionSchema.parse(req.body);
    const { rows } = await app.pg.query(
      `INSERT INTO subscriptions (name, description, price, currency, duration_days, type, status, quota_limit, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [body.name, body.description, body.price, body.currency, body.duration_days, body.type, body.status, body.quota_limit, body.features]
    );
    return reply.code(201).send(rows[0]);
  });

  app.patch<{ Params: { id: string } }>('/admin/subscriptions/:id', async (req, reply) => {
    const body = subscriptionUpdateSchema.parse(req.body);
    const keys = Object.keys(body) as (keyof typeof body)[];
    if (!keys.length) {
      const { rows } = await app.pg.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
      if (!rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' });
      return rows[0];
    }
    const updates: string[] = [];
    const values: unknown[] = [req.params.id];
    let idx = 2;
    for (const key of keys) {
      const value = body[key];
      if (value === undefined) continue;
      updates.push(`${key} = $${idx}`);
      values.push(value);
      idx += 1;
    }
    updates.push('updated_at = now()');
    const { rows } = await app.pg.query(
      `UPDATE subscriptions SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    if (!rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' });
    return rows[0];
  });

  app.delete<{ Params: { id: string } }>('/admin/subscriptions/:id', async (req, reply) => {
    const result = await app.pg.query(
      `UPDATE subscriptions SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send({ message: 'Архивировано' });
  });

  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return DASHBOARD_HTML;
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>OKAK Admin</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:24px;color:#111;}
h1{font-size:20px;margin:0 0 16px}
section{margin-bottom:24px;padding:16px;border:1px solid #e5e5ea;border-radius:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:13px}
.kpi{display:flex;gap:16px;flex-wrap:wrap}
.kpi div{padding:12px 16px;border:1px solid #e5e5ea;border-radius:12px;min-width:140px}
.kpi span{display:block;color:#8e8e93;font-size:12px;margin-bottom:4px}
.kpi b{font-size:20px}
</style>
</head>
<body>
<h1>OKAK Admin · loopback only</h1>
<section><h2>Сводка</h2><div class="kpi" id="stats">Загрузка…</div></section>
<section><h2>Пользователи</h2><div id="users">Загрузка…</div></section>
<section><h2>Подписки</h2><div id="subs">Загрузка…</div></section>
<script>
async function get(path){
  const res = await fetch(path, {headers:{Accept:'application/json'}});
  if(!res.ok) throw new Error(path+' '+res.status);
  return res.json();
}
function table(items, columns){
  const rows = items.map(it => '<tr>'+columns.map(c=>'<td>'+(it[c]??'')+'</td>').join('')+'</tr>').join('');
  return '<table><thead><tr>'+columns.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>';
}
(async()=>{
  try{
    const stats = await get('/admin/stats');
    document.getElementById('stats').innerHTML = Object.entries(stats).map(([k,v])=>'<div><span>'+k+'</span><b>'+v+'</b></div>').join('');
    const users = await get('/admin/users?limit=20');
    document.getElementById('users').innerHTML = table(users.items, ['email','role','subscription_status','email_verified','created_at']);
    const subs = await get('/admin/subscriptions');
    document.getElementById('subs').innerHTML = table(subs.items, ['name','price','currency','quota_limit','status']);
  }catch(err){document.body.innerHTML+='<pre>'+err.message+'</pre>';}
})();
</script>
</body>
</html>`;
