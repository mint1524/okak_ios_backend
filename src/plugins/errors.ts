import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: (msg = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'Forbidden') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg),
  conflict: (msg: string) => new AppError(409, 'CONFLICT', msg),
  validation: (msg: string, details?: unknown) => new AppError(422, 'VALIDATION', msg, details),
  quotaExceeded: (msg = 'Quota exceeded') => new AppError(429, 'QUOTA_EXCEEDED', msg),
  llmUnavailable: (msg = 'LLM unavailable') => new AppError(503, 'LLM_UNAVAILABLE', msg)
};

export const errorsPlugin = fp(async (app) => {
  app.setErrorHandler((err, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: err.code,
        code: err.code,
        message: err.message,
        details: err.details
      });
    }
    if (err instanceof ZodError) {
      return reply.status(422).send({
        error: 'VALIDATION',
        code: 'VALIDATION',
        message: 'Validation failed',
        details: err.flatten()
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: 'RATE_LIMIT',
        code: 'RATE_LIMIT',
        message: 'Слишком много запросов, попробуйте позже'
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL',
      code: 'INTERNAL',
      message: 'Внутренняя ошибка сервера'
    });
  });
});
