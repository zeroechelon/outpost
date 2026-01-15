/**
 * Dispatch Repository Tests
 *
 * Tests for DispatchRepository including idempotency key lookup,
 * tag storage/filtering, and DynamoDB operations.
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DispatchRepository,
  type DispatchRecord,
  type CreateDispatchInput,
  type ListDispatchesQuery,
  type DispatchStatus,
} from '../../repositories/dispatch.repository.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';

// Store mock send function for inspection
let mockSend: jest.Mock;
let lastSendInput: unknown;

// Mock the base repository
jest.mock('../../repositories/base.repository.js', () => ({
  getDocClient: () => ({
    send: (input: unknown) => {
      lastSendInput = input;
      return mockSend(input);
    },
  }),
}));

describe('DispatchRepository', () => {
  let repository: DispatchRepository;

  const mockDispatchItem = {
    dispatch_id: 'TEST123ABC',
    user_id: 'user-123',
    agent: 'claude',
    model_id: 'claude-opus-4-5-20251101',
    task: 'Test task',
    status: 'PENDING',
    started_at: '2024-01-15T10:00:00.000Z',
    version: 1,
  };

  beforeEach(() => {
    mockSend = jest.fn();
    lastSendInput = undefined;
    repository = new DispatchRepository();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdempotencyKey', () => {
    it('should return dispatch record when idempotency key exists', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            idempotency_key: 'user-123#idem-key-abc',
            dispatch_id: 'TEST123ABC',
          },
        })
        .mockResolvedValueOnce({
          Item: mockDispatchItem,
        });

      const result = await repository.findByIdempotencyKey('user-123', 'idem-key-abc');

      expect(result).not.toBeNull();
      expect(result?.dispatchId).toBe('TEST123ABC');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return null when idempotency key does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repository.findByIdempotencyKey('user-123', 'nonexistent-key');

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return null on idempotency table error (graceful degradation)', async () => {
      mockSend.mockRejectedValueOnce(new Error('Table not found'));

      const result = await repository.findByIdempotencyKey('user-123', 'any-key');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should store idempotency key mapping when provided', async () => {
      mockSend
        .mockResolvedValueOnce({}) // dispatch table put
        .mockResolvedValueOnce({}); // idempotency table put

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
        idempotencyKey: 'my-idem-key',
      };

      const result = await repository.create(input);

      expect(result.idempotencyKey).toBe('my-idem-key');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should store tags when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
        tags: {
          environment: 'production',
          team: 'backend',
        },
      };

      const result = await repository.create(input);

      expect(result.tags).toEqual({
        environment: 'production',
        team: 'backend',
      });
    });

    it('should create dispatch without idempotency key', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
      };

      const result = await repository.create(input);

      expect(result.idempotencyKey).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should create dispatch without tags', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
      };

      const result = await repository.create(input);

      expect(result.tags).toBeNull();
    });

    it('should use provided dispatchId when specified', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        dispatchId: 'CUSTOM-ID-123',
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
      };

      const result = await repository.create(input);

      expect(result.dispatchId).toBe('CUSTOM-ID-123');
    });

    it('should set initial status to PENDING', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
      };

      const result = await repository.create(input);

      expect(result.status).toBe('PENDING');
    });

    it('should set version to 1 for new dispatches', async () => {
      mockSend.mockResolvedValueOnce({});

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
      };

      const result = await repository.create(input);

      expect(result.version).toBe(1);
    });

    it('should continue if idempotency table write fails (non-fatal)', async () => {
      mockSend
        .mockResolvedValueOnce({}) // dispatch table put succeeds
        .mockRejectedValueOnce(new Error('Idempotency table error')); // idempotency fails

      const input: CreateDispatchInput = {
        userId: 'user-123',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        task: 'Test task',
        idempotencyKey: 'my-key',
      };

      const result = await repository.create(input);

      expect(result.dispatchId).toBeDefined();
    });
  });

  describe('listByUser', () => {
    describe('tag filtering (T5.4)', () => {
      it('should return dispatches matching all specified tags', async () => {
        mockSend.mockResolvedValueOnce({
          Items: [
            {
              ...mockDispatchItem,
              dispatch_id: 'MATCH1',
              tags: { env: 'prod', team: 'backend', project: 'outpost' },
            },
          ],
        });

        const query: ListDispatchesQuery = {
          tags: { env: 'prod', team: 'backend' },
        };

        const result = await repository.listByUser('user-123', query);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].dispatchId).toBe('MATCH1');
      });

      it('should pass tag filter to DynamoDB', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });

        const query: ListDispatchesQuery = {
          tags: { env: 'prod' },
        };

        await repository.listByUser('user-123', query);

        // The filter should have been applied
        expect(mockSend).toHaveBeenCalledTimes(1);
      });

      it('should handle empty tags object (no filter)', async () => {
        mockSend.mockResolvedValueOnce({ Items: [mockDispatchItem] });

        const query: ListDispatchesQuery = {
          tags: {},
        };

        const result = await repository.listByUser('user-123', query);

        expect(result.items).toHaveLength(1);
      });
    });

    it('should return items with correct pagination cursor', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [mockDispatchItem],
        LastEvaluatedKey: { dispatch_id: 'TEST123', user_id: 'user-123' },
      });

      const result = await repository.listByUser('user-123');

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeDefined();
      expect(() => Buffer.from(result.nextCursor!, 'base64').toString()).not.toThrow();
    });

    it('should handle pagination cursor', async () => {
      const cursor = Buffer.from(JSON.stringify({ dispatch_id: 'LAST', user_id: 'user-123' })).toString('base64');

      mockSend.mockResolvedValueOnce({ Items: [] });

      await repository.listByUser('user-123', { cursor });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should respect limit parameter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await repository.listByUser('user-123', { limit: 50 });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should filter by status', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ ...mockDispatchItem, status: 'COMPLETED' }],
      });

      const result = await repository.listByUser('user-123', { status: 'COMPLETED' });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no items found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repository.listByUser('user-123');

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('should return dispatch record when found', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          ...mockDispatchItem,
          idempotency_key: 'idem-123',
          tags: { env: 'test' },
        },
      });

      const result = await repository.getById('TEST123ABC');

      expect(result.dispatchId).toBe('TEST123ABC');
      expect(result.userId).toBe('user-123');
      expect(result.idempotencyKey).toBe('idem-123');
      expect(result.tags).toEqual({ env: 'test' });
    });

    it('should throw NotFoundError when dispatch does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(repository.getById('NONEXISTENT')).rejects.toThrow(NotFoundError);
    });

    it('should parse dates correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          ...mockDispatchItem,
          ended_at: '2024-01-15T11:00:00.000Z',
        },
      });

      const result = await repository.getById('TEST123ABC');

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.endedAt).toBeInstanceOf(Date);
    });

    it('should handle null optional fields', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDispatchItem });

      const result = await repository.getById('TEST123ABC');

      expect(result.endedAt).toBeNull();
      expect(result.taskArn).toBeNull();
      expect(result.idempotencyKey).toBeNull();
      expect(result.tags).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status with optimistic locking', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ...mockDispatchItem,
          status: 'RUNNING',
          version: 2,
        },
      });

      const result = await repository.updateStatus('TEST123', 'RUNNING', 1);

      expect(result.status).toBe('RUNNING');
      expect(result.version).toBe(2);
    });

    it('should throw ConflictError on version mismatch', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: 'Condition failed', $metadata: {} })
      );

      await expect(
        repository.updateStatus('TEST123', 'RUNNING', 1)
      ).rejects.toThrow(ConflictError);
    });

    it('should include additional updates when provided', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ...mockDispatchItem,
          status: 'RUNNING',
          task_arn: 'arn:aws:ecs:...',
          version: 2,
        },
      });

      const result = await repository.updateStatus('TEST123', 'RUNNING', 1, {
        taskArn: 'arn:aws:ecs:...',
      });

      expect(result.taskArn).toBe('arn:aws:ecs:...');
    });
  });

  describe('markCompleted', () => {
    it('should set status to COMPLETED and endedAt', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ...mockDispatchItem,
          status: 'COMPLETED',
          ended_at: new Date().toISOString(),
          artifacts_url: 's3://bucket/artifacts',
          version: 2,
        },
      });

      const result = await repository.markCompleted('TEST123', 1, 's3://bucket/artifacts');

      expect(result.status).toBe('COMPLETED');
      expect(result.artifactsUrl).toBe('s3://bucket/artifacts');
      expect(result.endedAt).not.toBeNull();
    });
  });

  describe('markFailed', () => {
    it('should set status to FAILED and error message', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ...mockDispatchItem,
          status: 'FAILED',
          error_message: 'Task execution failed',
          ended_at: new Date().toISOString(),
          version: 2,
        },
      });

      const result = await repository.markFailed('TEST123', 1, 'Task execution failed');

      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toBe('Task execution failed');
    });
  });
});
