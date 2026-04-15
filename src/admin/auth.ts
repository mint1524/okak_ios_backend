import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function basicAuthGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    reply.header('WWW-Authenticate', 'Basic realm="OKAK Admin"');
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Basic auth required' });
    return;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
  const sepIdx = decoded.indexOf(':');
  if (sepIdx < 0) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Malformed credentials' });
    return;
  }
  const user = decoded.slice(0, sepIdx);
  const pass = decoded.slice(sepIdx + 1);
  if (!timingSafeEqual(user, env.adminUsername) || !timingSafeEqual(pass, env.adminPassword)) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid admin credentials' });
    return;
  }
}

export function bindLoopbackOnly(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const remote = req.ip;
    const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowed.includes(remote)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin available on loopback only' });
    }
  });
}
