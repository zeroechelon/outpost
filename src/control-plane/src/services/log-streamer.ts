/**
 * Real-Time Log Streaming Service for Dispatch Execution
 *
 * Provides CloudWatch Logs subscription with polling-based streaming:
 * - Subscribe to live log updates with configurable polling intervals
 * - Fetch historical logs with pagination support
 * - Rate limiting to prevent CloudWatch API throttling
 * - Graceful handling of missing log groups/streams
 *
 * Log Group Pattern: /outpost/agents/{agent-type}
 * Log Stream Pattern: {dispatch-id}
 */

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  FilterLogEventsCommand,
  DescribeLogStreamsCommand,
  type OutputLogEvent,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { NotFoundError, RateLimitError } from '../utils/errors.js';
import type { AgentType } from '../types/agent.js';

/**
 * Log entry with parsed metadata
 */
export interface LogEntry {
  readonly timestamp: Date;
  readonly message: string;
  readonly level: 'info' | 'warn' | 'error' | 'debug';
  readonly ingestionTime?: Date;
}

/**
 * Options for fetching logs
 */
export interface LogStreamOptions {
  /** Dispatch ID to fetch logs for */
  readonly dispatchId: string;
  /** Agent type for log group selection */
  readonly agentType: AgentType;
  /** Start timestamp for filtering (inclusive) */
  readonly startTime?: Date;
  /** End timestamp for filtering (exclusive) */
  readonly endTime?: Date;
  /** Maximum number of log entries to return */
  readonly limit?: number;
  /** Pagination token from previous request */
  readonly nextToken?: string;
}

/**
 * Result from log fetch operation
 */
export interface LogStreamResult {
  /** Retrieved log entries */
  readonly logs: LogEntry[];
  /** Token for fetching next page */
  readonly nextToken?: string;
  /** Whether more logs are available */
  readonly hasMore: boolean;
  /** Timestamp of last log entry (for incremental polling) */
  readonly lastTimestamp?: Date;
}

/**
 * Active subscription for real-time log streaming
 */
export interface StreamSubscription {
  /** Dispatch ID being monitored */
  readonly dispatchId: string;
  /** Agent type for log group */
  readonly agentType: AgentType;
  /** Callback invoked with new logs */
  readonly callback: (logs: LogEntry[]) => void;
  /** Polling interval timer */
  readonly interval: NodeJS.Timeout;
  /** Last fetched timestamp for incremental polling */
  lastTimestamp: Date;
  /** Whether subscription is active */
  active: boolean;
}

/**
 * Rate limiter state for CloudWatch API calls
 */
interface RateLimiterState {
  /** Timestamps of recent requests */
  readonly requestTimestamps: number[];
  /** Maximum requests per window */
  readonly maxRequests: number;
  /** Window duration in milliseconds */
  readonly windowMs: number;
}

/**
 * Configuration for log streaming service
 */
export interface LogStreamerConfig {
  /** Polling interval in milliseconds (default: 1500ms for <2s latency) */
  readonly pollingIntervalMs: number;
  /** Maximum requests per rate limit window */
  readonly rateLimitRequests: number;
  /** Rate limit window in milliseconds */
  readonly rateLimitWindowMs: number;
  /** Default log limit per fetch */
  readonly defaultLimit: number;
  /** Maximum log limit per fetch */
  readonly maxLimit: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: LogStreamerConfig = {
  pollingIntervalMs: 1500, // 1.5s polling for <2s latency target
  rateLimitRequests: 10, // 10 requests per window
  rateLimitWindowMs: 1000, // 1 second window (CloudWatch limit: 10 TPS)
  defaultLimit: 100,
  maxLimit: 10000,
};

/**
 * Build CloudWatch log group name for an agent type
 */
function buildLogGroupName(agentType: AgentType): string {
  return `/outpost/agents/${agentType}`;
}

/**
 * Parse log level from message content
 */
function parseLogLevel(message: string): LogEntry['level'] {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('[error]') ||
    lowerMessage.includes('error:') ||
    lowerMessage.includes('exception') ||
    lowerMessage.includes('fatal')
  ) {
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
 * Convert CloudWatch log events to LogEntry array
 */
function convertOutputLogEvents(events: OutputLogEvent[]): LogEntry[] {
  return events
    .filter(
      (event): event is OutputLogEvent & { message: string; timestamp: number } =>
        event.message !== undefined && event.timestamp !== undefined
    )
    .map((event) => ({
      timestamp: new Date(event.timestamp),
      message: event.message.trim(),
      level: parseLogLevel(event.message),
      ...(event.ingestionTime !== undefined && { ingestionTime: new Date(event.ingestionTime) }),
    }));
}

/**
 * Convert FilteredLogEvents to LogEntry array
 */
function convertFilteredLogEvents(events: FilteredLogEvent[]): LogEntry[] {
  return events
    .filter(
      (event): event is FilteredLogEvent & { message: string; timestamp: number } =>
        event.message !== undefined && event.timestamp !== undefined
    )
    .map((event) => ({
      timestamp: new Date(event.timestamp),
      message: event.message.trim(),
      level: parseLogLevel(event.message),
      ...(event.ingestionTime !== undefined && { ingestionTime: new Date(event.ingestionTime) }),
    }));
}

/**
 * LogStreamerService - Real-time log streaming with CloudWatch Logs
 *
 * Features:
 * - Polling-based subscription for real-time updates
 * - Pagination support for historical log fetching
 * - Rate limiting to prevent API throttling
 * - Graceful error handling for missing resources
 */
export class LogStreamerService {
  private readonly logger = getLogger().child({ service: 'LogStreamerService' });
  private readonly logsClient: CloudWatchLogsClient;
  private readonly config: LogStreamerConfig;
  private readonly awsRegion: string;

  /** Active subscriptions indexed by dispatchId */
  private readonly subscriptions: Map<string, StreamSubscription> = new Map();

  /** Rate limiter state */
  private readonly rateLimiter: RateLimiterState;

  constructor(logsClient?: CloudWatchLogsClient, config?: Partial<LogStreamerConfig>) {
    const appConfig = getConfig();
    this.awsRegion = appConfig.awsRegion;
    this.logsClient = logsClient ?? new CloudWatchLogsClient({ region: this.awsRegion });
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.rateLimiter = {
      requestTimestamps: [],
      maxRequests: this.config.rateLimitRequests,
      windowMs: this.config.rateLimitWindowMs,
    };

    this.logger.info(
      {
        pollingIntervalMs: this.config.pollingIntervalMs,
        rateLimitRequests: this.config.rateLimitRequests,
        rateLimitWindowMs: this.config.rateLimitWindowMs,
      },
      'LogStreamerService initialized'
    );
  }

  /**
   * Fetch logs with optional pagination and time filtering
   *
   * @param options - Log stream options
   * @returns Log entries with pagination metadata
   * @throws RateLimitError if rate limit exceeded
   */
  async fetchLogs(options: LogStreamOptions): Promise<LogStreamResult> {
    const {
      dispatchId,
      agentType,
      startTime,
      endTime,
      limit = this.config.defaultLimit,
      nextToken,
    } = options;

    const logGroupName = buildLogGroupName(agentType);
    const logStreamName = dispatchId;
    const effectiveLimit = Math.min(limit, this.config.maxLimit);

    this.logger.debug(
      {
        dispatchId,
        agentType,
        logGroupName,
        startTime,
        endTime,
        limit: effectiveLimit,
        hasNextToken: nextToken !== undefined,
      },
      'Fetching logs'
    );

    // Check rate limit
    await this.checkRateLimit();

    try {
      // Use FilterLogEvents for time-filtered queries (more efficient for ranges)
      if (startTime !== undefined || endTime !== undefined) {
        return await this.fetchFilteredLogs(
          logGroupName,
          logStreamName,
          startTime,
          endTime,
          effectiveLimit,
          nextToken
        );
      }

      // Use GetLogEvents for simple sequential fetching
      return await this.fetchSequentialLogs(
        logGroupName,
        logStreamName,
        effectiveLimit,
        nextToken
      );
    } catch (error) {
      return this.handleLogFetchError(error, logGroupName, logStreamName, nextToken);
    }
  }

  /**
   * Subscribe to real-time log updates for a dispatch
   *
   * @param dispatchId - Dispatch ID to monitor
   * @param agentType - Agent type for log group selection
   * @param callback - Function called with new log entries
   * @returns Subscription ID (same as dispatchId)
   */
  subscribe(
    dispatchId: string,
    agentType: AgentType,
    callback: (logs: LogEntry[]) => void
  ): string {
    // Check if already subscribed
    if (this.subscriptions.has(dispatchId)) {
      this.logger.warn({ dispatchId }, 'Already subscribed, replacing existing subscription');
      this.unsubscribe(dispatchId);
    }

    const startTimestamp = new Date();

    // Create polling interval
    const interval = setInterval(() => {
      void this.pollForLogs(dispatchId);
    }, this.config.pollingIntervalMs);

    const subscription: StreamSubscription = {
      dispatchId,
      agentType,
      callback,
      interval,
      lastTimestamp: startTimestamp,
      active: true,
    };

    this.subscriptions.set(dispatchId, subscription);

    this.logger.info(
      {
        dispatchId,
        agentType,
        pollingIntervalMs: this.config.pollingIntervalMs,
        startTimestamp,
      },
      'Subscription created'
    );

    // Perform initial fetch immediately
    void this.pollForLogs(dispatchId);

    return dispatchId;
  }

  /**
   * Unsubscribe from log updates
   *
   * @param dispatchId - Dispatch ID to stop monitoring
   * @returns true if subscription existed and was removed
   */
  unsubscribe(dispatchId: string): boolean {
    const subscription = this.subscriptions.get(dispatchId);

    if (subscription === undefined) {
      this.logger.debug({ dispatchId }, 'No active subscription found');
      return false;
    }

    // Stop polling
    clearInterval(subscription.interval);
    subscription.active = false;

    // Remove from map
    this.subscriptions.delete(dispatchId);

    this.logger.info({ dispatchId }, 'Subscription removed');
    return true;
  }

  /**
   * Get all active subscriptions
   *
   * @returns Array of active subscription metadata
   */
  getActiveSubscriptions(): ReadonlyArray<{
    dispatchId: string;
    agentType: AgentType;
    lastTimestamp: Date;
    active: boolean;
  }> {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      dispatchId: sub.dispatchId,
      agentType: sub.agentType,
      lastTimestamp: sub.lastTimestamp,
      active: sub.active,
    }));
  }

  /**
   * Check if a dispatch has an active subscription
   *
   * @param dispatchId - Dispatch ID to check
   * @returns true if subscription exists and is active
   */
  hasSubscription(dispatchId: string): boolean {
    const subscription = this.subscriptions.get(dispatchId);
    return subscription !== undefined && subscription.active;
  }

  /**
   * Stop all active subscriptions
   * Useful for graceful shutdown
   */
  stopAll(): void {
    const subscriptionIds = Array.from(this.subscriptions.keys());

    for (const dispatchId of subscriptionIds) {
      this.unsubscribe(dispatchId);
    }

    this.logger.info({ count: subscriptionIds.length }, 'All subscriptions stopped');
  }

  /**
   * Check if log stream exists in CloudWatch
   *
   * @param dispatchId - Dispatch ID (log stream name)
   * @param agentType - Agent type for log group
   * @returns true if log stream exists
   */
  async checkLogStreamExists(dispatchId: string, agentType: AgentType): Promise<boolean> {
    const logGroupName = buildLogGroupName(agentType);

    try {
      await this.checkRateLimit();

      const response = await this.logsClient.send(
        new DescribeLogStreamsCommand({
          logGroupName,
          logStreamNamePrefix: dispatchId,
          limit: 1,
        })
      );

      const exists =
        response.logStreams !== undefined &&
        response.logStreams.some((stream) => stream.logStreamName === dispatchId);

      this.logger.debug({ dispatchId, agentType, exists }, 'Log stream existence check');
      return exists;
    } catch (error) {
      const errorName = (error as Error).name;
      if (errorName === 'ResourceNotFoundException') {
        this.logger.debug({ logGroupName }, 'Log group not found');
        return false;
      }

      this.logger.warn({ dispatchId, agentType, error }, 'Failed to check log stream existence');
      return false;
    }
  }

  /**
   * Poll for new logs and invoke callback
   */
  private async pollForLogs(dispatchId: string): Promise<void> {
    const subscription = this.subscriptions.get(dispatchId);

    if (subscription === undefined || !subscription.active) {
      this.logger.debug({ dispatchId }, 'Subscription no longer active, skipping poll');
      return;
    }

    try {
      const result = await this.fetchLogs({
        dispatchId,
        agentType: subscription.agentType,
        startTime: subscription.lastTimestamp,
      });

      if (result.logs.length > 0) {
        // Update last timestamp for incremental polling
        // Add 1ms to avoid fetching the same log again
        const lastLog = result.logs[result.logs.length - 1];
        if (lastLog !== undefined) {
          subscription.lastTimestamp = new Date(lastLog.timestamp.getTime() + 1);
        }

        // Invoke callback with new logs
        try {
          subscription.callback(result.logs);
        } catch (callbackError) {
          this.logger.error({ dispatchId, error: callbackError }, 'Subscription callback error');
        }

        this.logger.debug(
          { dispatchId, newLogs: result.logs.length, lastTimestamp: subscription.lastTimestamp },
          'Delivered new logs to subscriber'
        );
      }
    } catch (error) {
      if (error instanceof RateLimitError) {
        this.logger.warn({ dispatchId }, 'Rate limited during poll, will retry next interval');
      } else {
        this.logger.error({ dispatchId, error }, 'Error polling for logs');
      }
    }
  }

  /**
   * Fetch logs using FilterLogEvents (efficient for time ranges)
   */
  private async fetchFilteredLogs(
    logGroupName: string,
    logStreamName: string,
    startTime: Date | undefined,
    endTime: Date | undefined,
    limit: number,
    nextToken: string | undefined
  ): Promise<LogStreamResult> {
    const response = await this.logsClient.send(
      new FilterLogEventsCommand({
        logGroupName,
        logStreamNames: [logStreamName],
        startTime: startTime?.getTime(),
        endTime: endTime?.getTime(),
        limit,
        nextToken,
      })
    );

    const logs = convertFilteredLogEvents(response.events ?? []);
    const hasMore = response.nextToken !== undefined;
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : undefined;

    return {
      logs,
      hasMore,
      ...(response.nextToken !== undefined && { nextToken: response.nextToken }),
      ...(lastLog !== undefined && { lastTimestamp: lastLog.timestamp }),
    };
  }

  /**
   * Fetch logs using GetLogEvents (simple sequential access)
   */
  private async fetchSequentialLogs(
    logGroupName: string,
    logStreamName: string,
    limit: number,
    nextToken: string | undefined
  ): Promise<LogStreamResult> {
    const response = await this.logsClient.send(
      new GetLogEventsCommand({
        logGroupName,
        logStreamName,
        limit,
        startFromHead: true,
        nextToken: nextToken !== undefined && nextToken !== '' ? nextToken : undefined,
      })
    );

    const logs = convertOutputLogEvents(response.events ?? []);
    // GetLogEvents always returns a nextToken even when no more logs
    // Check if we got fewer logs than limit to determine hasMore
    const hasMore = logs.length >= limit && response.nextForwardToken !== nextToken;
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : undefined;

    return {
      logs,
      hasMore,
      ...(response.nextForwardToken !== undefined && { nextToken: response.nextForwardToken }),
      ...(lastLog !== undefined && { lastTimestamp: lastLog.timestamp }),
    };
  }

  /**
   * Handle errors from log fetch operations
   */
  private handleLogFetchError(
    error: unknown,
    logGroupName: string,
    logStreamName: string,
    nextToken: string | undefined
  ): LogStreamResult {
    const errorName = (error as Error).name;

    // Handle log group/stream not found gracefully
    if (errorName === 'ResourceNotFoundException') {
      this.logger.debug(
        { logGroupName, logStreamName },
        'Log group or stream not found, returning empty result'
      );
      return {
        logs: [],
        hasMore: false,
      };
    }

    // Handle throttling
    if (errorName === 'ThrottlingException' || errorName === 'LimitExceededException') {
      this.logger.warn({ logGroupName, logStreamName }, 'CloudWatch throttled request');
      throw new RateLimitError('CloudWatch API rate limit exceeded');
    }

    // Log and return empty for other errors
    this.logger.error(
      { logGroupName, logStreamName, error },
      'Unexpected error fetching logs'
    );

    return {
      logs: [],
      hasMore: false,
      ...(nextToken !== undefined && { nextToken }),
    };
  }

  /**
   * Check and enforce rate limiting
   * Implements sliding window rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.rateLimiter.windowMs;

    // Remove timestamps outside the window
    const timestamps = this.rateLimiter.requestTimestamps as number[];
    while (timestamps.length > 0 && timestamps[0] !== undefined && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    // Check if we're at the limit
    if (timestamps.length >= this.rateLimiter.maxRequests) {
      const oldestInWindow = timestamps[0];
      if (oldestInWindow !== undefined) {
        const waitMs = oldestInWindow + this.rateLimiter.windowMs - now;

        if (waitMs > 0) {
          this.logger.debug({ waitMs, currentRequests: timestamps.length }, 'Rate limit reached, waiting');
          await this.sleep(waitMs);
        }
      }
    }

    // Record this request
    timestamps.push(now);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton factory
 */
let streamerInstance: LogStreamerService | null = null;

export function getLogStreamerService(): LogStreamerService {
  if (streamerInstance === null) {
    streamerInstance = new LogStreamerService();
  }
  return streamerInstance;
}

/**
 * For testing - reset singleton
 */
export function resetLogStreamerService(): void {
  if (streamerInstance !== null) {
    streamerInstance.stopAll();
    streamerInstance = null;
  }
}
