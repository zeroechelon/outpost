/**
 * Tenant repository for DynamoDB operations
 */

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocClient } from './base.repository.js';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError } from '../utils/errors.js';
import {
  type TenantModel,
  type CreateTenantInput,
  fromDynamoItem,
  toDynamoItem,
  DEFAULT_USAGE_LIMITS,
} from '../models/tenant.model.js';

export class TenantRepository {
  private readonly tableName: string;
  private readonly logger = getLogger().child({ repository: 'TenantRepository' });

  constructor() {
    this.tableName = getConfig().dynamodb.tenantsTable;
  }

  async create(input: CreateTenantInput): Promise<TenantModel> {
    const docClient = getDocClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (today === undefined) {
      throw new InternalError('Failed to format date');
    }

    const tenant: TenantModel = {
      tenantId: uuidv4(),
      name: input.name,
      email: input.email,
      tier: input.tier,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      stripeCustomerId: null,
      usageLimits: DEFAULT_USAGE_LIMITS[input.tier],
      currentUsage: {
        concurrentJobs: 0,
        jobsToday: 0,
        lastResetDate: today,
      },
    };

    this.logger.debug({ tenantId: tenant.tenantId }, 'Creating tenant');

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toDynamoItem(tenant),
        ConditionExpression: 'attribute_not_exists(tenantId)',
      })
    );

    return tenant;
  }

  async getById(tenantId: string): Promise<TenantModel> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`Tenant not found: ${tenantId}`);
    }

    return fromDynamoItem(result.Item);
  }

  async incrementConcurrentJobs(tenantId: string): Promise<number> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression:
          'SET currentUsage.concurrentJobs = currentUsage.concurrentJobs + :inc, ' +
          'currentUsage.jobsToday = currentUsage.jobsToday + :inc',
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new InternalError('Failed to increment concurrent jobs');
    }

    const tenant = fromDynamoItem(result.Attributes);
    return tenant.currentUsage.concurrentJobs;
  }

  async decrementConcurrentJobs(tenantId: string): Promise<number> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression: 'SET currentUsage.concurrentJobs = currentUsage.concurrentJobs - :dec',
        ExpressionAttributeValues: { ':dec': 1 },
        ConditionExpression: 'currentUsage.concurrentJobs > :zero',
        ExpressionAttributeValues: { ':dec': 1, ':zero': 0 },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (result.Attributes === undefined) {
      throw new InternalError('Failed to decrement concurrent jobs');
    }

    const tenant = fromDynamoItem(result.Attributes);
    return tenant.currentUsage.concurrentJobs;
  }

  async resetDailyUsage(tenantId: string): Promise<void> {
    const docClient = getDocClient();
    const today = new Date().toISOString().split('T')[0];

    if (today === undefined) {
      throw new InternalError('Failed to format date');
    }

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression:
          'SET currentUsage.jobsToday = :zero, currentUsage.lastResetDate = :today',
        ExpressionAttributeValues: { ':zero': 0, ':today': today },
      })
    );
  }

  async updateStripeCustomerId(tenantId: string, stripeCustomerId: string): Promise<void> {
    const docClient = getDocClient();

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId },
        UpdateExpression: 'SET stripeCustomerId = :customerId, updatedAt = :now',
        ExpressionAttributeValues: {
          ':customerId': stripeCustomerId,
          ':now': new Date().toISOString(),
        },
      })
    );
  }
}
