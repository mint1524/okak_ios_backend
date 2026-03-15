import fp from 'fastify-plugin';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { Errors } from './errors.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAccessToken: (claims: AccessTokenClaims) => Promise<string>;
    signRefreshToken: (payload: { sub: string; sid: string }) => Promise<string>;
    verifyRefreshToken: (token: string) => Promise<{ sub: string; sid: string }>;
  }
  interface FastifyRequest {
    user?: AccessTokenClaims;
  }
}

const accessKey = new TextEncoder().encode(env.jwtAccessSecret);
const refreshKey = new TextEncoder().encode(env.jwtRefreshSecret);

export const authPlugin = fp(async (app) => {
  app.decorate('signAccessToken', async (claims: AccessTokenClaims) => {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setSubject(claims.sub)
      .setExpirationTime(`${env.jwtAccessTtlSeconds}s`)
      .sign(accessKey);
  });

  app.decorate('signRefreshToken', async (payload: { sub: string; sid: string }) => {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setSubject(payload.sub)
      .setExpirationTime(`${env.jwtRefreshTtlSeconds}s`)
      .sign(refreshKey);
  });

  app.decorate('verifyRefreshToken', async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, refreshKey);
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw Errors.unauthorized('Invalid refresh token');
      }
      return { sub: payload.sub, sid: payload.sid };
    } catch {
      throw Errors.unauthorized('Invalid or expired refresh token');
    }
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw Errors.unauthorized();
    }
    const token = header.slice('Bearer '.length);
    try {
      const { payload } = await jwtVerify(token, accessKey);
      if (
        typeof payload.sub !== 'string' ||
        typeof (payload as Record<string, unknown>).sid !== 'string' ||
        typeof (payload as Record<string, unknown>).role !== 'string'
      ) {
        throw Errors.unauthorized();
      }
      req.user = {
        sub: payload.sub,
        sid: (payload as { sid: string }).sid,
        role: (payload as { role: AccessTokenClaims['role'] }).role
      };
    } catch {
      throw Errors.unauthorized('Token invalid or expired');
    }
  });

  app.decorate('requireAdmin', async (req: FastifyRequest) => {
    if (!req.user) throw Errors.unauthorized();
    if (req.user.role !== 'admin') throw Errors.forbidden('Admin role required');
  });
});
