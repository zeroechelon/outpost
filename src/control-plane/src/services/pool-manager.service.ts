/**
 * Pool manager service - manages ECS worker task lifecycle
 */

import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { ServiceUnavailableError, InternalError } from '../utils/errors.js';
import type { AgentType, WorkerInstance, WorkerStatus } from '../types/agent.js';

export interface WorkerAllocation {
  workerId: string;
  taskArn: string;
  agentType: AgentType;
}

export class PoolManagerService {
  private readonly logger = getLogger().child({ service: 'PoolManagerService' });
  private readonly ecsClient: ECSClient;
  private readonly config = getConfig();

  // In-memory tracking of worker instances
  private readonly activeWorkers: Map<string, WorkerInstance> = new Map();

  constructor() {
    this.ecsClient = new ECSClient({ region: this.config.awsRegion });
  }

  async allocateWorker(agentType: AgentType, jobId: string): Promise<WorkerAllocation> {
    this.logger.info({ agentType, jobId }, 'Allocating worker for job');

    // Check for idle workers first
    const idleWorker = this.findIdleWorker(agentType);
    if (idleWorker !== null) {
      this.logger.info({ workerId: idleWorker.instanceId }, 'Reusing idle worker');

      this.activeWorkers.set(idleWorker.instanceId, {
        ...idleWorker,
        status: 'busy',
        currentJobId: jobId,
        lastActivityAt: new Date(),
      });

      return {
        workerId: idleWorker.instanceId,
        taskArn: idleWorker.taskArn,
        agentType,
      };
    }

    // Check pool limits
    const currentPoolSize = this.getActiveWorkerCount();
    if (currentPoolSize >= this.config.worker.maxPoolSize) {
      throw new ServiceUnavailableError('Worker pool at capacity', {
        maxPoolSize: this.config.worker.maxPoolSize,
        currentSize: currentPoolSize,
      });
    }

    // Start new ECS task
    const workerId = await this.startWorkerTask(agentType, jobId);

    return {
      workerId,
      taskArn: this.activeWorkers.get(workerId)?.taskArn ?? '',
      agentType,
    };
  }

  async releaseWorker(workerId: string): Promise<void> {
    this.logger.info({ workerId }, 'Releasing worker');

    const worker = this.activeWorkers.get(workerId);
    if (worker === undefined) {
      this.logger.warn({ workerId }, 'Worker not found for release');
      return;
    }

    // Set to idle instead of stopping
    this.activeWorkers.set(workerId, {
      ...worker,
      status: 'idle',
      currentJobId: null,
      lastActivityAt: new Date(),
    });

    this.logger.info({ workerId }, 'Worker set to idle');
  }

  async stopWorker(workerId: string): Promise<void> {
    this.logger.info({ workerId }, 'Stopping worker');

    const worker = this.activeWorkers.get(workerId);
    if (worker === undefined) {
      return;
    }

    this.activeWorkers.set(workerId, {
      ...worker,
      status: 'stopping',
    });

    try {
      const clusterArn = this.config.ecs.clusterArn;
      if (clusterArn === undefined) {
        throw new InternalError('ECS cluster ARN not configured');
      }

      await this.ecsClient.send(
        new StopTaskCommand({
          cluster: clusterArn,
          task: worker.taskArn,
          reason: 'Worker pool management',
        })
      );

      this.activeWorkers.delete(workerId);
      this.logger.info({ workerId }, 'Worker stopped');
    } catch (error) {
      this.logger.error({ workerId, error }, 'Failed to stop worker');
      this.activeWorkers.set(workerId, {
        ...worker,
        status: 'error',
      });
    }
  }

  async cleanupIdleWorkers(): Promise<number> {
    this.logger.debug('Cleaning up idle workers');

    const now = Date.now();
    const idleTimeoutMs = this.config.worker.idleTimeoutSeconds * 1000;
    let stoppedCount = 0;

    for (const [workerId, worker] of this.activeWorkers) {
      if (worker.status === 'idle') {
        const idleMs = now - worker.lastActivityAt.getTime();

        if (idleMs > idleTimeoutMs) {
          this.logger.info({ workerId, idleMs }, 'Stopping idle worker');
          await this.stopWorker(workerId);
          stoppedCount++;
        }
      }
    }

    return stoppedCount;
  }

  getWorkerStatus(workerId: string): WorkerInstance | undefined {
    return this.activeWorkers.get(workerId);
  }

  getActiveWorkerCount(): number {
    return Array.from(this.activeWorkers.values()).filter(
      (w) => w.status !== 'stopped' && w.status !== 'error'
    ).length;
  }

  getPoolStatus(): {
    total: number;
    idle: number;
    busy: number;
    starting: number;
  } {
    let idle = 0;
    let busy = 0;
    let starting = 0;

    for (const worker of this.activeWorkers.values()) {
      switch (worker.status) {
        case 'idle':
          idle++;
          break;
        case 'busy':
          busy++;
          break;
        case 'starting':
          starting++;
          break;
      }
    }

    return {
      total: this.activeWorkers.size,
      idle,
      busy,
      starting,
    };
  }

  private findIdleWorker(agentType: AgentType): WorkerInstance | null {
    for (const worker of this.activeWorkers.values()) {
      if (worker.agentType === agentType && worker.status === 'idle') {
        return worker;
      }
    }
    return null;
  }

  private async startWorkerTask(agentType: AgentType, jobId: string): Promise<string> {
    const clusterArn = this.config.ecs.clusterArn;
    const taskDefinition = this.config.ecs.workerTaskDefinition;
    const securityGroup = this.config.ecs.workerSecurityGroup;
    const subnetIds = this.config.ecs.workerSubnetIds;

    if (clusterArn === undefined || taskDefinition === undefined) {
      throw new InternalError('ECS configuration incomplete');
    }

    this.logger.info({ agentType, jobId }, 'Starting new ECS worker task');

    try {
      const response = await this.ecsClient.send(
        new RunTaskCommand({
          cluster: clusterArn,
          taskDefinition,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: subnetIds,
              securityGroups: securityGroup !== undefined ? [securityGroup] : undefined,
              assignPublicIp: 'DISABLED',
            },
          },
          overrides: {
            containerOverrides: [
              {
                name: 'worker',
                environment: [
                  { name: 'AGENT_TYPE', value: agentType },
                  { name: 'INITIAL_JOB_ID', value: jobId },
                ],
              },
            ],
          },
        })
      );

      const task = response.tasks?.[0];
      if (task?.taskArn === undefined) {
        throw new InternalError('Failed to start ECS task');
      }

      const workerId = task.taskArn.split('/').pop();
      if (workerId === undefined) {
        throw new InternalError('Failed to extract worker ID from task ARN');
      }

      const worker: WorkerInstance = {
        instanceId: workerId,
        agentType,
        taskArn: task.taskArn,
        status: 'starting',
        startedAt: new Date(),
        lastActivityAt: new Date(),
        currentJobId: jobId,
      };

      this.activeWorkers.set(workerId, worker);

      this.logger.info({ workerId, taskArn: task.taskArn }, 'Worker task started');

      return workerId;
    } catch (error) {
      this.logger.error({ agentType, error }, 'Failed to start worker task');
      throw new ServiceUnavailableError('Failed to provision worker', {
        agentType,
      });
    }
  }
}
