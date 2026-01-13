/**
 * API type definitions for HTTP request/response handling
 */

import type { Request, Response, NextFunction } from 'express';

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T | undefined;
  readonly error?: ApiError | undefined;
  readonly meta?: ResponseMeta | undefined;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown> | undefined;
}

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
  readonly pagination?: PaginationMeta | undefined;
}

export interface PaginationMeta {
  readonly cursor?: string | undefined;
  readonly hasMore: boolean;
  readonly limit: number;
  readonly total?: number | undefined;
}

export interface AuthenticatedRequest extends Request {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly requestId: string;
  readonly scopes: readonly string[];
}

export type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

export interface HealthCheckResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly version: string;
  readonly uptime: number;
  readonly checks: Record<string, HealthCheck>;
}

export interface HealthCheck {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly latencyMs?: number | undefined;
  readonly message?: string | undefined;
}

export interface ListRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ListResponse<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor?: string | undefined;
  readonly hasMore: boolean;
}
