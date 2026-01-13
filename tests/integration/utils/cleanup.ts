/**
 * Test cleanup utilities
 *
 * Provides helpers for cleaning up test resources after integration tests.
 * Tracks dispatches created during tests and cancels any that are still running.
 */

import type { ApiClient, DispatchStatusResponse } from './api-client.js';

/**
 * Terminal dispatch statuses that don't require cleanup
 */
const TERMINAL_STATUSES = new Set(['success', 'failed', 'timeout', 'cancelled']);

/**
 * Cleanup manager for tracking and cleaning up test dispatches
 */
export class DispatchCleanupManager {
  private readonly client: ApiClient;
  private readonly trackedDispatches: Set<string> = new Set();
  private readonly cleanupErrors: Array<{ dispatchId: string; error: string }> = [];

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Track a dispatch ID for cleanup
   */
  track(dispatchId: string): void {
    this.trackedDispatches.add(dispatchId);
  }

  /**
   * Untrack a dispatch ID (e.g., if it completed normally)
   */
  untrack(dispatchId: string): void {
    this.trackedDispatches.delete(dispatchId);
  }

  /**
   * Get all tracked dispatch IDs
   */
  getTrackedDispatches(): string[] {
    return Array.from(this.trackedDispatches);
  }

  /**
   * Get cleanup errors that occurred
   */
  getCleanupErrors(): Array<{ dispatchId: string; error: string }> {
    return [...this.cleanupErrors];
  }

  /**
   * Check if a dispatch is in a terminal state
   */
  private isTerminalStatus(status: string): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  /**
   * Attempt to cancel a single dispatch
   * Returns true if cleanup was successful or unnecessary
   */
  async cleanupDispatch(dispatchId: string): Promise<boolean> {
    try {
      // First check the current status
      const statusResponse = await this.client.getDispatchStatus(dispatchId, { skipLogs: true });

      if (!statusResponse.body.success) {
        // Dispatch might not exist or we don't have access - consider it cleaned up
        this.untrack(dispatchId);
        return true;
      }

      const status = (statusResponse.body as DispatchStatusResponse).data.status;

      // If already in terminal state, no cleanup needed
      if (this.isTerminalStatus(status)) {
        this.untrack(dispatchId);
        return true;
      }

      // Attempt to cancel
      const cancelResponse = await this.client.cancelDispatch(dispatchId, 'Integration test cleanup');

      if (cancelResponse.body.success) {
        this.untrack(dispatchId);
        return true;
      }

      this.cleanupErrors.push({
        dispatchId,
        error: `Cancel failed: ${JSON.stringify(cancelResponse.body)}`,
      });
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.cleanupErrors.push({
        dispatchId,
        error: `Exception during cleanup: ${errorMessage}`,
      });
      return false;
    }
  }

  /**
   * Clean up all tracked dispatches
   * Returns the number of dispatches that failed cleanup
   */
  async cleanupAll(): Promise<number> {
    const dispatches = this.getTrackedDispatches();

    if (dispatches.length === 0) {
      return 0;
    }

    console.log(`Cleaning up ${dispatches.length} tracked dispatch(es)...`);

    const results = await Promise.allSettled(
      dispatches.map((id) => this.cleanupDispatch(id))
    );

    const failures = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
    ).length;

    if (failures > 0) {
      console.warn(`Failed to clean up ${failures} dispatch(es)`);
    }

    return failures;
  }

  /**
   * Reset the cleanup manager
   */
  reset(): void {
    this.trackedDispatches.clear();
    this.cleanupErrors.length = 0;
  }
}

/**
 * Wait for a dispatch to reach a terminal state (with timeout)
 */
export async function waitForTerminalState(
  client: ApiClient,
  dispatchId: string,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<DispatchStatusResponse['data']> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await client.getDispatchStatus(dispatchId, { skipLogs: true });

    if (!response.body.success) {
      throw new Error(`Failed to get dispatch status: ${JSON.stringify(response.body)}`);
    }

    const data = (response.body as DispatchStatusResponse).data;

    if (TERMINAL_STATUSES.has(data.status)) {
      return data;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Dispatch ${dispatchId} did not reach terminal state within ${timeoutMs}ms`);
}

/**
 * Create a cleanup callback for Jest afterEach/afterAll hooks
 */
export function createCleanupCallback(manager: DispatchCleanupManager): () => Promise<void> {
  return async () => {
    const failures = await manager.cleanupAll();
    if (failures > 0) {
      const errors = manager.getCleanupErrors();
      console.error('Cleanup errors:', errors);
    }
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry helper for flaky operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && shouldRetry(error)) {
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after error: ${error}`);
        await sleep(retryDelayMs * (attempt + 1)); // Exponential backoff
      }
    }
  }

  throw lastError;
}

/**
 * Timeout wrapper for async operations
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${message} (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Assert that a dispatch reaches expected final state
 */
export async function assertDispatchCompletes(
  client: ApiClient,
  dispatchId: string,
  expectedStatus: 'success' | 'failed' | 'timeout' | 'cancelled',
  timeoutMs: number = 120000
): Promise<DispatchStatusResponse['data']> {
  const finalState = await waitForTerminalState(client, dispatchId, timeoutMs);

  if (finalState.status !== expectedStatus) {
    throw new Error(
      `Expected dispatch ${dispatchId} to end with status '${expectedStatus}' but got '${finalState.status}'`
    );
  }

  return finalState;
}
