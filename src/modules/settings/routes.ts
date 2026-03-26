import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const updateSettingsSchema = z.object({
  language: z.enum(['ru', 'en']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  notifications_enabled: z.boolean().optional(),
  analytics_enabled: z.boolean().optional()
});

interface SettingsRow {
  user_id: string;
  language: string;
  theme: string;
  notifications_enabled: boolean;
  analytics_enabled: boolean;
}

function toDTO(s: SettingsRow) {
  return {
    language: s.language,
    theme: s.theme,
    notifications_enabled: s.notifications_enabled,
    analytics_enabled: s.analytics_enabled
  };
}

async function ensure(app: FastifyInstance, userId: string): Promise<SettingsRow> {
  const { rows } = await app.pg.query<SettingsRow>('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  if (rows[0]) return rows[0];
  const created = await app.pg.query<SettingsRow>(
    'INSERT INTO user_settings (user_id) VALUES ($1) RETURNING *',
    [userId]
  );
  return created.rows[0]!;
}

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings', { preHandler: app.authenticate }, async (req) => {
    return toDTO(await ensure(app, req.user!.sub));
  });

  app.patch('/settings', { preHandler: app.authenticate }, async (req) => {
    const body = updateSettingsSchema.parse(req.body);
    const settings = await ensure(app, req.user!.sub);
    const updates: string[] = [];
    const values: unknown[] = [settings.user_id];
    let idx = 2;
    for (const key of Object.keys(body) as (keyof typeof body)[]) {
      const v = body[key];
      if (v === undefined) continue;
      updates.push(`${key} = $${idx}`);
      values.push(v);
      idx += 1;
    }
    if (!updates.length) return toDTO(settings);
    updates.push('updated_at = now()');
    const updated = await app.pg.query<SettingsRow>(
      `UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = $1 RETURNING *`,
      values
    );
    return toDTO(updated.rows[0]!);
  });
}
