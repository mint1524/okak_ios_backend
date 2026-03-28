import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { Errors } from '../../plugins/errors.js';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CompletionRequest {
  model: string;
  reasoningLevel: 'low' | 'medium' | 'high' | string;
  searchEnabled: boolean;
  messages: ChatTurn[];
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

class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai';

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!env.llmBaseUrl || !env.llmApiKey) throw Errors.llmUnavailable();
    const response = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.llmApiKey}`
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: false
      }),
      signal: AbortSignal.timeout(env.llmRequestTimeoutMs)
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'llm completion failed');
      throw Errors.llmUnavailable();
    }
    const json = (await response.json()) as OpenAIChunk;
    const content = json.choices?.[0]?.message?.content ?? '';
    return { content, tokenCount: json.usage?.total_tokens ?? approximateTokens(content) };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    if (!env.llmBaseUrl || !env.llmApiKey) {
      yield { type: 'error', message: 'LLM provider not configured' };
      return;
    }
    yield { type: 'start' };
    const response = await fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${env.llmApiKey}`
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true
      }),
      signal: AbortSignal.timeout(env.llmRequestTimeoutMs)
    });
    if (!response.ok || !response.body) {
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
  }
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
