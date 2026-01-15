/**
 * Dispatcher Orchestrator Tests
 *
 * Tests for DispatcherOrchestrator including idempotency key handling,
 * tag passthrough, resource constraints, and workspace mode handling.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  DispatcherOrchestrator,
  resetDispatcherOrchestrator,
  generateUlid,
  type DispatchRequest,
  type ResourceConstraints,
} from '../../services/dispatcher.js';
import { SecretInjectorService, resetSecretInjectorService } from '../../services/secret-injector.js';
import { TaskLauncherService, resetTaskLauncherService } from '../../services/task-launcher.js';
import { DispatchRepository, type DispatchRecord } from '../../repositories/dispatch.repository.js';
import { ValidationError } from '../../utils/errors.js';

// Mock dependencies
jest.mock('../../services/secret-injector.js', () => {
  const original = jest.requireActual('../../services/secret-injector.js');
  return {
    ...original,
    getSecretInjectorService: jest.fn(),
    resetSecretInjectorService: jest.fn(),
  };
});

jest.mock('../../services/task-launcher.js', () => {
  const original = jest.requireActual('../../services/task-launcher.js');
  return {
    ...original,
    getTaskLauncherService: jest.fn(),
    resetTaskLauncherService: jest.fn(),
  };
});

jest.mock('@aws-sdk/client-eventbridge');

describe('DispatcherOrchestrator', () => {
  let orchestrator: DispatcherOrchestrator;
  let mockSecretInjector: jest.Mocked<SecretInjectorService>;
  let mockTaskLauncher: jest.Mocked<TaskLauncherService>;
  let mockDispatchRepository: jest.Mocked<DispatchRepository>;
  let mockEventBridgeClient: jest.Mocked<EventBridgeClient>;

  const baseDispatchRequest: DispatchRequest = {
    userId: 'user-123',
    agent: 'claude',
    task: 'Write a test file',
  };

  const mockDispatchRecord: DispatchRecord = {
    dispatchId: 'TEST123ABC',
    userId: 'user-123',
    agent: 'claude',
    modelId: 'claude-opus-4-5-20251101',
    task: 'Write a test file',
    status: 'PENDING',
    startedAt: new Date(),
    endedAt: null,
    taskArn: null,
    workspaceId: null,
    artifactsUrl: null,
    errorMessage: null,
    version: 1,
    idempotencyKey: null,
    tags: null,
  };

  beforeEach(() => {
    resetDispatcherOrchestrator();

    // Create mock instances
    mockSecretInjector = {
      buildContainerSecrets: jest.fn().mockResolvedValue({
        secrets: [],
        agentType: 'claude',
        validatedAt: new Date(),
      }),
      validateAdditionalSecrets: jest.fn(),
    } as unknown as jest.Mocked<SecretInjectorService>;

    mockTaskLauncher = {
      launchTask: jest.fn().mockResolvedValue({
        taskArn: 'arn:aws:ecs:us-east-1:123456789:task/outpost/abc123',
        taskId: 'abc123',
        startedAt: new Date(),
        clusterArn: 'arn:aws:ecs:us-east-1:123456789:cluster/outpost',
      }),
      stopTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TaskLauncherService>;

    mockDispatchRepository = {
      create: jest.fn().mockResolvedValue(mockDispatchRecord),
      getById: jest.fn().mockResolvedValue(mockDispatchRecord),
      updateStatus: jest.fn().mockResolvedValue({ ...mockDispatchRecord, status: 'RUNNING' }),
      markFailed: jest.fn().mockResolvedValue({ ...mockDispatchRecord, status: 'FAILED' }),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      listByUser: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as jest.Mocked<DispatchRepository>;

    mockEventBridgeClient = {
      send: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EventBridgeClient>;

    orchestrator = new DispatcherOrchestrator(
      mockSecretInjector,
      mockTaskLauncher,
      mockDispatchRepository,
      mockEventBridgeClient
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('idempotency key handling (T5.1)', () => {
    it('should return existing dispatch for same idempotency key', async () => {
      const existingDispatch: DispatchRecord = {
        ...mockDispatchRecord,
        dispatchId: 'EXISTING123',
        idempotencyKey: 'idem-key-123',
        tags: { env: 'test' },
      };

      mockDispatchRepository.findByIdempotencyKey.mockResolvedValue(existingDispatch);

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        idempotencyKey: 'idem-key-123',
      };

      const result = await orchestrator.dispatch(request);

      expect(result.dispatchId).toBe('EXISTING123');
      expect(result.idempotent).toBe(true);
      expect(mockTaskLauncher.launchTask).not.toHaveBeenCalled();
      expect(mockDispatchRepository.create).not.toHaveBeenCalled();
    });

    it('should create new dispatch when no idempotency key match', async () => {
      mockDispatchRepository.findByIdempotencyKey.mockResolvedValue(null);

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        idempotencyKey: 'new-key-456',
      };

      const result = await orchestrator.dispatch(request);

      expect(result.idempotent).toBeUndefined();
      expect(mockTaskLauncher.launchTask).toHaveBeenCalled();
      expect(mockDispatchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'new-key-456',
        })
      );
    });

    it('should create new dispatch when idempotency key is different', async () => {
      const existingDispatch: DispatchRecord = {
        ...mockDispatchRecord,
        dispatchId: 'EXISTING123',
        idempotencyKey: 'key-A',
      };

      // First call returns existing, second returns null
      mockDispatchRepository.findByIdempotencyKey.mockResolvedValue(null);

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        idempotencyKey: 'key-B', // Different key
      };

      const result = await orchestrator.dispatch(request);

      expect(result.idempotent).toBeUndefined();
      expect(mockTaskLauncher.launchTask).toHaveBeenCalled();
    });

    it('should handle dispatch without idempotency key', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        // No idempotencyKey
      };

      const result = await orchestrator.dispatch(request);

      expect(mockDispatchRepository.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(mockTaskLauncher.launchTask).toHaveBeenCalled();
    });

    it('should map existing dispatch status correctly for idempotent response', async () => {
      const completedDispatch: DispatchRecord = {
        ...mockDispatchRecord,
        status: 'COMPLETED',
        idempotencyKey: 'completed-key',
      };

      mockDispatchRepository.findByIdempotencyKey.mockResolvedValue(completedDispatch);

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        idempotencyKey: 'completed-key',
      };

      const result = await orchestrator.dispatch(request);

      expect(result.idempotent).toBe(true);
      expect(result.status).toBe('provisioning');
    });
  });

  describe('tag passthrough (T5.2)', () => {
    it('should pass tags through to dispatch repository', async () => {
      const tags = {
        environment: 'production',
        team: 'backend',
        project: 'outpost',
      };

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        tags,
      };

      await orchestrator.dispatch(request);

      expect(mockDispatchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags,
        })
      );
    });

    it('should include tags in dispatch result', async () => {
      const tags = { env: 'test' };

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        tags,
      };

      const result = await orchestrator.dispatch(request);

      expect(result.tags).toEqual(tags);
    });

    it('should return tags from idempotent dispatch', async () => {
      const existingDispatch: DispatchRecord = {
        ...mockDispatchRecord,
        idempotencyKey: 'tagged-key',
        tags: { saved: 'tag' },
      };

      mockDispatchRepository.findByIdempotencyKey.mockResolvedValue(existingDispatch);

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        idempotencyKey: 'tagged-key',
        tags: { new: 'tag' }, // These should be ignored for idempotent response
      };

      const result = await orchestrator.dispatch(request);

      expect(result.tags).toEqual({ saved: 'tag' }); // Should return existing tags
    });

    it('should handle dispatch without tags', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        // No tags
      };

      const result = await orchestrator.dispatch(request);

      expect(result.tags).toBeUndefined();
      expect(mockDispatchRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          tags: expect.anything(),
        })
      );
    });
  });

  describe('resource constraints (T5.3)', () => {
    it('should pass resource constraints to task launcher', async () => {
      const resourceConstraints: ResourceConstraints = {
        maxMemoryMb: 4096,
        maxCpuUnits: 2048,
        maxDiskGb: 50,
      };

      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints,
      };

      await orchestrator.dispatch(request);

      expect(mockTaskLauncher.launchTask).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceConstraints: expect.objectContaining({
            maxMemoryMb: 4096,
            maxCpuUnits: 2048,
            maxDiskGb: 50,
          }),
        })
      );
    });

    it('should pass partial resource constraints', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints: {
          maxMemoryMb: 8192,
          // No CPU or disk constraints
        },
      };

      await orchestrator.dispatch(request);

      expect(mockTaskLauncher.launchTask).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceConstraints: expect.objectContaining({
            maxMemoryMb: 8192,
          }),
        })
      );
    });

    it('should handle dispatch without resource constraints', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        // No resourceConstraints
      };

      await orchestrator.dispatch(request);

      // Should still call launchTask but without resourceConstraints in override
      expect(mockTaskLauncher.launchTask).toHaveBeenCalled();
      const launchCall = mockTaskLauncher.launchTask.mock.calls[0][0];
      expect(launchCall.resourceConstraints).toBeUndefined();
    });

    it('should reject invalid memory constraint (too low)', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints: {
          maxMemoryMb: 256, // Below minimum of 512
        },
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid memory constraint (too high)', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints: {
          maxMemoryMb: 50000, // Above maximum of 30720
        },
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid CPU constraint (too low)', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints: {
          maxCpuUnits: 128, // Below minimum of 256
        },
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid disk constraint (too low)', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        resourceConstraints: {
          maxDiskGb: 10, // Below minimum of 21
        },
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });
  });

  describe('workspace mode passthrough', () => {
    it('should pass workspaceInitMode to task launcher', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        workspaceInitMode: 'minimal',
      };

      await orchestrator.dispatch(request);

      expect(mockTaskLauncher.launchTask).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceInitMode: 'minimal',
        })
      );
    });

    it('should default workspaceInitMode to full', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        // No workspaceInitMode specified
      };

      await orchestrator.dispatch(request);

      expect(mockTaskLauncher.launchTask).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceInitMode: 'full',
        })
      );
    });

    it('should pass workspaceMode correctly', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        workspaceMode: 'persistent',
      };

      await orchestrator.dispatch(request);

      expect(mockTaskLauncher.launchTask).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceMode: 'persistent',
        })
      );
    });
  });

  describe('request validation', () => {
    it('should reject empty userId', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        userId: '',
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject empty task', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        task: '',
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject task exceeding max length', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
        task: 'x'.repeat(50001),
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid agent type', async () => {
      const request = {
        ...baseDispatchRequest,
        agent: 'invalid-agent' as any,
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow(ValidationError);
    });

    it('should validate all supported agent types', async () => {
      const agents = ['claude', 'codex', 'gemini', 'aider', 'grok'] as const;

      for (const agent of agents) {
        mockDispatchRepository.create.mockResolvedValue({
          ...mockDispatchRecord,
          agent,
        });

        const request: DispatchRequest = {
          ...baseDispatchRequest,
          agent,
        };

        await expect(orchestrator.dispatch(request)).resolves.toBeDefined();
      }
    });

    it('should validate timeout range', async () => {
      // Too short
      await expect(
        orchestrator.dispatch({
          ...baseDispatchRequest,
          timeoutSeconds: 10,
        })
      ).rejects.toThrow(ValidationError);

      // Too long
      await expect(
        orchestrator.dispatch({
          ...baseDispatchRequest,
          timeoutSeconds: 100000,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('ULID generation', () => {
    it('should generate valid ULID format', () => {
      const ulid = generateUlid();

      expect(ulid).toHaveLength(26);
      expect(ulid).toMatch(/^[0-9A-Z]{26}$/);
    });

    it('should generate unique ULIDs', () => {
      const ulids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ulids.add(generateUlid());
      }

      // All ULIDs should be unique
      expect(ulids.size).toBe(100);
    });

    it('should generate 26 character strings', () => {
      for (let i = 0; i < 10; i++) {
        const ulid = generateUlid();
        expect(ulid.length).toBe(26);
      }
    });
  });

  describe('ECS task launch error handling', () => {
    it('should mark dispatch as failed when ECS launch fails', async () => {
      mockTaskLauncher.launchTask.mockRejectedValue(new Error('No capacity'));

      const request: DispatchRequest = {
        ...baseDispatchRequest,
      };

      await expect(orchestrator.dispatch(request)).rejects.toThrow();

      expect(mockDispatchRepository.markFailed).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.stringContaining('ECS launch failed')
      );
    });
  });

  describe('EventBridge cost event', () => {
    it('should emit cost event after successful launch', async () => {
      const request: DispatchRequest = {
        ...baseDispatchRequest,
      };

      await orchestrator.dispatch(request);

      // Wait for async event emission
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.any(PutEventsCommand)
      );
    });

    it('should not fail dispatch if cost event fails', async () => {
      mockEventBridgeClient.send.mockRejectedValue(new Error('EventBridge error'));

      const request: DispatchRequest = {
        ...baseDispatchRequest,
      };

      // Should not throw even if EventBridge fails
      await expect(orchestrator.dispatch(request)).resolves.toBeDefined();
    });
  });

  describe('getDispatchStatus', () => {
    it('should return dispatch record from repository', async () => {
      const expectedRecord = { ...mockDispatchRecord, status: 'RUNNING' as const };
      mockDispatchRepository.getById.mockResolvedValue(expectedRecord);

      const result = await orchestrator.getDispatchStatus('TEST123');

      expect(result).toEqual(expectedRecord);
      expect(mockDispatchRepository.getById).toHaveBeenCalledWith('TEST123');
    });
  });

  describe('cancelDispatch', () => {
    it('should throw ValidationError when cancelling completed dispatch', async () => {
      mockDispatchRepository.getById.mockResolvedValue({
        ...mockDispatchRecord,
        status: 'COMPLETED',
      });

      await expect(
        orchestrator.cancelDispatch('TEST123', 'Too late')
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when cancelling failed dispatch', async () => {
      mockDispatchRepository.getById.mockResolvedValue({
        ...mockDispatchRecord,
        status: 'FAILED',
      });

      await expect(
        orchestrator.cancelDispatch('TEST123', 'Already failed')
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when cancelling cancelled dispatch', async () => {
      mockDispatchRepository.getById.mockResolvedValue({
        ...mockDispatchRecord,
        status: 'CANCELLED',
      });

      await expect(
        orchestrator.cancelDispatch('TEST123', 'Already cancelled')
      ).rejects.toThrow(ValidationError);
    });
  });
});
