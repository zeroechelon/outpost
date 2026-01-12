/**
 * Error handling middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { getLogger } from '../../utils/logger.js';
import { OutpostError, isOutpostError, ValidationError } from '../../utils/errors.js';
import type { ApiResponse, ApiError } from '../../types/api.js';

const logger = getLogger().child({ middleware: 'error' });

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as { requestId?: string }).requestId ?? 'unknown';

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const details = error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    logger.warn({ requestId, errors: details }, 'Validation error');

    const response: ApiResponse<never> = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: { errors: details },
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(400).json(response);
    return;
  }

  // Handle custom Outpost errors
  if (isOutpostError(error)) {
    logger.warn(
      { requestId, code: error.code, message: error.message },
      'Outpost error'
    );

    const response: ApiResponse<never> = {
      success: false,
      error: error.toJSON() as ApiError,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(error.statusCode).json(response);
    return;
  }

  // Handle unknown errors
  logger.error({ requestId, error }, 'Unhandled error');

  const response: ApiResponse<never> = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(500).json(response);
}
