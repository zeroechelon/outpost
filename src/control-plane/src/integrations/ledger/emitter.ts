/**
 * Ledger Event Emitter - T5.2
 *
 * Emits dispatch_complete events to EventBridge for Ledger cost tracking.
 * Integrates with CostCalculatorService and TokenCounterService to build
 * comprehensive cost events with all required billing fields.
 *
 * EventBridge Configuration:
 * - Event Bus: outpost-events (or default)
 * - Source: outpost.control-plane
 * - Detail Type: LedgerCostEvent
 *
 * @module integrations/ledger/emitter
 */

import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { getLogger } from '../../utils/logger.js';
import { getConfig } from '../../utils/config.js';
import { CostCalculatorService, type CostBreakdown, type CostInput } from './cost-calculator.js';
import { TokenCounterService, type TokenUsage } from './token-counter.js';
import type { AgentType } from '../../types/agent.js';
import type { DispatchRecord, DispatchStatus } from '../../repositories/dispatch.repository.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Dispatch status mapped to Ledger event status
 */
export type LedgerEventStatus = 'success' | 'failure' | 'timeout' | 'cancelled';

/**
 * Token information for Ledger event
 */
export interface LedgerTokens {
  readonly input: number;
  readonly output: number;
  readonly source: 'parsed' | 'estimated' | 'unavailable';
}

/**
 * Resource information for Ledger event
 */
export interface LedgerResources {
  readonly vcpu: number;
  readonly memoryMb: number;
  readonly networkEgressBytes?: number;
}

/**
 * Full LedgerCostEvent schema (from T0.2)
 */
export interface LedgerCostEvent {
  readonly eventType: 'dispatch_complete';
  readonly userId: string;
  readonly dispatchId: string;
  readonly agent: AgentType;
  readonly modelId: string;
  readonly status: LedgerEventStatus;
  readonly startedAt: string; // ISO timestamp
  readonly endedAt: string; // ISO timestamp
  readonly durationSeconds: number;
  readonly resources: LedgerResources;
  readonly tokens: LedgerTokens;
  readonly workspaceMode: 'ephemeral' | 'persistent';
  readonly efsStorageBytes?: number;
  readonly costBreakdown: CostBreakdown;
}

/**
 * Dispatch completion data for emitting events
 */
export interface DispatchCompletionData {
  readonly dispatch: DispatchRecord;
  readonly outputLog: string;
  readonly resources: LedgerResources;
  readonly workspaceMode: 'ephemeral' | 'persistent';
  readonly efsStorageBytes?: number;
}

/**
 * Extended dispatch record with additional completion metadata
 */
export interface EnrichedDispatchRecord extends DispatchRecord {
  readonly endedAt: Date; // Required for completion
}

// ============================================================================
// Constants
// ============================================================================

/**
 * EventBridge configuration
 */
const EVENT_BUS_NAME = process.env['EVENTBRIDGE_BUS_NAME'] ?? 'outpost-events';
const EVENT_SOURCE = 'outpost.control-plane';
const EVENT_DETAIL_TYPE = 'LedgerCostEvent';

/**
 * Map DispatchStatus to LedgerEventStatus
 */
const STATUS_MAP: Readonly<Record<DispatchStatus, LedgerEventStatus | null>> = {
  PENDING: null, // Not a completion state
  RUNNING: null, // Not a completion state
  COMPLETED: 'success',
  FAILED: 'failure',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
};

/**
 * Default resource values when not provided
 */
const DEFAULT_RESOURCES: LedgerResources = {
  vcpu: 1024, // 1 vCPU
  memoryMb: 2048, // 2 GB
};

// ============================================================================
// LedgerEventEmitter Service
// ============================================================================

/**
 * Service for emitting Ledger cost events to EventBridge
 *
 * Usage:
 * ```typescript
 * const emitter = getLedgerEventEmitter();
 * await emitter.emitDispatchComplete({
 *   dispatch: dispatchRecord,
 *   outputLog: taskOutput,
 *   resources: { vcpu: 2048, memoryMb: 4096 },
 *   workspaceMode: 'ephemeral',
 * });
 * ```
 */
export class LedgerEventEmitter {
  private readonly logger = getLogger().child({ service: 'LedgerEventEmitter' });
  private readonly eventBridgeClient: EventBridgeClient;
  private readonly costCalculator: CostCalculatorService;
  private readonly tokenCounter: TokenCounterService;
  private readonly eventBusName: string;

  constructor(
    eventBridgeClient?: EventBridgeClient,
    costCalculator?: CostCalculatorService,
    tokenCounter?: TokenCounterService,
    eventBusName?: string
  ) {
    const config = getConfig();
    this.eventBridgeClient =
      eventBridgeClient ??
      new EventBridgeClient({
        region: config.awsRegion,
      });
    this.costCalculator = costCalculator ?? new CostCalculatorService();
    this.tokenCounter = tokenCounter ?? new TokenCounterService();
    this.eventBusName = eventBusName ?? EVENT_BUS_NAME;
  }

  /**
   * Emit dispatch_complete event after task completion
   *
   * Main entry point for Ledger integration. Called when a dispatch
   * reaches a terminal state (success, failure, timeout, cancelled).
   *
   * @param data - Dispatch completion data including output log
   * @returns Promise that resolves when event is sent
   * @throws Error if dispatch is not in terminal state or EventBridge fails
   */
  async emitDispatchComplete(data: DispatchCompletionData): Promise<void> {
    const { dispatch, outputLog, resources, workspaceMode, efsStorageBytes } = data;

    this.logger.info(
      {
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        agent: dispatch.agent,
      },
      'Emitting dispatch_complete event'
    );

    // Validate dispatch is in terminal state
    const eventStatus = STATUS_MAP[dispatch.status];
    if (eventStatus === null) {
      this.logger.warn(
        {
          dispatchId: dispatch.dispatchId,
          status: dispatch.status,
        },
        'Cannot emit event for non-terminal dispatch state'
      );
      throw new Error(`Cannot emit event for dispatch in ${dispatch.status} state`);
    }

    // Validate endedAt is set
    if (dispatch.endedAt === null) {
      this.logger.error(
        { dispatchId: dispatch.dispatchId },
        'Dispatch endedAt is null for terminal state'
      );
      throw new Error('Dispatch endedAt must be set for terminal state');
    }

    // Extract tokens from output log
    const tokens = this.tokenCounter.countTokens(dispatch.agent, outputLog);
    this.logger.debug(
      {
        dispatchId: dispatch.dispatchId,
        tokensInput: tokens.tokensInput,
        tokensOutput: tokens.tokensOutput,
        tokenSource: tokens.source,
      },
      'Tokens extracted from output'
    );

    // Calculate cost breakdown
    const costBreakdown = this.calculateCost(
      dispatch,
      tokens,
      resources,
      workspaceMode,
      efsStorageBytes
    );
    this.logger.debug(
      {
        dispatchId: dispatch.dispatchId,
        totalCost: costBreakdown.total,
      },
      'Cost calculated'
    );

    // Build and send event
    const event = this.buildCostEvent(
      dispatch as EnrichedDispatchRecord,
      tokens,
      costBreakdown,
      resources,
      workspaceMode,
      efsStorageBytes
    );

    await this.sendToEventBridge(event);

    this.logger.info(
      {
        dispatchId: dispatch.dispatchId,
        status: eventStatus,
        totalCost: costBreakdown.total,
      },
      'Dispatch complete event emitted successfully'
    );
  }

  /**
   * Build LedgerCostEvent payload from dispatch data
   *
   * @param dispatch - Completed dispatch record
   * @param tokens - Token usage from output parsing
   * @param costBreakdown - Calculated cost breakdown
   * @param resources - Resource allocation
   * @param workspaceMode - Ephemeral or persistent workspace
   * @param efsStorageBytes - EFS storage size (for persistent)
   * @returns LedgerCostEvent ready for EventBridge
   */
  buildCostEvent(
    dispatch: EnrichedDispatchRecord,
    tokens: TokenUsage,
    costBreakdown: CostBreakdown,
    resources: LedgerResources,
    workspaceMode: 'ephemeral' | 'persistent',
    efsStorageBytes?: number
  ): LedgerCostEvent {
    const eventStatus = STATUS_MAP[dispatch.status];
    if (eventStatus === null) {
      throw new Error(`Invalid status for cost event: ${dispatch.status}`);
    }

    const startedAt = dispatch.startedAt.toISOString();
    const endedAt = dispatch.endedAt.toISOString();
    const durationSeconds = Math.round(
      (dispatch.endedAt.getTime() - dispatch.startedAt.getTime()) / 1000
    );

    const event: LedgerCostEvent = {
      eventType: 'dispatch_complete',
      userId: dispatch.userId,
      dispatchId: dispatch.dispatchId,
      agent: dispatch.agent,
      modelId: dispatch.modelId,
      status: eventStatus,
      startedAt,
      endedAt,
      durationSeconds,
      resources: {
        vcpu: resources.vcpu,
        memoryMb: resources.memoryMb,
        ...(resources.networkEgressBytes !== undefined && {
          networkEgressBytes: resources.networkEgressBytes,
        }),
      },
      tokens: {
        input: tokens.tokensInput,
        output: tokens.tokensOutput,
        source: tokens.source,
      },
      workspaceMode,
      ...(efsStorageBytes !== undefined && { efsStorageBytes }),
      costBreakdown,
    };

    return event;
  }

  /**
   * Send event to EventBridge
   *
   * @param event - LedgerCostEvent to publish
   * @throws Error if EventBridge publish fails
   */
  async sendToEventBridge(event: LedgerCostEvent): Promise<void> {
    const entry: PutEventsRequestEntry = {
      EventBusName: this.eventBusName,
      Source: EVENT_SOURCE,
      DetailType: EVENT_DETAIL_TYPE,
      Time: new Date(),
      Detail: JSON.stringify(event),
    };

    this.logger.debug(
      {
        dispatchId: event.dispatchId,
        eventBus: this.eventBusName,
        source: EVENT_SOURCE,
        detailType: EVENT_DETAIL_TYPE,
      },
      'Sending event to EventBridge'
    );

    try {
      const result = await this.eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [entry],
        })
      );

      // Check for partial failures
      if (result.FailedEntryCount !== undefined && result.FailedEntryCount > 0) {
        const failedEntry = result.Entries?.find((e) => e.ErrorCode !== undefined);
        this.logger.error(
          {
            dispatchId: event.dispatchId,
            errorCode: failedEntry?.ErrorCode,
            errorMessage: failedEntry?.ErrorMessage,
          },
          'EventBridge publish failed'
        );
        throw new Error(
          `EventBridge publish failed: ${failedEntry?.ErrorCode ?? 'Unknown'} - ${failedEntry?.ErrorMessage ?? 'No message'}`
        );
      }

      this.logger.debug(
        {
          dispatchId: event.dispatchId,
          eventId: result.Entries?.[0]?.EventId,
        },
        'Event published to EventBridge'
      );
    } catch (error) {
      this.logger.error(
        {
          dispatchId: event.dispatchId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to send event to EventBridge'
      );
      throw error;
    }
  }

  /**
   * Calculate cost breakdown from dispatch data
   *
   * @param dispatch - Dispatch record
   * @param tokens - Token usage
   * @param resources - Resource allocation
   * @param workspaceMode - Ephemeral or persistent
   * @param efsStorageBytes - EFS storage size
   * @returns CostBreakdown with itemized costs
   */
  private calculateCost(
    dispatch: DispatchRecord,
    tokens: TokenUsage,
    resources: LedgerResources,
    workspaceMode: 'ephemeral' | 'persistent',
    efsStorageBytes?: number
  ): CostBreakdown {
    // Calculate duration in seconds
    const endedAt = dispatch.endedAt ?? new Date();
    const durationSeconds = Math.round(
      (endedAt.getTime() - dispatch.startedAt.getTime()) / 1000
    );

    const costInput: CostInput = {
      agent: dispatch.agent,
      modelId: dispatch.modelId,
      durationSeconds,
      vcpu: resources.vcpu / 1024, // Convert units to vCPU count
      memoryMb: resources.memoryMb,
      tokensInput: tokens.tokensInput,
      tokensOutput: tokens.tokensOutput,
      workspaceMode,
      ...(efsStorageBytes !== undefined && { efsSizeBytes: efsStorageBytes }),
    };

    return this.costCalculator.calculate(costInput);
  }

  /**
   * Emit event for successful dispatch completion
   *
   * Convenience method for success case.
   *
   * @param dispatch - Completed dispatch record
   * @param outputLog - Task output log
   * @param resources - Resource allocation (optional, uses defaults)
   */
  async emitSuccess(
    dispatch: DispatchRecord,
    outputLog: string,
    resources?: Partial<LedgerResources>
  ): Promise<void> {
    if (dispatch.status !== 'COMPLETED') {
      throw new Error(`Expected COMPLETED status, got ${dispatch.status}`);
    }

    await this.emitDispatchComplete({
      dispatch,
      outputLog,
      resources: { ...DEFAULT_RESOURCES, ...resources },
      workspaceMode: 'ephemeral',
    });
  }

  /**
   * Emit event for failed dispatch
   *
   * Convenience method for failure case.
   *
   * @param dispatch - Failed dispatch record
   * @param outputLog - Task output log
   * @param resources - Resource allocation (optional, uses defaults)
   */
  async emitFailure(
    dispatch: DispatchRecord,
    outputLog: string,
    resources?: Partial<LedgerResources>
  ): Promise<void> {
    if (dispatch.status !== 'FAILED') {
      throw new Error(`Expected FAILED status, got ${dispatch.status}`);
    }

    await this.emitDispatchComplete({
      dispatch,
      outputLog,
      resources: { ...DEFAULT_RESOURCES, ...resources },
      workspaceMode: 'ephemeral',
    });
  }

  /**
   * Emit event for timed out dispatch
   *
   * Convenience method for timeout case.
   *
   * @param dispatch - Timed out dispatch record
   * @param outputLog - Task output log (may be partial)
   * @param resources - Resource allocation (optional, uses defaults)
   */
  async emitTimeout(
    dispatch: DispatchRecord,
    outputLog: string,
    resources?: Partial<LedgerResources>
  ): Promise<void> {
    if (dispatch.status !== 'TIMEOUT') {
      throw new Error(`Expected TIMEOUT status, got ${dispatch.status}`);
    }

    await this.emitDispatchComplete({
      dispatch,
      outputLog,
      resources: { ...DEFAULT_RESOURCES, ...resources },
      workspaceMode: 'ephemeral',
    });
  }

  /**
   * Emit event for cancelled dispatch
   *
   * Convenience method for cancellation case.
   *
   * @param dispatch - Cancelled dispatch record
   * @param outputLog - Task output log (may be partial)
   * @param resources - Resource allocation (optional, uses defaults)
   */
  async emitCancelled(
    dispatch: DispatchRecord,
    outputLog: string,
    resources?: Partial<LedgerResources>
  ): Promise<void> {
    if (dispatch.status !== 'CANCELLED') {
      throw new Error(`Expected CANCELLED status, got ${dispatch.status}`);
    }

    await this.emitDispatchComplete({
      dispatch,
      outputLog,
      resources: { ...DEFAULT_RESOURCES, ...resources },
      workspaceMode: 'ephemeral',
    });
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let emitterInstance: LedgerEventEmitter | null = null;

/**
 * Get singleton LedgerEventEmitter instance
 */
export function getLedgerEventEmitter(): LedgerEventEmitter {
  if (emitterInstance === null) {
    emitterInstance = new LedgerEventEmitter();
  }
  return emitterInstance;
}

/**
 * For testing - reset singleton
 */
export function resetLedgerEventEmitter(): void {
  emitterInstance = null;
}
