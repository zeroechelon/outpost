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
}

/**
 * Input for creating a new dispatch
 */
export interface CreateDispatchInput {
  readonly userId: string;
  readonly agent: AgentType;
  readonly modelId: string;
  readonly task: string;
}

/**
 * Query options for listing dispatches by user
 */
export interface ListDispatchesQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: DispatchStatus;
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

  return item;
}

function fromDynamoItem(item: Record<string, unknown>): DispatchRecord {
  return {
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
  };
}

export class DispatchRepository {
  private readonly tableName: string;
  private readonly gsiName = 'user_id-started_at-index';
  private readonly logger = getLogger().child({ repository: 'DispatchRepository' });

  constructor() {
    const prefix = process.env['DYNAMODB_TABLE_PREFIX'] ?? 'outpost';
    this.tableName = `${prefix}-dispatches`;
  }

  /**
   * Create a new dispatch record
   */
  async create(input: CreateDispatchInput): Promise<DispatchRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const record: DispatchRecord = {
      dispatchId: uuidv4(),
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
    };

    this.logger.debug({ dispatchId: record.dispatchId, userId: input.userId }, 'Creating dispatch');

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toDynamoItem(record),
        ConditionExpression: 'attribute_not_exists(dispatch_id)',
      })
    );

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

    if (query.status !== undefined) {
      params.FilterExpression = '#status = :statusFilter';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':statusFilter': query.status,
      };
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
}
