import type { FastifyInstance } from 'fastify';
import type pkg from 'pg';
import { Errors } from '../../plugins/errors.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { generateNumericCode, generateOpaqueToken, sha256 } from '../../utils/codes.js';
import { sendEmail } from '../../utils/mailer.js';
import { renderCodeEmail, renderLinkEmail } from '../../utils/emailTemplates.js';
import { env } from '../../config/env.js';

export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  password_hash: string;
  name: string | null;
  email_verified: boolean;
  subscription_status: string;
  role: 'user' | 'admin';
  created_at: Date;
  updated_at: Date;
}

interface SessionContext {
  deviceName: string;
  deviceType: string;
  ipAddress: string;
  userAgent: string | null;
}

const VERIFICATION_TTL_MS = 1000 * 60 * 30;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;

export class AuthService {
  constructor(private readonly app: FastifyInstance) {}

  private get pg(): pkg.Pool {
    return this.app.pg;
  }

  async register(input: {
    email: string;
    password: string;
    dateOfBirth: string;
    acceptedTerms: boolean;
  }): Promise<{ userId: string; email: string; devCode?: string }> {
    if (!input.acceptedTerms) {
      throw Errors.validation('Нужно принять условия и политики OKAK');
    }
    const email = input.email.trim().toLowerCase();
    const existing = await this.pg.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw Errors.conflict('Email уже зарегистрирован');
    }

    const passwordHash = await hashPassword(input.password);
    const { rows } = await this.pg.query<UserRow>(
      `INSERT INTO users (email, password_hash, date_of_birth)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email, passwordHash, input.dateOfBirth]
    );
    const user = rows[0]!;

    await this.pg.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );
    await this.pg.query(
      `INSERT INTO user_settings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );
    await this.pg.query(
      `INSERT INTO quotas (user_id, plan_name, "limit", used, reset_at)
       VALUES ($1, 'free', $2, 0, now() + interval '30 days')
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id, env.freeQuotaLimit]
    ).catch(() => {
      // quotas table may not exist yet during early bootstrap migrations
    });

    const code = generateNumericCode(6);
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await this.pg.query(
      `INSERT INTO email_verification_codes (user_id, code, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, code, expiresAt]
    );

    await sendEmail({
      to: email,
      subject: 'Подтверждение почты OKAK',
      body: `Ваш код подтверждения OKAK: ${code}\n\nКод действителен 30 минут. Введите его в приложении, чтобы завершить регистрацию.\n\nЕсли вы не запрашивали регистрацию, просто проигнорируйте письмо.`,
      html: renderCodeEmail({
        heading: 'Подтверждение почты',
        intro: 'Введите этот код в приложении OKAK:',
        code,
        outro: 'Код действителен 30 минут.'
      }),
      category: 'transactional',
      metadata: { kind: 'email_verification' }
    });

    return {
      userId: user.id,
      email: user.email,
      devCode: env.nodeEnv === 'production' ? undefined : code
    };
  }

  async verifyEmail(input: { email: string; code: string }, ctx: SessionContext) {
    const email = input.email.trim().toLowerCase();
    const userResult = await this.pg.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];
    if (!user) throw Errors.notFound('Пользователь не найден');

    const codeResult = await this.pg.query<{ id: string; expires_at: Date }>(
      `SELECT id, expires_at FROM email_verification_codes
       WHERE user_id = $1 AND code = $2 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, input.code]
    );
    const code = codeResult.rows[0];
    if (!code) throw Errors.validation('Неверный код подтверждения');
    if (code.expires_at.getTime() < Date.now()) {
      throw Errors.validation('Код истёк, запросите новый');
    }

    await this.pg.query(
      `UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1`,
      [code.id]
    );
    const updated = await this.pg.query<UserRow>(
      `UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1 RETURNING *`,
      [user.id]
    );
    return this.createTokensForUser(updated.rows[0]!, ctx);
  }

  async resendVerification(email: string) {
    const userResult = await this.pg.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = userResult.rows[0];
    if (!user) return;
    if (user.email_verified) return;
    const code = generateNumericCode(6);
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await this.pg.query(
      `INSERT INTO email_verification_codes (user_id, code, expires_at) VALUES ($1, $2, $3)`,
      [user.id, code, expiresAt]
    );
    await sendEmail({
      to: user.email,
      subject: 'Новый код подтверждения OKAK',
      body: `Ваш новый код подтверждения OKAK: ${code}\n\nКод действителен 30 минут.`,
      html: renderCodeEmail({
        heading: 'Новый код подтверждения',
        intro: 'Введите этот код в приложении OKAK:',
        code,
        outro: 'Код действителен 30 минут.'
      }),
      category: 'transactional',
      metadata: { kind: 'email_verification_resend' }
    });
  }

  async login(input: { identifier: string; password: string }, ctx: SessionContext) {
    const identifier = input.identifier.trim();
    const isEmail = identifier.includes('@');
    const userResult = await this.pg.query<UserRow>(
      isEmail
        ? 'SELECT * FROM users WHERE email = $1'
        : 'SELECT * FROM users WHERE username = $1',
      [isEmail ? identifier.toLowerCase() : identifier]
    );
    const user = userResult.rows[0];
    if (!user) throw Errors.unauthorized('Неверный логин или пароль');
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) throw Errors.unauthorized('Неверный логин или пароль');
    if (!user.email_verified) {
      throw Errors.forbidden('Email не подтверждён. Завершите верификацию.');
    }
    return this.createTokensForUser(user, ctx);
  }

  async logoutSession(sessionId: string): Promise<void> {
    await this.pg.query(
      `UPDATE sessions SET revoked_at = now() WHERE id = $1`,
      [sessionId]
    );
  }

  async refresh(refreshToken: string, ctx: SessionContext) {
    const payload = await this.app.verifyRefreshToken(refreshToken);
    const tokenHash = sha256(refreshToken);
    const sessionResult = await this.pg.query<{
      id: string;
      user_id: string;
      refresh_token_hash: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, refresh_token_hash, revoked_at, expires_at
       FROM sessions WHERE id = $1`,
      [payload.sid]
    );
    const session = sessionResult.rows[0];
    if (!session || session.revoked_at) {
      throw Errors.unauthorized('Сессия отозвана');
    }
    if (session.expires_at.getTime() < Date.now()) {
      throw Errors.unauthorized('Refresh-токен истёк');
    }
    if (session.refresh_token_hash !== tokenHash) {
      throw Errors.unauthorized('Refresh-токен не совпадает');
    }
    const userResult = await this.pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [session.user_id]);
    const user = userResult.rows[0];
    if (!user) throw Errors.unauthorized();

    const newRefresh = await this.app.signRefreshToken({ sub: user.id, sid: session.id });
    await this.pg.query(
      `UPDATE sessions
       SET refresh_token_hash = $1, last_active_at = now(),
           device_name = COALESCE($2, device_name),
           ip_address = COALESCE($3, ip_address),
           user_agent = COALESCE($4, user_agent)
       WHERE id = $5`,
      [sha256(newRefresh), ctx.deviceName, ctx.ipAddress, ctx.userAgent, session.id]
    );
    const accessToken = await this.app.signAccessToken({ sub: user.id, sid: session.id, role: user.role });
    return { accessToken, refreshToken: newRefresh, user };
  }

  async requestPasswordReset(email: string) {
    const userResult = await this.pg.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = userResult.rows[0];
    if (!user) return;
    const token = generateOpaqueToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await this.pg.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );
    await sendEmail({
      to: user.email,
      subject: 'Сброс пароля OKAK',
      body: `Перейдите по ссылке, чтобы сбросить пароль: ${env.passwordResetUrl}?token=${token}\n\nСсылка действительна 60 минут. Если вы не запрашивали сброс, проигнорируйте письмо.`,
      html: renderLinkEmail({
        heading: 'Сброс пароля',
        intro: 'Нажмите кнопку ниже, чтобы задать новый пароль для аккаунта OKAK.',
        buttonLabel: 'Сбросить пароль',
        url: `${env.passwordResetUrl}?token=${token}`,
        outro: 'Ссылка действительна 60 минут. Если вы не запрашивали сброс — просто проигнорируйте письмо.'
      }),
      category: 'transactional',
      metadata: { kind: 'password_reset' }
    });
  }

  async confirmPasswordReset(input: { token: string; password: string }) {
    const tokenHash = sha256(input.token);
    const tokenResult = await this.pg.query<{ id: string; user_id: string; expires_at: Date }>(
      `SELECT id, user_id, expires_at FROM password_reset_tokens
       WHERE token_hash = $1 AND consumed_at IS NULL`,
      [tokenHash]
    );
    const token = tokenResult.rows[0];
    if (!token) throw Errors.validation('Токен недействителен');
    if (token.expires_at.getTime() < Date.now()) throw Errors.validation('Токен истёк');

    const passwordHash = await hashPassword(input.password);
    await this.pg.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [passwordHash, token.user_id]
    );
    await this.pg.query(
      `UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1`,
      [token.id]
    );
    await this.pg.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [token.user_id]
    );
  }

  async me(userId: string) {
    const { rows } = await this.pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw Errors.unauthorized();
    return rows[0];
  }

  private async createTokensForUser(user: UserRow, ctx: SessionContext) {
    const expiresAt = new Date(Date.now() + env.jwtRefreshTtlSeconds * 1000);
    const session = await this.pg.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, device_name, device_type, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [user.id, 'tmp', ctx.deviceName, ctx.deviceType, ctx.ipAddress, ctx.userAgent, expiresAt]
    );
    const sessionId = session.rows[0]!.id;
    const refreshToken = await this.app.signRefreshToken({ sub: user.id, sid: sessionId });
    const accessToken = await this.app.signAccessToken({ sub: user.id, sid: sessionId, role: user.role });
    await this.pg.query(
      `UPDATE sessions SET refresh_token_hash = $1 WHERE id = $2`,
      [sha256(refreshToken), sessionId]
    );
    return { user, accessToken, refreshToken };
  }
}

export function mapUserToDTO(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    email_verified: user.email_verified,
    subscription_status: user.subscription_status,
    role: user.role
  };
}
