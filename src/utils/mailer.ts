import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  if (env.devEmailLog) {
    logger.info({ to: email.to, subject: email.subject, body: email.body }, '[mailer] dev email');
    return;
  }
  // В продакшне здесь подключается SMTP-провайдер.
  logger.warn({ to: email.to }, '[mailer] no provider configured');
}
