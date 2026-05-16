import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

interface ModelEntry {
  id: string;
  label: string;
  provider: string;
}

const STATIC_MODELS: ModelEntry[] = [
  { id: 'okak-mini', label: 'OKAK Mini', provider: 'okak' },
  { id: 'okak-standard', label: 'OKAK Standard', provider: 'okak' },
  { id: 'okak-pro', label: 'OKAK Pro', provider: 'okak' }
];

let cache: { items: ModelEntry[]; expires: number } | null = null;

async function fetchProviderModels(): Promise<ModelEntry[]> {
  if (!env.llmBaseUrl || !env.llmApiKey) return [];
  const now = Date.now();
  if (cache && cache.expires > now) return cache.items;
  try {
    const url = `${env.llmBaseUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.llmApiKey}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    const items: ModelEntry[] = (json.data ?? [])
      .map((m) => ({
        id: String(m.id ?? ''),
        label: String(m.id ?? ''),
        provider: String(m.owned_by ?? 'provider')
      }))
      .filter((m) => m.id.length > 0);
    cache = { items, expires: now + 5 * 60 * 1000 };
    return items;
  } catch {
    return [];
  }
}

export function registerLLMRoutes(app: FastifyInstance): void {
  app.get('/llm/models', { preHandler: app.authenticate }, async () => {
    const remote = await fetchProviderModels();
    return {
      default: env.llmDefaultModel,
      items: remote.length ? remote : STATIC_MODELS
    };
  });
}
