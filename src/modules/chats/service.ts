import type { FastifyInstance } from 'fastify';
import { Errors } from '../../plugins/errors.js';
import { env } from '../../config/env.js';

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  model: string;
  reasoning_level: string;
  search_enabled: boolean;
  streaming_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
  token_count: number | null;
  created_at: Date;
}

export function chatToDTO(chat: ChatRow) {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    reasoning_level: chat.reasoning_level,
    search_enabled: chat.search_enabled,
    streaming_enabled: chat.streaming_enabled,
    created_at: chat.created_at,
    updated_at: chat.updated_at
  };
}

export async function messageToDTO(app: FastifyInstance, message: MessageRow) {
  const { rows } = await app.pg.query<{
    id: string;
    name: string;
    mime_type: string;
    url: string | null;
  }>(
    `SELECT id, name, mime_type, url FROM message_attachments WHERE message_id = $1 ORDER BY created_at`,
    [message.id]
  );
  return {
    id: message.id,
    chat_id: message.chat_id,
    role: message.role,
    content: message.content,
    status: message.status,
    token_count: message.token_count,
    attachments: rows,
    created_at: message.created_at
  };
}

export class ChatService {
  constructor(private readonly app: FastifyInstance) {}

  async list(userId: string): Promise<ChatRow[]> {
    const { rows } = await this.app.pg.query<ChatRow>(
      `SELECT * FROM chats WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return rows;
  }

  async create(userId: string, input: Partial<Pick<ChatRow, 'title' | 'model' | 'reasoning_level' | 'search_enabled' | 'streaming_enabled'>>): Promise<ChatRow> {
    const { rows } = await this.app.pg.query<ChatRow>(
      `INSERT INTO chats (user_id, title, model, reasoning_level, search_enabled, streaming_enabled)
       VALUES ($1, COALESCE($2, 'Новый чат'), COALESCE($3, $7), COALESCE($4, 'medium'), COALESCE($5, FALSE), COALESCE($6, TRUE))
       RETURNING *`,
      [
        userId,
        input.title,
        input.model,
        input.reasoning_level,
        input.search_enabled,
        input.streaming_enabled,
        env.llmDefaultModel
      ]
    );
    return rows[0]!;
  }

  async getOwned(userId: string, chatId: string): Promise<ChatRow> {
    const { rows } = await this.app.pg.query<ChatRow>(
      `SELECT * FROM chats WHERE id = $1 AND user_id = $2`,
      [chatId, userId]
    );
    if (!rows[0]) throw Errors.notFound('Чат не найден');
    return rows[0];
  }

  async rename(userId: string, chatId: string, title: string): Promise<ChatRow> {
    const chat = await this.getOwned(userId, chatId);
    const { rows } = await this.app.pg.query<ChatRow>(
      `UPDATE chats SET title = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [title, chat.id]
    );
    return rows[0]!;
  }

  async updateParameters(userId: string, chatId: string, params: Partial<Pick<ChatRow, 'model' | 'reasoning_level' | 'search_enabled' | 'streaming_enabled'>>): Promise<ChatRow> {
    const chat = await this.getOwned(userId, chatId);
    const updates: string[] = [];
    const values: unknown[] = [chat.id];
    let idx = 2;
    for (const key of ['model', 'reasoning_level', 'search_enabled', 'streaming_enabled'] as const) {
      const value = params[key];
      if (value === undefined) continue;
      updates.push(`${key} = $${idx}`);
      values.push(value);
      idx += 1;
    }
    if (!updates.length) return chat;
    updates.push('updated_at = now()');
    const { rows } = await this.app.pg.query<ChatRow>(
      `UPDATE chats SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return rows[0]!;
  }

  async remove(userId: string, chatId: string): Promise<void> {
    const result = await this.app.pg.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId]);
    if (!result.rowCount) throw Errors.notFound('Чат не найден');
  }

  async messages(chat: ChatRow): Promise<MessageRow[]> {
    const { rows } = await this.app.pg.query<MessageRow>(
      `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at`,
      [chat.id]
    );
    return rows;
  }

  async appendMessage(
    chat: ChatRow,
    input: {
      role: MessageRow['role'];
      content: string;
      status?: MessageRow['status'];
      tokenCount?: number;
    }
  ): Promise<MessageRow> {
    const { rows } = await this.app.pg.query<MessageRow>(
      `INSERT INTO messages (chat_id, role, content, status, token_count)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [chat.id, input.role, input.content, input.status ?? 'completed', input.tokenCount ?? null]
    );
    await this.app.pg.query(`UPDATE chats SET updated_at = now() WHERE id = $1`, [chat.id]);
    return rows[0]!;
  }

  async updateMessage(
    messageId: string,
    patch: { content?: string; status?: MessageRow['status']; tokenCount?: number | null }
  ): Promise<MessageRow> {
    const updates: string[] = [];
    const values: unknown[] = [messageId];
    let idx = 2;
    if (patch.content !== undefined) {
      updates.push(`content = $${idx}`); values.push(patch.content); idx += 1;
    }
    if (patch.status !== undefined) {
      updates.push(`status = $${idx}`); values.push(patch.status); idx += 1;
    }
    if (patch.tokenCount !== undefined) {
      updates.push(`token_count = $${idx}`); values.push(patch.tokenCount); idx += 1;
    }
    if (!updates.length) {
      const { rows } = await this.app.pg.query<MessageRow>('SELECT * FROM messages WHERE id = $1', [messageId]);
      return rows[0]!;
    }
    const { rows } = await this.app.pg.query<MessageRow>(
      `UPDATE messages SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return rows[0]!;
  }

  async maybeAutoTitle(chat: ChatRow, lastUserContent: string): Promise<ChatRow> {
    if (chat.title && chat.title !== 'Новый чат') return chat;
    const title = lastUserContent.trim().split(/\s+/).slice(0, 6).join(' ');
    if (!title) return chat;
    const truncated = title.length > 50 ? title.slice(0, 50) + '…' : title;
    const { rows } = await this.app.pg.query<ChatRow>(
      `UPDATE chats SET title = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [truncated, chat.id]
    );
    return rows[0]!;
  }

  async addAttachment(messageId: string, input: { name: string; mimeType: string; url?: string | null }) {
    const { rows } = await this.app.pg.query<{ id: string; name: string; mime_type: string; url: string | null }>(
      `INSERT INTO message_attachments (message_id, name, mime_type, url)
       VALUES ($1, $2, $3, $4) RETURNING id, name, mime_type, url`,
      [messageId, input.name, input.mimeType, input.url ?? null]
    );
    return rows[0]!;
  }
}
