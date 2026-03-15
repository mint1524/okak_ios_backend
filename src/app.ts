import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorsPlugin } from './plugins/errors.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    disableRequestLogging: false,
    trustProxy: true
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(errorsPlugin);

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  return app;
}

export { env };
