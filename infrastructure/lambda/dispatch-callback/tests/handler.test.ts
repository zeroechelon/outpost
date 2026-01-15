/**
 * Unit Tests for Dispatch Status Callback Lambda
 *
 * Tests status mapping, dispatch ID extraction, and handler logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapEcsTaskToDispatchStatus,
  extractDispatchId,
  shouldProcessTask
} from '../src/status-mapper.js';
import {
  DispatchStatus,
  type EcsTaskDetail
} from '../src/types.js';

// Mock DynamoDB module
vi.mock('../src/dynamodb.js', () => ({
  updateDispatchStatus: vi.fn().mockResolvedValue({ success: true, updated: true }),
  findDispatchByTaskArn: vi.fn().mockResolvedValue(undefined)
}));

/**
 * Creates a mock ECS task detail for testing.
 */
function createMockTask(overrides: Partial<EcsTaskDetail> = {}): EcsTaskDetail {
  return {
    taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/cluster/task-id',
    clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/outpost-workers',
    taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/outpost-worker:1',
    containers: [
      {
        name: 'worker',
        exitCode: 0,
        lastStatus: 'STOPPED'
      }
    ],
    lastStatus: 'STOPPED',
    desiredStatus: 'STOPPED',
    createdAt: '2024-01-15T10:00:00Z',
    startedAt: '2024-01-15T10:00:05Z',
    stoppedAt: '2024-01-15T10:05:00Z',
    group: 'dispatch:550e8400-e29b-41d4-a716-446655440000',
    ...overrides
  };
}

describe('mapEcsTaskToDispatchStatus', () => {
  describe('exit code based mapping', () => {
    it('should return COMPLETED for exit code 0', () => {
      const task = createMockTask({
        containers: [{ name: 'worker', exitCode: 0, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.COMPLETED);
      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should return FAILED for non-zero exit code', () => {
      const task = createMockTask({
        containers: [{ name: 'worker', exitCode: 1, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
      expect(result.exitCode).toBe(1);
      expect(result.errorMessage).toContain('code 1');
    });

    it('should return FAILED for exit code 137 (OOM killed)', () => {
      const task = createMockTask({
        containers: [{ name: 'worker', exitCode: 137, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
      expect(result.exitCode).toBe(137);
    });
  });

  describe('stopped reason based mapping', () => {
    it('should return TIMEOUT when stoppedReason contains timeout', () => {
      const task = createMockTask({
        stoppedReason: 'Task execution timeout exceeded',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.TIMEOUT);
      expect(result.errorMessage).toContain('timeout');
    });

    it('should return FAILED when stoppedReason contains error', () => {
      const task = createMockTask({
        stoppedReason: 'Essential container error',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
      expect(result.errorMessage).toContain('error');
    });

    it('should return FAILED when stoppedReason contains OOM', () => {
      const task = createMockTask({
        stoppedReason: 'OutOfMemory: Container killed due to OOM',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
    });
  });

  describe('stop code based mapping', () => {
    it('should return CANCELLED for UserInitiated with cancel reason', () => {
      const task = createMockTask({
        stopCode: 'UserInitiated',
        stoppedReason: 'User cancelled the task',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.CANCELLED);
    });

    it('should return CANCELLED for UserInitiated with abort reason', () => {
      const task = createMockTask({
        stopCode: 'UserInitiated',
        stoppedReason: 'Task aborted by operator',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.CANCELLED);
    });

    it('should return FAILED for TaskFailedToStart', () => {
      const task = createMockTask({
        stopCode: 'TaskFailedToStart',
        stoppedReason: 'CannotPullContainerError: pull image manifest',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
      expect(result.errorMessage).toContain('manifest');
    });

    it('should return FAILED for SpotInterruption', () => {
      const task = createMockTask({
        stopCode: 'SpotInterruption',
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
      expect(result.errorMessage).toContain('SpotInterruption');
    });
  });

  describe('edge cases', () => {
    it('should use first container when worker container not found', () => {
      const task = createMockTask({
        containers: [{ name: 'sidecar', exitCode: 0, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.COMPLETED);
      expect(result.exitCode).toBe(0);
    });

    it('should return FAILED for STOPPED task with no exit code', () => {
      const task = createMockTask({
        containers: [{ name: 'worker', exitCode: undefined, lastStatus: 'STOPPED' }]
      });

      const result = mapEcsTaskToDispatchStatus(task);

      expect(result.status).toBe(DispatchStatus.FAILED);
    });
  });
});

describe('extractDispatchId', () => {
  describe('from environment overrides', () => {
    it('should extract DISPATCH_ID from container environment', () => {
      const task = createMockTask({
        overrides: {
          containerOverrides: [
            {
              name: 'worker',
              environment: [
                { name: 'DISPATCH_ID', value: '550e8400-e29b-41d4-a716-446655440000' }
              ]
            }
          ]
        }
      });

      const result = extractDispatchId(task);

      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should search multiple containers for DISPATCH_ID', () => {
      const task = createMockTask({
        overrides: {
          containerOverrides: [
            {
              name: 'sidecar',
              environment: [{ name: 'OTHER_VAR', value: 'value' }]
            },
            {
              name: 'worker',
              environment: [
                { name: 'DISPATCH_ID', value: 'abc12345-e29b-41d4-a716-446655440000' }
              ]
            }
          ]
        }
      });

      const result = extractDispatchId(task);

      expect(result).toBe('abc12345-e29b-41d4-a716-446655440000');
    });
  });

  describe('from task group', () => {
    it('should extract dispatch ID from dispatch:UUID format', () => {
      const task = createMockTask({
        group: 'dispatch:550e8400-e29b-41d4-a716-446655440000',
        overrides: undefined
      });

      const result = extractDispatchId(task);

      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should extract UUID from group name containing UUID', () => {
      const task = createMockTask({
        group: 'family:outpost-550e8400-e29b-41d4-a716-446655440000',
        overrides: undefined
      });

      const result = extractDispatchId(task);

      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('from task tags', () => {
    it('should extract dispatch_id from tags', () => {
      const task = createMockTask({
        group: undefined,
        overrides: undefined,
        tags: [
          { key: 'dispatch_id', value: '550e8400-e29b-41d4-a716-446655440000' }
        ]
      });

      const result = extractDispatchId(task);

      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle dispatchId tag variant', () => {
      const task = createMockTask({
        group: undefined,
        overrides: undefined,
        tags: [
          { key: 'dispatchId', value: 'abc12345-e29b-41d4-a716-446655440000' }
        ]
      });

      const result = extractDispatchId(task);

      expect(result).toBe('abc12345-e29b-41d4-a716-446655440000');
    });
  });

  describe('from startedBy', () => {
    it('should extract UUID from startedBy field', () => {
      const task = createMockTask({
        group: undefined,
        overrides: undefined,
        tags: undefined,
        startedBy: 'outpost-dispatch-550e8400-e29b-41d4-a716-446655440000'
      });

      const result = extractDispatchId(task);

      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('fallback behavior', () => {
    it('should return undefined when no dispatch ID found', () => {
      const task = createMockTask({
        group: undefined,
        overrides: undefined,
        tags: undefined,
        startedBy: undefined
      });

      const result = extractDispatchId(task);

      expect(result).toBeUndefined();
    });

    it('should prioritize environment override over group', () => {
      const task = createMockTask({
        group: 'dispatch:11111111-1111-1111-1111-111111111111',
        overrides: {
          containerOverrides: [
            {
              name: 'worker',
              environment: [
                { name: 'DISPATCH_ID', value: '22222222-2222-2222-2222-222222222222' }
              ]
            }
          ]
        }
      });

      const result = extractDispatchId(task);

      expect(result).toBe('22222222-2222-2222-2222-222222222222');
    });
  });
});

describe('shouldProcessTask', () => {
  it('should return process: true for STOPPED task with dispatch ID', () => {
    const task = createMockTask();

    const result = shouldProcessTask(task);

    expect(result.process).toBe(true);
  });

  it('should return process: false for RUNNING task', () => {
    const task = createMockTask({ lastStatus: 'RUNNING' });

    const result = shouldProcessTask(task);

    expect(result.process).toBe(false);
    expect(result.reason).toContain('RUNNING');
  });

  it('should return process: false for PENDING task', () => {
    const task = createMockTask({ lastStatus: 'PENDING' });

    const result = shouldProcessTask(task);

    expect(result.process).toBe(false);
    expect(result.reason).toContain('PENDING');
  });

  it('should return process: false for task without dispatch ID', () => {
    const task = createMockTask({
      group: undefined,
      overrides: undefined,
      tags: undefined,
      startedBy: undefined
    });

    const result = shouldProcessTask(task);

    expect(result.process).toBe(false);
    expect(result.reason).toContain('No dispatch ID');
  });
});

describe('handler integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should skip non-STOPPED events', async () => {
    const { handler } = await import('../src/index.js');

    const event = {
      version: '0',
      id: 'event-id',
      'detail-type': 'ECS Task State Change' as const,
      source: 'aws.ecs' as const,
      account: '123456789012',
      time: '2024-01-15T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: createMockTask({ lastStatus: 'RUNNING' })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body.skipped).toBe(true);
  });

  it('should process STOPPED event and update status', async () => {
    const dynamoModule = await import('../src/dynamodb.js');
    vi.mocked(dynamoModule.updateDispatchStatus).mockResolvedValue({
      success: true,
      updated: true
    });

    const { handler } = await import('../src/index.js');

    const event = {
      version: '0',
      id: 'event-id',
      'detail-type': 'ECS Task State Change' as const,
      source: 'aws.ecs' as const,
      account: '123456789012',
      time: '2024-01-15T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: createMockTask()
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.dispatchId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.body.status).toBe(DispatchStatus.COMPLETED);
  });
});
