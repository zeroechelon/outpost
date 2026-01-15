/**
 * Pool Lifecycle Service - Warm pool task lifecycle management
 *
 * Manages the complete lifecycle of warm pool tasks including:
 * - Pre-warming N tasks per agent on startup
 * - Idle task TTL enforcement (default 15 minutes, configurable)
 * - Periodic health checks for idle tasks
 * - Automatic termination and replacement of unhealthy tasks
 * - Graceful shutdown with pool draining
 *
 * Integrates with WarmPoolManager for pool operations and TaskLauncherService
 * for task health verification.
 */

import {
  ECSClient,
  DescribeTasksCommand,
  StopTaskCommand,
  type Task,
} from '@aws-sdk/client-ecs';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { InternalError } from '../utils/errors.js';
import {
  WarmPoolManager,
  getWarmPoolManager,
  type PooledTask,
  type AggregatePoolMetrics,
} from './pool-manager.js';
import {
  TaskLauncherService,
  getTaskLauncherService,
  type TaskLaunchRequest,
} from './task-launcher.js';
import { PoolRepository, type PoolTaskRecord } from '../repositories/pool.repository.js';
import type { AgentType } from '../types/agent.js';

/**
 * Configuration for pool lifecycle management
 */
export interface PoolLifecycleConfig {
  readonly targetPoolSize: number; // per agent
  readonly idleTimeoutMinutes: number;
  readonly healthCheckIntervalSeconds: number;
  readonly warmupOnStartup: boolean;
}

/**
 * Health status for a single task
 */
export interface TaskHealthStatus {
  readonly taskArn: string;
  readonly agentType: AgentType;
  readonly healthy: boolean;
  readonly lastHealthCheck: Date;
  readonly failureReason?: string;
}

/**
 * Overall pool health status
 */
export interface PoolHealthStatus {
  readonly healthy: boolean;
  readonly totalTasks: number;
  readonly healthyTasks: number;
  readonly unhealthyTasks: number;
  readonly lastHealthCheck: Date;
  readonly unhealthyTaskDetails: TaskHealthStatus[];
  readonly metrics: AggregatePoolMetrics;
}

/**
 * AWS constants
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';

/**
 * Default configuration values
 */
const DEFAULT_TARGET_POOL_SIZE = 2;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;
const DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS = 60;
const DEFAULT_WARMUP_ON_STARTUP = true;

/**
 * Supported agent types for lifecycle management
 */
const SUPPORTED_AGENTS: readonly AgentType[] = ['claude', 'codex', 'gemini', 'aider', 'grok'];

/**
 * Valid ECS task statuses indicating a running/healthy task
 */
const HEALTHY_TASK_STATUSES = new Set(['RUNNING', 'PENDING', 'PROVISIONING']);

/**
 * PoolLifecycleService - Manages warm pool task lifecycle
 */
export class PoolLifecycleService {
  private readonly logger = getLogger().child({ service: 'PoolLifecycleService' });
  private readonly ecsClient: ECSClient;
  private readonly warmPoolManager: WarmPoolManager;
  private readonly taskLauncher: TaskLauncherService;
  private readonly poolRepository: PoolRepository;
  private readonly config: PoolLifecycleConfig;

  // Health check interval handle
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Track health status per task
  private readonly taskHealthCache: Map<string, TaskHealthStatus> = new Map();

  // Lifecycle state
  private initialized = false;
  private shuttingDown = false;

  constructor(
    ecsClient?: ECSClient,
    warmPoolManager?: WarmPoolManager,
    taskLauncher?: TaskLauncherService,
    poolRepository?: PoolRepository,
    config?: Partial<PoolLifecycleConfig>
  ) {
    const appConfig = getConfig();
    this.ecsClient = ecsClient ?? new ECSClient({ region: appConfig.awsRegion });
    this.warmPoolManager = warmPoolManager ?? getWarmPoolManager();
    this.taskLauncher = taskLauncher ?? getTaskLauncherService();
    this.poolRepository = poolRepository ?? new PoolRepository();

    // Load configuration from environment with provided overrides
    this.config = {
      targetPoolSize: config?.targetPoolSize ??
        parseInt(process.env['POOL_TARGET_SIZE'] ?? String(DEFAULT_TARGET_POOL_SIZE), 10),
      idleTimeoutMinutes: config?.idleTimeoutMinutes ??
        parseInt(process.env['POOL_IDLE_TIMEOUT_MINUTES'] ?? String(DEFAULT_IDLE_TIMEOUT_MINUTES), 10),
      healthCheckIntervalSeconds: config?.healthCheckIntervalSeconds ??
        parseInt(process.env['POOL_HEALTH_CHECK_INTERVAL_SECONDS'] ?? String(DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS), 10),
      warmupOnStartup: config?.warmupOnStartup ??
        (process.env['POOL_WARMUP_ON_STARTUP'] !== 'false'),
    };

    this.logger.info(
      {
        targetPoolSize: this.config.targetPoolSize,
        idleTimeoutMinutes: this.config.idleTimeoutMinutes,
        healthCheckIntervalSeconds: this.config.healthCheckIntervalSeconds,
        warmupOnStartup: this.config.warmupOnStartup,
      },
      'PoolLifecycleService created'
    );
  }

  /**
   * Initialize the pool lifecycle service.
   * Pre-warms pools on startup if configured to do so.
   *
   * @returns Number of tasks pre-warmed
   */
  async initialize(): Promise<number> {
    if (this.initialized) {
      this.logger.warn('PoolLifecycleService already initialized');
      return 0;
    }

    this.logger.info('Initializing PoolLifecycleService');

    let warmedCount = 0;

    if (this.config.warmupOnStartup) {
      this.logger.info(
        { targetPoolSize: this.config.targetPoolSize, agents: SUPPORTED_AGENTS },
        'Pre-warming pools on startup'
      );

      for (const agentType of SUPPORTED_AGENTS) {
        try {
          const count = await this.warmPoolForAgent(agentType);
          warmedCount += count;
        } catch (error) {
          this.logger.error(
            { agentType, error },
            'Failed to pre-warm pool for agent during initialization'
          );
          // Continue with other agents
        }
      }

      this.logger.info({ warmedCount }, 'Pool pre-warming completed');
    }

    this.initialized = true;
    return warmedCount;
  }

  /**
   * Start periodic health check monitoring for idle tasks.
   * Health checks run at the configured interval and will:
   * - Verify ECS task status via DescribeTasks
   * - Terminate unhealthy tasks
   * - Replace terminated tasks to maintain pool size
   * - Enforce idle timeout TTL
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval !== null) {
      this.logger.warn('Health checks already running');
      return;
    }

    if (this.shuttingDown) {
      this.logger.warn('Cannot start health checks during shutdown');
      return;
    }

    const intervalMs = this.config.healthCheckIntervalSeconds * 1000;

    this.logger.info(
      { intervalSeconds: this.config.healthCheckIntervalSeconds },
      'Starting health check monitoring'
    );

    // Run initial health check immediately
    void this.runHealthCheckCycle();

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      void this.runHealthCheckCycle();
    }, intervalMs);
  }

  /**
   * Stop health check monitoring.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval === null) {
      this.logger.debug('Health checks not running');
      return;
    }

    this.logger.info('Stopping health check monitoring');
    clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = null;
  }

  /**
   * Check health of a single task.
   *
   * @param taskArn - The ECS task ARN to check
   * @returns TaskHealthStatus with health information
   */
  async checkTaskHealth(taskArn: string): Promise<TaskHealthStatus> {
    // Find the task in the pool to get agent type
    let agentType: AgentType | undefined;
    for (const agent of SUPPORTED_AGENTS) {
      const tasks = await this.poolRepository.listByAgent(agent);
      const found = tasks.find((t) => t.taskArn === taskArn);
      if (found !== undefined) {
        agentType = agent;
        break;
      }
    }

    if (agentType === undefined) {
      const status: TaskHealthStatus = {
        taskArn,
        agentType: 'claude', // Default, though task not found
        healthy: false,
        lastHealthCheck: new Date(),
        failureReason: 'Task not found in pool',
      };
      return status;
    }

    return this.checkSingleTaskHealth(agentType, taskArn);
  }

  /**
   * Replace an unhealthy task with a new one.
   * Terminates the unhealthy task and provisions a replacement.
   *
   * @param agentType - The agent type for the replacement task
   * @returns The new task ARN if successful
   */
  async replaceUnhealthyTask(agentType: AgentType): Promise<string | null> {
    if (this.shuttingDown) {
      this.logger.warn({ agentType }, 'Cannot replace task during shutdown');
      return null;
    }

    this.logger.info({ agentType }, 'Replacing unhealthy task');

    try {
      // Provision a new task
      const newTaskArn = await this.provisionPoolTask(agentType);

      this.logger.info(
        { agentType, newTaskArn },
        'Successfully replaced unhealthy task'
      );

      return newTaskArn;
    } catch (error) {
      this.logger.error(
        { agentType, error },
        'Failed to replace unhealthy task'
      );
      return null;
    }
  }

  /**
   * Gracefully drain the pool during shutdown.
   * Stops health checks and terminates all idle tasks.
   *
   * @returns Number of tasks drained
   */
  async drainPool(): Promise<number> {
    this.logger.info('Initiating pool drain for graceful shutdown');
    this.shuttingDown = true;

    // Stop health checks first
    this.stopHealthChecks();

    let drainedCount = 0;

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        const tasks = await this.poolRepository.listByAgent(agentType);

        for (const task of tasks) {
          // Only drain idle tasks; in_use tasks are still executing
          if (task.status === 'idle') {
            try {
              await this.terminateTask(agentType, task.taskArn);
              drainedCount++;
              this.logger.debug(
                { agentType, taskArn: task.taskArn },
                'Drained idle task'
              );
            } catch (error) {
              this.logger.error(
                { agentType, taskArn: task.taskArn, error },
                'Failed to drain task'
              );
            }
          }
        }
      } catch (error) {
        this.logger.error({ agentType, error }, 'Failed to list tasks for draining');
      }
    }

    this.logger.info({ drainedCount }, 'Pool drain completed');
    return drainedCount;
  }

  /**
   * Get overall pool health status.
   *
   * @returns PoolHealthStatus with aggregate health information
   */
  async getPoolHealth(): Promise<PoolHealthStatus> {
    const now = new Date();
    const unhealthyDetails: TaskHealthStatus[] = [];
    let totalTasks = 0;
    let healthyTasks = 0;
    let unhealthyTasks = 0;

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        const tasks = await this.poolRepository.listByAgent(agentType);

        for (const task of tasks) {
          totalTasks++;

          // Check cache first
          const cached = this.taskHealthCache.get(task.taskArn);
          if (cached !== undefined && cached.healthy) {
            healthyTasks++;
          } else if (cached !== undefined && !cached.healthy) {
            unhealthyTasks++;
            unhealthyDetails.push(cached);
          } else {
            // No cached status, perform fresh check
            const status = await this.checkSingleTaskHealth(agentType, task.taskArn);
            if (status.healthy) {
              healthyTasks++;
            } else {
              unhealthyTasks++;
              unhealthyDetails.push(status);
            }
          }
        }
      } catch (error) {
        this.logger.error({ agentType, error }, 'Failed to check pool health for agent');
      }
    }

    // Get aggregate metrics from WarmPoolManager
    const metrics = await this.warmPoolManager.getAggregateMetrics();

    const overallHealthy = unhealthyTasks === 0 && totalTasks > 0;

    return {
      healthy: overallHealthy,
      totalTasks,
      healthyTasks,
      unhealthyTasks,
      lastHealthCheck: now,
      unhealthyTaskDetails: unhealthyDetails,
      metrics,
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): PoolLifecycleConfig {
    return { ...this.config };
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if the service is shutting down
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Run a complete health check cycle for all pool tasks
   */
  private async runHealthCheckCycle(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.logger.debug('Running health check cycle');

    const now = Date.now();
    const idleTimeoutMs = this.config.idleTimeoutMinutes * 60 * 1000;

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        const tasks = await this.poolRepository.listByAgent(agentType);

        for (const task of tasks) {
          // Skip tasks that are terminating
          if (task.status === 'terminating') {
            continue;
          }

          // Check idle timeout for idle tasks
          if (task.status === 'idle') {
            const idleMs = now - task.lastUsedAt.getTime();
            if (idleMs > idleTimeoutMs) {
              this.logger.info(
                {
                  agentType,
                  taskArn: task.taskArn,
                  idleMinutes: Math.floor(idleMs / 60000),
                  timeoutMinutes: this.config.idleTimeoutMinutes,
                },
                'Task exceeded idle timeout, terminating'
              );

              await this.terminateAndReplace(agentType, task.taskArn, 'idle timeout exceeded');
              continue;
            }
          }

          // Perform health check on the task
          const healthStatus = await this.checkSingleTaskHealth(agentType, task.taskArn);

          if (!healthStatus.healthy) {
            this.logger.warn(
              {
                agentType,
                taskArn: task.taskArn,
                failureReason: healthStatus.failureReason,
              },
              'Unhealthy task detected'
            );

            // Terminate and replace unhealthy task
            await this.terminateAndReplace(
              agentType,
              task.taskArn,
              healthStatus.failureReason ?? 'health check failed'
            );
          }
        }

        // Ensure pool is at target size after health checks
        await this.ensurePoolSize(agentType);
      } catch (error) {
        this.logger.error({ agentType, error }, 'Error during health check cycle');
      }
    }
  }

  /**
   * Check health of a single task via ECS DescribeTasks
   */
  private async checkSingleTaskHealth(
    agentType: AgentType,
    taskArn: string
  ): Promise<TaskHealthStatus> {
    const now = new Date();

    try {
      const clusterArn = this.buildClusterArn();

      const response = await this.ecsClient.send(
        new DescribeTasksCommand({
          cluster: clusterArn,
          tasks: [taskArn],
        })
      );

      // Check if task exists
      if (!response.tasks || response.tasks.length === 0) {
        const status: TaskHealthStatus = {
          taskArn,
          agentType,
          healthy: false,
          lastHealthCheck: now,
          failureReason: 'Task not found in ECS',
        };
        this.taskHealthCache.set(taskArn, status);
        return status;
      }

      const task = response.tasks[0] as Task;
      const taskStatus = task.lastStatus ?? 'UNKNOWN';

      // Check if task is in a healthy state
      const isHealthy = HEALTHY_TASK_STATUSES.has(taskStatus);

      let failureReason: string | undefined;
      if (!isHealthy) {
        failureReason = `Task status: ${taskStatus}`;

        // Check for stop reason
        if (task.stoppedReason !== undefined) {
          failureReason += ` (${task.stoppedReason})`;
        }
      }

      // Check container health if available
      if (isHealthy && task.containers && task.containers.length > 0) {
        const container = task.containers[0];
        if (container !== undefined) {
          const containerStatus = container.lastStatus;
          if (containerStatus === 'STOPPED') {
            failureReason = `Container stopped: ${container.reason ?? 'unknown reason'}`;
          }
        }
      }

      const status: TaskHealthStatus = {
        taskArn,
        agentType,
        healthy: isHealthy && failureReason === undefined,
        lastHealthCheck: now,
        ...(failureReason !== undefined ? { failureReason } : {}),
      };

      this.taskHealthCache.set(taskArn, status);
      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const status: TaskHealthStatus = {
        taskArn,
        agentType,
        healthy: false,
        lastHealthCheck: now,
        failureReason: `Health check error: ${errorMessage}`,
      };
      this.taskHealthCache.set(taskArn, status);
      return status;
    }
  }

  /**
   * Terminate a task and replace it to maintain pool size
   */
  private async terminateAndReplace(
    agentType: AgentType,
    taskArn: string,
    reason: string
  ): Promise<void> {
    try {
      // Terminate the unhealthy task
      await this.terminateTask(agentType, taskArn);

      // Remove from health cache
      this.taskHealthCache.delete(taskArn);

      // Replace to maintain pool size
      await this.replaceUnhealthyTask(agentType);
    } catch (error) {
      this.logger.error(
        { agentType, taskArn, reason, error },
        'Failed to terminate and replace task'
      );
    }
  }

  /**
   * Terminate a task via ECS StopTask and remove from pool
   */
  private async terminateTask(agentType: AgentType, taskArn: string): Promise<void> {
    try {
      // Mark as terminating in pool
      await this.poolRepository.markTerminating(agentType, taskArn);

      const clusterArn = this.buildClusterArn();

      // Stop the ECS task
      await this.ecsClient.send(
        new StopTaskCommand({
          cluster: clusterArn,
          task: taskArn,
          reason: 'Pool lifecycle management: task terminated',
        })
      );

      // Delete from pool (TTL will also handle cleanup)
      await this.poolRepository.delete(agentType, taskArn);

      this.logger.info({ agentType, taskArn }, 'Task terminated');
    } catch (error) {
      this.logger.error({ agentType, taskArn, error }, 'Failed to terminate task');
      throw error;
    }
  }

  /**
   * Ensure pool is at target size for an agent type
   */
  private async ensurePoolSize(agentType: AgentType): Promise<void> {
    const currentIdle = await this.poolRepository.countByAgent(agentType, 'idle');
    const currentInUse = await this.poolRepository.countByAgent(agentType, 'in_use');
    const total = currentIdle + currentInUse;
    const toProvision = Math.max(0, this.config.targetPoolSize - total);

    if (toProvision > 0) {
      this.logger.debug(
        { agentType, currentIdle, currentInUse, total, targetSize: this.config.targetPoolSize, toProvision },
        'Pool below target size, provisioning tasks'
      );

      for (let i = 0; i < toProvision; i++) {
        try {
          await this.provisionPoolTask(agentType);
        } catch (error) {
          this.logger.error(
            { agentType, error },
            'Failed to provision replacement task'
          );
        }
      }
    }
  }

  /**
   * Warm pool for a specific agent type to target size
   */
  private async warmPoolForAgent(agentType: AgentType): Promise<number> {
    const currentIdle = await this.poolRepository.countByAgent(agentType, 'idle');
    const toProvision = Math.max(0, this.config.targetPoolSize - currentIdle);

    if (toProvision === 0) {
      this.logger.debug(
        { agentType, currentIdle, targetSize: this.config.targetPoolSize },
        'Pool already at target size'
      );
      return 0;
    }

    this.logger.info(
      { agentType, currentIdle, targetSize: this.config.targetPoolSize, toProvision },
      'Warming pool for agent'
    );

    let provisioned = 0;
    for (let i = 0; i < toProvision; i++) {
      try {
        await this.provisionPoolTask(agentType);
        provisioned++;
      } catch (error) {
        this.logger.error(
          { agentType, error, provisioned, toProvision },
          'Failed to provision pool task during warm-up'
        );
      }
    }

    return provisioned;
  }

  /**
   * Provision a new task for the pool
   */
  private async provisionPoolTask(agentType: AgentType): Promise<string> {
    this.logger.debug({ agentType }, 'Provisioning new pool task');

    // Create a placeholder dispatch request for pool warming
    const poolWarmRequest: TaskLaunchRequest = {
      dispatchId: `pool-lifecycle-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      userId: 'system',
      agent: agentType,
      task: 'pool-warm', // Worker recognizes this as idle/standby mode
      workspaceMode: 'ephemeral',
      workspaceInitMode: 'none', // Pool warm tasks don't need workspace
      timeoutSeconds: 3600,
    };

    const result = await this.taskLauncher.launchTask(poolWarmRequest);

    // Register task in pool as idle
    await this.poolRepository.create({
      agentType,
      taskArn: result.taskArn,
      instanceType: 'fargate',
    });

    this.logger.info(
      { agentType, taskArn: result.taskArn },
      'Pool task provisioned'
    );

    return result.taskArn;
  }

  /**
   * Build cluster ARN from environment
   */
  private buildClusterArn(): string {
    const appConfig = getConfig();
    if (appConfig.ecs.clusterArn !== undefined) {
      return appConfig.ecs.clusterArn;
    }
    const env = appConfig.nodeEnv === 'production' ? 'prod' : 'dev';
    return `arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/outpost-${env}`;
  }
}

// ============================================================================
// Singleton management
// ============================================================================

let serviceInstance: PoolLifecycleService | null = null;

/**
 * Get singleton PoolLifecycleService instance
 */
export function getPoolLifecycleService(): PoolLifecycleService {
  if (serviceInstance === null) {
    serviceInstance = new PoolLifecycleService();
  }
  return serviceInstance;
}

/**
 * Reset singleton for testing
 */
export function resetPoolLifecycleService(): void {
  if (serviceInstance !== null) {
    serviceInstance.stopHealthChecks();
  }
  serviceInstance = null;
}
