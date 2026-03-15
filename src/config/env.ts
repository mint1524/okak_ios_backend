import { config as loadEnv } from 'dotenv';
loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Env var ${name} must be a number`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: number('PORT', 3000),
  adminPort: number('ADMIN_PORT', 3001),
  adminHost: process.env.ADMIN_HOST ?? '127.0.0.1',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_change_me',
  jwtAccessTtlSeconds: number('JWT_ACCESS_TTL_SECONDS', 60 * 15),
  jwtRefreshTtlSeconds: number('JWT_REFRESH_TTL_SECONDS', 60 * 60 * 24 * 30),

  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin_local',

  databaseUrl: required('DATABASE_URL'),
  pgSslMode: process.env.PGSSLMODE ?? 'disable',

  llmProvider: (process.env.LLM_PROVIDER ?? 'mock') as 'mock' | 'openai',
  llmBaseUrl: process.env.LLM_BASE_URL ?? '',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmDefaultModel: process.env.LLM_DEFAULT_MODEL ?? 'okak-standard',
  llmRequestTimeoutMs: number('LLM_REQUEST_TIMEOUT_MS', 60_000),

  freeQuotaLimit: number('FREE_QUOTA_LIMIT', 20),
  devEmailLog: boolean('DEV_EMAIL_LOG', true)
};

export type Env = typeof env;
