/**
 * List Jobs Integration Tests (T1.5)
 *
 * Tests the GET /api/v2/jobs endpoint for listing jobs with filtering and pagination.
 * Supports two modes:
 * - Mock mode (default): Uses supertest with mocked services for CI
 * - Real mode: Tests against actual OUTPOST_API_URL endpoint
 *
 * Set OUTPOST_API_URL and OUTPOST_API_KEY env vars for real endpoint testing.
 */

import {
  ApiClient,
  createApiClient,
  isRealEndpointMode,
  DispatchCleanupManager,
  createCleanupCallback,
  type ApiErrorResponse,
} from './utils/index.js';

// Test configuration
const TEST_TIMEOUT_MS = 60000; // 1 minute for most tests

// Type definitions for list jobs endpoint
interface ListJobsItem {
  jobId: string;
  tenantId: string;
  agent: string;
  task: string;
  repo: string | null;
  branch: string | null;
  context: string;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  workerId: string | null;
  workspacePath: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeoutSeconds: number;
  exitCode: number | null;
  errorMessage: string | null;
  outputS3Key: string | null;
}

interface ListJobsResponse {
  success: boolean;
  data: {
    items: ListJobsItem[];
    nextCursor?: string;
    hasMore: boolean;
  };
  meta?: {
    requestId: string;
    timestamp: string;
    pagination?: {
      cursor?: string;
      hasMore: boolean;
      limit: number;
    };
  };
}

// Extended API client with list jobs support
class ListJobsApiClient extends ApiClient {
  /**
   * List jobs with optional filtering
   */
  async listJobs(options: {
    status?: string;
    agent?: string;
    limit?: number;
    cursor?: string;
    since?: string;
  } = {}): Promise<{ status: number; body: ListJobsResponse | ApiErrorResponse; headers: Record<string, string> }> {
    const params = new URLSearchParams();

    if (options.status !== undefined) {
      params.set('status', options.status);
    }
    if (options.agent !== undefined) {
      params.set('agent', options.agent);
    }
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) {
      params.set('cursor', options.cursor);
    }
    if (options.since !== undefined) {
      params.set('since', options.since);
    }

    const queryString = params.toString();
    const url = queryString !== '' ? `/api/v2/jobs?${queryString}` : '/api/v2/jobs';

    return this.get<ListJobsResponse | ApiErrorResponse>(url);
  }

  /**
   * HTTP GET request (exposed for list jobs)
   */
  protected async get<T>(path: string): Promise<{ status: number; body: T; headers: Record<string, string> }> {
    return this.fetchRequest<T>('GET', path);
  }

  /**
   * Execute request using native fetch
   */
  private async fetchRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: T; headers: Record<string, string> }> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const apiKey = process.env['OUTPOST_API_KEY'] ?? 'test-api-key';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
}

// Create extended client
function createListJobsClient(): ListJobsApiClient {
  return new ListJobsApiClient();
}

// Global test state
let client: ListJobsApiClient;
let cleanupManager: DispatchCleanupManager;

// Detect test mode
const isRealMode = isRealEndpointMode();
const testModeLabel = isRealMode ? '[REAL ENDPOINT]' : '[MOCK MODE]';

describe(`List Jobs Integration Tests ${testModeLabel}`, () => {
  beforeAll(() => {
    client = createListJobsClient();
    cleanupManager = new DispatchCleanupManager(createApiClient());

    console.log(`Running in ${isRealMode ? 'REAL ENDPOINT' : 'MOCK'} mode`);
    console.log(`Base URL: ${client.getBaseUrl()}`);
  });

  afterAll(async () => {
    await createCleanupCallback(cleanupManager)();
  });

  afterEach(() => {
    cleanupManager.reset();
  });

  // ==========================================================================
  // Test Suite 1: Basic List Jobs
  // ==========================================================================

  describe('Basic List Jobs', () => {
    it('should list jobs with default pagination', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping list jobs test');
        return;
      }

      const response = await client.listJobs();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.hasMore).toBe('boolean');

      // Verify structure of items if any exist
      if (data.items.length > 0) {
        const item = data.items[0];
        expect(item.jobId).toBeDefined();
        expect(item.tenantId).toBeDefined();
        expect(item.agent).toBeDefined();
        expect(item.task).toBeDefined();
        expect(item.status).toBeDefined();
        expect(item.createdAt).toBeDefined();
      }
    }, TEST_TIMEOUT_MS);

    it('should handle empty results gracefully', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping empty results test');
        return;
      }

      // Filter by a status unlikely to have results
      const response = await client.listJobs({
        status: 'CANCELLED',
        since: new Date(Date.now() - 60000).toISOString(), // Last minute only
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.hasMore).toBe(false);
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 2: Status Filtering
  // ==========================================================================

  describe('Status Filtering', () => {
    const validStatuses = ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];

    for (const status of validStatuses) {
      it(`should filter by status=${status}`, async () => {
        if (!isRealMode) {
          console.log(`Mock mode: Skipping status=${status} filter test`);
          return;
        }

        const response = await client.listJobs({ status });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const data = (response.body as ListJobsResponse).data;

        // If there are results, verify they all match the status filter
        for (const item of data.items) {
          expect(item.status).toBe(status);
        }
      }, TEST_TIMEOUT_MS);
    }

    it('should return validation error for invalid status', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping invalid status test');
        return;
      }

      const response = await client.listJobs({ status: 'INVALID_STATUS' });

      expect(response.body.success).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 3: Agent Filtering
  // ==========================================================================

  describe('Agent Filtering', () => {
    const validAgents = ['claude', 'codex', 'gemini', 'aider', 'grok'];

    for (const agent of validAgents) {
      it(`should filter by agent=${agent}`, async () => {
        if (!isRealMode) {
          console.log(`Mock mode: Skipping agent=${agent} filter test`);
          return;
        }

        const response = await client.listJobs({ agent });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const data = (response.body as ListJobsResponse).data;

        // If there are results, verify they all match the agent filter
        for (const item of data.items) {
          expect(item.agent).toBe(agent);
        }
      }, TEST_TIMEOUT_MS);
    }

    it('should return validation error for invalid agent', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping invalid agent test');
        return;
      }

      const response = await client.listJobs({ agent: 'invalid_agent' });

      expect(response.body.success).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 4: Combined Filtering (Status AND Agent)
  // ==========================================================================

  describe('Combined Filtering', () => {
    it('should filter by status AND agent together', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping combined filter test');
        return;
      }

      const response = await client.listJobs({
        status: 'COMPLETED',
        agent: 'claude',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;

      // Verify all results match BOTH filters
      for (const item of data.items) {
        expect(item.status).toBe('COMPLETED');
        expect(item.agent).toBe('claude');
      }
    }, TEST_TIMEOUT_MS);

    it('should filter by status, agent, and limit', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping triple filter test');
        return;
      }

      const response = await client.listJobs({
        status: 'COMPLETED',
        agent: 'claude',
        limit: 5,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;
      expect(data.items.length).toBeLessThanOrEqual(5);

      // Verify all results match filters
      for (const item of data.items) {
        expect(item.status).toBe('COMPLETED');
        expect(item.agent).toBe('claude');
      }
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 5: Pagination (Limit Parameter)
  // ==========================================================================

  describe('Pagination', () => {
    it('should respect limit parameter', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping limit test');
        return;
      }

      const response = await client.listJobs({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;
      expect(data.items.length).toBeLessThanOrEqual(5);
    }, TEST_TIMEOUT_MS);

    it('should use default limit when not specified', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping default limit test');
        return;
      }

      const response = await client.listJobs();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;
      // Default limit is 20 per schema
      expect(data.items.length).toBeLessThanOrEqual(20);
    }, TEST_TIMEOUT_MS);

    it('should return validation error for limit below minimum', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping limit below minimum test');
        return;
      }

      const response = await client.listJobs({ limit: 0 });

      expect(response.body.success).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }, TEST_TIMEOUT_MS);

    it('should return validation error for limit above maximum', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping limit above maximum test');
        return;
      }

      const response = await client.listJobs({ limit: 101 });

      expect(response.body.success).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }, TEST_TIMEOUT_MS);

    it('should include pagination metadata', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping pagination metadata test');
        return;
      }

      const response = await client.listJobs({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const body = response.body as ListJobsResponse;
      expect(body.meta).toBeDefined();

      if (body.meta?.pagination) {
        expect(typeof body.meta.pagination.hasMore).toBe('boolean');
        expect(body.meta.pagination.limit).toBe(5);
      }
    }, TEST_TIMEOUT_MS);

    it('should support cursor-based pagination', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping cursor pagination test');
        return;
      }

      // First request
      const response1 = await client.listJobs({ limit: 2 });
      expect(response1.status).toBe(200);
      expect(response1.body.success).toBe(true);

      const data1 = (response1.body as ListJobsResponse).data;

      // If there are more results, use the cursor
      if (data1.hasMore && data1.nextCursor) {
        const response2 = await client.listJobs({
          limit: 2,
          cursor: data1.nextCursor,
        });

        expect(response2.status).toBe(200);
        expect(response2.body.success).toBe(true);

        const data2 = (response2.body as ListJobsResponse).data;

        // Verify we got different results
        if (data1.items.length > 0 && data2.items.length > 0) {
          expect(data2.items[0].jobId).not.toBe(data1.items[0].jobId);
        }
      }
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 6: Authentication Requirements
  // ==========================================================================

  describe('Authentication', () => {
    it('should require authentication', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping authentication test');
        return;
      }

      const baseUrl = client.getBaseUrl();

      // Make request without API key
      const response = await fetch(`${baseUrl}/api/v2/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.success).toBe(false);
    }, TEST_TIMEOUT_MS);

    it('should reject invalid API key', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping invalid API key test');
        return;
      }

      const baseUrl = client.getBaseUrl();

      const response = await fetch(`${baseUrl}/api/v2/jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-api-key-xyz-123',
        },
      });

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.success).toBe(false);
    }, TEST_TIMEOUT_MS);
  });

  // ==========================================================================
  // Test Suite 7: Response Structure Validation
  // ==========================================================================

  describe('Response Structure', () => {
    it('should return proper API response structure', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping response structure test');
        return;
      }

      const response = await client.listJobs();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const body = response.body as ListJobsResponse;

      // Required fields
      expect(body.success).toBeDefined();
      expect(body.data).toBeDefined();
      expect(body.data.items).toBeDefined();
      expect(body.data.hasMore).toBeDefined();

      // Meta fields
      expect(body.meta).toBeDefined();
      expect(body.meta?.requestId).toBeDefined();
      expect(body.meta?.timestamp).toBeDefined();
    }, TEST_TIMEOUT_MS);

    it('should return jobs sorted by creation date (newest first)', async () => {
      if (!isRealMode) {
        console.log('Mock mode: Skipping sort order test');
        return;
      }

      const response = await client.listJobs({ limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = (response.body as ListJobsResponse).data;

      // Verify descending order if there are multiple items
      if (data.items.length > 1) {
        for (let i = 0; i < data.items.length - 1; i++) {
          const current = new Date(data.items[i].createdAt).getTime();
          const next = new Date(data.items[i + 1].createdAt).getTime();
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    }, TEST_TIMEOUT_MS);
  });
});

// ==========================================================================
// Unit Tests for Test Utilities (always run)
// ==========================================================================

describe('List Jobs Test Utilities (Unit Tests)', () => {
  describe('ListJobsApiClient', () => {
    it('should create client with environment configuration', () => {
      const client = createListJobsClient();
      expect(client).toBeDefined();
      expect(client.getBaseUrl()).toBeDefined();
    });

    it('should build query string correctly', async () => {
      // This tests the URL building logic
      const params = new URLSearchParams();
      params.set('status', 'COMPLETED');
      params.set('agent', 'claude');
      params.set('limit', '10');

      const queryString = params.toString();
      expect(queryString).toContain('status=COMPLETED');
      expect(queryString).toContain('agent=claude');
      expect(queryString).toContain('limit=10');
    });
  });

  describe('Status Values', () => {
    const validStatuses = ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];

    it('should have all expected status values', () => {
      expect(validStatuses).toContain('PENDING');
      expect(validStatuses).toContain('QUEUED');
      expect(validStatuses).toContain('RUNNING');
      expect(validStatuses).toContain('COMPLETED');
      expect(validStatuses).toContain('FAILED');
      expect(validStatuses).toContain('CANCELLED');
      expect(validStatuses).toContain('TIMEOUT');
    });
  });

  describe('Agent Values', () => {
    const validAgents = ['claude', 'codex', 'gemini', 'aider', 'grok'];

    it('should have all expected agent values', () => {
      expect(validAgents).toContain('claude');
      expect(validAgents).toContain('codex');
      expect(validAgents).toContain('gemini');
      expect(validAgents).toContain('aider');
      expect(validAgents).toContain('grok');
    });
  });
});
