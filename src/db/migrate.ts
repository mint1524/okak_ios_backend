import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pkg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(pool: pkg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(pool: pkg.Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function runMigration(pool: pkg.Pool, file: string): Promise<void> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    await client.query('COMMIT');
    logger.info({ file }, 'migration applied');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate(options: { reset?: boolean } = {}): Promise<void> {
  const pool = new Pool({ connectionString: env.databaseUrl });
  try {
    if (options.reset) {
      logger.warn('resetting public schema');
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await ensureMigrationsTable(pool);
    const applied = await appliedVersions(pool);
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await runMigration(pool, file);
    }
    logger.info('migrations complete');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  const reset = process.argv.includes('--reset');
  migrate({ reset }).catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exit(1);
  });
}

// allow direct invocation in dev via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes('--reset');
  migrate({ reset }).catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exit(1);
  });
}
