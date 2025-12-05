import pino from 'pino';

const redactPaths = [
  'apiKey',
  'password',
  'token',
  'authorization',
  'secret',
  'creditCard',
  '*.apiKey',
  '*.password',
  '*.token',
  'headers.authorization',
  'newRelicApiKey',
  'stripeSecretKey',
];

export const logger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  base: {
    service: process.env['SERVICE_NAME'] || 'groundhog',
    environment: process.env['NODE_ENV'] || 'development',
    version: process.env['APP_VERSION'] || '1.0.0',
  },
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
});

export interface RequestLoggerContext {
  requestId: string;
  userId?: string;
  orgId?: string;
}

export function createRequestLogger(
  context: RequestLoggerContext
): pino.Logger {
  return logger.child({
    requestId: context.requestId,
    userId: context.userId,
    orgId: context.orgId,
  });
}

export type Logger = pino.Logger;
