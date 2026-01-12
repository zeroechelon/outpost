/**
 * API Key repository for DynamoDB operations
 */

import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { getDocClient } from './base.repository.js';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError } from '../utils/errors.js';
import {
  type ApiKeyModel,
  type CreateApiKeyInput,
  fromDynamoItem,
  toDynamoItem,
} from '../models/api-key.model.js';

export interface GeneratedApiKey {
  apiKey: ApiKeyModel;
  rawKey: string;
}

export class ApiKeyRepository {
  private readonly tableName: string;
  private readonly logger = getLogger().child({ repository: 'ApiKeyRepository' });

  constructor() {
    this.tableName = getConfig().dynamodb.apiKeysTable;
  }

  async create(tenantId: string, input: CreateApiKeyInput): Promise<GeneratedApiKey> {
    const docClient = getDocClient();
    const now = new Date();

    // Generate a secure random API key
    const rawKey = `otp_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12);

    const apiKey: ApiKeyModel = {
      apiKeyId: uuidv4(),
      tenantId,
      name: input.name,
      keyHash,
      keyPrefix,
      status: 'active',
      scopes: input.scopes,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      usageCount: 0,
    };

    this.logger.debug({ apiKeyId: apiKey.apiKeyId, tenantId }, 'Creating API key');

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...toDynamoItem(apiKey),
          // GSI for lookup by key hash
          keyHashIndex: keyHash,
        },
        ConditionExpression: 'attribute_not_exists(apiKeyId)',
      })
    );

    return { apiKey, rawKey };
  }

  async getById(apiKeyId: string): Promise<ApiKeyModel> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { apiKeyId },
      })
    );

    if (result.Item === undefined) {
      throw new NotFoundError(`API key not found: ${apiKeyId}`);
    }

    return fromDynamoItem(result.Item);
  }

  async getByRawKey(rawKey: string): Promise<ApiKeyModel | null> {
    const docClient = getDocClient();
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const result = await docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'key-hash-index',
        KeyConditionExpression: 'keyHashIndex = :hash',
        ExpressionAttributeValues: { ':hash': keyHash },
        Limit: 1,
      })
    );

    if (result.Items === undefined || result.Items.length === 0) {
      return null;
    }

    const item = result.Items[0];
    if (item === undefined) {
      return null;
    }

    return fromDynamoItem(item);
  }

  async listByTenant(tenantId: string): Promise<ApiKeyModel[]> {
    const docClient = getDocClient();

    const result = await docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenant-index',
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: { ':tenantId': tenantId },
      })
    );

    return (result.Items ?? []).map((item) => fromDynamoItem(item));
  }

  async recordUsage(apiKeyId: string): Promise<void> {
    const docClient = getDocClient();

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { apiKeyId },
        UpdateExpression: 'SET lastUsedAt = :now, usageCount = usageCount + :inc',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':inc': 1,
        },
      })
    );
  }

  async revoke(apiKeyId: string): Promise<void> {
    const docClient = getDocClient();

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { apiKeyId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'revoked' },
      })
    );
  }
}
