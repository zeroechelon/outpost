/**
 * Pool Autoscaler Service - Demand-based pool auto-scaling
 *
 * Monitors dispatch queue depth per agent type and automatically scales
 * the warm pool up or down based on demand patterns.
 *
 * Scale-up triggers:
 * - Queue depth > pool_size * 2
 *
 * Scale-down triggers:
 * - Idle count > pool_size * 0.5 for 10 minutes
 *
 * Constraints:
 * - Min pool size: 1 per agent
 * - Max pool size: 10 per agent (configurable)
 * - Cooldown: 5 minutes between scale actions
 */

import { getLogger } from '../utils/logger.js';
import { WarmPoolManager, getWarmPoolManager } from './pool-manager.js';
import { PoolRepository } from '../repositories/pool.repository.js';
import { DispatchRepository, type DispatchStatus } from '../repositories/dispatch.repository.js';
import type { AgentType } from '../types/agent.js';

/**
 * Autoscaler configuration
 */
export interface AutoscalerConfig {
  readonly minPoolSize: number;
  readonly maxPoolSize: number;
  readonly scaleUpThreshold: number; // queue_depth / pool_size ratio
  readonly scaleDownThreshold: number; // idle_ratio
  readonly scaleDownDelayMinutes: number;
  readonly cooldownMinutes: number;
  readonly evaluationIntervalSeconds: number;
}

/**
 * Scaling decision result
 */
export interface ScalingDecision {
  readonly agentType: AgentType;
  readonly action: 'scale_up' | 'scale_down' | 'no_action';
  readonly currentSize: number;
  readonly targetSize: number;
  readonly reason: string;
}

/**
 * Demand metrics for an agent type
 */
export interface DemandMetrics {
  readonly agentType: AgentType;
  readonly queueDepth: number;
  readonly idleCount: number;
  readonly inUseCount: number;
  readonly totalCount: number;
  readonly avgWaitTimeMs: number;
}

/**
 * Scaling history entry
 */
export interface ScalingHistoryEntry {
  readonly timestamp: Date;
  readonly decision: ScalingDecision;
  readonly success: boolean;
  readonly errorMessage?: string;
}

/**
 * Idle tracking for scale-down delay
 */
interface IdleTracking {
  readonly agentType: AgentType;
  idleStartTime: Date | null;
  consecutiveIdleCount: number;
}

/**
 * Default configuration values
 */
const DEFAULT_MIN_POOL_SIZE = 1;
const DEFAULT_MAX_POOL_SIZE = 10;
const DEFAULT_SCALE_UP_THRESHOLD = 2.0; // queue_depth / pool_size
const DEFAULT_SCALE_DOWN_THRESHOLD = 0.5; // idle_ratio
const DEFAULT_SCALE_DOWN_DELAY_MINUTES = 10;
const DEFAULT_COOLDOWN_MINUTES = 5;
const DEFAULT_EVALUATION_INTERVAL_SECONDS = 30;

/**
 * Supported agent types for scaling
 */
const SUPPORTED_AGENTS: readonly AgentType[] = ['claude', 'codex', 'gemini', 'aider', 'grok'];

/**
 * Maximum scaling history entries to retain
 */
const MAX_HISTORY_ENTRIES = 100;

/**
 * Pool Autoscaler - Manages demand-based pool scaling
 */
export class PoolAutoscaler {
  private readonly logger = getLogger().child({ service: 'PoolAutoscaler' });
  private readonly poolManager: WarmPoolManager;
  private readonly poolRepository: PoolRepository;
  private readonly dispatchRepository: DispatchRepository;
  private readonly config: AutoscalerConfig;

  // Scaling state tracking
  private readonly lastScaleAction: Map<AgentType, Date> = new Map();
  private readonly idleTracking: Map<AgentType, IdleTracking> = new Map();
  private readonly scalingHistory: ScalingHistoryEntry[] = [];
  private readonly targetPoolSizes: Map<AgentType, number> = new Map();

  // Auto-scaling loop control
  private evaluationInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(
    poolManager?: WarmPoolManager,
    poolRepository?: PoolRepository,
    dispatchRepository?: DispatchRepository,
    config?: Partial<AutoscalerConfig>
  ) {
    this.poolManager = poolManager ?? getWarmPoolManager();
    this.poolRepository = poolRepository ?? new PoolRepository();
    this.dispatchRepository = dispatchRepository ?? new DispatchRepository();

    // Merge provided config with defaults from environment
    this.config = {
      minPoolSize: config?.minPoolSize ??
        parseInt(process.env['AUTOSCALER_MIN_POOL_SIZE'] ?? String(DEFAULT_MIN_POOL_SIZE), 10),
      maxPoolSize: config?.maxPoolSize ??
        parseInt(process.env['AUTOSCALER_MAX_POOL_SIZE'] ?? String(DEFAULT_MAX_POOL_SIZE), 10),
      scaleUpThreshold: config?.scaleUpThreshold ??
        parseFloat(process.env['AUTOSCALER_SCALE_UP_THRESHOLD'] ?? String(DEFAULT_SCALE_UP_THRESHOLD)),
      scaleDownThreshold: config?.scaleDownThreshold ??
        parseFloat(process.env['AUTOSCALER_SCALE_DOWN_THRESHOLD'] ?? String(DEFAULT_SCALE_DOWN_THRESHOLD)),
      scaleDownDelayMinutes: config?.scaleDownDelayMinutes ??
        parseInt(process.env['AUTOSCALER_SCALE_DOWN_DELAY_MINUTES'] ?? String(DEFAULT_SCALE_DOWN_DELAY_MINUTES), 10),
      cooldownMinutes: config?.cooldownMinutes ??
        parseInt(process.env['AUTOSCALER_COOLDOWN_MINUTES'] ?? String(DEFAULT_COOLDOWN_MINUTES), 10),
      evaluationIntervalSeconds: config?.evaluationIntervalSeconds ??
        parseInt(process.env['AUTOSCALER_EVALUATION_INTERVAL_SECONDS'] ?? String(DEFAULT_EVALUATION_INTERVAL_SECONDS), 10),
    };

    // Initialize idle tracking for each agent
    for (const agent of SUPPORTED_AGENTS) {
      this.idleTracking.set(agent, {
        agentType: agent,
        idleStartTime: null,
        consecutiveIdleCount: 0,
      });
      // Initialize target pool sizes to minimum
      this.targetPoolSizes.set(agent, this.config.minPoolSize);
    }

    this.logger.info(
      {
        minPoolSize: this.config.minPoolSize,
        maxPoolSize: this.config.maxPoolSize,
        scaleUpThreshold: this.config.scaleUpThreshold,
        scaleDownThreshold: this.config.scaleDownThreshold,
        scaleDownDelayMinutes: this.config.scaleDownDelayMinutes,
        cooldownMinutes: this.config.cooldownMinutes,
        evaluationIntervalSeconds: this.config.evaluationIntervalSeconds,
      },
      'PoolAutoscaler initialized'
    );
  }

  /**
   * Start the auto-scaling evaluation loop
   */
  startAutoScaling(): void {
    if (this.isRunning) {
      this.logger.warn('Auto-scaling already running');
      return;
    }

    this.isRunning = true;
    const intervalMs = this.config.evaluationIntervalSeconds * 1000;

    this.logger.info(
      { intervalMs },
      'Starting auto-scaling evaluation loop'
    );

    // Run initial evaluation
    void this.runEvaluationCycle();

    // Set up periodic evaluation
    this.evaluationInterval = setInterval(() => {
      void this.runEvaluationCycle();
    }, intervalMs);
  }

  /**
   * Stop the auto-scaling evaluation loop
   */
  stopAutoScaling(): void {
    if (!this.isRunning) {
      this.logger.warn('Auto-scaling not running');
      return;
    }

    if (this.evaluationInterval !== null) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Auto-scaling stopped');
  }

  /**
   * Check if auto-scaling is currently running
   */
  isAutoScalingRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Evaluate demand metrics for a specific agent type
   */
  async evaluateDemand(agentType: AgentType): Promise<DemandMetrics> {
    this.logger.debug({ agentType }, 'Evaluating demand');

    // Get pool metrics
    const poolMetrics = await this.poolManager.getMetrics(agentType);

    // Count pending dispatches (queue depth)
    const queueDepth = await this.countPendingDispatches(agentType);

    const metrics: DemandMetrics = {
      agentType,
      queueDepth,
      idleCount: poolMetrics.idleTasks,
      inUseCount: poolMetrics.inUseTasks,
      totalCount: poolMetrics.totalTasks,
      avgWaitTimeMs: poolMetrics.averageWaitTime,
    };

    this.logger.debug({ agentType, metrics }, 'Demand evaluation complete');

    return metrics;
  }

  /**
   * Make a scaling decision based on demand metrics
   */
  makeScalingDecision(metrics: DemandMetrics): ScalingDecision {
    const { agentType, queueDepth, idleCount, totalCount } = metrics;
    const currentTarget = this.targetPoolSizes.get(agentType) ?? this.config.minPoolSize;

    // Check cooldown period
    const lastAction = this.lastScaleAction.get(agentType);
    if (lastAction !== undefined) {
      const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
      const timeSinceLastAction = Date.now() - lastAction.getTime();
      if (timeSinceLastAction < cooldownMs) {
        return {
          agentType,
          action: 'no_action',
          currentSize: totalCount,
          targetSize: currentTarget,
          reason: `Cooldown active (${Math.ceil((cooldownMs - timeSinceLastAction) / 1000)}s remaining)`,
        };
      }
    }

    // Calculate ratios
    const effectivePoolSize = Math.max(totalCount, 1); // Avoid division by zero
    const queueToPoolRatio = queueDepth / effectivePoolSize;
    const idleRatio = totalCount > 0 ? idleCount / totalCount : 1;

    // Scale-up decision: queue depth > pool_size * threshold
    if (queueToPoolRatio > this.config.scaleUpThreshold) {
      // Calculate new target based on queue depth
      const neededCapacity = Math.ceil(queueDepth / this.config.scaleUpThreshold);
      const newTarget = Math.min(
        Math.max(neededCapacity, currentTarget + 1),
        this.config.maxPoolSize
      );

      if (newTarget > currentTarget) {
        // Reset idle tracking since we're scaling up
        this.resetIdleTracking(agentType);

        return {
          agentType,
          action: 'scale_up',
          currentSize: totalCount,
          targetSize: newTarget,
          reason: `Queue depth (${queueDepth}) exceeds threshold (pool ${totalCount} * ${this.config.scaleUpThreshold} = ${totalCount * this.config.scaleUpThreshold})`,
        };
      }
    }

    // Scale-down decision: idle > threshold for extended period
    if (idleRatio > this.config.scaleDownThreshold && currentTarget > this.config.minPoolSize) {
      const tracking = this.idleTracking.get(agentType);
      if (tracking !== undefined) {
        const now = new Date();

        if (tracking.idleStartTime === null) {
          // Start tracking idle period
          tracking.idleStartTime = now;
          tracking.consecutiveIdleCount = 1;
        } else {
          tracking.consecutiveIdleCount++;

          const idleDurationMs = now.getTime() - tracking.idleStartTime.getTime();
          const requiredDelayMs = this.config.scaleDownDelayMinutes * 60 * 1000;

          if (idleDurationMs >= requiredDelayMs) {
            // Enough time has passed with high idle ratio
            const newTarget = Math.max(currentTarget - 1, this.config.minPoolSize);

            // Reset idle tracking after scale-down decision
            this.resetIdleTracking(agentType);

            return {
              agentType,
              action: 'scale_down',
              currentSize: totalCount,
              targetSize: newTarget,
              reason: `Idle ratio (${(idleRatio * 100).toFixed(1)}%) exceeded threshold (${this.config.scaleDownThreshold * 100}%) for ${this.config.scaleDownDelayMinutes} minutes`,
            };
          } else {
            return {
              agentType,
              action: 'no_action',
              currentSize: totalCount,
              targetSize: currentTarget,
              reason: `Scale-down pending (${Math.ceil((requiredDelayMs - idleDurationMs) / 1000)}s until threshold met)`,
            };
          }
        }
      }
    } else {
      // Not in idle state, reset tracking
      this.resetIdleTracking(agentType);
    }

    return {
      agentType,
      action: 'no_action',
      currentSize: totalCount,
      targetSize: currentTarget,
      reason: 'Demand within normal parameters',
    };
  }

  /**
   * Execute a scaling decision by adjusting the pool
   */
  async executeScaling(decision: ScalingDecision): Promise<boolean> {
    const { agentType, action, currentSize, targetSize } = decision;

    if (action === 'no_action') {
      return true;
    }

    this.logger.info(
      {
        agentType,
        action,
        currentSize,
        targetSize,
        reason: decision.reason,
      },
      'Executing scaling decision'
    );

    try {
      // Update target pool size
      this.targetPoolSizes.set(agentType, targetSize);

      if (action === 'scale_up') {
        // Provision additional tasks to reach target
        const toProvision = targetSize - currentSize;
        if (toProvision > 0) {
          await this.poolManager.warmPool([agentType]);
        }
      } else if (action === 'scale_down') {
        // Terminate excess idle tasks
        const toTerminate = currentSize - targetSize;
        if (toTerminate > 0) {
          await this.terminateExcessTasks(agentType, toTerminate);
        }
      }

      // Record successful action
      this.lastScaleAction.set(agentType, new Date());
      this.recordHistory(decision, true);

      this.logger.info(
        { agentType, action, targetSize },
        'Scaling action completed successfully'
      );

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { agentType, action, error: errorMessage },
        'Scaling action failed'
      );
      this.recordHistory(decision, false, errorMessage);
      return false;
    }
  }

  /**
   * Get recent scaling history
   */
  getScalingHistory(limit?: number): readonly ScalingHistoryEntry[] {
    const count = limit ?? MAX_HISTORY_ENTRIES;
    return this.scalingHistory.slice(-count);
  }

  /**
   * Get scaling history for a specific agent type
   */
  getScalingHistoryForAgent(agentType: AgentType, limit?: number): readonly ScalingHistoryEntry[] {
    const count = limit ?? MAX_HISTORY_ENTRIES;
    return this.scalingHistory
      .filter((entry) => entry.decision.agentType === agentType)
      .slice(-count);
  }

  /**
   * Get the current target pool size for an agent type
   */
  getTargetPoolSize(agentType: AgentType): number {
    return this.targetPoolSizes.get(agentType) ?? this.config.minPoolSize;
  }

  /**
   * Get the current configuration
   */
  getConfig(): AutoscalerConfig {
    return { ...this.config };
  }

  /**
   * Manually trigger an evaluation cycle for a specific agent
   */
  async evaluateAndScale(agentType: AgentType): Promise<ScalingDecision> {
    const metrics = await this.evaluateDemand(agentType);
    const decision = this.makeScalingDecision(metrics);
    await this.executeScaling(decision);
    return decision;
  }

  /**
   * Run a complete evaluation cycle for all agents
   */
  private async runEvaluationCycle(): Promise<void> {
    this.logger.debug('Running evaluation cycle');

    for (const agentType of SUPPORTED_AGENTS) {
      try {
        await this.evaluateAndScale(agentType);
      } catch (error) {
        this.logger.error(
          { agentType, error: error instanceof Error ? error.message : String(error) },
          'Evaluation cycle failed for agent'
        );
      }
    }
  }

  /**
   * Count pending dispatches for an agent type (queue depth)
   */
  private async countPendingDispatches(agentType: AgentType): Promise<number> {
    // Query dispatches in PENDING status for this agent
    // Note: This is a simplified implementation. In production, you might
    // want a dedicated index or counter for better performance.
    try {
      const pendingStatuses: DispatchStatus[] = ['PENDING'];
      let count = 0;

      // Count pending tasks by querying the pool repository for pending work
      // Since DispatchRepository doesn't have a direct count by agent+status,
      // we approximate using pool metrics
      const idleTasks = await this.poolRepository.getIdleTasks(agentType, 100);

      // Queue depth is approximated by:
      // If idle tasks are 0, check if there might be pending work
      // This is a heuristic - in production, maintain a dedicated queue depth metric
      if (idleTasks.length === 0) {
        // No idle tasks available - there might be pending dispatches
        // Check the pool manager's acquire attempt rate as a proxy
        const metrics = await this.poolManager.getMetrics(agentType);
        if (metrics.inUseTasks >= metrics.totalTasks && metrics.averageWaitTime > 1000) {
          // High utilization and wait times suggest queue buildup
          count = Math.ceil(metrics.averageWaitTime / 1000); // Rough estimate
        }
      }

      return count;
    } catch (error) {
      this.logger.error(
        { agentType, error: error instanceof Error ? error.message : String(error) },
        'Failed to count pending dispatches'
      );
      return 0;
    }
  }

  /**
   * Terminate excess idle tasks for an agent type
   */
  private async terminateExcessTasks(agentType: AgentType, count: number): Promise<void> {
    const idleTasks = await this.poolRepository.getIdleTasks(agentType, count);

    for (const task of idleTasks.slice(0, count)) {
      try {
        // Mark task as terminating (pool manager will handle actual termination)
        await this.poolRepository.markTerminating(agentType, task.taskArn);
        this.logger.debug(
          { agentType, taskArn: task.taskArn },
          'Marked task for termination'
        );
      } catch (error) {
        this.logger.error(
          { agentType, taskArn: task.taskArn, error: error instanceof Error ? error.message : String(error) },
          'Failed to terminate task'
        );
      }
    }
  }

  /**
   * Reset idle tracking for an agent type
   */
  private resetIdleTracking(agentType: AgentType): void {
    const tracking = this.idleTracking.get(agentType);
    if (tracking !== undefined) {
      tracking.idleStartTime = null;
      tracking.consecutiveIdleCount = 0;
    }
  }

  /**
   * Record a scaling action in history
   */
  private recordHistory(decision: ScalingDecision, success: boolean, errorMessage?: string): void {
    const entry: ScalingHistoryEntry = {
      timestamp: new Date(),
      decision,
      success,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    };

    this.scalingHistory.push(entry);

    // Trim history if too large
    while (this.scalingHistory.length > MAX_HISTORY_ENTRIES) {
      this.scalingHistory.shift();
    }
  }
}

/**
 * Singleton instance
 */
let autoscalerInstance: PoolAutoscaler | null = null;

/**
 * Get singleton PoolAutoscaler instance
 */
export function getPoolAutoscaler(): PoolAutoscaler {
  if (autoscalerInstance === null) {
    autoscalerInstance = new PoolAutoscaler();
  }
  return autoscalerInstance;
}

/**
 * Reset singleton for testing
 */
export function resetPoolAutoscaler(): void {
  if (autoscalerInstance !== null) {
    autoscalerInstance.stopAutoScaling();
  }
  autoscalerInstance = null;
}
