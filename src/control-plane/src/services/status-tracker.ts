/**
 * Dispatch Status Tracker Service - Monitors job execution with streaming support
 *
 * Provides real-time status tracking for dispatched tasks via:
 * - ECS DescribeTasks polling for task state
 * - CloudWatch Logs fetching with pagination
 * - Progress percentage heuristics based on logs/time
 * - TTL caching for performance
 *
 * Log Group Pattern: /outpost/agents/{agent-type}
 * Log Stream Pattern: {dispatch-id}
 */

import {
  ECSClient,
  DescribeTasksCommand,
  type Task,
} from '@aws-sdk/client-ecs';
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  type OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { NotFoundError, InternalError } from '../utils/errors.js';
import { DispatchRepository, type DispatchRecord } from '../repositories/dispatch.repository.js';
import type { AgentType } from '../types/agent.js';

/**
 * Dispatch status values aligned with DispatchRecord + additional granularity
 */
export type DispatchStatusValue =
  | 'pending'
  | 'provisioning'
  | 'running'
  | 'completing'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/**
 * Log entry with parsed level
 */
export interface LogEntry {
  readonly timestamp: Date;
  readonly message: string;
  readonly level: 'info' | 'warn' | 'error' | 'debug';
}

/**
 * Complete dispatch status response for clients
 */
export interface DispatchStatus {
  readonly dispatchId: string;
  readonly status: DispatchStatusValue;
  readonly progress: number; // 0-100
  readonly logs: LogEntry[];
  readonly logOffset: string; // For pagination - base64 encoded forward token
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly taskArn?: string;
  readonly exitCode?: number;
  readonly errorMessage?: string;
}

/**
 * Options for getStatus method
 */
export interface GetStatusOptions {
  /**
   * Log offset from previous request for streaming
   * Pass the logOffset from previous response to get only new logs
   */
  readonly logOffset?: string;

  /**
   * Maximum number of log entries to return (default: 100)
   */
  readonly logLimit?: number;

  /**
   * Whether to skip log fetching (useful for quick status checks)
   */
  readonly skipLogs?: boolean;
}

/**
 * Cached status entry
 */
interface CachedStatus {
  readonly status: DispatchStatus;
  readonly cachedAt: number;
}

/**
 * AWS Constants
 */
const AWS_REGION = 'us-east-1';

/**
 * Cache TTL in milliseconds (5 seconds)
 */
const STATUS_CACHE_TTL_MS = 5000;

/**
 * Default log limit per request
 */
const DEFAULT_LOG_LIMIT = 100;

/**
 * Maximum log limit to prevent memory issues
 */
const MAX_LOG_LIMIT = 1000;

/**
 * Progress heuristics - checkpoint markers in logs
 */
const PROGRESS_MARKERS: ReadonlyArray<{ pattern: RegExp; progress: number }> = [
  { pattern: /starting|initializing|booting/i, progress: 5 },
  { pattern: /cloning|fetching.*repo/i, progress: 15 },
  { pattern: /installing|dependencies|npm|pip/i, progress: 25 },
  { pattern: /analyzing|scanning|parsing/i, progress: 35 },
  { pattern: /generating|building|compiling/i, progress: 50 },
  { pattern: /testing|running tests/i, progress: 65 },
  { pattern: /linting|formatting/i, progress: 75 },
  { pattern: /committing|pushing/i, progress: 85 },
  { pattern: /cleanup|finalizing/i, progress: 95 },
  { pattern: /completed|finished|done/i, progress: 100 },
];

/**
 * ECS task status to dispatch status mapping
 */
const ECS_STATUS_MAP: Readonly<Record<string, DispatchStatusValue>> = {
  PROVISIONING: 'provisioning',
  PENDING: 'pending',
  ACTIVATING: 'provisioning',
  RUNNING: 'running',
  DEACTIVATING: 'completing',
  STOPPING: 'completing',
  DEPROVISIONING: 'completing',
  STOPPED: 'success', // Will be refined based on exit code
};

/**
 * Parse log level from message content
 */
function parseLogLevel(message: string): LogEntry['level'] {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('[error]') || lowerMessage.includes('error:') || lowerMessage.includes('exception')) {
    return 'error';
  }
  if (lowerMessage.includes('[warn]') || lowerMessage.includes('warning:')) {
    return 'warn';
  }
  if (lowerMessage.includes('[debug]') || lowerMessage.includes('debug:')) {
    return 'debug';
  }

  return 'info';
}

/**
 * Calculate progress based on log content and elapsed time
 */
function calculateProgress(
  logs: LogEntry[],
  startedAt: Date | undefined,
  timeoutSeconds: number,
  status: DispatchStatusValue
): number {
  // Terminal states have fixed progress
  if (status === 'success') return 100;
  if (status === 'failed' || status === 'timeout' || status === 'cancelled') return 100;
  if (status === 'pending') return 0;
  if (status === 'provisioning') return 2;

  // No logs yet - use time-based estimate
  if (logs.length === 0) {
    if (startedAt === undefined) return 5;

    const elapsed = Date.now() - startedAt.getTime();
    const elapsedPercent = Math.min((elapsed / (timeoutSeconds * 1000)) * 100, 95);
    return Math.max(5, Math.round(elapsedPercent * 0.3)); // Scale to 30% max for time-only
  }

  // Scan logs for progress markers (use last N messages for efficiency)
  const recentLogs = logs.slice(-50);
  let maxProgress = 5;

  for (const log of recentLogs) {
    for (const marker of PROGRESS_MARKERS) {
      if (marker.pattern.test(log.message)) {
        maxProgress = Math.max(maxProgress, marker.progress);
      }
    }
  }

  // Combine marker progress with time-based progress
  if (startedAt !== undefined && maxProgress < 95) {
    const elapsed = Date.now() - startedAt.getTime();
    const elapsedPercent = Math.min((elapsed / (timeoutSeconds * 1000)) * 100, 95);
    const timeProgress = Math.round(elapsedPercent * 0.3);

    // Take the higher of marker-based or time-based, but cap at 95
    maxProgress = Math.min(Math.max(maxProgress, timeProgress), 95);
  }

  return maxProgress;
}

/**
 * Convert CloudWatch log events to LogEntry array
 */
function convertLogEvents(events: OutputLogEvent[]): LogEntry[] {
  return events
    .filter((event): event is OutputLogEvent & { message: string; timestamp: number } =>
      event.message !== undefined && event.timestamp !== undefined
    )
    .map((event) => ({
      timestamp: new Date(event.timestamp),
      message: event.message.trim(),
      level: parseLogLevel(event.message),
    }));
}

/**
 * Build log group name for an agent type
 */
function buildLogGroupName(agent: AgentType): string {
  return `/outpost/agents/${agent}`;
}

/**
 * DispatchStatusTracker - Real-time status tracking with streaming log support
 */
export class DispatchStatusTracker {
  private readonly logger = getLogger().child({ service: 'DispatchStatusTracker' });
  private readonly ecsClient: ECSClient;
  private readonly logsClient: CloudWatchLogsClient;
  private readonly dispatchRepository: DispatchRepository;
  private readonly statusCache: Map<string, CachedStatus> = new Map();
  private readonly config = getConfig();

  constructor(
    ecsClient?: ECSClient,
    logsClient?: CloudWatchLogsClient,
    dispatchRepository?: DispatchRepository
  ) {
    this.ecsClient = ecsClient ?? new ECSClient({ region: this.config.awsRegion });
    this.logsClient = logsClient ?? new CloudWatchLogsClient({ region: this.config.awsRegion });
    this.dispatchRepository = dispatchRepository ?? new DispatchRepository();
  }

  /**
   * Get current dispatch status with optional log streaming
   *
   * @param dispatchId - The dispatch ID to query
   * @param options - Options for log fetching and caching
   * @returns DispatchStatus with current state and logs
   * @throws NotFoundError if dispatch not found
   */
  async getStatus(dispatchId: string, options: GetStatusOptions = {}): Promise<DispatchStatus> {
    const { logOffset, logLimit = DEFAULT_LOG_LIMIT, skipLogs = false } = options;

    this.logger.debug({ dispatchId, logOffset, logLimit, skipLogs }, 'Getting dispatch status');

    // Check cache first (only for requests without log offset - streaming requests bypass cache)
    if (logOffset === undefined && !skipLogs) {
      const cached = this.getCachedStatus(dispatchId);
      if (cached !== undefined) {
        this.logger.debug({ dispatchId, cachedAt: cached.cachedAt }, 'Returning cached status');
        return cached.status;
      }
    }

    // Fetch dispatch record from DynamoDB
    let dispatch: DispatchRecord;
    try {
      dispatch = await this.dispatchRepository.getById(dispatchId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.logger.warn({ dispatchId }, 'Dispatch not found');
        throw error;
      }
      this.logger.error({ dispatchId, error }, 'Failed to fetch dispatch record');
      throw new InternalError('Failed to fetch dispatch status', { dispatchId });
    }

    // Determine status from dispatch record and ECS task
    let ecsTask: Task | undefined;
    let status: DispatchStatusValue;
    let exitCode: number | undefined;

    // If dispatch has a task ARN and is not in terminal state, poll ECS
    if (dispatch.taskArn !== null && !this.isTerminalStatus(dispatch.status)) {
      ecsTask = await this.describeEcsTask(dispatch.taskArn);

      if (ecsTask !== undefined) {
        status = this.mapEcsStatus(ecsTask, dispatch);
        exitCode = this.extractExitCode(ecsTask);
      } else {
        // Task not found in ECS - likely completed and deregistered
        status = this.mapDispatchStatus(dispatch.status);
      }
    } else {
      status = this.mapDispatchStatus(dispatch.status);
    }

    // Fetch logs from CloudWatch
    let logs: LogEntry[] = [];
    let newLogOffset = '';

    if (!skipLogs) {
      const logResult = await this.fetchLogs(
        dispatch.agent,
        dispatchId,
        logOffset,
        Math.min(logLimit, MAX_LOG_LIMIT)
      );
      logs = logResult.logs;
      newLogOffset = logResult.nextOffset;
    }

    // Calculate progress
    const progress = calculateProgress(
      logs,
      dispatch.startedAt ?? undefined,
      this.config.worker.taskTimeoutSeconds,
      status
    );

    // Build response - conditionally add optional fields to satisfy exactOptionalPropertyTypes
    const response: DispatchStatus = {
      dispatchId,
      status,
      progress,
      logs,
      logOffset: newLogOffset,
      ...(dispatch.startedAt !== null && { startedAt: dispatch.startedAt }),
      ...(dispatch.endedAt !== null && { endedAt: dispatch.endedAt }),
      ...(dispatch.taskArn !== null && { taskArn: dispatch.taskArn }),
      ...(exitCode !== undefined && { exitCode }),
      ...(dispatch.errorMessage !== null && { errorMessage: dispatch.errorMessage }),
    };

    // Cache the response (only for non-streaming requests)
    if (logOffset === undefined && !skipLogs) {
      this.cacheStatus(dispatchId, response);
    }

    this.logger.info(
      {
        dispatchId,
        status,
        progress,
        logCount: logs.length,
        taskArn: dispatch.taskArn,
      },
      'Status retrieved'
    );

    return response;
  }

  /**
   * Stream logs since a specific offset
   * Convenience method for real-time log streaming
   *
   * @param dispatchId - The dispatch ID
   * @param offset - The log offset from previous request
   * @param limit - Maximum logs to return
   * @returns New logs since offset and next offset
   */
  async streamLogs(
    dispatchId: string,
    offset?: string,
    limit: number = DEFAULT_LOG_LIMIT
  ): Promise<{ logs: LogEntry[]; nextOffset: string; hasMore: boolean }> {
    const options: GetStatusOptions = {
      logLimit: limit,
      skipLogs: false,
    };

    // Only add logOffset if defined to satisfy exactOptionalPropertyTypes
    if (offset !== undefined) {
      (options as { logOffset: string }).logOffset = offset;
    }

    const status = await this.getStatus(dispatchId, options);

    return {
      logs: status.logs,
      nextOffset: status.logOffset,
      hasMore: status.logs.length >= limit,
    };
  }

  /**
   * Check if dispatch is in terminal state
   *
   * @param dispatchId - The dispatch ID
   * @returns true if completed, failed, timeout, or cancelled
   */
  async isTerminal(dispatchId: string): Promise<boolean> {
    const status = await this.getStatus(dispatchId, { skipLogs: true });
    return this.isTerminalStatusValue(status.status);
  }

  /**
   * Clear cached status for a dispatch
   * Useful when status is externally updated
   *
   * @param dispatchId - The dispatch ID
   */
  clearCache(dispatchId: string): void {
    this.statusCache.delete(dispatchId);
    this.logger.debug({ dispatchId }, 'Cache cleared');
  }

  /**
   * Clear all cached statuses
   */
  clearAllCaches(): void {
    this.statusCache.clear();
    this.logger.debug('All status caches cleared');
  }

  /**
   * Describe ECS task to get current status
   */
  private async describeEcsTask(taskArn: string): Promise<Task | undefined> {
    const clusterArn = this.config.ecs.clusterArn;

    if (clusterArn === undefined) {
      this.logger.warn('ECS cluster ARN not configured');
      return undefined;
    }

    try {
      const response = await this.ecsClient.send(
        new DescribeTasksCommand({
          cluster: clusterArn,
          tasks: [taskArn],
        })
      );

      if (response.tasks === undefined || response.tasks.length === 0) {
        this.logger.debug({ taskArn }, 'Task not found in ECS');
        return undefined;
      }

      return response.tasks[0];
    } catch (error) {
      this.logger.warn({ taskArn, error }, 'Failed to describe ECS task');
      return undefined;
    }
  }

  /**
   * Fetch logs from CloudWatch with pagination
   */
  private async fetchLogs(
    agent: AgentType,
    dispatchId: string,
    offset: string | undefined,
    limit: number
  ): Promise<{ logs: LogEntry[]; nextOffset: string }> {
    const logGroupName = buildLogGroupName(agent);
    const logStreamName = dispatchId;

    try {
      const response = await this.logsClient.send(
        new GetLogEventsCommand({
          logGroupName,
          logStreamName,
          limit,
          startFromHead: true,
          nextToken: offset !== undefined && offset !== '' ? offset : undefined,
        })
      );

      const logs = convertLogEvents(response.events ?? []);
      const nextOffset = response.nextForwardToken ?? '';

      return { logs, nextOffset };
    } catch (error) {
      // Handle log stream not found gracefully
      const errorName = (error as Error).name;
      if (errorName === 'ResourceNotFoundException') {
        this.logger.debug({ logGroupName, logStreamName }, 'Log stream not found');
        return { logs: [], nextOffset: '' };
      }

      this.logger.warn(
        { logGroupName, logStreamName, error },
        'Failed to fetch logs from CloudWatch'
      );
      return { logs: [], nextOffset: offset ?? '' };
    }
  }

  /**
   * Map ECS task status to dispatch status
   */
  private mapEcsStatus(task: Task, dispatch: DispatchRecord): DispatchStatusValue {
    const ecsStatus = task.lastStatus ?? 'UNKNOWN';
    const mappedStatus = ECS_STATUS_MAP[ecsStatus];

    if (mappedStatus === undefined) {
      this.logger.warn({ ecsStatus }, 'Unknown ECS status');
      return 'running';
    }

    // If ECS says stopped, determine success/failure from stop reason and exit code
    if (mappedStatus === 'success' && task.stoppedReason !== undefined) {
      const reason = task.stoppedReason.toLowerCase();

      if (reason.includes('timeout') || reason.includes('essential container')) {
        return 'timeout';
      }
      if (reason.includes('error') || reason.includes('failed')) {
        return 'failed';
      }

      // Check container exit code
      const exitCode = this.extractExitCode(task);
      if (exitCode !== undefined && exitCode !== 0) {
        return 'failed';
      }
    }

    return mappedStatus;
  }

  /**
   * Map dispatch record status to DispatchStatusValue
   */
  private mapDispatchStatus(dbStatus: DispatchRecord['status']): DispatchStatusValue {
    const statusMap: Readonly<Record<DispatchRecord['status'], DispatchStatusValue>> = {
      PENDING: 'pending',
      RUNNING: 'running',
      COMPLETED: 'success',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      TIMEOUT: 'timeout',
    };

    return statusMap[dbStatus];
  }

  /**
   * Extract exit code from ECS task
   */
  private extractExitCode(task: Task): number | undefined {
    const containers = task.containers ?? [];

    if (containers.length === 0) {
      return undefined;
    }

    // Find main agent container exit code
    const agentContainer = containers.find((c) => c.name === 'agent');
    const container = agentContainer ?? containers[0];

    return container?.exitCode ?? undefined;
  }

  /**
   * Check if dispatch database status is terminal
   */
  private isTerminalStatus(status: DispatchRecord['status']): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMEOUT';
  }

  /**
   * Check if dispatch status value is terminal
   */
  private isTerminalStatusValue(status: DispatchStatusValue): boolean {
    return status === 'success' || status === 'failed' || status === 'cancelled' || status === 'timeout';
  }

  /**
   * Get cached status if not expired
   */
  private getCachedStatus(dispatchId: string): CachedStatus | undefined {
    const cached = this.statusCache.get(dispatchId);

    if (cached === undefined) {
      return undefined;
    }

    const age = Date.now() - cached.cachedAt;

    if (age > STATUS_CACHE_TTL_MS) {
      this.statusCache.delete(dispatchId);
      return undefined;
    }

    return cached;
  }

  /**
   * Cache status response
   */
  private cacheStatus(dispatchId: string, status: DispatchStatus): void {
    this.statusCache.set(dispatchId, {
      status,
      cachedAt: Date.now(),
    });

    // Prune old cache entries periodically
    if (this.statusCache.size > 1000) {
      this.pruneCache();
    }
  }

  /**
   * Remove expired cache entries
   */
  private pruneCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, value] of this.statusCache.entries()) {
      if (now - value.cachedAt > STATUS_CACHE_TTL_MS) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.statusCache.delete(key);
    }

    this.logger.debug({ prunedCount: keysToDelete.length }, 'Cache pruned');
  }
}

/**
 * Singleton factory
 */
let trackerInstance: DispatchStatusTracker | null = null;

export function getDispatchStatusTracker(): DispatchStatusTracker {
  if (trackerInstance === null) {
    trackerInstance = new DispatchStatusTracker();
  }
  return trackerInstance;
}

/**
 * For testing - reset singleton
 */
export function resetDispatchStatusTracker(): void {
  trackerInstance = null;
}
