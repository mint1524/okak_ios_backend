import { buildAdminApp } from './app.js';
import { env } from '../config/env.js';

async function main() {
  const app = await buildAdminApp();
  await app.listen({ host: env.adminHost, port: env.adminPort });
  app.log.info({ host: env.adminHost, port: env.adminPort }, 'admin api listening');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info({ signal }, 'admin shutting down');
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('failed to start admin', err);
  process.exit(1);
});
