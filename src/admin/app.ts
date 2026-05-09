import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../config/env.js';
import { loggerConfig } from '../utils/logger.js';
import { errorsPlugin } from '../plugins/errors.js';
import { dbPlugin } from '../plugins/db.js';
import { registerAdminRoutes } from './routes.js';

export async function buildAdminApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerConfig, trustProxy: true });
  await app.register(cors, { origin: false });
  await app.register(errorsPlugin);
  await app.register(dbPlugin);
  registerAdminRoutes(app);
  return app;
}

export { env };
