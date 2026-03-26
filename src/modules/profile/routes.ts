import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../plugins/errors.js';

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  language: z.enum(['ru', 'en']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  communication_style: z.string().max(100).optional(),
  interests: z.array(z.string().max(64)).max(50).optional(),
  ai_personalization_enabled: z.boolean().optional()
});

interface ProfileRow {
  id: string;
  user_id: string;
  display_name: string | null;
  language: string;
  theme: string;
  communication_style: string | null;
  interests: string[];
  ai_personalization_enabled: boolean;
}

function toDTO(p: ProfileRow) {
  return {
    id: p.id,
    user_id: p.user_id,
    display_name: p.display_name,
    language: p.language,
    theme: p.theme,
    communication_style: p.communication_style,
    interests: p.interests,
    ai_personalization_enabled: p.ai_personalization_enabled
  };
}

async function ensureProfile(app: FastifyInstance, userId: string): Promise<ProfileRow> {
  const { rows } = await app.pg.query<ProfileRow>('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
  if (rows[0]) return rows[0];
  const created = await app.pg.query<ProfileRow>(
    'INSERT INTO user_profiles (user_id) VALUES ($1) RETURNING *',
    [userId]
  );
  return created.rows[0]!;
}

export function registerProfileRoutes(app: FastifyInstance): void {
  app.get('/profile', { preHandler: app.authenticate }, async (req) => {
    const profile = await ensureProfile(app, req.user!.sub);
    return toDTO(profile);
  });

  app.patch('/profile', { preHandler: app.authenticate }, async (req) => {
    const body = updateProfileSchema.parse(req.body);
    const profile = await ensureProfile(app, req.user!.sub);
    const updates: string[] = [];
    const values: unknown[] = [profile.id];
    let idx = 2;
    for (const key of Object.keys(body) as (keyof typeof body)[]) {
      const value = body[key];
      if (value === undefined) continue;
      updates.push(`${key} = $${idx}`);
      values.push(value);
      idx += 1;
    }
    if (!updates.length) return toDTO(profile);
    updates.push('updated_at = now()');
    const updated = await app.pg.query<ProfileRow>(
      `UPDATE user_profiles SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return toDTO(updated.rows[0]!);
  });

  app.post('/profile/ai-personalization/reset', { preHandler: app.authenticate }, async (req) => {
    const profile = await ensureProfile(app, req.user!.sub);
    const updated = await app.pg.query<ProfileRow>(
      `UPDATE user_profiles
       SET interests = '{}', communication_style = NULL, ai_personalization_enabled = TRUE,
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [profile.id]
    );
    if (!updated.rows[0]) throw Errors.notFound('Профиль не найден');
    return toDTO(updated.rows[0]);
  });
}
