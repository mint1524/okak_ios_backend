import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

interface ModelEntry {
  id: string;
  label: string;
  provider: string;
}

const STATIC_MODELS: ModelEntry[] = [
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-4.6-thinking', label: 'Claude Sonnet 4.6 (thinking)', provider: 'anthropic' },
  { id: 'claude-opus-4-7-low', label: 'Claude Opus 4.7 (low)', provider: 'anthropic' },
  { id: 'claude-opus-4-7-medium', label: 'Claude Opus 4.7 (medium)', provider: 'anthropic' },
  { id: 'claude-opus-4-7-high', label: 'Claude Opus 4.7 (high)', provider: 'anthropic' },
  { id: 'claude-opus-4-7-medium-thinking', label: 'Claude Opus 4.7 (medium, thinking)', provider: 'anthropic' },
  { id: 'claude-opus-4-7-high-thinking', label: 'Claude Opus 4.7 (high, thinking)', provider: 'anthropic' },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' },
  { id: 'gpt-5.5-low', label: 'GPT-5.5 (low)', provider: 'openai' },
  { id: 'gpt-5.5-medium', label: 'GPT-5.5 (medium)', provider: 'openai' },
  { id: 'gpt-5.5-high', label: 'GPT-5.5 (high)', provider: 'openai' },
  { id: 'gpt-5.5-none', label: 'GPT-5.5 (none)', provider: 'openai' },
  { id: 'gpt-5.3-codex-high', label: 'GPT-5.3 Codex (high)', provider: 'openai' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (high)', provider: 'google' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (low)', provider: 'google' },
  { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', provider: 'google' },
  { id: 'deepseek-v4', label: 'DeepSeek v4', provider: 'deepseek' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xai' },
  { id: 'kimi-k2-6', label: 'Kimi K2.6', provider: 'moonshot' },
  { id: 'glm-5.1', label: 'GLM 5.1', provider: 'zhipu' },
  { id: 'minimax-m2.5', label: 'MiniMax M2.5', provider: 'minimax' }
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
