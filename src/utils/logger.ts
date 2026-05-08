import { pino } from 'pino';
import { env } from '../config/env.js';

export const loggerConfig = {
  level: env.logLevel,
  transport:
    env.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', singleLine: true }
        }
      : undefined
};

export const logger = pino(loggerConfig);
