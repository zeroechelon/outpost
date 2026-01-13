/**
 * Health check API handlers
 *
 * Provides health check and fleet status endpoints for monitoring
 * and Kubernetes probes.
 *
 * Fleet health endpoint (GET /health/fleet) provides:
 * - Overall status: healthy | degraded | unhealthy
 * - Per-agent metrics: pool_size, active, success_rate, avg_duration
 * - System metrics: CPU, memory utilization
 * - Dispatches in last hour count
 * - 30-second cached metrics for performance
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../../utils/config.js';
import { PoolManagerService } from '../../services/pool-manager.service.js';
import { WorkspaceHandlerService } from '../../services/workspace-handler.service.js';
import { getWarmPoolManager, type AggregatePoolMetrics } from '../../services/pool-manager.js';
import { DispatchRepository } from '../../repositories/dispatch.repository.js';
import { AGENT_CONFIGS, type AgentType } from '../../types/agent.js';
import type { HealthCheckResponse, HealthCheck, ApiResponse } from '../../types/api.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger().child({ handler: 'HealthHandler' });
const poolManager = new PoolManagerService();
const workspaceHandler = new WorkspaceHandlerService();
const warmPoolManager = getWarmPoolManager();
const dispatchRepository = new DispatchRepository();

// Track server start time
const startTime = Date.now();

/**
 * Cache TTL for fleet metrics (30 seconds as per blueprint)
 */
const FLEET_METRICS_CACHE_TTL_MS = 30000;

/**
 * Cached fleet metrics
 */
interface CachedFleetMetrics {
  readonly data: FleetHealthResponse;
  readonly cachedAt: number;
}

let fleetMetricsCache: CachedFleetMetrics | null = null;

/**
 * System metrics
 */
interface SystemMetrics {
  readonly cpuUsagePercent: number;
  readonly memoryUsagePercent: number;
  readonly memoryUsedMB: number;
  readonly memoryTotalMB: number;
  readonly heapUsedMB: number;
  readonly heapTotalMB: number;
}

/**
 * Per-agent health metrics
 */
interface AgentHealthMetrics {
  readonly agent: AgentType;
  readonly available: boolean;
  readonly modelId: string;
  readonly poolSize: number;
  readonly active: number;
  readonly idle: number;
  readonly successRate: number; // Percentage 0-100
  readonly avgDurationMs: number;
  readonly maxConcurrent: number;
}

/**
 * Dispatch statistics
 */
interface DispatchStats {
  readonly lastHourTotal: number;
  readonly byStatus: {
    readonly pending: number;
    readonly running: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly timeout: number;
  };
}

/**
 * Fleet health response structure (enhanced per blueprint)
 */
interface FleetHealthResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly pool: AggregatePoolMetrics;
  readonly agents: AgentHealthMetrics[];
  readonly system: SystemMetrics;
  readonly dispatches: DispatchStats;
  readonly uptime: number;
  readonly timestamp: string;
}

/**
 * Legacy fleet status response structure (for backwards compatibility)
 */
interface FleetStatusResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly pool: AggregatePoolMetrics;
  readonly agents: AgentAvailability[];
  readonly uptime: number;
  readonly timestamp: string;
}

/**
 * Agent availability status (legacy)
 */
interface AgentAvailability {
  readonly agent: AgentType;
  readonly available: boolean;
  readonly modelId: string;
  readonly idleWorkers: number;
  readonly busyWorkers: number;
  readonly maxConcurrent: number;
}

export class HealthHandler {
  static async health(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = getConfig();
      const checks: Record<string, HealthCheck> = {};

      // Check EFS health
      const efsHealth = await workspaceHandler.checkEfsHealth();
      const efsCheck: HealthCheck = {
        status: efsHealth.healthy ? 'pass' : 'fail',
      };
      if (efsHealth.message !== undefined) {
        (efsCheck as { message: string }).message = efsHealth.message;
      }
      checks['efs'] = efsCheck;

      // Check worker pool
      const poolStatus = poolManager.getPoolStatus();
      checks['worker-pool'] = {
        status: poolStatus.total < config.worker.maxPoolSize ? 'pass' : 'warn',
        message: `${poolStatus.busy}/${poolStatus.total} workers busy`,
      };

      // Determine overall status
      const hasFailure = Object.values(checks).some((c) => c.status === 'fail');
      const hasWarning = Object.values(checks).some((c) => c.status === 'warn');

      let overallStatus: HealthCheckResponse['status'] = 'healthy';
      if (hasFailure) {
        overallStatus = 'unhealthy';
      } else if (hasWarning) {
        overallStatus = 'degraded';
      }

      const response: HealthCheckResponse = {
        status: overallStatus,
        version: process.env['npm_package_version'] ?? '2.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        checks,
      };

      const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(response);
    } catch (error) {
      next(error);
    }
  }

  static liveness(req: Request, res: Response): void {
    res.status(200).json({ status: 'ok' });
  }

  static readiness(req: Request, res: Response): void {
    // Simple readiness check - can be extended
    res.status(200).json({ status: 'ready' });
  }

  /**
   * GET /health/fleet - Fleet health with comprehensive metrics
   *
   * Returns:
   * - Overall status: healthy | degraded | unhealthy
   * - Per-agent metrics: pool_size, active, success_rate, avg_duration
   * - System metrics: CPU, memory utilization
   * - Dispatches in last hour count
   *
   * Performance: Response time <500ms via 30-second metrics caching
   */
  static async fleetStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestStart = Date.now();

    try {
      // Check cache first
      if (fleetMetricsCache !== null) {
        const cacheAge = Date.now() - fleetMetricsCache.cachedAt;
        if (cacheAge < FLEET_METRICS_CACHE_TTL_MS) {
          logger.debug({ cacheAgeMs: cacheAge }, 'Returning cached fleet metrics');

          const cachedResponse = {
            success: true,
            data: fleetMetricsCache.data,
            meta: {
              requestId: (req as { requestId?: string }).requestId ?? 'unknown',
              timestamp: new Date().toISOString(),
              cached: true,
              cacheAgeMs: cacheAge,
            },
          };

          const statusCode = fleetMetricsCache.data.status === 'unhealthy' ? 503 : 200;
          res.status(statusCode).json(cachedResponse);
          return;
        }
      }

      // Gather metrics in parallel for performance
      const [poolMetrics, dispatchMetrics, systemMetrics] = await Promise.all([
        warmPoolManager.getAggregateMetrics(),
        dispatchRepository.getDispatchMetrics(1), // Last hour
        HealthHandler.getSystemMetrics(),
      ]);

      // Build enhanced agent metrics
      const agentTypes: AgentType[] = ['claude', 'codex', 'gemini', 'aider', 'grok'];
      const agents: AgentHealthMetrics[] = [];

      for (const agentType of agentTypes) {
        const agentConfig = AGENT_CONFIGS[agentType];
        const agentPoolMetrics = poolMetrics.byAgent.find((m) => m.agentType === agentType);
        const agentDispatchStats = dispatchMetrics.byAgent[agentType];

        const poolSize = agentPoolMetrics?.totalTasks ?? 0;
        const active = agentPoolMetrics?.inUseTasks ?? 0;
        const idle = agentPoolMetrics?.idleTasks ?? 0;

        // Calculate success rate from dispatch metrics
        const total = agentDispatchStats?.total ?? 0;
        const completed = agentDispatchStats?.completed ?? 0;
        const failed = agentDispatchStats?.failed ?? 0;
        const successRate = total > 0
          ? Math.round((completed / (completed + failed)) * 100) || 0
          : 100; // Default to 100% if no data

        agents.push({
          agent: agentType,
          available: idle > 0 || active < agentConfig.maxConcurrent,
          modelId: agentConfig.modelId,
          poolSize,
          active,
          idle,
          successRate,
          avgDurationMs: agentDispatchStats?.avgDurationMs ?? 0,
          maxConcurrent: agentConfig.maxConcurrent,
        });
      }

      // Build dispatch statistics
      const dispatches: DispatchStats = {
        lastHourTotal: dispatchMetrics.totalDispatches,
        byStatus: {
          pending: dispatchMetrics.byStatus.PENDING,
          running: dispatchMetrics.byStatus.RUNNING,
          completed: dispatchMetrics.byStatus.COMPLETED,
          failed: dispatchMetrics.byStatus.FAILED,
          cancelled: dispatchMetrics.byStatus.CANCELLED,
          timeout: dispatchMetrics.byStatus.TIMEOUT,
        },
      };

      // Determine overall fleet status
      const availableAgents = agents.filter((a) => a.available).length;
      const avgSuccessRate = agents.reduce((sum, a) => sum + a.successRate, 0) / agents.length;

      let status: FleetHealthResponse['status'] = 'healthy';

      if (availableAgents === 0) {
        status = 'unhealthy';
      } else if (availableAgents < agentTypes.length || avgSuccessRate < 80) {
        status = 'degraded';
      }

      // Check system health
      if (systemMetrics.memoryUsagePercent > 90 || systemMetrics.cpuUsagePercent > 95) {
        status = status === 'healthy' ? 'degraded' : status;
      }

      const fleetHealth: FleetHealthResponse = {
        status,
        pool: poolMetrics,
        agents,
        system: systemMetrics,
        dispatches,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
      };

      // Cache the result
      fleetMetricsCache = {
        data: fleetHealth,
        cachedAt: Date.now(),
      };

      const responseTime = Date.now() - requestStart;
      logger.info({ responseTimeMs: responseTime, status }, 'Fleet health metrics computed');

      const fleetResponse = {
        success: true,
        data: fleetHealth,
        meta: {
          requestId: (req as { requestId?: string }).requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };

      const statusCode = status === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(fleetResponse);
    } catch (error) {
      logger.error({ error }, 'Failed to get fleet health metrics');
      next(error);
    }
  }

  /**
   * Get system metrics (CPU, memory)
   */
  private static async getSystemMetrics(): Promise<SystemMetrics> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Get heap statistics
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    // Estimate total memory from RSS (Resident Set Size)
    const memoryUsedMB = Math.round(memUsage.rss / 1024 / 1024);

    // Get system memory info via os module
    const os = await import('os');
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
    const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
    const usedMemMB = totalMemMB - freeMemMB;
    const memoryUsagePercent = Math.round((usedMemMB / totalMemMB) * 100);

    // CPU usage calculation (average over cores)
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const cpuUsagePercent = Math.round(100 - (totalIdle / totalTick) * 100);

    return {
      cpuUsagePercent,
      memoryUsagePercent,
      memoryUsedMB: usedMemMB,
      memoryTotalMB: totalMemMB,
      heapUsedMB,
      heapTotalMB,
    };
  }

  /**
   * Clear fleet metrics cache (useful for testing)
   */
  static clearFleetMetricsCache(): void {
    fleetMetricsCache = null;
    logger.debug('Fleet metrics cache cleared');
  }
}
