import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { Errors } from '../../plugins/errors.js';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CompletionRequest {
  model: string;
  reasoningLevel: ReasoningLevel | string;
  searchEnabled: boolean;
  messages: ChatTurn[];
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  tokenCount: number;
}

export type StreamEvent =
  | { type: 'start' }
  | { type: 'delta'; content: string }
  | { type: 'tool_use'; content: string }
  | { type: 'done'; content: string; tokenCount: number }
  | { type: 'error'; message: string };

export interface LLMProvider {
  name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest): AsyncIterable<StreamEvent>;
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

class MockLLMProvider implements LLMProvider {
  name = 'mock';

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const reply = this.buildReply(req);
    return { content: reply, tokenCount: approximateTokens(reply) };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const reply = this.buildReply(req);
    yield { type: 'start' };
    const chunks = reply.match(/\S+\s*/g) ?? [reply];
    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, 40));
      yield { type: 'delta', content: chunk };
    }
    yield { type: 'done', content: reply, tokenCount: approximateTokens(reply) };
  }

  private buildReply(req: CompletionRequest): string {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content?.trim() || 'Привет!';
    const trimmed = prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt;
    const reasoning = req.reasoningLevel;
    const search = req.searchEnabled ? ' (поиск включён)' : '';
    return `OKAK ${req.model} [${reasoning}]${search}: ${trimmed}\n\nКраткий ответ на запрос: учитываю контекст диалога и сохраняю стиль ответа дружелюбным.`;
  }
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { total_tokens?: number };
}

interface UpstreamErrorBody {
  error?: { message?: string; type?: string; retry_after_ms?: number } | string;
  message?: string;
  type?: string;
  retry_after_ms?: number;
}

export const REASONING_LEVEL_IDS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'thinking',
  'medium-thinking',
  'high-thinking',
  'xhigh',
  'max'
] as const;
export type ReasoningLevel = (typeof REASONING_LEVEL_IDS)[number];

const DEFAULT_MODEL_FALLBACKS = ['claude-sonnet-4.6-thinking', 'claude-sonnet-4.6'];

function unique(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeReasoningLevel(reasoningLevel = 'medium'): ReasoningLevel {
  return (REASONING_LEVEL_IDS as readonly string[]).includes(reasoningLevel)
    ? (reasoningLevel as ReasoningLevel)
    : 'medium';
}

function isReasoningOff(level: ReasoningLevel): boolean {
  return level === 'none' || level === 'minimal' || level === 'low';
}

function withThinkingVariant(base: string): string {
  return base.endsWith('-thinking') ? base : `${base}-thinking`;
}

function resolveProModel(base: string, level: ReasoningLevel): string {
  if (base === 'claude-opus-4-7') {
    const suffix = level === 'thinking' ? 'medium-thinking' : isReasoningOff(level) ? 'low' : level;
    return `${base}-${suffix}`;
  }
  if (isReasoningOff(level)) return base;
  return withThinkingVariant(base);
}

export function resolveModelCandidates(model: string, reasoningLevel = 'medium'): string[] {
  const level = normalizeReasoningLevel(reasoningLevel);
  if (model === 'okak-mini') {
    return unique([env.llmMiniModel, 'claude-sonnet-4.6', ...DEFAULT_MODEL_FALLBACKS]);
  }
  if (model === 'okak-pro') {
    return unique([
      resolveProModel(env.llmProModel, level),
      level === 'max' ? 'claude-opus-4-7-xhigh' : undefined,
      'claude-opus-4-7-medium',
      ...DEFAULT_MODEL_FALLBACKS
    ]);
  }
  const base = model === 'okak-standard' ? env.llmStandardModel : env.llmStandardModel;
  return unique([
    isReasoningOff(level) ? base : withThinkingVariant(base),
    base,
    ...DEFAULT_MODEL_FALLBACKS
  ]);
}

async function readUpstreamError(response: Response): Promise<UpstreamErrorBody | undefined> {
  try {
    return (await response.json()) as UpstreamErrorBody;
  } catch {
    return undefined;
  }
}

function upstreamErrorMessage(body: UpstreamErrorBody | undefined): string {
  if (!body) return 'Unknown upstream error';
  if (typeof body.error === 'string') return body.error;
  return body.error?.message ?? body.message ?? body.type ?? 'Unknown upstream error';
}

function shouldTryFallback(status: number): boolean {
  return status !== 401;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(env.llmRequestTimeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai';

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!env.llmBaseUrl || !env.llmApiKey) throw Errors.llmUnavailable();
    const candidates = resolveModelCandidates(req.model, req.reasoningLevel);
    for (const candidate of candidates) {
      const response = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.llmApiKey}`
        },
        body: JSON.stringify({
          model: candidate,
          messages: req.messages,
          stream: false
        }),
        signal: requestSignal(req.signal)
      });
      if (!response.ok) {
        const body = await readUpstreamError(response);
        logger.warn(
          { status: response.status, model: candidate, message: upstreamErrorMessage(body) },
          'llm completion candidate failed'
        );
        if (shouldTryFallback(response.status)) continue;
        throw Errors.llmUnavailable();
      }
      const json = (await response.json()) as OpenAIChunk;
      const content = json.choices?.[0]?.message?.content ?? '';
      return { content, tokenCount: json.usage?.total_tokens ?? approximateTokens(content) };
    }
    throw Errors.llmUnavailable();
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    if (!env.llmBaseUrl || !env.llmApiKey) {
      yield { type: 'error', message: 'LLM provider not configured' };
      return;
    }
    yield { type: 'start' };
    const candidates = resolveModelCandidates(req.model, req.reasoningLevel);
    for (const candidate of candidates) {
      const response = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${env.llmApiKey}`
        },
        body: JSON.stringify({
          model: candidate,
          messages: req.messages,
          stream: true
        }),
        signal: requestSignal(req.signal)
      });
      if (!response.ok || !response.body) {
        const body = response.ok ? undefined : await readUpstreamError(response);
        logger.warn(
          { status: response.status, model: candidate, message: upstreamErrorMessage(body) },
          'llm stream candidate failed'
        );
        if (shouldTryFallback(response.status)) continue;
        yield { type: 'error', message: `Upstream error ${response.status}` };
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      let combined = '';
      let tokenCount = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as OpenAIChunk;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              combined += delta;
              yield { type: 'delta', content: delta };
            }
            if (parsed.usage?.total_tokens) tokenCount = parsed.usage.total_tokens;
          } catch {
            // ignore non-JSON keep-alives
          }
        }
      }
      yield {
        type: 'done',
        content: combined,
        tokenCount: tokenCount || approximateTokens(combined)
      };
      return;
    }
    yield { type: 'error', message: 'LLM provider rejected all model candidates' };
  }
}

export function resolveModel(model: string, reasoningLevel = 'medium'): string {
  return resolveModelCandidates(model, reasoningLevel)[0] ?? env.llmStandardModel;
}

let cached: LLMProvider | undefined;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  if (env.llmProvider === 'openai' && env.llmApiKey && env.llmBaseUrl) {
    cached = new OpenAICompatibleProvider();
  } else {
    cached = new MockLLMProvider();
  }
  return cached;
}
