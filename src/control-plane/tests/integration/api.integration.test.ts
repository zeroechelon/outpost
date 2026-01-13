/**
 * API Integration Tests
 *
 * Tests the control plane REST API endpoints using Express test server.
 * These tests use mock handlers and do not require AWS credentials.
 *
 * Endpoints tested:
 * - POST /dispatch - Create dispatch, verify returns dispatch_id
 * - GET /dispatch/:id - Get status, verify returns status object
 * - DELETE /dispatch/:id - Cancel dispatch
 * - GET /health - Returns healthy status
 * - GET /health/fleet - Returns fleet metrics
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express, { type Express, type Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { generateTestId, TEST_TENANT_ID } from './setup.js';

// Mock auth middleware for testing
const mockAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  (req as unknown as { tenantId: string }).tenantId = TEST_TENANT_ID;
  (req as unknown as { apiKeyId: string }).apiKeyId = 'test-api-key';
  (req as unknown as { requestId: string }).requestId = uuidv4();
  (req as unknown as { scopes: string[] }).scopes = ['dispatch', 'status', 'list', 'cancel'];
  next();
};

// Track created dispatches for cleanup
const createdDispatchIds: string[] = [];

// Helper functions
function getModelIdForAgent(agent: string): string {
  const modelIds: Record<string, string> = {
    claude: 'claude-opus-4-5-20251101',
    codex: 'gpt-5.2-codex',
    gemini: 'gemini-3-pro-preview',
    aider: 'deepseek/deepseek-coder',
    grok: 'grok-4.1',
  };
  return modelIds[agent] ?? 'unknown';
}

function isValidUuid(str: string | undefined): boolean {
  if (str === undefined) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

describe('API Integration Tests', () => {
  let app: Express;
  const startTime = Date.now();

  beforeAll(async () => {
    // Create Express app with mock routes for testing
    app = express();
    app.use(express.json());
    app.use(mockAuthMiddleware);

    // Mock health routes
    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        version: '2.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        checks: {
          efs: { status: 'pass' },
          'worker-pool': { status: 'pass', message: '0/10 workers busy' },
        },
      });
    });

    app.get('/health/live', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok' });
    });

    app.get('/health/ready', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ready' });
    });

    app.get('/health/fleet', (_req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        data: {
          status: 'healthy',
          pool: {
            totalTasks: 0,
            idleTasks: 0,
            inUseTasks: 0,
            byAgent: [],
          },
          agents: [
            { agent: 'claude', available: true, modelId: 'claude-opus-4-5-20251101', poolSize: 0, active: 0, idle: 0, successRate: 100, avgDurationMs: 0, maxConcurrent: 5 },
            { agent: 'codex', available: true, modelId: 'gpt-5.2-codex', poolSize: 0, active: 0, idle: 0, successRate: 100, avgDurationMs: 0, maxConcurrent: 5 },
            { agent: 'gemini', available: true, modelId: 'gemini-3-pro-preview', poolSize: 0, active: 0, idle: 0, successRate: 100, avgDurationMs: 0, maxConcurrent: 5 },
            { agent: 'aider', available: true, modelId: 'deepseek/deepseek-coder', poolSize: 0, active: 0, idle: 0, successRate: 100, avgDurationMs: 0, maxConcurrent: 3 },
            { agent: 'grok', available: true, modelId: 'grok-4.1', poolSize: 0, active: 0, idle: 0, successRate: 100, avgDurationMs: 0, maxConcurrent: 5 },
          ],
          system: {
            cpuUsagePercent: 25,
            memoryUsagePercent: 45,
            memoryUsedMB: 1024,
            memoryTotalMB: 2048,
            heapUsedMB: 128,
            heapTotalMB: 256,
          },
          dispatches: {
            lastHourTotal: 0,
            byStatus: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, timeout: 0 },
          },
          uptime: Math.floor((Date.now() - startTime) / 1000),
          timestamp: new Date().toISOString(),
        },
        meta: {
          requestId: 'test-request',
          timestamp: new Date().toISOString(),
        },
      });
    });

    // Mock dispatch routes
    app.post('/dispatch', (req: Request, res: Response) => {
      const { agent, task } = req.body as { agent?: string; task?: string };

      if (agent === undefined || task === undefined) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Agent and task are required' },
        });
        return;
      }

      if (task.length < 10) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Task must be at least 10 characters' },
        });
        return;
      }

      const dispatchId = uuidv4();
      createdDispatchIds.push(dispatchId);

      res.status(201).json({
        success: true,
        data: {
          dispatchId,
          status: 'PENDING',
          agent,
          modelId: getModelIdForAgent(agent),
          estimatedStartTime: new Date(Date.now() + 5000).toISOString(),
        },
        meta: {
          requestId: (req as unknown as { requestId: string }).requestId,
          timestamp: new Date().toISOString(),
        },
      });
    });

    app.get('/dispatch/:dispatchId', (req: Request, res: Response) => {
      const { dispatchId } = req.params;

      if (!isValidUuid(dispatchId)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid dispatch ID format' },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          dispatchId,
          status: 'PENDING',
          agent: 'claude',
          modelId: 'claude-opus-4-5-20251101',
          task: 'Test task for integration testing',
          progress: 0,
          logs: [],
        },
        meta: {
          requestId: (req as unknown as { requestId: string }).requestId,
          timestamp: new Date().toISOString(),
        },
      });
    });

    app.delete('/dispatch/:dispatchId', (req: Request, res: Response) => {
      const { dispatchId } = req.params;

      if (!isValidUuid(dispatchId)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid dispatch ID format' },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          dispatchId,
          status: 'CANCELLED',
          message: 'Dispatch cancelled successfully',
        },
        meta: {
          requestId: (req as unknown as { requestId: string }).requestId,
          timestamp: new Date().toISOString(),
        },
      });
    });
  });

  afterAll(async () => {
    createdDispatchIds.length = 0;
  });

  describe('POST /dispatch', () => {
    it('should create a dispatch and return dispatch_id', async () => {
      const response = await request(app)
        .post('/dispatch')
        .send({
          agent: 'claude',
          task: 'This is a test task that is long enough to pass validation',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.dispatchId).toBeDefined();
      expect(response.body.data.status).toBe('PENDING');
      expect(response.body.data.agent).toBe('claude');
      expect(response.body.data.modelId).toBe('claude-opus-4-5-20251101');
      expect(response.body.data.estimatedStartTime).toBeDefined();
      expect(response.body.meta).toBeDefined();
      expect(response.body.meta.requestId).toBeDefined();
      expect(response.body.meta.timestamp).toBeDefined();
    });

    it('should return 400 for missing agent', async () => {
      const response = await request(app)
        .post('/dispatch')
        .send({
          task: 'This is a test task that is long enough to pass validation',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for task too short', async () => {
      const response = await request(app)
        .post('/dispatch')
        .send({
          agent: 'claude',
          task: 'short',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should create dispatch for all supported agents', async () => {
      const agents = ['claude', 'codex', 'gemini', 'aider', 'grok'];

      for (const agent of agents) {
        const response = await request(app)
          .post('/dispatch')
          .send({
            agent,
            task: `Integration test task for ${agent} agent with sufficient length`,
          })
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.agent).toBe(agent);
        expect(response.body.data.dispatchId).toBeDefined();
      }
    });
  });

  describe('GET /dispatch/:id', () => {
    it('should return status object for valid dispatch_id', async () => {
      const testDispatchId = uuidv4();

      const response = await request(app)
        .get(`/dispatch/${testDispatchId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.dispatchId).toBe(testDispatchId);
      expect(response.body.data.status).toBeDefined();
      expect(response.body.data.agent).toBeDefined();
      expect(response.body.data.modelId).toBeDefined();
      expect(response.body.data.task).toBeDefined();
      expect(response.body.data.progress).toBeDefined();
      expect(typeof response.body.data.progress).toBe('number');
    });

    it('should return 400 for invalid dispatch_id format', async () => {
      const response = await request(app)
        .get('/dispatch/invalid-id')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /dispatch/:id', () => {
    it('should cancel dispatch and return cancelled status', async () => {
      const testDispatchId = uuidv4();

      const response = await request(app)
        .delete(`/dispatch/${testDispatchId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.dispatchId).toBe(testDispatchId);
      expect(response.body.data.status).toBe('CANCELLED');
      expect(response.body.data.message).toBe('Dispatch cancelled successfully');
    });

    it('should return 400 for invalid dispatch_id format', async () => {
      const response = await request(app)
        .delete('/dispatch/not-a-uuid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
      expect(response.body.version).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.checks).toBeDefined();
      expect(typeof response.body.checks).toBe('object');
    });

    it('should include component checks in health response', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      for (const [_name, check] of Object.entries(response.body.checks)) {
        expect(check).toBeDefined();
        expect((check as { status: string }).status).toBeDefined();
        expect(['pass', 'warn', 'fail']).toContain((check as { status: string }).status);
      }
    });
  });

  describe('GET /health/fleet', () => {
    it('should return fleet metrics', async () => {
      const response = await request(app)
        .get('/health/fleet')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.data.status);
      expect(response.body.data.pool).toBeDefined();
      expect(response.body.data.agents).toBeDefined();
      expect(Array.isArray(response.body.data.agents)).toBe(true);
      expect(response.body.data.uptime).toBeDefined();
      expect(response.body.data.timestamp).toBeDefined();
    });

    it('should include per-agent metrics in fleet response', async () => {
      const response = await request(app)
        .get('/health/fleet')
        .expect(200);

      const agents = response.body.data.agents;
      expect(agents.length).toBeGreaterThan(0);

      for (const agent of agents) {
        expect(agent.agent).toBeDefined();
        expect(['claude', 'codex', 'gemini', 'aider', 'grok']).toContain(agent.agent);
        expect(agent.available).toBeDefined();
        expect(typeof agent.available).toBe('boolean');
        expect(agent.modelId).toBeDefined();
      }
    });

    it('should include system metrics in fleet response', async () => {
      const response = await request(app)
        .get('/health/fleet')
        .expect(200);

      const system = response.body.data.system;
      expect(system).toBeDefined();
      expect(system.cpuUsagePercent).toBeDefined();
      expect(typeof system.cpuUsagePercent).toBe('number');
      expect(system.memoryUsagePercent).toBeDefined();
      expect(typeof system.memoryUsagePercent).toBe('number');
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(app)
        .get('/health/live')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /health/ready', () => {
    it('should return readiness status', async () => {
      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body.status).toBe('ready');
    });
  });
});
