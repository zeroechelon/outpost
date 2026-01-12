/**
 * Pool repository for DynamoDB operations
 * Manages warm pool of agent tasks with composite key (agent_type, task_arn)
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { getDocClient } from './base.repository.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError } from '../utils/errors.js';
import type { AgentType } from '../types/agent.js';

/**
 * Pool task status values
 */
export type PoolTaskStatus = 'idle' | 'in_use' | 'terminating';

/**
 * Pool task record stored in DynamoDB
 */
export interface PoolTaskRecord {
  readonly agentType: AgentType;
  readonly taskArn: string;
  readonly status: PoolTaskStatus;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly instanceType: string;
  readonly ttl?: number; // Unix timestamp for TTL
}

/**
 * Input for creating a new pool task
 */
export interface CreatePoolTaskInput {
  readonly agentType: AgentType;
  readonly taskArn: string;
  readonly instanceType: string;
}

/**
 * DynamoDB item shape
 */
interface PoolTaskDynamoItem {
  agent_type: string;
  task_arn: string;
  status: string;
  created_at: string;
  last_used_at: string;
  instance_type: string;
  ttl?: number;
}

function toDynamoItem(record: PoolTaskRecord): PoolTaskDynamoItem {
  const item: PoolTaskDynamoItem = {
    agent_type: record.agentType,
    task_arn: record.taskArn,
    status: record.status,
    created_at: record.createdAt.toISOString(),
    last_used_at: record.lastUsedAt.toISOString(),
    instance_type: record.instanceType,
  };

  if (record.ttl !== undefined) {
    item.ttl = record.ttl;
  }

  return item;
}

function fromDynamoItem(item: Record<string, unknown>): PoolTaskRecord {
  const record: PoolTaskRecord = {
    agentType: item['agent_type'] as AgentType,
    taskArn: item['task_arn'] as string,
    status: item['status'] as PoolTaskStatus,
    createdAt: new Date(item['created_at'] as string),
    lastUsedAt: new Date(item['last_used_at'] as string),
    instanceType: item['instance_type'] as string,
  };

  if (item['ttl'] !== undefined) {
    return { ...record, ttl: item['ttl'] as number };
  }

  return record;
}

export class PoolRepository {
  private readonly tableName: string;
  private readonly terminatingTtlSeconds = 300; // 5 minutes TTL for terminating tasks
  private readonly logger = getLogger().child({ repository: 'PoolRepository' });

  constructor() {
    const prefix = process.env['DYNAMODB_TABLE_PREFIX'] ?? 'outpost';
    this.tableName = `${prefix}-pool`;
  }

  /**
   * Create a new pool task record
   */
  async create(input: CreatePoolTaskInput): Promise<PoolTaskRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const record: PoolTaskRecord = {
      agentType: input.agentType,
      taskArn: input.taskArn,
      status: 'idle',
      createdAt: now,
      lastUsedAt: now,
      instanceType: input.instanceType,
    };

    this.logger.debug(
      { taskArn: record.taskArn, agentType: input.agentType },
      'Creating pool task'
    );

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toDynamoItem(record),
        ConditionExpression: 'attribute_not_exists(agent_type) AND attribute_not_exists(task_arn)',
      })
    );

    return record;
  }

  /**
   * Get idle tasks for a specific agent type
   */
  async getIdleTasks(agentType: AgentType, limit: number = 10): Promise<PoolTaskRecord[]> {
    const docClient = getDocClient();

    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'agent_type = :agentType',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':agentType': agentType,
        ':status': 'idle',
      },
      Limit: limit,
    };

    const result = await docClient.send(new QueryCommand(params));

    return (result.Items ?? []).map((item) => fromDynamoItem(item));
  }

  /**
   * Mark a pool task as in use
   */
  async markInUse(agentType: AgentType, taskArn: string): Promise<PoolTaskRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          agent_type: agentType,
          task_arn: taskArn,
        },
        UpdateExpression: 'SET #status = :status, last_used_at = :lastUsedAt REMOVE #ttl',
        ConditionExpression: 'attribute_exists(agent_type) AND attribute_exists(task_arn) AND #status = :idleStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':status': 'in_use',
          ':lastUsedAt': now.toISOString(),
          ':idleStatus': 'idle',
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new NotFoundError(`Pool task not found or not idle: ${taskArn}`);
    }

    return fromDynamoItem(result.Attributes);
  }

  /**
   * Mark a pool task as idle
   */
  async markIdle(agentType: AgentType, taskArn: string): Promise<PoolTaskRecord> {
    const docClient = getDocClient();
    const now = new Date();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          agent_type: agentType,
          task_arn: taskArn,
        },
        UpdateExpression: 'SET #status = :status, last_used_at = :lastUsedAt REMOVE #ttl',
        ConditionExpression: 'attribute_exists(agent_type) AND attribute_exists(task_arn)',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':status': 'idle',
          ':lastUsedAt': now.toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new NotFoundError(`Pool task not found: ${taskArn}`);
    }

    return fromDynamoItem(result.Attributes);
  }

  /**
   * Mark a pool task as terminating with TTL
   */
  async markTerminating(agentType: AgentType, taskArn: string): Promise<PoolTaskRecord> {
    const docClient = getDocClient();
    const now = new Date();
    const ttlTimestamp = Math.floor(now.getTime() / 1000) + this.terminatingTtlSeconds;

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          agent_type: agentType,
          task_arn: taskArn,
        },
        UpdateExpression: 'SET #status = :status, last_used_at = :lastUsedAt, #ttl = :ttl',
        ConditionExpression: 'attribute_exists(agent_type) AND attribute_exists(task_arn)',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':status': 'terminating',
          ':lastUsedAt': now.toISOString(),
          ':ttl': ttlTimestamp,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new NotFoundError(`Pool task not found: ${taskArn}`);
    }

    return fromDynamoItem(result.Attributes);
  }

  /**
   * Delete a pool task
   */
  async delete(agentType: AgentType, taskArn: string): Promise<void> {
    const docClient = getDocClient();

    this.logger.debug({ taskArn, agentType }, 'Deleting pool task');

    await docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          agent_type: agentType,
          task_arn: taskArn,
        },
      })
    );
  }

  /**
   * Count tasks by agent type and optionally by status
   */
  async countByAgent(agentType: AgentType, status?: PoolTaskStatus): Promise<number> {
    const docClient = getDocClient();

    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'agent_type = :agentType',
      ExpressionAttributeValues: {
        ':agentType': agentType,
      },
      Select: 'COUNT',
    };

    if (status !== undefined) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':status': status,
      };
    }

    const result = await docClient.send(new QueryCommand(params));

    return result.Count ?? 0;
  }

  /**
   * Get all tasks by agent type
   */
  async listByAgent(agentType: AgentType): Promise<PoolTaskRecord[]> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'agent_type = :agentType',
        ExpressionAttributeValues: {
          ':agentType': agentType,
        },
      })
    );

    return (result.Items ?? []).map((item) => fromDynamoItem(item));
  }
}
