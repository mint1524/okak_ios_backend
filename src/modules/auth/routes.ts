import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthService, mapUserToDTO } from './service.js';
import {
  registerSchema,
  verifyEmailSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  refreshSchema
} from './schemas.js';

interface SessionCtxRequestBody {
  device_name?: string;
  device_type?: string;
}

function sessionContext(req: FastifyRequest, body?: SessionCtxRequestBody) {
  return {
    deviceName: body?.device_name ?? (req.headers['x-device-name'] as string | undefined) ?? 'iPhone',
    deviceType: body?.device_type ?? (req.headers['x-device-type'] as string | undefined) ?? 'ios',
    ipAddress: (req.ip ?? '0.0.0.0').toString(),
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const auth = new AuthService(app);

  app.post('/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const result = await auth.register({
      email: body.email,
      password: body.password,
      dateOfBirth: body.date_of_birth,
      acceptedTerms: body.accepted_terms
    });
    return reply.code(201).send({
      user_id: result.userId,
      email: result.email,
      verification_code_dev: result.devCode
    });
  });

  app.post('/auth/verify-email', async (req) => {
    const body = verifyEmailSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await auth.verifyEmail(
      { email: body.email, code: body.code },
      sessionContext(req)
    );
    return {
      user: mapUserToDTO(user),
      tokens: { access_token: accessToken, refresh_token: refreshToken }
    };
  });

  app.post('/auth/verify-email/resend', async (req, reply) => {
    const body = passwordResetRequestSchema.parse(req.body);
    await auth.resendVerification(body.email);
    return reply.code(202).send({ message: 'Если адрес зарегистрирован, код выслан повторно' });
  });

  app.post('/auth/login', async (req) => {
    const body = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await auth.login(body, sessionContext(req));
    return {
      user: mapUserToDTO(user),
      tokens: { access_token: accessToken, refresh_token: refreshToken }
    };
  });

  app.post('/auth/refresh', async (req) => {
    const body = refreshSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await auth.refresh(body.refresh_token, sessionContext(req));
    return {
      user: mapUserToDTO(user),
      tokens: { access_token: accessToken, refresh_token: refreshToken }
    };
  });

  app.post('/auth/password-reset/request', async (req, reply) => {
    const body = passwordResetRequestSchema.parse(req.body);
    await auth.requestPasswordReset(body.email);
    return reply.code(202).send({ message: 'Если адрес зарегистрирован, ссылка выслана' });
  });

  app.post('/auth/password-reset/confirm', async (req, reply) => {
    const body = passwordResetConfirmSchema.parse(req.body);
    await auth.confirmPasswordReset(body);
    return reply.send({ message: 'Пароль обновлён' });
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const user = await auth.me(req.user!.sub);
    return mapUserToDTO(user);
  });

  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    await auth.logoutSession(req.user!.sid);
    return reply.send({ message: 'Сессия завершена' });
  });
}
