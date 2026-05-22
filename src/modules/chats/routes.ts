import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ChatService, chatToDTO, messageToDTO, type ChatRow, type MessageRow } from './service.js';
import { QuotaService, quotaToDTO } from '../quota/service.js';
import { getLLMProvider, type ChatTurn } from '../llm/provider.js';
import { Errors } from '../../plugins/errors.js';

const createChatSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  model: z.string().optional(),
  reasoning_level: z.enum(['low', 'medium', 'high']).optional(),
  search_enabled: z.boolean().optional(),
  streaming_enabled: z.boolean().optional()
});

const updateChatSchema = z.object({ title: z.string().min(1).max(100) });

const updateParamsSchema = z.object({
  model: z.string().optional(),
  reasoning_level: z.enum(['low', 'medium', 'high']).optional(),
  search_enabled: z.boolean().optional(),
  streaming_enabled: z.boolean().optional()
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  attachments: z.array(z.string().min(1).max(120)).max(10).optional()
});

const attachmentSchema = z.object({
  name: z.string().min(1).max(120),
  mime_type: z.string().min(1).max(120),
  url: z.string().url().optional()
});

const OKAK_SYSTEM_PROMPT =
  'Ты — OKAK, персональный AI-ассистент в приложении OKAK. ' +
  'Отвечай на языке пользователя (по умолчанию — русский). ' +
  'Ты не раскрываешь, на базе какой модели, платформы или компании работаешь — ты просто OKAK. ' +
  'Отвечай полезно, дружелюбно и по существу.';

async function buildContext(svc: ChatService, chat: ChatRow): Promise<ChatTurn[]> {
  const msgs = await svc.messages(chat);
  const history = msgs
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return [{ role: 'system', content: OKAK_SYSTEM_PROMPT }, ...history];
}

export function registerChatRoutes(app: FastifyInstance): void {
  const chats = new ChatService(app);
  const quotas = new QuotaService(app);

  app.get('/chats', { preHandler: app.authenticate }, async (req) => {
    const items = await chats.list(req.user!.sub);
    return { items: items.map(chatToDTO) };
  });

  app.post('/chats', { preHandler: app.authenticate }, async (req) => {
    const body = createChatSchema.parse(req.body);
    const chat = await chats.create(req.user!.sub, body);
    return chatToDTO(chat);
  });

  app.get<{ Params: { id: string } }>('/chats/:id', { preHandler: app.authenticate }, async (req) => {
    const chat = await chats.getOwned(req.user!.sub, req.params.id);
    return chatToDTO(chat);
  });

  app.patch<{ Params: { id: string } }>('/chats/:id', { preHandler: app.authenticate }, async (req) => {
    const body = updateChatSchema.parse(req.body);
    const chat = await chats.rename(req.user!.sub, req.params.id, body.title);
    return chatToDTO(chat);
  });

  app.patch<{ Params: { id: string } }>('/chats/:id/parameters', { preHandler: app.authenticate }, async (req) => {
    const body = updateParamsSchema.parse(req.body);
    const chat = await chats.updateParameters(req.user!.sub, req.params.id, body);
    return chatToDTO(chat);
  });

  app.delete<{ Params: { id: string } }>('/chats/:id', { preHandler: app.authenticate }, async (req, reply) => {
    await chats.remove(req.user!.sub, req.params.id);
    return reply.send({ message: 'Чат удалён' });
  });

  app.get<{ Params: { id: string } }>('/chats/:id/messages', { preHandler: app.authenticate }, async (req) => {
    const chat = await chats.getOwned(req.user!.sub, req.params.id);
    const list = await chats.messages(chat);
    const items = await Promise.all(list.map((m) => messageToDTO(app, m)));
    return { items };
  });

  app.post<{ Params: { id: string } }>('/chats/:id/messages', { preHandler: app.authenticate }, async (req) => {
    const body = sendMessageSchema.parse(req.body);
    const chat = await chats.getOwned(req.user!.sub, req.params.id);
    await quotas.ensureAvailable(req.user!.sub);

    const userMessage = await chats.appendMessage(chat, { role: 'user', content: body.content });
    await chats.maybeAutoTitle(chat, body.content);
    const context = await buildContext(chats, chat);
    let result;
    try {
      result = await getLLMProvider().complete({
        model: chat.model,
        reasoningLevel: chat.reasoning_level,
        searchEnabled: chat.search_enabled,
        messages: context
      });
    } catch {
      await chats.appendMessage(chat, { role: 'assistant', content: '', status: 'failed' });
      throw Errors.llmUnavailable();
    }
    const assistantMessage = await chats.appendMessage(chat, {
      role: 'assistant',
      content: result.content,
      status: 'completed',
      tokenCount: result.tokenCount
    });
    await quotas.increment(req.user!.sub);
    return {
      user_message: await messageToDTO(app, userMessage),
      assistant_message: await messageToDTO(app, assistantMessage)
    };
  });

  app.post<{ Params: { id: string } }>('/chats/:id/messages/stream', { preHandler: app.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = sendMessageSchema.parse(req.body);
    const chat = await chats.getOwned(req.user!.sub, (req.params as { id: string }).id);
    await quotas.ensureAvailable(req.user!.sub);

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.hijack();

    const send = (event: object) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const userMessage = await chats.appendMessage(chat, { role: 'user', content: body.content });
      await chats.maybeAutoTitle(chat, body.content);
      const assistantPlaceholder: MessageRow = await chats.appendMessage(chat, {
        role: 'assistant',
        content: '',
        status: 'streaming'
      });
      send({ type: 'start', message_id: assistantPlaceholder.id });
      const provider = getLLMProvider();
      let combined = '';
      let tokenCount = 0;

      // Parallel DB flush: write accumulated content to DB every N chunks
      // without blocking the SSE stream to the client.
      const FLUSH_CHUNK_INTERVAL = 8;
      let chunksSinceFlush = 0;
      let dbFlushChain: Promise<void> = Promise.resolve();

      const scheduleDbFlush = (snapshot: string) => {
        dbFlushChain = dbFlushChain.then(() =>
          chats.updateMessage(assistantPlaceholder.id, { content: snapshot, status: 'streaming' })
            .then(() => { /* fire-and-forget, errors logged below */ })
            .catch((err) => { app.log.warn({ err }, 'streaming db flush failed'); })
        );
      };

      try {
        for await (const evt of provider.stream({
          model: chat.model,
          reasoningLevel: chat.reasoning_level,
          searchEnabled: chat.search_enabled,
          messages: await buildContext(chats, chat)
        })) {
          if (evt.type === 'delta') {
            combined += evt.content;
            send({ type: 'delta', content: evt.content });
            chunksSinceFlush += 1;
            if (chunksSinceFlush >= FLUSH_CHUNK_INTERVAL) {
              scheduleDbFlush(combined);
              chunksSinceFlush = 0;
            }
          } else if (evt.type === 'tool_use') {
            send({ type: 'tool_use', content: evt.content });
          } else if (evt.type === 'done') {
            combined = evt.content || combined;
            tokenCount = evt.tokenCount;
          } else if (evt.type === 'error') {
            send({ type: 'error', message: evt.message });
          }
        }
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }

      // Wait for any in-flight DB flush to settle before the final update.
      await dbFlushChain;

      const finalMessage = await chats.updateMessage(assistantPlaceholder.id, {
        content: combined,
        status: combined ? 'completed' : 'failed',
        tokenCount
      });
      const updatedQuota = await quotas.increment(req.user!.sub);
      send({ type: 'done', message: await messageToDTO(app, finalMessage), user_message: await messageToDTO(app, userMessage) });
      send({ type: 'quota', quota: quotaToDTO(updatedQuota) });
    } finally {
      reply.raw.end();
    }
  });

  app.post<{ Params: { id: string } }>('/chats/:id/attachments', { preHandler: app.authenticate }, async (req) => {
    const body = attachmentSchema.parse(req.body);
    const chat = await chats.getOwned(req.user!.sub, req.params.id);
    const placeholder = await chats.appendMessage(chat, {
      role: 'user',
      content: '',
      status: 'pending'
    });
    const created = await chats.addAttachment(placeholder.id, {
      name: body.name,
      mimeType: body.mime_type,
      url: body.url
    });
    return { id: created.id, name: created.name, mime_type: created.mime_type, url: created.url, message_id: placeholder.id };
  });
}
