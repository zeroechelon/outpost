/**
 * Request logging middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLogger, createRequestLogger } from '../../utils/logger.js';

const logger = getLogger().child({ middleware: 'request-logger' });

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  const startTime = Date.now();

  // Attach request ID to request object
  (req as { requestId: string }).requestId = requestId;

  // Set request ID header on response
  res.setHeader('X-Request-ID', requestId);

  // Create request-scoped logger
  const reqLogger = createRequestLogger(requestId);

  // Log incoming request
  reqLogger.info(
    {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      contentLength: req.headers['content-length'],
    },
    'Incoming request'
  );

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
    };

    if (res.statusCode >= 500) {
      reqLogger.error(logData, 'Request completed with server error');
    } else if (res.statusCode >= 400) {
      reqLogger.warn(logData, 'Request completed with client error');
    } else {
      reqLogger.info(logData, 'Request completed');
    }
  });

  next();
}
