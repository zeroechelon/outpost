/**
 * Health check API handlers
 *
 * Provides health check and fleet status endpoints for monitoring
 * and Kubernetes probes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../../utils/config.js';
import { PoolManagerService } from '../../services/pool-manager.service.js';
import { WorkspaceHandlerService } from '../../services/workspace-handler.service.js';
import { getWarmPoolManager, type AggregatePoolMetrics } from '../../services/pool-manager.js';
import { AGENT_CONFIGS, type AgentType } from '../../types/agent.js';
import type { HealthCheckResponse, HealthCheck, ApiResponse } from '../../types/api.js';

const poolManager = new PoolManagerService();
const workspaceHandler = new WorkspaceHandlerService();
const warmPoolManager = getWarmPoolManager();

// Track server start time
const startTime = Date.now();

/**
 * Fleet status response structure
 */
interface FleetStatusResponse {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly pool: AggregatePoolMetrics;
  readonly agents: AgentAvailability[];
  readonly uptime: number;
  readonly timestamp: string;
}

/**
 * Agent availability status
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
      checks['efs'] = {
        status: efsHealth.healthy ? 'pass' : 'fail',
        message: efsHealth.message,
      };

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
   * GET /health/fleet - Fleet status with pool metrics and agent availability
   */
  static async fleetStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Get aggregate pool metrics
      const poolMetrics = await warmPoolManager.getAggregateMetrics();

      // Build agent availability from pool metrics and config
      const agents: AgentAvailability[] = [];
      const agentTypes: AgentType[] = ['claude', 'codex', 'gemini', 'aider', 'grok'];

      for (const agentType of agentTypes) {
        const agentConfig = AGENT_CONFIGS[agentType];
        const agentPoolMetrics = poolMetrics.byAgent.find((m) => m.agentType === agentType);

        const idleWorkers = agentPoolMetrics?.idleTasks ?? 0;
        const busyWorkers = agentPoolMetrics?.inUseTasks ?? 0;

        agents.push({
          agent: agentType,
          available: idleWorkers > 0,
          modelId: agentConfig.modelId,
          idleWorkers,
          busyWorkers,
          maxConcurrent: agentConfig.maxConcurrent,
        });
      }

      // Determine overall fleet status
      const availableAgents = agents.filter((a) => a.available).length;
      let status: FleetStatusResponse['status'] = 'healthy';

      if (availableAgents === 0) {
        status = 'unhealthy';
      } else if (availableAgents < agentTypes.length) {
        status = 'degraded';
      }

      const fleetStatus: FleetStatusResponse = {
        status,
        pool: poolMetrics,
        agents,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
      };

      const response: ApiResponse<FleetStatusResponse> = {
        success: true,
        data: fleetStatus,
        meta: {
          requestId: (req as { requestId?: string }).requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      };

      const statusCode = status === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(response);
    } catch (error) {
      next(error);
    }
  }
}
