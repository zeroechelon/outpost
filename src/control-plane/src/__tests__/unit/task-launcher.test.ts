/**
 * Task Launcher Service Tests
 *
 * Tests for TaskLauncherService including resource constraints,
 * workspace mode environment injection, and ECS task overrides.
 */

import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import {
  TaskLauncherService,
  resetTaskLauncherService,
  type TaskLaunchRequest,
  type ResourceConstraints,
} from '../../services/task-launcher.js';
import { SecretInjectorService, resetSecretInjectorService } from '../../services/secret-injector.js';
import { ServiceUnavailableError, ValidationError, InternalError } from '../../utils/errors.js';

// Mock config
jest.mock('../../utils/config.js', () => ({
  getConfig: jest.fn().mockReturnValue({
    nodeEnv: 'test',
    awsRegion: 'us-east-1',
    ecs: {
      clusterArn: 'arn:aws:ecs:us-east-1:123456789:cluster/outpost-dev',
      workerSubnetIds: ['subnet-abc123', 'subnet-def456'],
      workerSecurityGroup: 'sg-123456',
    },
    s3: {
      outputBucket: 'outpost-outputs-dev',
    },
  }),
}));

// Mock task-selector
jest.mock('../../services/task-selector.js', () => ({
  selectTaskDefinition: jest.fn().mockReturnValue({
    taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789:task-definition/outpost-claude:1',
    modelId: 'claude-opus-4-5-20251101',
    tier: 'flagship',
    cpu: 2048,
    memory: 4096,
  }),
}));

describe('TaskLauncherService', () => {
  let service: TaskLauncherService;
  let mockSend: jest.Mock;
  let mockSecretInjector: jest.Mocked<SecretInjectorService>;

  const baseTaskLaunchRequest: TaskLaunchRequest = {
    dispatchId: 'TEST123ABC',
    userId: 'user-123',
    agent: 'claude',
    task: 'Write a test file',
    workspaceMode: 'ephemeral',
    workspaceInitMode: 'full',
    timeoutSeconds: 600,
  };

  const mockSuccessfulTaskResponse = {
    tasks: [
      {
        taskArn: 'arn:aws:ecs:us-east-1:123456789:task/outpost-dev/abc123def456',
        lastStatus: 'PROVISIONING',
      },
    ],
    failures: [],
  };

  beforeEach(() => {
    resetTaskLauncherService();

    mockSend = jest.fn().mockResolvedValue(mockSuccessfulTaskResponse);

    const mockECSClient = {
      send: mockSend,
    } as unknown as ECSClient;

    mockSecretInjector = {
      buildContainerSecrets: jest.fn().mockResolvedValue({
        secrets: [],
        agentType: 'claude',
        validatedAt: new Date(),
      }),
    } as unknown as jest.Mocked<SecretInjectorService>;

    service = new TaskLauncherService(mockECSClient, mockSecretInjector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('launchTask', () => {
    it('should successfully launch a task', async () => {
      const result = await service.launchTask(baseTaskLaunchRequest);

      expect(result.taskArn).toBe('arn:aws:ecs:us-east-1:123456789:task/outpost-dev/abc123def456');
      expect(result.taskId).toBe('abc123def456');
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.clusterArn).toBeDefined();
    });

    it('should call secret injector to validate secrets', async () => {
      await service.launchTask(baseTaskLaunchRequest);

      expect(mockSecretInjector.buildContainerSecrets).toHaveBeenCalledWith(
        'claude',
        'user-123',
        undefined
      );
    });

    it('should pass additional secrets to secret injector', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        additionalSecrets: ['CUSTOM_SECRET'],
      };

      await service.launchTask(request);

      expect(mockSecretInjector.buildContainerSecrets).toHaveBeenCalledWith(
        'claude',
        'user-123',
        ['CUSTOM_SECRET']
      );
    });
  });

  describe('resource constraints (T5.3)', () => {
    it('should successfully launch task with memory constraint', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        resourceConstraints: {
          maxMemoryMb: 8192,
        },
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should successfully launch task with CPU constraint', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        resourceConstraints: {
          maxCpuUnits: 4096,
        },
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should successfully launch task with disk constraint', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        resourceConstraints: {
          maxDiskGb: 100,
        },
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should successfully launch task with all constraints', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        resourceConstraints: {
          maxMemoryMb: 16384,
          maxCpuUnits: 4096,
          maxDiskGb: 150,
        },
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should successfully launch task without constraints', async () => {
      const result = await service.launchTask(baseTaskLaunchRequest);

      expect(result.taskArn).toBeDefined();
    });
  });

  describe('workspaceInitMode', () => {
    it('should accept workspaceInitMode=full', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        workspaceInitMode: 'full',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should accept workspaceInitMode=minimal', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        workspaceInitMode: 'minimal',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should accept workspaceInitMode=none', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        workspaceInitMode: 'none',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });
  });

  describe('task launch result', () => {
    it('should extract task ID from ARN correctly', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [
          {
            taskArn: 'arn:aws:ecs:us-east-1:123456789:task/cluster-name/xyz789',
          },
        ],
        failures: [],
      });

      const result = await service.launchTask(baseTaskLaunchRequest);

      expect(result.taskId).toBe('xyz789');
    });
  });

  describe('error handling', () => {
    it('should throw InternalError when no tasks returned', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [],
        failures: [],
      });

      await expect(service.launchTask(baseTaskLaunchRequest)).rejects.toThrow(
        InternalError
      );
    });

    it('should throw InternalError on non-capacity failure', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [],
        failures: [
          {
            arn: 'arn:aws:ecs:...',
            reason: 'TASK_DEFINITION_NOT_FOUND',
          },
        ],
      });

      await expect(service.launchTask(baseTaskLaunchRequest)).rejects.toThrow(
        InternalError
      );
    });

    it('should retry on capacity errors', async () => {
      // First two calls fail, third succeeds
      mockSend
        .mockResolvedValueOnce({
          tasks: [],
          failures: [{ reason: 'RESOURCE:CAPACITY' }],
        })
        .mockResolvedValueOnce({
          tasks: [],
          failures: [{ reason: 'insufficient capacity' }],
        })
        .mockResolvedValueOnce(mockSuccessfulTaskResponse);

      const result = await service.launchTask(baseTaskLaunchRequest);

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(result.taskArn).toBeDefined();
    });

    it('should throw ServiceUnavailableError after max retries', async () => {
      mockSend.mockResolvedValue({
        tasks: [],
        failures: [{ reason: 'RESOURCE:CAPACITY' }],
      });

      await expect(service.launchTask(baseTaskLaunchRequest)).rejects.toThrow(
        ServiceUnavailableError
      );

      // Should have tried 3 times (MAX_CAPACITY_RETRIES)
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('verifyTaskRunning', () => {
    it('should return true for running task', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [{ lastStatus: 'RUNNING' }],
      });

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(true);
    });

    it('should return true for pending task', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [{ lastStatus: 'PENDING' }],
      });

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(true);
    });

    it('should return true for provisioning task', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [{ lastStatus: 'PROVISIONING' }],
      });

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(true);
    });

    it('should return false for stopped task', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [{ lastStatus: 'STOPPED' }],
      });

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(false);
    });

    it('should return false when task not found', async () => {
      mockSend.mockResolvedValueOnce({
        tasks: [],
      });

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('API error'));

      const result = await service.verifyTaskRunning(
        'arn:aws:ecs:...',
        'arn:aws:ecs:cluster/...'
      );

      expect(result).toBe(false);
    });
  });

  describe('stopTask', () => {
    it('should be a callable method', () => {
      expect(typeof service.stopTask).toBe('function');
    });
  });

  describe('agent support', () => {
    it('should support claude agent', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        agent: 'claude',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should support codex agent', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        agent: 'codex',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should support gemini agent', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        agent: 'gemini',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should support aider agent', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        agent: 'aider',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should support grok agent', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        agent: 'grok',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });
  });

  describe('workspace mode', () => {
    it('should support ephemeral workspace mode', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        workspaceMode: 'ephemeral',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should support persistent workspace mode', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        workspaceMode: 'persistent',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });
  });

  describe('optional parameters', () => {
    it('should handle repoUrl parameter', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        repoUrl: 'https://github.com/owner/repo',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });

    it('should handle modelId parameter', async () => {
      const request: TaskLaunchRequest = {
        ...baseTaskLaunchRequest,
        modelId: 'claude-opus-4-5-20251101',
      };

      const result = await service.launchTask(request);

      expect(result.taskArn).toBeDefined();
    });
  });
});
