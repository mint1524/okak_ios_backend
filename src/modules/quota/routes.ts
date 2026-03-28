import type { FastifyInstance } from 'fastify';
import { QuotaService, quotaToDTO } from './service.js';

export function registerQuotaRoutes(app: FastifyInstance): void {
  const quotas = new QuotaService(app);
  app.get('/quota', { preHandler: app.authenticate }, async (req) => {
    const q = await quotas.getOrCreate(req.user!.sub);
    return quotaToDTO(q);
  });
}
