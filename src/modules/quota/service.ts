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

export class QuotaService {
  constructor(private readonly app: FastifyInstance) {}

  async getOrCreate(userId: string): Promise<QuotaRow> {
    const { rows } = await this.app.pg.query<QuotaRow>(
      'SELECT user_id, plan_name, "limit" AS "limit", used, reset_at FROM quotas WHERE user_id = $1',
      [userId]
    );
    if (rows[0]) return this.maybeReset(rows[0]);
    const created = await this.app.pg.query<QuotaRow>(
      `INSERT INTO quotas (user_id, plan_name, "limit", used, reset_at)
       VALUES ($1, 'free', $2, 0, now() + interval '30 days')
       RETURNING user_id, plan_name, "limit", used, reset_at`,
      [userId, env.freeQuotaLimit]
    );
    return created.rows[0]!;
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
}

export function quotaToDTO(q: QuotaRow) {
  return {
    plan_name: q.plan_name,
    limit: q.limit,
    used: q.used,
    reset_at: q.reset_at
  };
}
