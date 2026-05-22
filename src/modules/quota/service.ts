import type { FastifyInstance } from 'fastify';
import { Errors } from '../../plugins/errors.js';
import { env } from '../../config/env.js';

export interface QuotaRow {
  user_id: string;
  plan_name: string;
  limit: number;
  used: number;
  reset_at: Date;
}

interface ActivePlanRow {
  name: string;
  quota_limit: number;
  end_date: Date;
}

export function planNameFromSubscription(name: string): string {
  const tier = name.trim().toLowerCase().split(/\s+/)[0];
  if (tier === 'free' || tier === 'pro' || tier === 'premium' || tier === 'business') {
    return tier;
  }
  return tier || 'paid';
}

export class QuotaService {
  constructor(private readonly app: FastifyInstance) {}

  async getOrCreate(userId: string): Promise<QuotaRow> {
    const { rows } = await this.app.pg.query<QuotaRow>(
      'SELECT user_id, plan_name, "limit" AS "limit", used, reset_at FROM quotas WHERE user_id = $1',
      [userId]
    );
    if (rows[0]) return this.syncActivePlan(await this.maybeReset(rows[0]));
    const created = await this.app.pg.query<QuotaRow>(
      `INSERT INTO quotas (user_id, plan_name, "limit", used, reset_at)
       VALUES ($1, 'free', $2, 0, now() + interval '30 days')
       RETURNING user_id, plan_name, "limit", used, reset_at`,
      [userId, env.freeQuotaLimit]
    );
    return this.syncActivePlan(created.rows[0]!);
  }

  async ensureAvailable(userId: string): Promise<QuotaRow> {
    const quota = await this.getOrCreate(userId);
    if (quota.used >= quota.limit) {
      throw Errors.quotaExceeded();
    }
    return quota;
  }

  async increment(userId: string, by = 1): Promise<QuotaRow> {
    const { rows } = await this.app.pg.query<QuotaRow>(
      `UPDATE quotas SET used = LEAST("limit", used + $2)
       WHERE user_id = $1
       RETURNING user_id, plan_name, "limit", used, reset_at`,
      [userId, by]
    );
    return rows[0] ?? (await this.getOrCreate(userId));
  }

  private async maybeReset(quota: QuotaRow): Promise<QuotaRow> {
    if (quota.reset_at.getTime() > Date.now()) return quota;
    const updated = await this.app.pg.query<QuotaRow>(
      `UPDATE quotas SET used = 0, reset_at = now() + interval '30 days'
       WHERE user_id = $1
       RETURNING user_id, plan_name, "limit", used, reset_at`,
      [quota.user_id]
    );
    return updated.rows[0]!;
  }

  private async syncActivePlan(quota: QuotaRow): Promise<QuotaRow> {
    const { rows } = await this.app.pg.query<ActivePlanRow>(
      `SELECT s.name, s.quota_limit, us.end_date
       FROM user_subscriptions us
       JOIN subscriptions s ON s.id = us.subscription_id
       WHERE us.user_id = $1
         AND us.status = 'active'
         AND us.end_date > now()
       ORDER BY us.end_date DESC, us.id DESC
       LIMIT 1`,
      [quota.user_id]
    );
    const activePlan = rows[0];
    if (!activePlan) return quota;
    const planName = planNameFromSubscription(activePlan.name);
    if (quota.plan_name === planName && quota.limit === activePlan.quota_limit) {
      return quota;
    }
    const updated = await this.app.pg.query<QuotaRow>(
      `UPDATE quotas
       SET plan_name = $2, "limit" = $3, reset_at = $4
       WHERE user_id = $1
       RETURNING user_id, plan_name, "limit", used, reset_at`,
      [quota.user_id, planName, activePlan.quota_limit, activePlan.end_date]
    );
    return updated.rows[0]!;
  }
}

export function quotaToDTO(q: QuotaRow) {
  return {
    plan_name: q.plan_name,
    limit: q.limit,
    used: q.used,
    reset_at: q.reset_at
  };
}
