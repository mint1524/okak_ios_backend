import fp from 'fastify-plugin';
import pkg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pkg;

declare module 'fastify' {
  interface FastifyInstance {
    pg: pkg.Pool;
  }
}

export const dbPlugin = fp(async (app) => {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
  pool.on('error', (err) => app.log.error({ err }, 'pg pool error'));
  app.decorate('pg', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
});
