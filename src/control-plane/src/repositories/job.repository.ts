/**
 * Job repository for DynamoDB operations
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocClient } from './base.repository.js';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError } from '../utils/errors.js';
import {
  type JobModel,
  type CreateJobInput,
  type ListJobsQuery,
  fromDynamoItem,
  toDynamoItem,
} from '../models/job.model.js';
import type { JobStatus } from '../types/job.js';

export class JobRepository {
  private readonly tableName: string;
  private readonly logger = getLogger().child({ repository: 'JobRepository' });

  constructor() {
    this.tableName = getConfig().dynamodb.jobsTable;
  }

  async create(tenantId: string, input: CreateJobInput): Promise<JobModel> {
    const docClient = getDocClient();
    const now = new Date();

    const job: JobModel = {
      jobId: uuidv4(),
      tenantId,
      agent: input.agent,
      task: input.task,
      repo: input.repo ?? null,
      branch: input.branch ?? null,
      context: input.context,
      status: 'PENDING',
      workerId: null,
      workspacePath: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      timeoutSeconds: input.timeoutSeconds,
      exitCode: null,
      errorMessage: null,
      outputS3Key: null,
    };

    this.logger.debug({ jobId: job.jobId, tenantId }, 'Creating job');

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toDynamoItem(job),
        ConditionExpression: 'attribute_not_exists(job_id)',
      })
    );

    return job;
  }

  async getById(jobId: string, tenantId: string): Promise<JobModel> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenant_id: tenantId, job_id: jobId },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    return fromDynamoItem(result.Item);
  }

  async getByIdForTenant(jobId: string, tenantId: string): Promise<JobModel> {
    // With composite key, we already scope by tenant
    return this.getById(jobId, tenantId);
  }

  async updateStatus(
    jobId: string,
    tenantId: string,
    status: JobStatus,
    updates?: Partial<Pick<JobModel, 'workerId' | 'startedAt' | 'completedAt' | 'exitCode' | 'errorMessage' | 'outputS3Key' | 'workspacePath'>>
  ): Promise<JobModel> {
    const docClient = getDocClient();

    const updateExpressions: string[] = ['#status = :status'];
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
    const expressionAttributeValues: Record<string, unknown> = { ':status': status };

    if (updates !== undefined) {
      if (updates.workerId !== undefined) {
        updateExpressions.push('worker_id = :workerId');
        expressionAttributeValues[':workerId'] = updates.workerId;
      }
      if (updates.startedAt !== undefined && updates.startedAt !== null) {
        updateExpressions.push('started_at = :startedAt');
        expressionAttributeValues[':startedAt'] = updates.startedAt.toISOString();
      }
      if (updates.completedAt !== undefined && updates.completedAt !== null) {
        updateExpressions.push('completed_at = :completedAt');
        expressionAttributeValues[':completedAt'] = updates.completedAt.toISOString();
      }
      if (updates.exitCode !== undefined) {
        updateExpressions.push('exit_code = :exitCode');
        expressionAttributeValues[':exitCode'] = updates.exitCode;
      }
      if (updates.errorMessage !== undefined) {
        updateExpressions.push('error_message = :errorMessage');
        expressionAttributeValues[':errorMessage'] = updates.errorMessage;
      }
      if (updates.outputS3Key !== undefined) {
        updateExpressions.push('output_s3_key = :outputS3Key');
        expressionAttributeValues[':outputS3Key'] = updates.outputS3Key;
      }
      if (updates.workspacePath !== undefined) {
        updateExpressions.push('workspace_path = :workspacePath');
        expressionAttributeValues[':workspacePath'] = updates.workspacePath;
      }
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenant_id: tenantId, job_id: jobId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new InternalError('Failed to update job');
    }

    return fromDynamoItem(result.Attributes);
  }

  async listByTenant(
    tenantId: string,
    query: ListJobsQuery
  ): Promise<{ items: JobModel[]; nextCursor?: string | undefined }> {
    const docClient = getDocClient();

    // Query on main table using tenant_id as partition key
    // Note: Results sorted by job_id (range key), not created_at
    // We sort by createdAt in memory after retrieval
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'tenant_id = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
      },
      // Fetch extra items for in-memory sorting, then limit
      Limit: Math.min((query.limit ?? 20) * 3, 300),
    };

    if (query.cursor !== undefined) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(query.cursor, 'base64').toString('utf-8'));
    }

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

    if (query.agent !== undefined) {
      filterExpressions.push('#agent = :agentFilter');
      expressionAttributeNames['#agent'] = 'agent';
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':agentFilter': query.agent,
      };
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      // Only set ExpressionAttributeNames if it has entries
      if (Object.keys(expressionAttributeNames).length > 0) {
        params.ExpressionAttributeNames = expressionAttributeNames;
      }
    }

    const result = await docClient.send(new QueryCommand(params));

    // Convert items and sort by createdAt descending (newest first)
    let items = (result.Items ?? []).map((item) => fromDynamoItem(item));
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply limit after sorting
    const requestedLimit = query.limit ?? 20;
    const hasMore = items.length > requestedLimit || result.LastEvaluatedKey !== undefined;
    items = items.slice(0, requestedLimit);

    let nextCursor: string | undefined;
    if (hasMore && result.LastEvaluatedKey !== undefined) {
      nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return { items, nextCursor };
  }

  async listPending(limit: number = 10): Promise<JobModel[]> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'PENDING' },
        Limit: limit,
        ScanIndexForward: true, // Oldest first (by created_at)
      })
    );

    return (result.Items ?? []).map((item) => fromDynamoItem(item));
  }
}
