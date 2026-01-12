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
        ConditionExpression: 'attribute_not_exists(jobId)',
      })
    );

    return job;
  }

  async getById(jobId: string): Promise<JobModel> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { jobId },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    return fromDynamoItem(result.Item);
  }

  async getByIdForTenant(jobId: string, tenantId: string): Promise<JobModel> {
    const job = await this.getById(jobId);

    if (job.tenantId !== tenantId) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    return job;
  }

  async updateStatus(
    jobId: string,
    status: JobStatus,
    updates?: Partial<Pick<JobModel, 'workerId' | 'startedAt' | 'completedAt' | 'exitCode' | 'errorMessage' | 'outputS3Key' | 'workspacePath'>>
  ): Promise<JobModel> {
    const docClient = getDocClient();

    const updateExpressions: string[] = ['#status = :status'];
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
    const expressionAttributeValues: Record<string, unknown> = { ':status': status };

    if (updates !== undefined) {
      if (updates.workerId !== undefined) {
        updateExpressions.push('workerId = :workerId');
        expressionAttributeValues[':workerId'] = updates.workerId;
      }
      if (updates.startedAt !== undefined) {
        updateExpressions.push('startedAt = :startedAt');
        expressionAttributeValues[':startedAt'] = updates.startedAt.toISOString();
      }
      if (updates.completedAt !== undefined) {
        updateExpressions.push('completedAt = :completedAt');
        expressionAttributeValues[':completedAt'] = updates.completedAt.toISOString();
      }
      if (updates.exitCode !== undefined) {
        updateExpressions.push('exitCode = :exitCode');
        expressionAttributeValues[':exitCode'] = updates.exitCode;
      }
      if (updates.errorMessage !== undefined) {
        updateExpressions.push('errorMessage = :errorMessage');
        expressionAttributeValues[':errorMessage'] = updates.errorMessage;
      }
      if (updates.outputS3Key !== undefined) {
        updateExpressions.push('outputS3Key = :outputS3Key');
        expressionAttributeValues[':outputS3Key'] = updates.outputS3Key;
      }
      if (updates.workspacePath !== undefined) {
        updateExpressions.push('workspacePath = :workspacePath');
        expressionAttributeValues[':workspacePath'] = updates.workspacePath;
      }
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { jobId },
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
  ): Promise<{ items: JobModel[]; nextCursor?: string }> {
    const docClient = getDocClient();

    const params: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: 'tenant-created-index',
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
      },
      Limit: query.limit,
      ScanIndexForward: false, // Descending order by createdAt
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
      filterExpressions.push('agent = :agentFilter');
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':agentFilter': query.agent,
      };
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    const result = await docClient.send(new QueryCommand(params));

    const items = (result.Items ?? []).map((item) => fromDynamoItem(item));
    let nextCursor: string | undefined;

    if (result.LastEvaluatedKey !== undefined) {
      nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return { items, nextCursor };
  }

  async listPending(limit: number = 10): Promise<JobModel[]> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-created-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'PENDING' },
        Limit: limit,
        ScanIndexForward: true, // Oldest first
      })
    );

    return (result.Items ?? []).map((item) => fromDynamoItem(item));
  }
}
