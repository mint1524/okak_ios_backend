import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorsPlugin } from './plugins/errors.js';
import { dbPlugin } from './plugins/db.js';
import { authPlugin } from './plugins/auth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerSessionRoutes } from './modules/sessions/routes.js';
import { registerProfileRoutes } from './modules/profile/routes.js';
import { registerSettingsRoutes } from './modules/settings/routes.js';
import { registerChatRoutes } from './modules/chats/routes.js';
import { registerQuotaRoutes } from './modules/quota/routes.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import { registerSubscriptionsRoutes } from './modules/subscriptions/routes.js';
import { registerOrdersRoutes } from './modules/orders/routes.js';
import { registerPaymentsRoutes } from './modules/payments/routes.js';
import { registerRecommendationsRoutes } from './modules/recommendations/routes.js';
import { swaggerPlugin } from './plugins/swagger.js';
import rateLimit from '@fastify/rate-limit';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    disableRequestLogging: false,
    trustProxy: true
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1']
  });
  await app.register(errorsPlugin);
  await app.register(dbPlugin);
  await app.register(authPlugin);
  await swaggerPlugin(app);

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  registerAuthRoutes(app);
  registerSessionRoutes(app);
  registerProfileRoutes(app);
  registerSettingsRoutes(app);
  registerChatRoutes(app);
  registerQuotaRoutes(app);
  registerCatalogRoutes(app);
  registerSubscriptionsRoutes(app);
  registerOrdersRoutes(app);
  registerPaymentsRoutes(app);
  registerRecommendationsRoutes(app);

  return app;
}

export { env };
