import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  html?: string;
  category?: 'transactional' | 'notification' | 'marketing';
  metadata?: Record<string, unknown>;
}

interface MailServiceResponse {
  ok: boolean;
  accepted: number;
  rejected: number;
  sent?: Array<{ to: string; messageId?: string }>;
  failed?: Array<{ to: string; error?: string }>;
}

function isMailServiceConfigured(): boolean {
  return Boolean(env.mailServiceBaseUrl && env.mailServiceToken);
}

async function postToMailService(email: OutboundEmail): Promise<void> {
  const url = `${env.mailServiceBaseUrl.replace(/\/$/, '')}/internal/send`;
  const payload = {
    to: [email.to],
    subject: email.subject,
    text: email.body,
    html: email.html,
    category: email.category ?? 'transactional',
    metadata: email.metadata ?? {}
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const secret = env.mailRequestHmacSecret || env.mailServiceToken;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.mailServiceToken}`,
      'X-OKAK-Token': env.mailServiceToken,
      'X-OKAK-Timestamp': timestamp,
      'X-OKAK-Signature': signature
    },
    body,
    signal: AbortSignal.timeout(env.mailRequestTimeoutMs)
  });

  const raw = await response.text();
  let parsed: MailServiceResponse | null = null;
  try {
    parsed = raw ? (JSON.parse(raw) as MailServiceResponse) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok || (parsed && parsed.accepted === 0)) {
    logger.error(
      { status: response.status, body: raw.slice(0, 500), to: email.to },
      '[mailer] send failed'
    );
    throw new Error(`mail service rejected: ${response.status}`);
  }

  logger.info(
    { to: email.to, subject: email.subject, messageId: parsed?.sent?.[0]?.messageId },
    '[mailer] sent'
  );
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  if (isMailServiceConfigured()) {
    try {
      await postToMailService(email);
      return;
    } catch (err) {
      if (env.nodeEnv === 'production') {
        throw err;
      }
      logger.warn({ err: (err as Error).message }, '[mailer] falling back to dev log');
    }
  }
  if (env.devEmailLog || env.nodeEnv !== 'production') {
    logger.info(
      { to: email.to, subject: email.subject, body: email.body },
      '[mailer] dev email (no provider configured)'
    );
    return;
  }
  logger.warn({ to: email.to }, '[mailer] no provider configured');
  throw new Error('mail service not configured');
}
