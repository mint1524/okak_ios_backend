import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();
  await app.listen({ host: '0.0.0.0', port: env.port });
  app.log.info({ port: env.port }, 'public api listening');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('failed to start server', err);
  process.exit(1);
});
