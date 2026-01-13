/**
 * API Client wrapper for integration testing
 *
 * Provides a typed HTTP client for testing Outpost API endpoints.
 * Supports both mock testing (using supertest) and real endpoint testing
 * (when OUTPOST_API_URL environment variable is set).
 */

import type { Application } from 'express';

/**
 * Dispatch request payload
 */
export interface DispatchPayload {
  agent: 'claude' | 'codex' | 'gemini' | 'aider' | 'grok';
  task: string;
  repo?: string;
  branch?: string;
  context?: 'minimal' | 'standard' | 'full';
  workspaceMode?: 'ephemeral' | 'persistent';
  timeoutSeconds?: number;
  additionalSecrets?: string[];
}

/**
 * Dispatch creation response
 */
export interface DispatchCreatedResponse {
  success: boolean;
  data: {
    dispatchId: string;
    status: string;
    agent: string;
    modelId: string;
    estimatedStartTime: string;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * Log entry from dispatch status
 */
export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

/**
 * Dispatch status response
 */
export interface DispatchStatusResponse {
  success: boolean;
  data: {
    dispatchId: string;
    status: 'pending' | 'provisioning' | 'running' | 'completing' | 'success' | 'failed' | 'timeout' | 'cancelled';
    agent: string;
    modelId: string;
    task: string;
    progress: number;
    logs?: LogEntry[];
    logOffset?: string;
    startedAt?: string;
    endedAt?: string;
    taskArn?: string;
    exitCode?: number;
    errorMessage?: string;
    estimatedStartTime?: string;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * Cancel dispatch response
 */
export interface CancelDispatchResponse {
  success: boolean;
  data: {
    dispatchId: string;
    status: string;
    message: string;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * API error response
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * HTTP response wrapper
 */
export interface HttpResponse<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

/**
 * API Client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  app?: Application;
}

/**
 * Integration test API client
 *
 * Automatically detects whether to use supertest (mock mode)
 * or native fetch (real endpoint mode) based on configuration.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly app?: Application;
  private readonly useMock: boolean;

  constructor(config: ApiClientConfig = {}) {
    const envUrl = process.env['OUTPOST_API_URL'];
    const envKey = process.env['OUTPOST_API_KEY'];

    this.baseUrl = config.baseUrl ?? envUrl ?? 'http://localhost:3000';
    this.apiKey = config.apiKey ?? envKey ?? 'test-api-key';
    this.timeout = config.timeout ?? 30000;
    this.app = config.app;

    // Use mock mode if app is provided and no external URL is set
    this.useMock = this.app !== undefined && envUrl === undefined;
  }

  /**
   * Check if running in mock mode (supertest) vs real endpoint mode
   */
  isMockMode(): boolean {
    return this.useMock;
  }

  /**
   * Get configured base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Create a new dispatch
   */
  async createDispatch(
    payload: DispatchPayload
  ): Promise<HttpResponse<DispatchCreatedResponse | ApiErrorResponse>> {
    return this.post<DispatchCreatedResponse | ApiErrorResponse>('/api/v1/dispatch', payload);
  }

  /**
   * Get dispatch status
   */
  async getDispatchStatus(
    dispatchId: string,
    options: { logOffset?: string; logLimit?: number; skipLogs?: boolean } = {}
  ): Promise<HttpResponse<DispatchStatusResponse | ApiErrorResponse>> {
    const params = new URLSearchParams();
    if (options.logOffset !== undefined) {
      params.set('logOffset', options.logOffset);
    }
    if (options.logLimit !== undefined) {
      params.set('logLimit', String(options.logLimit));
    }
    if (options.skipLogs !== undefined) {
      params.set('skipLogs', String(options.skipLogs));
    }

    const queryString = params.toString();
    const url = queryString !== '' ? `/api/v1/dispatch/${dispatchId}?${queryString}` : `/api/v1/dispatch/${dispatchId}`;

    return this.get<DispatchStatusResponse | ApiErrorResponse>(url);
  }

  /**
   * Cancel a dispatch
   */
  async cancelDispatch(
    dispatchId: string,
    reason?: string
  ): Promise<HttpResponse<CancelDispatchResponse | ApiErrorResponse>> {
    const body = reason !== undefined ? { reason } : {};
    return this.delete<CancelDispatchResponse | ApiErrorResponse>(`/api/v1/dispatch/${dispatchId}`, body);
  }

  /**
   * Poll dispatch until terminal state or timeout
   */
  async pollDispatchUntilComplete(
    dispatchId: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onStatus?: (status: DispatchStatusResponse['data']) => void;
    } = {}
  ): Promise<DispatchStatusResponse['data']> {
    const pollInterval = options.pollIntervalMs ?? 2000;
    const timeout = options.timeoutMs ?? 600000; // 10 minutes default
    const terminalStatuses = new Set(['success', 'failed', 'timeout', 'cancelled']);

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const response = await this.getDispatchStatus(dispatchId, { skipLogs: true });

      if (!response.body.success) {
        throw new Error(`Failed to get dispatch status: ${JSON.stringify(response.body)}`);
      }

      const statusData = (response.body as DispatchStatusResponse).data;

      if (options.onStatus !== undefined) {
        options.onStatus(statusData);
      }

      if (terminalStatuses.has(statusData.status)) {
        return statusData;
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`Dispatch ${dispatchId} did not complete within ${timeout}ms`);
  }

  /**
   * HTTP GET request
   */
  private async get<T>(path: string): Promise<HttpResponse<T>> {
    if (this.useMock && this.app !== undefined) {
      return this.mockRequest<T>('GET', path);
    }
    return this.fetchRequest<T>('GET', path);
  }

  /**
   * HTTP POST request
   */
  private async post<T>(path: string, body: unknown): Promise<HttpResponse<T>> {
    if (this.useMock && this.app !== undefined) {
      return this.mockRequest<T>('POST', path, body);
    }
    return this.fetchRequest<T>('POST', path, body);
  }

  /**
   * HTTP DELETE request
   */
  private async delete<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
    if (this.useMock && this.app !== undefined) {
      return this.mockRequest<T>('DELETE', path, body);
    }
    return this.fetchRequest<T>('DELETE', path, body);
  }

  /**
   * Execute request using supertest (mock mode)
   */
  private async mockRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<HttpResponse<T>> {
    // Dynamic import of supertest to avoid bundling issues
    const { default: request } = await import('supertest');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req = (request(this.app) as any)[method.toLowerCase()](path);
    req = req.set('Authorization', `Bearer ${this.apiKey}`);
    req = req.set('Content-Type', 'application/json');

    if (body !== undefined) {
      req = req.send(body);
    }

    const response = await req;

    return {
      status: response.status,
      body: response.body as T,
      headers: response.headers as Record<string, string>,
    };
  }

  /**
   * Execute request using native fetch (real endpoint mode)
   */
  private async fetchRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      const responseBody = await response.json() as T;

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body: responseBody,
        headers,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create API client with default configuration
 */
export function createApiClient(config?: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

/**
 * Check if integration tests should run against real endpoint
 */
export function isRealEndpointMode(): boolean {
  return process.env['OUTPOST_API_URL'] !== undefined;
}

/**
 * Skip test if not in real endpoint mode
 */
export function skipIfMockMode(testFn: () => void | Promise<void>): () => void | Promise<void> {
  return () => {
    if (!isRealEndpointMode()) {
      console.log('Skipping test: OUTPOST_API_URL not set (mock mode)');
      return;
    }
    return testFn();
  };
}

/**
 * Skip test if in real endpoint mode
 */
export function skipIfRealMode(testFn: () => void | Promise<void>): () => void | Promise<void> {
  return () => {
    if (isRealEndpointMode()) {
      console.log('Skipping test: Running against real endpoint');
      return;
    }
    return testFn();
  };
}
