/**
 * Task Launcher Service - ECS RunTask API integration for the control plane
 *
 * Launches Fargate tasks for agent execution with proper network configuration,
 * secret injection, and environment variable overrides. Handles capacity errors
 * with AZ failover retry logic.
 *
 * Uses AWS SDK v3 ECSClient for all ECS operations.
 */

import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  type RunTaskCommandInput,
  type KeyValuePair,
  type ContainerOverride,
} from '@aws-sdk/client-ecs';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { ServiceUnavailableError, ValidationError, InternalError } from '../utils/errors.js';
import { selectTaskDefinition, type TaskSelectionResult } from './task-selector.js';
import { SecretInjectorService, getSecretInjectorService } from './secret-injector.js';
import type { AgentType } from '../types/agent.js';

/**
 * T5.3: Resource constraints for ECS task overrides
 */
export interface ResourceConstraints {
  readonly maxMemoryMb?: number;
  readonly maxCpuUnits?: number;
  readonly maxDiskGb?: number;
}

/**
 * Request parameters for launching an ECS task
 */
export interface TaskLaunchRequest {
  readonly dispatchId: string;
  readonly userId: string;
  readonly agent: AgentType;
  readonly modelId?: string;
  readonly task: string;
  readonly repoUrl?: string;
  readonly workspaceMode: 'ephemeral' | 'persistent';
  readonly workspaceInitMode: 'full' | 'minimal' | 'none';
  readonly timeoutSeconds: number;
  readonly additionalSecrets?: readonly string[];
  // T5.3: Resource constraints for ECS task overrides
  readonly resourceConstraints?: ResourceConstraints;
}

/**
 * Result of a successful task launch
 */
export interface TaskLaunchResult {
  readonly taskArn: string;
  readonly taskId: string;
  readonly startedAt: Date;
  readonly clusterArn: string;
}

/**
 * AWS constants
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';

/**
 * Container name in ECS task definition
 */
const AGENT_CONTAINER_NAME = 'agent';

/**
 * Maximum retry attempts for capacity errors
 */
const MAX_CAPACITY_RETRIES = 3;

/**
 * Delay between retry attempts (ms)
 */
const RETRY_DELAY_MS = 2000;

/**
 * Extracts task ID from task ARN
 * ARN format: arn:aws:ecs:region:account:task/cluster/task-id
 */
function extractTaskId(taskArn: string): string {
  const parts = taskArn.split('/');
  const taskId = parts[parts.length - 1];
  if (taskId === undefined || taskId === '') {
    throw new InternalError('Failed to extract task ID from ARN', { taskArn });
  }
  return taskId;
}

/**
 * Builds the cluster ARN from environment configuration
 */
function buildClusterArn(env: string): string {
  return `arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/outpost-${env}`;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * TaskLauncherService - Handles ECS Fargate task launching for agent execution
 */
export class TaskLauncherService {
  private readonly logger = getLogger().child({ service: 'TaskLauncherService' });
  private readonly client: ECSClient;
  private readonly secretInjector: SecretInjectorService;
  private readonly env: string;

  constructor(client?: ECSClient, secretInjector?: SecretInjectorService) {
    const config = getConfig();
    this.env = config.nodeEnv === 'production' ? 'prod' : 'dev';
    this.client =
      client ??
      new ECSClient({
        region: config.awsRegion,
      });
    this.secretInjector = secretInjector ?? getSecretInjectorService();
  }

  /**
   * Launch an ECS Fargate task for agent execution
   *
   * @param request - Task launch parameters
   * @returns TaskLaunchResult with task ARN and metadata
   * @throws ServiceUnavailableError if no capacity after retries
   * @throws ValidationError if request parameters are invalid
   */
  async launchTask(request: TaskLaunchRequest): Promise<TaskLaunchResult> {
    this.logger.info(
      {
        dispatchId: request.dispatchId,
        agent: request.agent,
        userId: request.userId,
        workspaceMode: request.workspaceMode,
      },
      'Launching ECS task'
    );

    // Select task definition and get resource configuration
    const taskSelection = selectTaskDefinition(request.agent, request.modelId);

    this.logger.debug(
      {
        taskDefinitionArn: taskSelection.taskDefinitionArn,
        cpu: taskSelection.cpu,
        memory: taskSelection.memory,
        modelId: taskSelection.modelId,
        tier: taskSelection.tier,
      },
      'Task definition selected'
    );

    // Validate container secrets exist in Secrets Manager before launching
    // Note: Secrets are injected via the ECS task definition, not at runtime.
    // This validation ensures all required secrets are present before we launch.
    await this.secretInjector.buildContainerSecrets(
      request.agent,
      request.userId,
      request.additionalSecrets
    );

    this.logger.debug({ agent: request.agent }, 'Container secrets validated');

    // Attempt task launch with retry logic for capacity errors
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_CAPACITY_RETRIES; attempt++) {
      try {
        const result = await this.attemptTaskLaunch(request, taskSelection, attempt);
        return result;
      } catch (error) {
        lastError = error as Error;

        if (this.isCapacityError(error)) {
          this.logger.warn(
            { attempt, maxRetries: MAX_CAPACITY_RETRIES, error: (error as Error).message },
            'Capacity error, retrying with different AZ'
          );

          if (attempt < MAX_CAPACITY_RETRIES) {
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
        } else {
          // Non-capacity error, don't retry
          throw error;
        }
      }
    }

    // All retries exhausted
    throw new ServiceUnavailableError('Failed to launch task after capacity retries', {
      dispatchId: request.dispatchId,
      agent: request.agent,
      attempts: MAX_CAPACITY_RETRIES,
      lastError: lastError?.message,
    });
  }

  /**
   * Attempt a single task launch
   *
   * Note on secrets: ECS Fargate does not support runtime secret injection
   * via ContainerOverride. Secrets must be defined in the task definition
   * and are validated before launch via SecretInjectorService.
   */
  private async attemptTaskLaunch(
    request: TaskLaunchRequest,
    taskSelection: TaskSelectionResult,
    attempt: number
  ): Promise<TaskLaunchResult> {
    const config = getConfig();
    const clusterArn = config.ecs.clusterArn ?? buildClusterArn(this.env);

    // Build environment variables
    const environment = this.buildEnvironmentVariables(request, taskSelection);

    // T5.3: Apply resource constraints if provided, otherwise use task selection defaults
    const constraints = request.resourceConstraints;
    const effectiveCpu = constraints?.maxCpuUnits ?? taskSelection.cpu;
    const effectiveMemory = constraints?.maxMemoryMb ?? taskSelection.memory;

    // Build container overrides (environment and resources only, secrets are in task definition)
    // Note: Container name matches the agent name in the task definition
    const containerOverride: ContainerOverride = {
      name: request.agent,
      environment,
      cpu: effectiveCpu,
      memory: effectiveMemory,
    };

    // Get network configuration
    const subnets = this.getSubnetsForAttempt(config.ecs.workerSubnetIds, attempt);
    const securityGroups = config.ecs.workerSecurityGroup
      ? [config.ecs.workerSecurityGroup]
      : [];

    if (subnets.length === 0) {
      throw new ValidationError('No subnets configured for ECS workers', {
        configKey: 'ECS_WORKER_SUBNET_IDS',
      });
    }

    // Build RunTask command
    const runTaskInput: RunTaskCommandInput = {
      taskDefinition: taskSelection.taskDefinitionArn,
      cluster: clusterArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [containerOverride],
        cpu: effectiveCpu.toString(),
        memory: effectiveMemory.toString(),
        // T5.3: Apply ephemeral storage constraint if provided
        ...(constraints?.maxDiskGb !== undefined && {
          ephemeralStorage: {
            sizeInGiB: constraints.maxDiskGb,
          },
        }),
      },
      tags: [
        { key: 'dispatchId', value: request.dispatchId },
        { key: 'agent', value: request.agent },
        { key: 'userId', value: request.userId },
        { key: 'environment', value: this.env },
      ],
      enableExecuteCommand: this.env !== 'prod',
      propagateTags: 'TASK_DEFINITION',
    };

    this.logger.debug(
      {
        cluster: clusterArn,
        taskDefinition: taskSelection.taskDefinitionArn,
        subnets,
        attempt,
      },
      'Executing RunTask command'
    );

    const response = await this.client.send(new RunTaskCommand(runTaskInput));

    // Check for failures in response
    if (response.failures && response.failures.length > 0) {
      const failure = response.failures[0];
      const reason = failure?.reason ?? 'Unknown failure';
      const arn = failure?.arn ?? 'unknown';

      this.logger.error({ failures: response.failures }, 'Task launch failed');

      // Check if this is a capacity-related failure
      if (this.isCapacityFailureReason(reason)) {
        throw new ServiceUnavailableError(`Capacity error: ${reason}`, {
          arn,
          reason,
        });
      }

      throw new InternalError(`Task launch failed: ${reason}`, {
        arn,
        reason,
      });
    }

    // Validate task was created
    if (!response.tasks || response.tasks.length === 0) {
      throw new InternalError('No tasks returned from RunTask', {
        dispatchId: request.dispatchId,
      });
    }

    const task = response.tasks[0];
    if (task === undefined || task.taskArn === undefined) {
      throw new InternalError('Invalid task response from RunTask', {
        dispatchId: request.dispatchId,
      });
    }

    const taskArn = task.taskArn;
    const taskId = extractTaskId(taskArn);
    const startedAt = new Date();

    this.logger.info(
      {
        taskArn,
        taskId,
        dispatchId: request.dispatchId,
        agent: request.agent,
        startedAt: startedAt.toISOString(),
      },
      'ECS task launched successfully'
    );

    return {
      taskArn,
      taskId,
      startedAt,
      clusterArn,
    };
  }

  /**
   * Build environment variables for the container
   */
  private buildEnvironmentVariables(
    request: TaskLaunchRequest,
    taskSelection: TaskSelectionResult
  ): KeyValuePair[] {
    const config = getConfig();

    const env: KeyValuePair[] = [
      { name: 'DISPATCH_ID', value: request.dispatchId },
      { name: 'AGENT_TYPE', value: request.agent },
      { name: 'MODEL_ID', value: taskSelection.modelId },
      { name: 'TASK', value: request.task },
      { name: 'WORKSPACE_MODE', value: request.workspaceMode },
      { name: 'WORKSPACE_INIT_MODE', value: request.workspaceInitMode },
      { name: 'TIMEOUT_SECONDS', value: request.timeoutSeconds.toString() },
      { name: 'OUTPUT_BUCKET', value: config.s3.outputBucket },
      { name: 'USER_ID', value: request.userId },
      { name: 'AWS_REGION', value: config.awsRegion },
    ];

    // Add optional repository URL
    if (request.repoUrl !== undefined && request.repoUrl !== '') {
      env.push({ name: 'REPO_URL', value: request.repoUrl });
    }

    // Add environment identifier
    env.push({ name: 'OUTPOST_ENV', value: this.env });

    return env;
  }

  /**
   * Get subnets for a specific retry attempt
   * Rotates through subnets to try different AZs on capacity failures
   */
  private getSubnetsForAttempt(allSubnets: readonly string[], attempt: number): string[] {
    if (allSubnets.length === 0) {
      return [];
    }

    if (allSubnets.length === 1) {
      return [...allSubnets];
    }

    // Rotate subnet order based on attempt number
    const rotateBy = (attempt - 1) % allSubnets.length;
    const rotated = [...allSubnets.slice(rotateBy), ...allSubnets.slice(0, rotateBy)];

    return rotated;
  }

  /**
   * Check if an error is a capacity-related error
   */
  private isCapacityError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const capacityPatterns = [
      'RESOURCE:CAPACITY',
      'capacity',
      'Capacity',
      'no available capacity',
      'insufficient capacity',
    ];

    return capacityPatterns.some(
      (pattern) => error.message.includes(pattern) || error.name.includes(pattern)
    );
  }

  /**
   * Check if a failure reason indicates capacity issues
   */
  private isCapacityFailureReason(reason: string): boolean {
    const capacityPatterns = [
      'RESOURCE:CAPACITY',
      'capacity',
      'Capacity',
      'RESOURCE:MEMORY',
      'RESOURCE:CPU',
    ];

    return capacityPatterns.some((pattern) => reason.includes(pattern));
  }

  /**
   * Verify a task is running by describing it
   * Useful for health checks and status verification
   *
   * @param taskArn - The task ARN to verify
   * @param clusterArn - The cluster ARN
   * @returns true if task exists and is in RUNNING or PENDING state
   */
  async verifyTaskRunning(taskArn: string, clusterArn: string): Promise<boolean> {
    try {
      const response = await this.client.send(
        new DescribeTasksCommand({
          cluster: clusterArn,
          tasks: [taskArn],
        })
      );

      if (!response.tasks || response.tasks.length === 0) {
        return false;
      }

      const task = response.tasks[0];
      const status = task?.lastStatus;

      return status === 'RUNNING' || status === 'PENDING' || status === 'PROVISIONING';
    } catch (error) {
      this.logger.error({ taskArn, error }, 'Failed to verify task status');
      return false;
    }
  }

  /**
   * Stop a running task
   *
   * @param taskArn - The task ARN to stop
   * @param clusterArn - The cluster ARN
   * @param reason - Reason for stopping the task
   */
  async stopTask(taskArn: string, clusterArn: string, reason: string): Promise<void> {
    const { StopTaskCommand } = await import('@aws-sdk/client-ecs');

    this.logger.info({ taskArn, reason }, 'Stopping ECS task');

    await this.client.send(
      new StopTaskCommand({
        cluster: clusterArn,
        task: taskArn,
        reason,
      })
    );

    this.logger.info({ taskArn }, 'ECS task stopped');
  }
}

/**
 * Export singleton-friendly factory
 */
let serviceInstance: TaskLauncherService | null = null;

export function getTaskLauncherService(): TaskLauncherService {
  if (serviceInstance === null) {
    serviceInstance = new TaskLauncherService();
  }
  return serviceInstance;
}

/**
 * For testing - allows resetting the service instance
 */
export function resetTaskLauncherService(): void {
  serviceInstance = null;
}
