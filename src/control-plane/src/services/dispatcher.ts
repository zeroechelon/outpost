/**
 * Dispatcher Service - Orchestrates the full dispatch flow for ECS task execution
 *
 * Coordinates:
 * 1. ULID generation for dispatch_id
 * 2. Request validation with Zod
 * 3. Task definition selection (task-selector)
 * 4. Secret validation/preparation (secret-injector)
 * 5. Dispatch record persistence (DynamoDB)
 * 6. ECS task launch (task-launcher)
 * 7. EventBridge cost event emission
 *
 * Returns immediately after launching ECS task - does not wait for completion.
 */

import { z } from 'zod';
import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { ValidationError, InternalError } from '../utils/errors.js';
import { selectTaskDefinition, type TaskSelectionResult, type ModelTier } from './task-selector.js';
import { SecretInjectorService, getSecretInjectorService } from './secret-injector.js';
import { TaskLauncherService, getTaskLauncherService, type TaskLaunchRequest, type ResourceConstraints as TaskLauncherResourceConstraints } from './task-launcher.js';
import {
  DispatchRepository,
  type DispatchRecord,
} from '../repositories/dispatch.repository.js';
import type { AgentType } from '../types/agent.js';

/**
 * Supported agent types for validation
 */
const AGENT_TYPES = ['claude', 'codex', 'gemini', 'aider', 'grok'] as const;

/**
 * Resource constraints for ECS task overrides (T5.3)
 */
const ResourceConstraintsSchema = z.object({
  maxMemoryMb: z.number().int().min(512).max(30720).optional(),
  maxCpuUnits: z.number().int().min(256).max(4096).optional(),
  maxDiskGb: z.number().int().min(21).max(200).optional(),
});

/**
 * Zod schema for dispatch request validation
 */
const DispatchRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required').max(64, 'userId too long'),
  agent: z.enum(AGENT_TYPES, { errorMap: () => ({ message: `agent must be one of: ${AGENT_TYPES.join(', ')}` }) }),
  task: z.string().min(1, 'task is required').max(50000, 'task exceeds maximum length of 50000 characters'),
  modelId: z.string().optional(),
  repoUrl: z.string().url('repoUrl must be a valid URL').optional(),
  workspaceMode: z.enum(['ephemeral', 'persistent']).default('ephemeral'),
  workspaceInitMode: z.enum(['full', 'minimal', 'none']).default('full'),
  timeoutSeconds: z.number().int().min(30).max(86400).default(600),
  contextLevel: z.enum(['minimal', 'standard', 'full']).default('standard'),
  additionalSecrets: z.array(z.string()).optional(),
  // T5.1: Idempotency key for deduplication
  idempotencyKey: z.string().max(128).optional(),
  // T5.2: Tags for categorization and filtering
  tags: z.record(z.string(), z.string()).optional(),
  // T5.3: Resource constraints for ECS task overrides
  resourceConstraints: ResourceConstraintsSchema.optional(),
});

/**
 * Resource constraints interface (T5.3)
 */
export interface ResourceConstraints {
  readonly maxMemoryMb?: number;
  readonly maxCpuUnits?: number;
  readonly maxDiskGb?: number;
}

/**
 * Dispatch request interface
 */
export interface DispatchRequest {
  readonly userId: string;
  readonly agent: AgentType;
  readonly task: string;
  readonly modelId?: string;
  readonly repoUrl?: string;
  readonly workspaceMode?: 'ephemeral' | 'persistent';
  readonly workspaceInitMode?: 'full' | 'minimal' | 'none';
  readonly timeoutSeconds?: number;
  readonly contextLevel?: 'minimal' | 'standard' | 'full';
  readonly additionalSecrets?: string[];
  // T5.1: Idempotency key for deduplication
  readonly idempotencyKey?: string;
  // T5.2: Tags for categorization and filtering
  readonly tags?: Record<string, string>;
  // T5.3: Resource constraints for ECS task overrides
  readonly resourceConstraints?: ResourceConstraints;
}

/**
 * Dispatch result returned immediately after launching
 */
export interface DispatchResult {
  readonly dispatchId: string;
  readonly status: 'pending' | 'provisioning';
  readonly agent: AgentType;
  readonly modelId: string;
  readonly estimatedStartTime: Date;
  // T5.1: Indicates if response was from idempotency cache
  readonly idempotent?: boolean;
  // T5.2: Tags associated with the dispatch
  readonly tags?: Record<string, string>;
}

/**
 * EFS mount configuration for persistent workspaces
 */
export interface EfsMountConfig {
  readonly fileSystemId: string;
  readonly accessPointId: string;
  readonly mountPath: string;
  readonly rootDirectory: string;
}

/**
 * Resource limits based on model tier
 */
interface ResourceLimits {
  readonly cpu: number;
  readonly memory: number;
  readonly ephemeralStorage: number;
}

/**
 * Ledger cost event payload for EventBridge
 */
interface LedgerCostEvent {
  readonly dispatchId: string;
  readonly userId: string;
  readonly agent: AgentType;
  readonly modelId: string;
  readonly tier: ModelTier;
  readonly resourceLimits: ResourceLimits;
  readonly startedAt: string;
  readonly workspaceMode: 'ephemeral' | 'persistent';
}

/**
 * AWS Constants
 */
const AWS_REGION = 'us-east-1';
const EVENT_BUS_NAME = 'outpost-events';
const COST_EVENT_SOURCE = 'outpost.dispatcher';
const COST_EVENT_DETAIL_TYPE = 'LedgerCostEvent';

/**
 * Resource limits per model tier (cpu in vCPU units, memory/storage in MB)
 */
const TIER_RESOURCE_LIMITS: Readonly<Record<ModelTier, ResourceLimits>> = {
  flagship: { cpu: 2048, memory: 4096, ephemeralStorage: 21474836480 }, // 20GB
  balanced: { cpu: 1024, memory: 2048, ephemeralStorage: 10737418240 }, // 10GB
  fast: { cpu: 512, memory: 1024, ephemeralStorage: 5368709120 }, // 5GB
};

/**
 * Estimated start time offsets by tier (ms)
 */
const TIER_START_TIME_OFFSET: Readonly<Record<ModelTier, number>> = {
  flagship: 30000, // 30 seconds
  balanced: 20000, // 20 seconds
  fast: 15000, // 15 seconds
};

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
 *
 * ULID format: TTTTTTTTTTRRRRRRRRRRRRRRRRR
 * - T: Timestamp (10 chars, Crockford Base32)
 * - R: Randomness (16 chars, Crockford Base32)
 *
 * Implementation note: Using timestamp-prefixed UUID-like format for
 * lexicographic sortability while maintaining uniqueness.
 */
function generateUlid(): string {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32

  // Timestamp component (48 bits = 10 chars in base32)
  const now = Date.now();
  let timestamp = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    timestamp = ENCODING[t % 32] + timestamp;
    t = Math.floor(t / 32);
  }

  // Random component (80 bits = 16 chars in base32)
  let random = '';
  for (let i = 0; i < 16; i++) {
    random += ENCODING[Math.floor(Math.random() * 32)];
  }

  return timestamp + random;
}

/**
 * DispatcherOrchestrator - Main service for orchestrating dispatch operations
 */
export class DispatcherOrchestrator {
  private readonly logger = getLogger().child({ service: 'DispatcherOrchestrator' });
  private readonly secretInjector: SecretInjectorService;
  private readonly taskLauncher: TaskLauncherService;
  private readonly dispatchRepository: DispatchRepository;
  private readonly eventBridgeClient: EventBridgeClient;
  private readonly config = getConfig();

  constructor(
    secretInjector?: SecretInjectorService,
    taskLauncher?: TaskLauncherService,
    dispatchRepository?: DispatchRepository,
    eventBridgeClient?: EventBridgeClient
  ) {
    this.secretInjector = secretInjector ?? getSecretInjectorService();
    this.taskLauncher = taskLauncher ?? getTaskLauncherService();
    this.dispatchRepository = dispatchRepository ?? new DispatchRepository();
    this.eventBridgeClient =
      eventBridgeClient ??
      new EventBridgeClient({
        region: this.config.awsRegion,
      });
  }

  /**
   * Dispatch a task to an agent for execution
   *
   * Flow:
   * 0. T5.1: Check idempotency key and return existing dispatch if found
   * 1. Generate ULID dispatch_id
   * 2. Validate request with Zod
   * 3. Select task definition and get resource config
   * 4. Validate secrets exist in Secrets Manager
   * 5. Create dispatch record in DynamoDB (PENDING)
   * 6. Launch ECS task
   * 7. Update dispatch record with task ARN (PROVISIONING)
   * 8. Emit cost event to EventBridge
   * 9. Return dispatch result immediately
   *
   * @param request - Dispatch request parameters
   * @returns DispatchResult with dispatch_id and status
   * @throws ValidationError if request validation fails
   * @throws NotFoundError if secrets are missing
   * @throws ServiceUnavailableError if ECS capacity unavailable
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    // T5.1: Step 0 - Check idempotency key before anything else
    if (request.idempotencyKey !== undefined) {
      const existingDispatch = await this.dispatchRepository.findByIdempotencyKey(
        request.userId,
        request.idempotencyKey
      );

      if (existingDispatch !== null) {
        this.logger.info(
          {
            dispatchId: existingDispatch.dispatchId,
            idempotencyKey: request.idempotencyKey,
          },
          'Returning existing dispatch for idempotency key'
        );

        // Map DB status to API status
        const statusMap: Record<string, 'pending' | 'provisioning'> = {
          PENDING: 'pending',
          RUNNING: 'provisioning',
          COMPLETED: 'provisioning',
          FAILED: 'provisioning',
          CANCELLED: 'provisioning',
          TIMEOUT: 'provisioning',
        };

        const idempotentResult: DispatchResult = {
          dispatchId: existingDispatch.dispatchId,
          status: statusMap[existingDispatch.status] ?? 'provisioning',
          agent: existingDispatch.agent,
          modelId: existingDispatch.modelId,
          estimatedStartTime: existingDispatch.startedAt,
          idempotent: true,
        };

        // Only add tags if defined (exactOptionalPropertyTypes compliance)
        if (existingDispatch.tags !== undefined && existingDispatch.tags !== null) {
          (idempotentResult as { tags: Record<string, string> }).tags = existingDispatch.tags;
        }

        return idempotentResult;
      }
    }

    // Step 1: Generate ULID
    const dispatchId = generateUlid();

    this.logger.info(
      {
        dispatchId,
        agent: request.agent,
        userId: request.userId,
        workspaceMode: request.workspaceMode ?? 'ephemeral',
      },
      'Starting dispatch orchestration'
    );

    // Step 2: Validate request with Zod
    const validationResult = DispatchRequestSchema.safeParse(request);
    if (!validationResult.success) {
      const errors = validationResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Request validation failed: ${errors}`, {
        errors: validationResult.error.errors,
      });
    }

    const validatedRequest = validationResult.data;
    const workspaceMode = validatedRequest.workspaceMode;
    const workspaceInitMode = validatedRequest.workspaceInitMode;
    const timeoutSeconds = validatedRequest.timeoutSeconds;

    // Step 3: Select task definition and get resource configuration
    let taskSelection: TaskSelectionResult;
    try {
      taskSelection = selectTaskDefinition(validatedRequest.agent, validatedRequest.modelId);
    } catch (error) {
      this.logger.error({ dispatchId, error }, 'Task selection failed');
      throw error;
    }

    this.logger.debug(
      {
        dispatchId,
        taskDefinitionArn: taskSelection.taskDefinitionArn,
        modelId: taskSelection.modelId,
        tier: taskSelection.tier,
      },
      'Task definition selected'
    );

    // Step 4: Validate secrets exist
    try {
      await this.secretInjector.buildContainerSecrets(
        validatedRequest.agent,
        validatedRequest.userId,
        validatedRequest.additionalSecrets
      );
    } catch (error) {
      this.logger.error({ dispatchId, error }, 'Secret validation failed');
      throw error;
    }

    this.logger.debug({ dispatchId }, 'Secrets validated');

    // Step 5: Create dispatch record in DynamoDB with PENDING status
    let dispatchRecord: DispatchRecord;
    try {
      dispatchRecord = await this.createDispatchRecord(dispatchId, validatedRequest, taskSelection);
    } catch (error) {
      this.logger.error({ dispatchId, error }, 'Failed to create dispatch record');
      throw new InternalError('Failed to create dispatch record', {
        dispatchId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.logger.debug({ dispatchId, status: dispatchRecord.status }, 'Dispatch record created');

    // Step 6: Launch ECS task
    let taskArn: string;
    try {
      // Build launch request, omitting undefined optional fields for exactOptionalPropertyTypes
      const launchRequest: TaskLaunchRequest = {
        dispatchId,
        userId: validatedRequest.userId,
        agent: validatedRequest.agent,
        task: validatedRequest.task,
        workspaceMode,
        workspaceInitMode,
        timeoutSeconds,
      };

      // Add optional fields only if defined
      if (validatedRequest.modelId !== undefined) {
        (launchRequest as { modelId?: string }).modelId = validatedRequest.modelId;
      }
      if (validatedRequest.repoUrl !== undefined) {
        (launchRequest as { repoUrl?: string }).repoUrl = validatedRequest.repoUrl;
      }
      if (validatedRequest.additionalSecrets !== undefined) {
        (launchRequest as { additionalSecrets?: readonly string[] }).additionalSecrets = validatedRequest.additionalSecrets;
      }
      // T5.3: Add resource constraints if defined
      if (validatedRequest.resourceConstraints !== undefined) {
        const rc = validatedRequest.resourceConstraints;
        const resourceConstraints: TaskLauncherResourceConstraints = {};
        if (rc.maxMemoryMb !== undefined) {
          (resourceConstraints as { maxMemoryMb: number }).maxMemoryMb = rc.maxMemoryMb;
        }
        if (rc.maxCpuUnits !== undefined) {
          (resourceConstraints as { maxCpuUnits: number }).maxCpuUnits = rc.maxCpuUnits;
        }
        if (rc.maxDiskGb !== undefined) {
          (resourceConstraints as { maxDiskGb: number }).maxDiskGb = rc.maxDiskGb;
        }
        (launchRequest as { resourceConstraints?: TaskLauncherResourceConstraints }).resourceConstraints = resourceConstraints;
      }

      const launchResult = await this.taskLauncher.launchTask(launchRequest);

      taskArn = launchResult.taskArn;

      this.logger.info(
        {
          dispatchId,
          taskArn,
          taskId: launchResult.taskId,
        },
        'ECS task launched'
      );
    } catch (error) {
      // Mark dispatch as failed if ECS launch fails
      await this.markDispatchFailed(
        dispatchId,
        dispatchRecord.version,
        `ECS launch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }

    // Step 7: Update dispatch record with task ARN and RUNNING status
    // Note: ECS status will be PROVISIONING -> PENDING -> RUNNING
    // We mark as RUNNING since the task is now in ECS hands
    try {
      await this.dispatchRepository.updateStatus(dispatchId, 'RUNNING', dispatchRecord.version, {
        taskArn,
      });
    } catch (error) {
      this.logger.warn({ dispatchId, error }, 'Failed to update dispatch status to RUNNING');
      // Don't throw - task is launched, status update is best-effort
    }

    // Step 8: Emit cost event to EventBridge (async, don't wait)
    const resourceLimits = TIER_RESOURCE_LIMITS[taskSelection.tier];
    this.emitCostEvent({
      dispatchId,
      userId: validatedRequest.userId,
      agent: validatedRequest.agent,
      modelId: taskSelection.modelId,
      tier: taskSelection.tier,
      resourceLimits,
      startedAt: new Date().toISOString(),
      workspaceMode,
    }).catch((error) => {
      this.logger.warn({ dispatchId, error }, 'Failed to emit cost event');
    });

    // Step 9: Return dispatch result immediately
    const estimatedStartTime = new Date(
      Date.now() + TIER_START_TIME_OFFSET[taskSelection.tier]
    );

    const result: DispatchResult = {
      dispatchId,
      status: 'provisioning',
      agent: validatedRequest.agent,
      modelId: taskSelection.modelId,
      estimatedStartTime,
      // T5.2: Include tags in result
      ...(validatedRequest.tags !== undefined && { tags: validatedRequest.tags }),
    };

    this.logger.info(
      {
        dispatchId,
        status: result.status,
        estimatedStartTime: estimatedStartTime.toISOString(),
      },
      'Dispatch completed successfully'
    );

    return result;
  }

  /**
   * Create dispatch record in DynamoDB
   * Uses custom dispatchId instead of auto-generated one
   * T5.1: Stores idempotency key mapping
   * T5.2: Stores tags
   */
  private async createDispatchRecord(
    dispatchId: string,
    request: z.infer<typeof DispatchRequestSchema>,
    taskSelection: TaskSelectionResult
  ): Promise<DispatchRecord> {
    // Build create input with required fields
    const createInput: {
      dispatchId: string;
      userId: string;
      agent: typeof request.agent;
      modelId: string;
      task: string;
      idempotencyKey?: string;
      tags?: Record<string, string>;
    } = {
      dispatchId,
      userId: request.userId,
      agent: request.agent,
      modelId: taskSelection.modelId,
      task: request.task,
    };

    // T5.1: Add idempotency key only if defined
    if (request.idempotencyKey !== undefined) {
      createInput.idempotencyKey = request.idempotencyKey;
    }

    // T5.2: Add tags only if defined
    if (request.tags !== undefined) {
      createInput.tags = request.tags;
    }

    const record = await this.dispatchRepository.create(createInput);

    this.logger.debug(
      { dispatchId: record.dispatchId },
      'Dispatch record created'
    );

    return record;
  }

  /**
   * Mark dispatch as failed in DynamoDB
   */
  private async markDispatchFailed(
    dispatchId: string,
    version: number,
    errorMessage: string
  ): Promise<void> {
    try {
      await this.dispatchRepository.markFailed(dispatchId, version, errorMessage);
      this.logger.info({ dispatchId }, 'Dispatch marked as failed');
    } catch (error) {
      this.logger.error({ dispatchId, error }, 'Failed to mark dispatch as failed');
    }
  }

  /**
   * Emit cost event to EventBridge for Ledger tracking
   */
  private async emitCostEvent(event: LedgerCostEvent): Promise<void> {
    const entry: PutEventsRequestEntry = {
      EventBusName: EVENT_BUS_NAME,
      Source: COST_EVENT_SOURCE,
      DetailType: COST_EVENT_DETAIL_TYPE,
      Time: new Date(),
      Detail: JSON.stringify(event),
    };

    this.logger.debug(
      {
        dispatchId: event.dispatchId,
        eventBus: EVENT_BUS_NAME,
      },
      'Emitting cost event to EventBridge'
    );

    await this.eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [entry],
      })
    );

    this.logger.debug(
      {
        dispatchId: event.dispatchId,
      },
      'Cost event emitted successfully'
    );
  }

  /**
   * Get EFS mount configuration for persistent workspaces
   *
   * @param dispatchId - The dispatch ID for workspace directory
   * @returns EfsMountConfig or null if EFS not configured
   */
  getEfsMountConfig(dispatchId: string): EfsMountConfig | null {
    const fileSystemId = this.config.efs.fileSystemId;
    const accessPointId = this.config.efs.accessPointId;
    const mountPath = this.config.efs.mountPath;

    if (fileSystemId === undefined || accessPointId === undefined) {
      this.logger.debug('EFS not configured, returning null');
      return null;
    }

    return {
      fileSystemId,
      accessPointId,
      mountPath,
      rootDirectory: `${mountPath}/${dispatchId}`,
    };
  }

  /**
   * Get resource limits for a model tier
   *
   * @param tier - Model tier (flagship, balanced, fast)
   * @returns ResourceLimits with cpu, memory, ephemeralStorage
   */
  getResourceLimitsForTier(tier: ModelTier): ResourceLimits {
    return TIER_RESOURCE_LIMITS[tier];
  }

  /**
   * Cancel a dispatch by stopping its ECS task
   *
   * @param dispatchId - The dispatch ID to cancel
   * @param reason - Reason for cancellation
   */
  async cancelDispatch(dispatchId: string, reason: string): Promise<void> {
    this.logger.info({ dispatchId, reason }, 'Cancelling dispatch');

    const dispatch = await this.dispatchRepository.getById(dispatchId);

    if (dispatch.status === 'COMPLETED' || dispatch.status === 'FAILED' || dispatch.status === 'CANCELLED') {
      throw new ValidationError('Cannot cancel dispatch in terminal state', {
        dispatchId,
        currentStatus: dispatch.status,
      });
    }

    // Stop ECS task if running
    if (dispatch.taskArn !== null) {
      const clusterArn = this.config.ecs.clusterArn;
      if (clusterArn !== undefined) {
        try {
          await this.taskLauncher.stopTask(dispatch.taskArn, clusterArn, reason);
        } catch (error) {
          this.logger.warn({ dispatchId, taskArn: dispatch.taskArn, error }, 'Failed to stop ECS task');
        }
      }
    }

    // Update status to CANCELLED
    await this.dispatchRepository.updateStatus(dispatchId, 'CANCELLED', dispatch.version);

    this.logger.info({ dispatchId }, 'Dispatch cancelled');
  }

  /**
   * Get dispatch status
   *
   * @param dispatchId - The dispatch ID to query
   * @returns DispatchRecord with current status
   */
  async getDispatchStatus(dispatchId: string): Promise<DispatchRecord> {
    return this.dispatchRepository.getById(dispatchId);
  }
}

/**
 * Singleton factory
 */
let orchestratorInstance: DispatcherOrchestrator | null = null;

export function getDispatcherOrchestrator(): DispatcherOrchestrator {
  if (orchestratorInstance === null) {
    orchestratorInstance = new DispatcherOrchestrator();
  }
  return orchestratorInstance;
}

/**
 * For testing - reset singleton
 */
export function resetDispatcherOrchestrator(): void {
  orchestratorInstance = null;
}

/**
 * Export ULID generator for external use
 */
export { generateUlid };
