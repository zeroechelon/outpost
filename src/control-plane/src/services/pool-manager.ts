/**
 * Warm Pool Manager Service - Manages warm pool of pre-provisioned Fargate tasks
 *
 * Maintains a pool of idle Fargate tasks per agent type for fast cold starts.
 * Uses DynamoDB for state persistence via PoolRepository. Integrates with
 * TaskLauncherService for provisioning new tasks.
 *
 * Pool Task States:
 * - idle: Available for dispatch
 * - in_use: Currently executing a dispatch
 * - terminating: Marked for cleanup
 */

import {
  ECSClient,
  StopTaskCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { InternalError, NotFoundError } from '../utils/errors.js';
import { PoolRepository, type PoolTaskRecord, type PoolTaskStatus } from '../repositories/pool.repository.js';
import { TaskLauncherService, getTaskLauncherService, type TaskLaunchRequest } from './task-launcher.js';
import type { AgentType } from '../types/agent.js';

/**
 * Pooled task representation
 */
export interface PooledTask {
  readonly taskArn: string;
  readonly agentType: AgentType;
  readonly status: PoolTaskStatus;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
}

/**
 * Pool metrics per agent type
 */
export interface PoolMetrics {
  readonly agentType: AgentType;
  readonly totalTasks: number;
  readonly idleTasks: number;
  readonly inUseTasks: number;
  readonly averageWaitTime: number; // ms
}

/**
 * Aggregate pool metrics across all agent types
 */
export interface AggregatePoolMetrics {
  readonly totalTasks: number;
  readonly idleTasks: number;
  readonly inUseTasks: number;
  readonly terminatingTasks: number;
  readonly byAgent: PoolMetrics[];
}

/**
 * Pool configuration
 */
export interface PoolConfig {
  readonly poolSizePerAgent: number;
  readonly idleTimeoutMinutes: number;
  readonly scaleUpThreshold: number;  // Acquire rate triggering scale-up
  readonly scaleDownThreshold: number; // Idle rate triggering scale-down
}

/**
 * AWS constants
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';

/**
 * Default configuration values
 */
const DEFAULT_POOL_SIZE_PER_AGENT = 2;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;
const DEFAULT_SCALE_UP_THRESHOLD = 0.8;  // 80% utilization
const DEFAULT_SCALE_DOWN_THRESHOLD = 0.2; // 20% utilization

/**
 * Supported agent types for warm pool
 */
const SUPPORTED_AGENTS: readonly AgentType[] = ['claude', 'codex', 'gemini', 'aider', 'grok'];

/**
 * WarmPoolManager - Manages pre-provisioned Fargate task pool for fast dispatch
 */
export class WarmPoolManager {
  private readonly logger = getLogger().child({ service: 'WarmPoolManager' });
  private readonly ecsClient: ECSClient;
  private readonly poolRepository: PoolRepository;
  private readonly taskLauncher: TaskLauncherService;
  private readonly config: PoolConfig;

  // Demand tracking for auto-scaling
  private readonly acquireTimestamps: Map<AgentType, number[]> = new Map();
  private readonly waitTimes: Map<AgentType, number[]> = new Map();

  constructor(
    ecsClient?: ECSClient,
    poolRepository?: PoolRepository,
    taskLauncher?: TaskLauncherService
  ) {
    const appConfig = getConfig();
    this.ecsClient = ecsClient ?? new ECSClient({ region: appConfig.awsRegion });
    this.poolRepository = poolRepository ?? new PoolRepository();
    this.taskLauncher = taskLauncher ?? getTaskLauncherService();

    // Load pool configuration from environment
    this.config = {
      poolSizePerAgent: parseInt(process.env['POOL_SIZE_PER_AGENT'] ?? String(DEFAULT_POOL_SIZE_PER_AGENT), 10),
      idleTimeoutMinutes: parseInt(process.env['POOL_IDLE_TIMEOUT_MINUTES'] ?? String(DEFAULT_IDLE_TIMEOUT_MINUTES), 10),
      scaleUpThreshold: parseFloat(process.env['POOL_SCALE_UP_THRESHOLD'] ?? String(DEFAULT_SCALE_UP_THRESHOLD)),
      scaleDownThreshold: parseFloat(process.env['POOL_SCALE_DOWN_THRESHOLD'] ?? String(DEFAULT_SCALE_DOWN_THRESHOLD)),
    };

    this.logger.info(
      {
        poolSizePerAgent: this.config.poolSizePerAgent,
        idleTimeoutMinutes: this.config.idleTimeoutMinutes,
      },
      'WarmPoolManager initialized'
    );

    // Initialize demand tracking maps
    for (const agent of SUPPORTED_AGENTS) {
      this.acquireTimestamps.set(agent, []);
      this.waitTimes.set(agent, []);
    }
  }

  /**
   * Acquire an idle task from the pool for the specified agent type.
   * Returns null if no idle task is available.
   *
   * @param agentType - The agent type to acquire a task for
   * @returns PooledTask if available, null otherwise
   */
  async acquireTask(agentType: AgentType): Promise<PooledTask | null> {
    const startTime = Date.now();
    this.logger.debug({ agentType }, 'Attempting to acquire task from pool');

    try {
      // Query for idle tasks of this agent type
      const idleTasks = await this.poolRepository.getIdleTasks(agentType, 1);

      if (idleTasks.length === 0) {
        this.logger.debug({ agentType }, 'No idle tasks available in pool');
        this.recordAcquireAttempt(agentType, Date.now() - startTime, false);
        return null;
      }

      const task = idleTasks[0];
      if (task === undefined) {
        return null;
      }

      // Atomically mark as in_use (will fail if another process claimed it)
      try {
        const updatedTask = await this.poolRepository.markInUse(agentType, task.taskArn);

        const waitTime = Date.now() - startTime;
        this.recordAcquireAttempt(agentType, waitTime, true);

        this.logger.info(
          {
            agentType,
            taskArn: task.taskArn,
            waitTimeMs: waitTime,
          },
          'Task acquired from pool'
        );

        return this.toPooledTask(updatedTask);
      } catch (error) {
        // Task was claimed by another process, retry once
        if (error instanceof NotFoundError) {
          this.logger.debug({ agentType, taskArn: task.taskArn }, 'Task claimed by another process, retrying');
          return this.acquireTask(agentType);
        }
        throw error;
      }
    } catch (error) {
      this.logger.error({ agentType, error }, 'Failed to acquire task from pool');
      throw error;
    }
  }

  /**
   * Release a task back to the pool after use.
   * If pool is at capacity, terminates the task instead.
   *
   * @param agentType - The agent type of the task
   * @param taskArn - The ECS task ARN
   */
  async releaseTask(agentType: AgentType, taskArn: string): Promise<void> {
    this.logger.debug({ agentType, taskArn }, 'Releasing task');

    try {
      // Check current pool size for this agent
      const idleCount = await this.poolRepository.countByAgent(agentType, 'idle');
      const targetSize = this.getTargetPoolSize(agentType);

      if (idleCount >= targetSize) {
        // Pool is full, terminate instead of returning to pool
        this.logger.info(
          {
            agentType,
            taskArn,
            idleCount,
            targetSize,
          },
          'Pool at capacity, terminating task'
        );
        await this.terminateTask(agentType, taskArn);
        return;
      }

      // Return task to idle pool
      await this.poolRepository.markIdle(agentType, taskArn);

      this.logger.info(
        {
          agentType,
          taskArn,
          newIdleCount: idleCount + 1,
        },
        'Task released to pool'
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.logger.warn({ agentType, taskArn }, 'Task not found in pool during release');
        return;
      }
      this.logger.error({ agentType, taskArn, error }, 'Failed to release task');
      throw error;
    }
  }

  /**
   * Recycle tasks that have been idle longer than the configured timeout.
   * Terminates stale tasks to free up resources.
   *
   * @returns Number of tasks terminated
   */
  async recycleIdleTasks(): Promise<number> {
    this.logger.debug('Running idle task recycler');

    const idleTimeoutMs = this.config.idleTimeoutMinutes * 60 * 1000;
    const now = Date.now();
    let terminatedCount = 0;

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        const tasks = await this.poolRepository.listByAgent(agentType);

        for (const task of tasks) {
          if (task.status !== 'idle') {
            continue;
          }

          const idleMs = now - task.lastUsedAt.getTime();

          if (idleMs > idleTimeoutMs) {
            this.logger.info(
              {
                agentType,
                taskArn: task.taskArn,
                idleMinutes: Math.floor(idleMs / 60000),
              },
              'Recycling stale idle task'
            );

            await this.terminateTask(agentType, task.taskArn);
            terminatedCount++;
          }
        }
      } catch (error) {
        this.logger.error({ agentType, error }, 'Error recycling idle tasks for agent');
      }
    }

    if (terminatedCount > 0) {
      this.logger.info({ terminatedCount }, 'Idle task recycling completed');
    }

    return terminatedCount;
  }

  /**
   * Pre-provision tasks to reach the target pool size for all agent types.
   * Called during startup or to maintain pool health.
   *
   * @param agentTypes - Optional list of agent types to warm (defaults to all)
   * @returns Number of tasks provisioned
   */
  async warmPool(agentTypes?: readonly AgentType[]): Promise<number> {
    const agents = agentTypes ?? SUPPORTED_AGENTS;
    let provisionedCount = 0;

    this.logger.info({ agents }, 'Warming pool');

    for (const agentType of agents) {
      try {
        const provisioned = await this.warmPoolForAgent(agentType);
        provisionedCount += provisioned;
      } catch (error) {
        this.logger.error({ agentType, error }, 'Failed to warm pool for agent');
      }
    }

    this.logger.info({ provisionedCount }, 'Pool warming completed');

    return provisionedCount;
  }

  /**
   * Get pool metrics for a specific agent type
   *
   * @param agentType - The agent type
   * @returns PoolMetrics for the agent
   */
  async getMetrics(agentType: AgentType): Promise<PoolMetrics> {
    const [totalTasks, idleTasks, inUseTasks] = await Promise.all([
      this.poolRepository.countByAgent(agentType),
      this.poolRepository.countByAgent(agentType, 'idle'),
      this.poolRepository.countByAgent(agentType, 'in_use'),
    ]);

    const waitTimes = this.waitTimes.get(agentType) ?? [];
    const averageWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((sum, t) => sum + t, 0) / waitTimes.length
      : 0;

    return {
      agentType,
      totalTasks,
      idleTasks,
      inUseTasks,
      averageWaitTime: Math.round(averageWaitTime),
    };
  }

  /**
   * Get aggregate metrics across all agent types
   *
   * @returns AggregatePoolMetrics
   */
  async getAggregateMetrics(): Promise<AggregatePoolMetrics> {
    const metricsPromises = SUPPORTED_AGENTS.map((agent) => this.getMetrics(agent));
    const byAgent = await Promise.all(metricsPromises);

    let totalTasks = 0;
    let idleTasks = 0;
    let inUseTasks = 0;
    let terminatingTasks = 0;

    for (const agentType of SUPPORTED_AGENTS) {
      const terminating = await this.poolRepository.countByAgent(agentType, 'terminating');
      terminatingTasks += terminating;
    }

    for (const metrics of byAgent) {
      totalTasks += metrics.totalTasks;
      idleTasks += metrics.idleTasks;
      inUseTasks += metrics.inUseTasks;
    }

    return {
      totalTasks,
      idleTasks,
      inUseTasks,
      terminatingTasks,
      byAgent,
    };
  }

  /**
   * Auto-scale the pool based on demand patterns.
   * Increases pool size when utilization is high, decreases when low.
   */
  async autoScale(): Promise<void> {
    this.logger.debug('Running auto-scaler');

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        await this.autoScaleAgent(agentType);
      } catch (error) {
        this.logger.error({ agentType, error }, 'Auto-scale failed for agent');
      }
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): PoolConfig {
    return { ...this.config };
  }

  /**
   * Warm pool for a specific agent type
   */
  private async warmPoolForAgent(agentType: AgentType): Promise<number> {
    const currentIdle = await this.poolRepository.countByAgent(agentType, 'idle');
    const targetSize = this.getTargetPoolSize(agentType);
    const toProvision = Math.max(0, targetSize - currentIdle);

    if (toProvision === 0) {
      this.logger.debug(
        { agentType, currentIdle, targetSize },
        'Pool already at target size'
      );
      return 0;
    }

    this.logger.info(
      { agentType, currentIdle, targetSize, toProvision },
      'Provisioning tasks to warm pool'
    );

    let provisioned = 0;

    for (let i = 0; i < toProvision; i++) {
      try {
        await this.provisionPoolTask(agentType);
        provisioned++;
      } catch (error) {
        this.logger.error(
          { agentType, error, provisioned, toProvision },
          'Failed to provision pool task'
        );
        // Continue trying to provision remaining tasks
      }
    }

    return provisioned;
  }

  /**
   * Provision a new task for the pool
   */
  private async provisionPoolTask(agentType: AgentType): Promise<PooledTask> {
    this.logger.debug({ agentType }, 'Provisioning new pool task');

    // Create a placeholder dispatch request for pool warming
    const poolWarmRequest: TaskLaunchRequest = {
      dispatchId: `pool-warm-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      userId: 'system',
      agent: agentType,
      task: 'pool-warm', // Worker recognizes this as idle/standby mode
      workspaceMode: 'ephemeral',
      timeoutSeconds: 3600,
    };

    const result = await this.taskLauncher.launchTask(poolWarmRequest);

    // Register task in pool as idle
    const record = await this.poolRepository.create({
      agentType,
      taskArn: result.taskArn,
      instanceType: 'fargate',
    });

    this.logger.info(
      { agentType, taskArn: result.taskArn },
      'Pool task provisioned'
    );

    return this.toPooledTask(record);
  }

  /**
   * Terminate a task and remove from pool
   */
  private async terminateTask(agentType: AgentType, taskArn: string): Promise<void> {
    try {
      // Mark as terminating first
      await this.poolRepository.markTerminating(agentType, taskArn);

      // Get cluster ARN
      const appConfig = getConfig();
      const clusterArn = appConfig.ecs.clusterArn ?? this.buildClusterArn();

      // Stop the ECS task
      await this.ecsClient.send(
        new StopTaskCommand({
          cluster: clusterArn,
          task: taskArn,
          reason: 'Pool management: task recycled or pool at capacity',
        })
      );

      // Delete from DynamoDB (TTL will also handle cleanup)
      await this.poolRepository.delete(agentType, taskArn);

      this.logger.info({ agentType, taskArn }, 'Task terminated');
    } catch (error) {
      this.logger.error({ agentType, taskArn, error }, 'Failed to terminate task');
      throw error;
    }
  }

  /**
   * Auto-scale logic for a specific agent type
   */
  private async autoScaleAgent(agentType: AgentType): Promise<void> {
    const metrics = await this.getMetrics(agentType);
    const currentTarget = this.getTargetPoolSize(agentType);

    // Calculate utilization
    const utilization = metrics.totalTasks > 0
      ? metrics.inUseTasks / metrics.totalTasks
      : 0;

    // Calculate demand rate (acquires in last 5 minutes)
    const recentAcquires = this.getRecentAcquireCount(agentType, 5);
    const demandRate = recentAcquires / 5; // per minute

    this.logger.debug(
      {
        agentType,
        utilization,
        demandRate,
        currentTarget,
        metrics,
      },
      'Auto-scale evaluation'
    );

    // Scale up if utilization is high or demand rate is increasing
    if (utilization > this.config.scaleUpThreshold || demandRate > currentTarget) {
      const newTarget = Math.min(currentTarget + 1, this.config.poolSizePerAgent * 2);

      if (newTarget > currentTarget) {
        this.logger.info(
          { agentType, oldTarget: currentTarget, newTarget, utilization, demandRate },
          'Scaling up pool'
        );
        await this.warmPoolForAgent(agentType);
      }
    }
    // Scale down if utilization is very low
    else if (utilization < this.config.scaleDownThreshold && metrics.idleTasks > this.config.poolSizePerAgent) {
      const excessIdle = metrics.idleTasks - this.config.poolSizePerAgent;

      if (excessIdle > 0) {
        this.logger.info(
          { agentType, excessIdle, utilization },
          'Scaling down pool'
        );

        // Terminate excess idle tasks
        const idleTasks = await this.poolRepository.getIdleTasks(agentType, excessIdle);
        for (const task of idleTasks.slice(0, excessIdle)) {
          await this.terminateTask(agentType, task.taskArn);
        }
      }
    }
  }

  /**
   * Get target pool size for an agent type
   */
  private getTargetPoolSize(agentType: AgentType): number {
    // Could be extended to have per-agent configurations
    return this.config.poolSizePerAgent;
  }

  /**
   * Record an acquire attempt for metrics
   */
  private recordAcquireAttempt(agentType: AgentType, waitTimeMs: number, success: boolean): void {
    const timestamps = this.acquireTimestamps.get(agentType);
    if (timestamps !== undefined) {
      timestamps.push(Date.now());
      // Keep only last hour of timestamps
      const oneHourAgo = Date.now() - 3600000;
      while (timestamps.length > 0 && timestamps[0] !== undefined && timestamps[0] < oneHourAgo) {
        timestamps.shift();
      }
    }

    if (success) {
      const waitTimes = this.waitTimes.get(agentType);
      if (waitTimes !== undefined) {
        waitTimes.push(waitTimeMs);
        // Keep only last 100 samples
        while (waitTimes.length > 100) {
          waitTimes.shift();
        }
      }
    }
  }

  /**
   * Get count of recent acquire attempts
   */
  private getRecentAcquireCount(agentType: AgentType, minutes: number): number {
    const timestamps = this.acquireTimestamps.get(agentType) ?? [];
    const cutoff = Date.now() - minutes * 60000;
    return timestamps.filter((t) => t >= cutoff).length;
  }

  /**
   * Convert PoolTaskRecord to PooledTask
   */
  private toPooledTask(record: PoolTaskRecord): PooledTask {
    return {
      taskArn: record.taskArn,
      agentType: record.agentType,
      status: record.status,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  /**
   * Build cluster ARN from environment
   */
  private buildClusterArn(): string {
    const appConfig = getConfig();
    const env = appConfig.nodeEnv === 'production' ? 'prod' : 'dev';
    return `arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/outpost-${env}`;
  }
}

/**
 * Singleton instance
 */
let managerInstance: WarmPoolManager | null = null;

/**
 * Get singleton WarmPoolManager instance
 */
export function getWarmPoolManager(): WarmPoolManager {
  if (managerInstance === null) {
    managerInstance = new WarmPoolManager();
  }
  return managerInstance;
}

/**
 * Reset singleton for testing
 */
export function resetWarmPoolManager(): void {
  managerInstance = null;
}
