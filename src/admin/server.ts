import { buildAdminApp } from './app.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

async function main() {
  const app = await buildAdminApp();
  await app.listen({ host: env.adminHost, port: env.adminPort });
  logger.info({ host: env.adminHost, port: env.adminPort }, 'admin api listening');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, 'admin shutting down');
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'failed to start admin');
  process.exit(1);
});
