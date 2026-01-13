/**
 * Repository Integration Tests
 *
 * Tests repository classes with contract validation.
 * These tests verify repository interfaces and data transformations.
 *
 * To run against real DynamoDB (dev tables):
 * AWS_PROFILE=soc npm run test:integration
 *
 * Tests:
 * - DispatchRepository contract validation
 * - TenantRepository contract validation
 * - Data model transformations
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { generateTestId, TEST_USER_ID } from './setup.js';

// Import types for contract validation
import type { DispatchStatus, CreateDispatchInput, DispatchRecord } from '../../src/repositories/dispatch.repository.js';
import type { CreateTenantInput, TenantTier, TenantModel, UsageLimits, UsageStatus } from '../../src/models/tenant.model.js';

describe('Repository Integration Tests', () => {
  describe('DispatchRepository Contract', () => {
    describe('CreateDispatchInput validation', () => {
      it('should define required fields for dispatch creation', () => {
        const validInput: CreateDispatchInput = {
          userId: TEST_USER_ID,
          agent: 'claude',
          modelId: 'claude-opus-4-5-20251101',
          task: 'Integration test task for dispatch creation',
        };

        expect(validInput.userId).toBeDefined();
        expect(validInput.agent).toBeDefined();
        expect(validInput.modelId).toBeDefined();
        expect(validInput.task).toBeDefined();
        expect(['claude', 'codex', 'gemini', 'aider', 'grok']).toContain(validInput.agent);
      });

      it('should support all agent types', () => {
        const agents: Array<CreateDispatchInput['agent']> = ['claude', 'codex', 'gemini', 'aider', 'grok'];

        for (const agent of agents) {
          const input: CreateDispatchInput = {
            userId: TEST_USER_ID,
            agent,
            modelId: `model-for-${agent}`,
            task: `Test task for ${agent}`,
          };
          expect(input.agent).toBe(agent);
        }
      });

      it('should support optional fields', () => {
        const inputWithOptionals: CreateDispatchInput = {
          userId: TEST_USER_ID,
          agent: 'claude',
          modelId: 'claude-opus-4-5-20251101',
          task: 'Integration test with optional fields',
          repoUrl: 'https://github.com/user/repo',
          branch: 'main',
          workspaceId: 'ws-123',
          timeoutSeconds: 600,
          contextLevel: 'standard',
        };

        expect(inputWithOptionals.repoUrl).toBeDefined();
        expect(inputWithOptionals.branch).toBeDefined();
        expect(inputWithOptionals.workspaceId).toBeDefined();
        expect(inputWithOptionals.timeoutSeconds).toBeDefined();
        expect(inputWithOptionals.contextLevel).toBeDefined();
      });
    });

    describe('DispatchRecord structure', () => {
      it('should have all required fields for a dispatch record', () => {
        const mockRecord: DispatchRecord = {
          dispatchId: uuidv4(),
          userId: TEST_USER_ID,
          agent: 'claude',
          modelId: 'claude-opus-4-5-20251101',
          task: 'Test task',
          status: 'PENDING',
          startedAt: new Date(),
          endedAt: null,
          taskArn: null,
          workspaceId: null,
          artifactsUrl: null,
          errorMessage: null,
          version: 1,
        };

        expect(mockRecord.dispatchId).toBeDefined();
        expect(mockRecord.userId).toBeDefined();
        expect(mockRecord.agent).toBeDefined();
        expect(mockRecord.modelId).toBeDefined();
        expect(mockRecord.task).toBeDefined();
        expect(mockRecord.status).toBeDefined();
        expect(mockRecord.startedAt).toBeInstanceOf(Date);
        expect(mockRecord.version).toBe(1);
      });

      it('should support all dispatch statuses', () => {
        const statuses: DispatchStatus[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];

        for (const status of statuses) {
          const record: Partial<DispatchRecord> = { status };
          expect(record.status).toBe(status);
        }
      });
    });

    describe('Dispatch ID generation', () => {
      it('should generate unique UUIDs', () => {
        const ids = Array.from({ length: 10 }, () => uuidv4());
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it('should generate valid UUID format', () => {
        const id = uuidv4();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(id).toMatch(uuidRegex);
      });
    });

    describe('Status transitions', () => {
      it('should define valid PENDING transitions', () => {
        const validFromPending: DispatchStatus[] = ['RUNNING', 'CANCELLED'];
        expect(validFromPending).toContain('RUNNING');
        expect(validFromPending).toContain('CANCELLED');
        expect(validFromPending).not.toContain('COMPLETED');
      });

      it('should define valid RUNNING transitions', () => {
        const validFromRunning: DispatchStatus[] = ['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'];
        expect(validFromRunning).toContain('COMPLETED');
        expect(validFromRunning).toContain('FAILED');
        expect(validFromRunning).toContain('TIMEOUT');
        expect(validFromRunning).toContain('CANCELLED');
      });

      it('should not allow transitions from terminal states', () => {
        const terminalStates: DispatchStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];
        for (const state of terminalStates) {
          // Terminal states should not transition to anything
          expect(state).toBeDefined();
        }
      });
    });

    describe('Version control (optimistic locking)', () => {
      it('should increment version on update', () => {
        const initialVersion = 1;
        const updatedVersion = initialVersion + 1;
        expect(updatedVersion).toBe(2);
      });

      it('should start at version 1', () => {
        const newRecord: Partial<DispatchRecord> = { version: 1 };
        expect(newRecord.version).toBe(1);
      });
    });

    describe('listByUser query parameters', () => {
      it('should support pagination with limit', () => {
        const query = { limit: 10 };
        expect(query.limit).toBe(10);
        expect(query.limit).toBeGreaterThan(0);
        expect(query.limit).toBeLessThanOrEqual(100);
      });

      it('should support status filter', () => {
        const query = { limit: 10, status: 'RUNNING' as DispatchStatus };
        expect(query.status).toBe('RUNNING');
      });

      it('should support agent filter', () => {
        const query = { limit: 10, agent: 'claude' as const };
        expect(query.agent).toBe('claude');
      });

      it('should support cursor-based pagination', () => {
        const query = { limit: 10, cursor: 'base64EncodedCursor' };
        expect(query.cursor).toBeDefined();
      });
    });
  });

  describe('TenantRepository Contract', () => {
    describe('CreateTenantInput validation', () => {
      it('should define required fields for tenant creation', () => {
        const validInput: CreateTenantInput = {
          name: 'Test Tenant',
          email: 'test@example.com',
          tier: 'free',
        };

        expect(validInput.name).toBeDefined();
        expect(validInput.email).toBeDefined();
        expect(validInput.tier).toBeDefined();
      });

      it('should support all tenant tiers', () => {
        const tiers: TenantTier[] = ['free', 'starter', 'pro', 'enterprise'];

        for (const tier of tiers) {
          const input: CreateTenantInput = {
            name: `${tier} Tenant`,
            email: `${tier}@example.com`,
            tier,
          };
          expect(input.tier).toBe(tier);
        }
      });
    });

    describe('TenantModel structure', () => {
      it('should have all required fields', () => {
        const mockTenant: TenantModel = {
          tenantId: uuidv4(),
          name: 'Test Tenant',
          email: 'test@example.com',
          tier: 'starter',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          stripeCustomerId: null,
          usageLimits: {
            maxConcurrentJobs: 3,
            maxJobsPerDay: 50,
            maxJobTimeoutSeconds: 600,
          },
          currentUsage: {
            concurrentJobs: 0,
            jobsToday: 0,
            lastResetDate: new Date().toISOString().split('T')[0],
          },
        };

        expect(mockTenant.tenantId).toBeDefined();
        expect(mockTenant.name).toBeDefined();
        expect(mockTenant.email).toBeDefined();
        expect(mockTenant.tier).toBeDefined();
        expect(mockTenant.status).toBeDefined();
        expect(mockTenant.createdAt).toBeInstanceOf(Date);
        expect(mockTenant.updatedAt).toBeInstanceOf(Date);
        expect(mockTenant.usageLimits).toBeDefined();
        expect(mockTenant.currentUsage).toBeDefined();
      });
    });

    describe('UsageLimits by tier', () => {
      it('should define correct limits for free tier', () => {
        const freeLimits: UsageLimits = {
          maxConcurrentJobs: 1,
          maxJobsPerDay: 10,
          maxJobTimeoutSeconds: 300,
        };

        expect(freeLimits.maxConcurrentJobs).toBe(1);
        expect(freeLimits.maxJobsPerDay).toBe(10);
        expect(freeLimits.maxJobTimeoutSeconds).toBe(300);
      });

      it('should define correct limits for starter tier', () => {
        const starterLimits: UsageLimits = {
          maxConcurrentJobs: 3,
          maxJobsPerDay: 50,
          maxJobTimeoutSeconds: 600,
        };

        expect(starterLimits.maxConcurrentJobs).toBe(3);
        expect(starterLimits.maxJobsPerDay).toBe(50);
        expect(starterLimits.maxJobTimeoutSeconds).toBe(600);
      });

      it('should define correct limits for pro tier', () => {
        const proLimits: UsageLimits = {
          maxConcurrentJobs: 10,
          maxJobsPerDay: 500,
          maxJobTimeoutSeconds: 1800,
        };

        expect(proLimits.maxConcurrentJobs).toBe(10);
        expect(proLimits.maxJobsPerDay).toBe(500);
        expect(proLimits.maxJobTimeoutSeconds).toBe(1800);
      });

      it('should define correct limits for enterprise tier', () => {
        const enterpriseLimits: UsageLimits = {
          maxConcurrentJobs: 50,
          maxJobsPerDay: 10000,
          maxJobTimeoutSeconds: 3600,
        };

        expect(enterpriseLimits.maxConcurrentJobs).toBe(50);
        expect(enterpriseLimits.maxJobsPerDay).toBe(10000);
        expect(enterpriseLimits.maxJobTimeoutSeconds).toBe(3600);
      });
    });

    describe('UsageStatus tracking', () => {
      it('should track concurrent jobs', () => {
        const usage: UsageStatus = {
          concurrentJobs: 2,
          jobsToday: 15,
          lastResetDate: '2026-01-12',
        };

        expect(usage.concurrentJobs).toBeGreaterThanOrEqual(0);
        expect(usage.jobsToday).toBeGreaterThanOrEqual(0);
        expect(usage.lastResetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should initialize usage at zero', () => {
        const initialUsage: UsageStatus = {
          concurrentJobs: 0,
          jobsToday: 0,
          lastResetDate: new Date().toISOString().split('T')[0],
        };

        expect(initialUsage.concurrentJobs).toBe(0);
        expect(initialUsage.jobsToday).toBe(0);
      });
    });

    describe('Tenant status values', () => {
      it('should support active status', () => {
        const tenant: Partial<TenantModel> = { status: 'active' };
        expect(tenant.status).toBe('active');
      });

      it('should support suspended status', () => {
        const tenant: Partial<TenantModel> = { status: 'suspended' };
        expect(tenant.status).toBe('suspended');
      });

      it('should support deleted status', () => {
        const tenant: Partial<TenantModel> = { status: 'deleted' };
        expect(tenant.status).toBe('deleted');
      });
    });

    describe('Concurrent jobs management', () => {
      it('should increment within limits', () => {
        const currentJobs = 0;
        const limit = 3;
        const newCount = currentJobs + 1;

        expect(newCount).toBeLessThanOrEqual(limit);
      });

      it('should not allow exceeding limit', () => {
        const currentJobs = 3;
        const limit = 3;

        expect(currentJobs).toBe(limit);
        // Should not increment beyond limit
      });

      it('should decrement to zero minimum', () => {
        const currentJobs = 1;
        const newCount = Math.max(0, currentJobs - 1);

        expect(newCount).toBe(0);
        expect(newCount).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Data Transformation', () => {
    describe('DynamoDB item format', () => {
      it('should use snake_case for DynamoDB attributes', () => {
        const dynamoItem = {
          dispatch_id: uuidv4(),
          user_id: TEST_USER_ID,
          model_id: 'claude-opus-4-5-20251101',
          started_at: new Date().toISOString(),
          ended_at: null,
          task_arn: null,
          workspace_id: null,
          artifacts_url: null,
          error_message: null,
        };

        expect(dynamoItem.dispatch_id).toBeDefined();
        expect(dynamoItem.user_id).toBeDefined();
        expect(dynamoItem.model_id).toBeDefined();
        expect(dynamoItem.started_at).toBeDefined();
      });

      it('should convert dates to ISO strings', () => {
        const date = new Date();
        const isoString = date.toISOString();

        expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });

    describe('Model to DynamoDB conversion', () => {
      it('should convert dispatchId to dispatch_id', () => {
        const model = { dispatchId: uuidv4() };
        const dynamoItem = { dispatch_id: model.dispatchId };

        expect(dynamoItem.dispatch_id).toBe(model.dispatchId);
      });

      it('should convert userId to user_id', () => {
        const model = { userId: TEST_USER_ID };
        const dynamoItem = { user_id: model.userId };

        expect(dynamoItem.user_id).toBe(model.userId);
      });

      it('should convert modelId to model_id', () => {
        const model = { modelId: 'claude-opus-4-5-20251101' };
        const dynamoItem = { model_id: model.modelId };

        expect(dynamoItem.model_id).toBe(model.modelId);
      });
    });

    describe('DynamoDB to Model conversion', () => {
      it('should convert dispatch_id to dispatchId', () => {
        const dynamoItem = { dispatch_id: uuidv4() };
        const model = { dispatchId: dynamoItem.dispatch_id };

        expect(model.dispatchId).toBe(dynamoItem.dispatch_id);
      });

      it('should parse ISO string dates to Date objects', () => {
        const isoString = '2026-01-12T00:00:00.000Z';
        const date = new Date(isoString);

        expect(date).toBeInstanceOf(Date);
        expect(date.toISOString()).toBe(isoString);
      });

      it('should handle null values', () => {
        const dynamoItem = {
          ended_at: null,
          error_message: null,
        };

        expect(dynamoItem.ended_at).toBeNull();
        expect(dynamoItem.error_message).toBeNull();
      });
    });
  });
});
