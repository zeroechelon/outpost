/**
 * Dispatch repository for DynamoDB operations
 * Manages dispatch state persistence with optimistic locking
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocClient } from './base.repository.js';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, ConflictError, InternalError } from '../utils/errors.js';
import type { AgentType } from '../types/agent.js';

/**
 * Dispatch status values
 */
export type DispatchStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

/**
 * Dispatch record stored in DynamoDB
 */
export interface DispatchRecord {
  readonly dispatchId: string;
  readonly userId: string;
  readonly agent: AgentType;
  readonly modelId: string;
  readonly task: string;
  readonly status: DispatchStatus;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly taskArn: string | null;
  readonly workspaceId: string | null;
  readonly artifactsUrl: string | null;
  readonly errorMessage: string | null;
  readonly version: number;
  // T5.1: Idempotency key for deduplication
  readonly idempotencyKey: string | null;
  // T5.2: Tags for categorization and filtering
  readonly tags: Record<string, string> | null;
  // T0.2: Optional expiration timestamp for dispatch lifecycle management
  readonly expiresAt?: string;
}

/**
 * Input for creating a new dispatch
 */
export interface CreateDispatchInput {
  readonly dispatchId?: string;
  readonly userId: string;
  readonly agent: AgentType;
  readonly modelId: string;
  readonly task: string;
  // T5.1: Idempotency key for deduplication
  readonly idempotencyKey?: string;
  // T5.2: Tags for categorization and filtering
  readonly tags?: Record<string, string>;
}

/**
 * Query options for listing dispatches by user
 */
export interface ListDispatchesQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: DispatchStatus;
  // T5.4: Tag filtering with AND logic (all tags must match)
  readonly tags?: Record<string, string>;
}

/**
 * DynamoDB item shape
 */
interface DispatchDynamoItem {
  dispatch_id: string;
  user_id: string;
  agent: string;
  model_id: string;
  task: string;
  status: string;
  started_at: string;
  ended_at?: string;
  task_arn?: string;
  workspace_id?: string;
  artifacts_url?: string;
  error_message?: string;
  version: number;
  // T5.1: Idempotency key for deduplication
  idempotency_key?: string;
  // T5.2: Tags for categorization and filtering
  tags?: Record<string, string>;
  // T0.2: TTL attribute for automatic expiration
  expires_at?: number;
}

function toDynamoItem(record: DispatchRecord): DispatchDynamoItem {
  const item: DispatchDynamoItem = {
    dispatch_id: record.dispatchId,
    user_id: record.userId,
    agent: record.agent,
    model_id: record.modelId,
    task: record.task,
    status: record.status,
    started_at: record.startedAt.toISOString(),
    version: record.version,
  };

  if (record.endedAt !== null) {
    item.ended_at = record.endedAt.toISOString();
  }
  if (record.taskArn !== null) {
    item.task_arn = record.taskArn;
  }
  if (record.workspaceId !== null) {
    item.workspace_id = record.workspaceId;
  }
  if (record.artifactsUrl !== null) {
    item.artifacts_url = record.artifactsUrl;
  }
  if (record.errorMessage !== null) {
    item.error_message = record.errorMessage;
  }
  // T5.1: Idempotency key
  if (record.idempotencyKey !== null) {
    item.idempotency_key = record.idempotencyKey;
  }
  // T5.2: Tags
  if (record.tags !== null && Object.keys(record.tags).length > 0) {
    item.tags = record.tags;
  }
  // T0.2: Expiration timestamp (convert ISO string to Unix epoch seconds for DynamoDB TTL)
  if (record.expiresAt !== undefined) {
    item.expires_at = Math.floor(new Date(record.expiresAt).getTime() / 1000);
  }

  return item;
}

function fromDynamoItem(item: Record<string, unknown>): DispatchRecord {
  const record: DispatchRecord = {
    dispatchId: item['dispatch_id'] as string,
    userId: item['user_id'] as string,
    agent: item['agent'] as AgentType,
    modelId: item['model_id'] as string,
    task: item['task'] as string,
    status: item['status'] as DispatchStatus,
    startedAt: new Date(item['started_at'] as string),
    endedAt: item['ended_at'] !== undefined ? new Date(item['ended_at'] as string) : null,
    taskArn: (item['task_arn'] as string) ?? null,
    workspaceId: (item['workspace_id'] as string) ?? null,
    artifactsUrl: (item['artifacts_url'] as string) ?? null,
    errorMessage: (item['error_message'] as string) ?? null,
    version: item['version'] as number,
    // T5.1: Idempotency key
    idempotencyKey: (item['idempotency_key'] as string) ?? null,
    // T5.2: Tags
    tags: (item['tags'] as Record<string, string>) ?? null,
  };

  // T0.2: Expiration timestamp (convert Unix epoch seconds to ISO string)
  if (item['expires_at'] !== undefined) {
    return {
      ...record,
      expiresAt: new Date((item['expires_at'] as number) * 1000).toISOString()
    };
  }

  return record;
}

export class DispatchRepository {
  private readonly tableName: string;
  private readonly idempotencyTableName: string;
  private readonly gsiName = 'user_id-started_at-index';
  private readonly logger = getLogger().child({ repository: 'DispatchRepository' });

  constructor() {
    const prefix = process.env['DYNAMODB_TABLE_PREFIX'] ?? 'outpost';
    this.tableName = `${prefix}-dispatches`;
    this.idempotencyTableName = `${prefix}-dispatch-idempotency`;
  }

  /**
   * T0.3: Calculate expires_at timestamp (90 days from now)
   */
  private calculateExpiresAt(): string {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));
    return expiresAt.toISOString();
  }

  /**
   * T5.1: Find dispatch by idempotency key
   * Returns the dispatch if found, null otherwise
   */
  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<DispatchRecord | null> {
    const docClient = getDocClient();
    const compositeKey = `${userId}#${idempotencyKey}`;

    this.logger.debug({ userId, idempotencyKey }, 'Looking up dispatch by idempotency key');

    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.idempotencyTableName,
          Key: { idempotency_key: compositeKey },
        })
      );

      if (result.Item === undefined) {
        return null;
      }

      const dispatchId = result.Item['dispatch_id'] as string;
      return this.getById(dispatchId);
    } catch (error) {
      // If table doesn't exist, return null (graceful degradation)
      this.logger.warn({ error }, 'Idempotency lookup failed, continuing without idempotency');
      return null;
    }
  }

  /**
   * Create a new dispatch record
   */
  async create(input: CreateDispatchInput): Promise<DispatchRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const record: DispatchRecord = {
      dispatchId: input.dispatchId ?? uuidv4(),
      userId: input.userId,
      agent: input.agent,
      modelId: input.modelId,
      task: input.task,
      status: 'PENDING',
      startedAt: now,
      endedAt: null,
      taskArn: null,
      workspaceId: null,
      artifactsUrl: null,
      errorMessage: null,
      version: 1,
      // T5.1: Idempotency key
      idempotencyKey: input.idempotencyKey ?? null,
      // T5.2: Tags
      tags: input.tags ?? null,
    };

    this.logger.debug({ dispatchId: record.dispatchId, userId: input.userId }, 'Creating dispatch');

    // T0.3: Calculate expires_at (90 days from now, Unix timestamp)
    const expiresAtIso = this.calculateExpiresAt();
    const expiresAtUnix = Math.floor(new Date(expiresAtIso).getTime() / 1000);

    const item: DispatchDynamoItem = {
      ...toDynamoItem(record),
      expires_at: expiresAtUnix,
    };

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(dispatch_id)',
      })
    );

    // T5.1: Store idempotency key mapping if provided
    if (input.idempotencyKey !== undefined) {
      const compositeKey = `${input.userId}#${input.idempotencyKey}`;
      const ttlSeconds = 24 * 60 * 60; // 24 hour TTL for idempotency keys
      const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;

      try {
        await docClient.send(
          new PutCommand({
            TableName: this.idempotencyTableName,
            Item: {
              idempotency_key: compositeKey,
              dispatch_id: record.dispatchId,
              created_at: now.toISOString(),
              ttl,
            },
          })
        );
        this.logger.debug({ dispatchId: record.dispatchId, idempotencyKey: input.idempotencyKey }, 'Stored idempotency key mapping');
      } catch (error) {
        // Non-fatal: idempotency table might not exist yet
        this.logger.warn({ error, idempotencyKey: input.idempotencyKey }, 'Failed to store idempotency key mapping');
      }
    }

    return record;
  }

  /**
   * Get dispatch by ID
   */
  async getById(dispatchId: string): Promise<DispatchRecord> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { dispatch_id: dispatchId },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`Dispatch not found: ${dispatchId}`);
    }

    return fromDynamoItem(result.Item);
  }

  /**
   * Update dispatch status with optimistic locking
   */
  async updateStatus(
    dispatchId: string,
    status: DispatchStatus,
    currentVersion: number,
    updates?: Partial<Pick<DispatchRecord, 'taskArn' | 'workspaceId' | 'artifactsUrl' | 'errorMessage'>>
  ): Promise<DispatchRecord> {
    const docClient = getDocClient();

    const updateExpressions: string[] = ['#status = :status', '#version = :newVersion'];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#version': 'version',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':currentVersion': currentVersion,
      ':newVersion': currentVersion + 1,
    };

    if (updates !== undefined) {
      if (updates.taskArn !== undefined) {
        updateExpressions.push('task_arn = :taskArn');
        expressionAttributeValues[':taskArn'] = updates.taskArn;
      }
      if (updates.workspaceId !== undefined) {
        updateExpressions.push('workspace_id = :workspaceId');
        expressionAttributeValues[':workspaceId'] = updates.workspaceId;
      }
      if (updates.artifactsUrl !== undefined) {
        updateExpressions.push('artifacts_url = :artifactsUrl');
        expressionAttributeValues[':artifactsUrl'] = updates.artifactsUrl;
      }
      if (updates.errorMessage !== undefined) {
        updateExpressions.push('error_message = :errorMessage');
        expressionAttributeValues[':errorMessage'] = updates.errorMessage;
      }
    }

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { dispatch_id: dispatchId },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ConditionExpression: '#version = :currentVersion',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        })
      );

      if (result.Attributes === undefined) {
        throw new InternalError('Failed to update dispatch');
      }

      return fromDynamoItem(result.Attributes);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConflictError(`Dispatch ${dispatchId} was modified by another process`, {
          dispatchId,
          expectedVersion: currentVersion,
        });
      }
      throw error;
    }
  }

  /**
   * List dispatches by user ID, ordered by started_at descending
   * T5.4: Supports tag filtering with AND logic
   */
  async listByUser(
    userId: string,
    query: ListDispatchesQuery = {}
  ): Promise<{ items: DispatchRecord[]; nextCursor?: string }> {
    const docClient = getDocClient();
    const limit = query.limit ?? 20;

    const params: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: this.gsiName,
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Limit: limit,
      ScanIndexForward: false, // Descending order by started_at
    };

    if (query.cursor !== undefined) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(query.cursor, 'base64').toString('utf-8'));
    }

    // Build filter expressions
    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};

    if (query.status !== undefined) {
      filterExpressions.push('#status = :statusFilter');
      expressionAttributeNames['#status'] = 'status';
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':statusFilter': query.status,
      };
    }

    // T5.4: Tag filtering with AND logic - all specified tags must match
    if (query.tags !== undefined && Object.keys(query.tags).length > 0) {
      let tagIndex = 0;
      for (const [tagKey, tagValue] of Object.entries(query.tags)) {
        const keyPlaceholder = `#tagKey${tagIndex}`;
        const valuePlaceholder = `:tagValue${tagIndex}`;
        filterExpressions.push(`tags.${keyPlaceholder} = ${valuePlaceholder}`);
        expressionAttributeNames[keyPlaceholder] = tagKey;
        params.ExpressionAttributeValues = {
          ...params.ExpressionAttributeValues,
          [valuePlaceholder]: tagValue,
        };
        tagIndex++;
      }
    }

    // Apply filter expressions if any
    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    const result = await docClient.send(new QueryCommand(params));

    const items = (result.Items ?? []).map((item) => fromDynamoItem(item));

    if (result.LastEvaluatedKey !== undefined) {
      return {
        items,
        nextCursor: Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64'),
      };
    }

    return { items };
  }

  /**
   * Mark dispatch as completed
   */
  async markCompleted(
    dispatchId: string,
    currentVersion: number,
    artifactsUrl: string
  ): Promise<DispatchRecord> {
    const docClient = getDocClient();
    const now = new Date();

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { dispatch_id: dispatchId },
          UpdateExpression: 'SET #status = :status, ended_at = :endedAt, artifacts_url = :artifactsUrl, #version = :newVersion',
          ConditionExpression: '#version = :currentVersion',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':status': 'COMPLETED',
            ':endedAt': now.toISOString(),
            ':artifactsUrl': artifactsUrl,
            ':currentVersion': currentVersion,
            ':newVersion': currentVersion + 1,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      if (result.Attributes === undefined) {
        throw new InternalError('Failed to mark dispatch as completed');
      }

      return fromDynamoItem(result.Attributes);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConflictError(`Dispatch ${dispatchId} was modified by another process`, {
          dispatchId,
          expectedVersion: currentVersion,
        });
      }
      throw error;
    }
  }

  /**
   * Mark dispatch as failed
   */
  async markFailed(
    dispatchId: string,
    currentVersion: number,
    errorMessage: string
  ): Promise<DispatchRecord> {
    const docClient = getDocClient();
    const now = new Date();

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { dispatch_id: dispatchId },
          UpdateExpression: 'SET #status = :status, ended_at = :endedAt, error_message = :errorMessage, #version = :newVersion',
          ConditionExpression: '#version = :currentVersion',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':status': 'FAILED',
            ':endedAt': now.toISOString(),
            ':errorMessage': errorMessage,
            ':currentVersion': currentVersion,
            ':newVersion': currentVersion + 1,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      if (result.Attributes === undefined) {
        throw new InternalError('Failed to mark dispatch as failed');
      }

      return fromDynamoItem(result.Attributes);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConflictError(`Dispatch ${dispatchId} was modified by another process`, {
          dispatchId,
          expectedVersion: currentVersion,
        });
      }
      throw error;
    }
  }

  /**
   * Get dispatch metrics for health monitoring
   * Returns counts and aggregate statistics for recent dispatches
   */
  async getDispatchMetrics(sinceHoursAgo: number = 1): Promise<{
    totalDispatches: number;
    byStatus: Record<DispatchStatus, number>;
    byAgent: Record<string, { total: number; completed: number; failed: number; avgDurationMs: number }>;
  }> {
    const docClient = getDocClient();
    const sinceTime = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000);

    // Use Scan with time filter
    // Note: For production scale, use a GSI on started_at
    // This is acceptable for health checks due to 30-second caching
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await docClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'started_at >= :sinceTime',
        ExpressionAttributeValues: {
          ':sinceTime': sinceTime.toISOString(),
        },
      })
    );

    const items = (result.Items ?? []).map((item) => fromDynamoItem(item));

    // Calculate metrics
    const byStatus: Record<DispatchStatus, number> = {
      PENDING: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
      TIMEOUT: 0,
    };

    const byAgent: Record<string, { total: number; completed: number; failed: number; totalDurationMs: number; completedCount: number }> = {};

    for (const item of items) {
      // Count by status
      byStatus[item.status]++;

      // Initialize agent stats if needed
      if (byAgent[item.agent] === undefined) {
        byAgent[item.agent] = { total: 0, completed: 0, failed: 0, totalDurationMs: 0, completedCount: 0 };
      }

      const agentStats = byAgent[item.agent];
      if (agentStats !== undefined) {
        agentStats.total++;

        if (item.status === 'COMPLETED') {
          agentStats.completed++;
          if (item.endedAt !== null) {
            agentStats.totalDurationMs += item.endedAt.getTime() - item.startedAt.getTime();
            agentStats.completedCount++;
          }
        } else if (item.status === 'FAILED' || item.status === 'TIMEOUT') {
          agentStats.failed++;
        }
      }
    }

    // Convert to final format with average duration
    const byAgentFinal: Record<string, { total: number; completed: number; failed: number; avgDurationMs: number }> = {};
    for (const [agent, stats] of Object.entries(byAgent)) {
      byAgentFinal[agent] = {
        total: stats.total,
        completed: stats.completed,
        failed: stats.failed,
        avgDurationMs: stats.completedCount > 0 ? Math.round(stats.totalDurationMs / stats.completedCount) : 0,
      };
    }

    return {
      totalDispatches: items.length,
      byStatus,
      byAgent: byAgentFinal,
    };
  }
}
