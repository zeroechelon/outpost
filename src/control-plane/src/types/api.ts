/**
 * API type definitions for HTTP request/response handling
 */

import type { Request, Response, NextFunction } from 'express';

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: ApiError;
  readonly meta?: ResponseMeta;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
  readonly pagination?: PaginationMeta;
}

export interface PaginationMeta {
  readonly cursor?: string;
  readonly hasMore: boolean;
  readonly limit: number;
  readonly total?: number;
}

export interface AuthenticatedRequest extends Request {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly requestId: string;
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
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface ListRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListResponse<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}
