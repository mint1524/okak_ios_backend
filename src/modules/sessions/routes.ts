import type { FastifyInstance } from 'fastify';

interface SessionRow {
  id: string;
  user_id: string;
  device_name: string;
  device_type: string;
  ip_address: string;
  user_agent: string | null;
  created_at: Date;
  last_active_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toDTO(s: SessionRow, currentSid: string) {
  return {
    id: s.id,
    device_name: s.device_name,
    device_type: s.device_type,
    ip_address: s.ip_address,
    user_agent: s.user_agent,
    is_current: s.id === currentSid,
    created_at: s.created_at,
    last_active_at: s.last_active_at,
    expires_at: s.expires_at
  };
}

export function registerSessionRoutes(app: FastifyInstance): void {
  app.get('/sessions', { preHandler: app.authenticate }, async (req) => {
    const { rows } = await app.pg.query<SessionRow>(
      `SELECT * FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_active_at DESC`,
      [req.user!.sub]
    );
    return { items: rows.map((r) => toDTO(r, req.user!.sid)) };
  });

  app.delete('/sessions/current', { preHandler: app.authenticate }, async (req, reply) => {
    await app.pg.query(
      `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2`,
      [req.user!.sid, req.user!.sub]
    );
    return reply.send({ message: 'Текущая сессия завершена' });
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', {
    preHandler: app.authenticate
  }, async (req, reply) => {
    if (req.params.id === req.user!.sid) {
      return reply.code(409).send({ error: 'CANNOT_REVOKE_CURRENT', message: 'Используйте /sessions/current' });
    }
    const result = await app.pg.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.params.id, req.user!.sub]
    );
    if (!result.rowCount) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Сессия не найдена' });
    }
    return reply.send({ message: 'Сессия завершена' });
  });
}
