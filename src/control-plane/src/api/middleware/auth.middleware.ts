/**
 * Authentication middleware for API key validation
 */

import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../../utils/logger.js';
import { AuthenticationError, AuthorizationError } from '../../utils/errors.js';
import { ApiKeyRepository } from '../../repositories/api-key.repository.js';
import type { AuthenticatedRequest } from '../../types/api.js';

const logger = getLogger().child({ middleware: 'auth' });
const apiKeyRepository = new ApiKeyRepository();

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = extractApiKey(req);

    if (apiKey === null) {
      throw new AuthenticationError('API key required');
    }

    const keyRecord = await apiKeyRepository.getByRawKey(apiKey);

    if (keyRecord === null) {
      throw new AuthenticationError('Invalid API key');
    }

    if (keyRecord.status !== 'active') {
      throw new AuthenticationError(`API key is ${keyRecord.status}`);
    }

    if (keyRecord.expiresAt !== null && keyRecord.expiresAt < new Date()) {
      throw new AuthenticationError('API key has expired');
    }

    // Record usage asynchronously
    void apiKeyRepository.recordUsage(keyRecord.apiKeyId);

    // Attach auth info to request
    const authenticatedReq = req as unknown as AuthenticatedRequest;
    (authenticatedReq as unknown as { tenantId: string }).tenantId = keyRecord.tenantId;
    (authenticatedReq as unknown as { apiKeyId: string }).apiKeyId = keyRecord.apiKeyId;
    (authenticatedReq as unknown as { scopes: readonly string[] }).scopes = keyRecord.scopes;

    logger.debug(
      { tenantId: keyRecord.tenantId, apiKeyId: keyRecord.apiKeyId },
      'Request authenticated'
    );

    next();
  } catch (error) {
    next(error);
  }
}

export function requireScope(scope: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authenticatedReq = req as AuthenticatedRequest & { scopes?: readonly string[] };
    const scopes = authenticatedReq.scopes ?? [];

    if (!scopes.includes(scope) && !scopes.includes('admin')) {
      next(new AuthorizationError(`Missing required scope: ${scope}`));
      return;
    }

    next();
  };
}

function extractApiKey(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  return null;
}
