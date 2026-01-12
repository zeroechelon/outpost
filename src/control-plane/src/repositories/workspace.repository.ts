/**
 * Workspace repository for DynamoDB operations
 * Manages user workspace persistence with composite key (user_id, workspace_id)
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocClient } from './base.repository.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError } from '../utils/errors.js';

/**
 * Workspace record stored in DynamoDB
 */
export interface WorkspaceRecord {
  readonly userId: string;
  readonly workspaceId: string;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly sizeBytes: number;
  readonly repoUrl: string | null;
  readonly efsAccessPointId: string | null;
}

/**
 * Input for creating a new workspace
 */
export interface CreateWorkspaceInput {
  readonly userId: string;
  readonly repoUrl?: string;
  readonly efsAccessPointId?: string;
}

/**
 * Query options for listing workspaces by user
 */
export interface ListWorkspacesQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * DynamoDB item shape
 */
interface WorkspaceDynamoItem {
  user_id: string;
  workspace_id: string;
  created_at: string;
  last_accessed_at: string;
  size_bytes: number;
  repo_url?: string;
  efs_access_point_id?: string;
}

function toDynamoItem(record: WorkspaceRecord): WorkspaceDynamoItem {
  const item: WorkspaceDynamoItem = {
    user_id: record.userId,
    workspace_id: record.workspaceId,
    created_at: record.createdAt.toISOString(),
    last_accessed_at: record.lastAccessedAt.toISOString(),
    size_bytes: record.sizeBytes,
  };

  if (record.repoUrl !== null) {
    item.repo_url = record.repoUrl;
  }
  if (record.efsAccessPointId !== null) {
    item.efs_access_point_id = record.efsAccessPointId;
  }

  return item;
}

function fromDynamoItem(item: Record<string, unknown>): WorkspaceRecord {
  return {
    userId: item['user_id'] as string,
    workspaceId: item['workspace_id'] as string,
    createdAt: new Date(item['created_at'] as string),
    lastAccessedAt: new Date(item['last_accessed_at'] as string),
    sizeBytes: item['size_bytes'] as number,
    repoUrl: (item['repo_url'] as string) ?? null,
    efsAccessPointId: (item['efs_access_point_id'] as string) ?? null,
  };
}

export class WorkspaceRepository {
  private readonly tableName: string;
  private readonly logger = getLogger().child({ repository: 'WorkspaceRepository' });

  constructor() {
    const prefix = process.env['DYNAMODB_TABLE_PREFIX'] ?? 'outpost';
    this.tableName = `${prefix}-workspaces`;
  }

  /**
   * Create a new workspace record
   */
  async create(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const record: WorkspaceRecord = {
      userId: input.userId,
      workspaceId: uuidv4(),
      createdAt: now,
      lastAccessedAt: now,
      sizeBytes: 0,
      repoUrl: input.repoUrl ?? null,
      efsAccessPointId: input.efsAccessPointId ?? null,
    };

    this.logger.debug(
      { workspaceId: record.workspaceId, userId: input.userId },
      'Creating workspace'
    );

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toDynamoItem(record),
        ConditionExpression: 'attribute_not_exists(user_id) AND attribute_not_exists(workspace_id)',
      })
    );

    return record;
  }

  /**
   * Get workspace by user ID and workspace ID
   */
  async getByUserAndId(userId: string, workspaceId: string): Promise<WorkspaceRecord> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          user_id: userId,
          workspace_id: workspaceId,
        },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`Workspace not found: ${workspaceId} for user ${userId}`);
    }

    return fromDynamoItem(result.Item);
  }

  /**
   * List workspaces by user ID, ordered by created_at descending
   */
  async listByUser(
    userId: string,
    query: ListWorkspacesQuery = {}
  ): Promise<{ items: WorkspaceRecord[]; nextCursor?: string }> {
    const docClient = getDocClient();
    const limit = query.limit ?? 20;

    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Limit: limit,
      ScanIndexForward: false, // Descending order by workspace_id (sort key)
    };

    if (query.cursor !== undefined) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(query.cursor, 'base64').toString('utf-8'));
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
   * Update last accessed timestamp
   */
  async updateLastAccessed(userId: string, workspaceId: string): Promise<WorkspaceRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          user_id: userId,
          workspace_id: workspaceId,
        },
        UpdateExpression: 'SET last_accessed_at = :lastAccessedAt',
        ExpressionAttributeValues: {
          ':lastAccessedAt': now.toISOString(),
        },
        ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(workspace_id)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new NotFoundError(`Workspace not found: ${workspaceId} for user ${userId}`);
    }

    return fromDynamoItem(result.Attributes);
  }

  /**
   * Update workspace size in bytes
   */
  async updateSize(userId: string, workspaceId: string, sizeBytes: number): Promise<WorkspaceRecord> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          user_id: userId,
          workspace_id: workspaceId,
        },
        UpdateExpression: 'SET size_bytes = :sizeBytes, last_accessed_at = :lastAccessedAt',
        ExpressionAttributeValues: {
          ':sizeBytes': sizeBytes,
          ':lastAccessedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(workspace_id)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new NotFoundError(`Workspace not found: ${workspaceId} for user ${userId}`);
    }

    return fromDynamoItem(result.Attributes);
  }

  /**
   * Delete a workspace
   */
  async delete(userId: string, workspaceId: string): Promise<void> {
    const docClient = getDocClient();

    this.logger.debug({ workspaceId, userId }, 'Deleting workspace');

    await docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          user_id: userId,
          workspace_id: workspaceId,
        },
        ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(workspace_id)',
      })
    );
  }
}
