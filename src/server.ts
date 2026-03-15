import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function main() {
  const app = await buildApp();
  await app.listen({ host: '0.0.0.0', port: env.port });
  logger.info({ port: env.port }, 'public api listening');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
