/**
 * Logger setup using Pino for Outpost V2 Control Plane
 * Provides structured JSON logging with request context
 */

import pino from 'pino';
import { getConfig } from './config.js';

export interface LogContext {
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly jobId?: string;
  readonly workerId?: string;
  readonly [key: string]: unknown;
}

function createLogger(): pino.Logger {
  const config = getConfig();

  const options: pino.LoggerOptions = {
    level: config.log.level,
    base: {
      service: 'outpost-control-plane',
      version: process.env['npm_package_version'] ?? '2.0.0',
      env: config.nodeEnv,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'password',
        'apiKey',
        'secret',
        'token',
      ],
      remove: true,
    },
  };

  // Use pino-pretty for development
  if (config.log.pretty && config.nodeEnv !== 'production') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(options);
}

// Singleton logger instance
let loggerInstance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (loggerInstance === null) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: LogContext): pino.Logger {
  return getLogger().child(context);
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(requestId: string, tenantId?: string): pino.Logger {
  return createChildLogger({
    requestId,
    ...(tenantId !== undefined ? { tenantId } : {}),
  });
}

/**
 * Log levels for type safety
 */
export const LogLevel = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

// For testing - allows resetting logger
export function resetLogger(): void {
  loggerInstance = null;
}

export default getLogger;
