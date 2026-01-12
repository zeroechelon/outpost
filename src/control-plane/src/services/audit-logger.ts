/**
 * Audit Logger Service - Comprehensive audit logging for Outpost V2
 *
 * Provides immutable audit logging for all platform operations:
 * - Dispatch requests
 * - Status queries
 * - Workspace operations
 * - Secret access (values never logged)
 * - API calls
 *
 * Security: No update/delete operations. All records are immutable.
 * Storage: DynamoDB with 1-year TTL, exports to S3 for long-term retention.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  type QueryCommandInput,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { getDocClientRaw } from '../repositories/base.repository.js';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { InternalError } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Audit event types categorizing all auditable operations
 */
export type AuditEventType =
  | 'dispatch'
  | 'status_query'
  | 'workspace_operation'
  | 'secret_access'
  | 'api_call';

/**
 * Outcome of an audited operation
 */
export type AuditOutcome = 'success' | 'failure';

/**
 * Core audit event structure
 */
export interface AuditEvent {
  readonly eventId: string;
  readonly eventType: AuditEventType;
  readonly userId: string;
  readonly timestamp: Date;
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly sourceIp?: string;
  readonly userAgent?: string;
  readonly outcome: AuditOutcome;
  readonly errorMessage?: string;
}

/**
 * Input for creating a new audit event
 * eventId and timestamp are auto-generated if not provided
 */
export interface AuditEventInput {
  readonly eventType: AuditEventType;
  readonly userId: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly sourceIp?: string;
  readonly userAgent?: string;
  readonly outcome: AuditOutcome;
  readonly errorMessage?: string;
}

/**
 * DynamoDB record structure for audit events
 */
interface AuditEventRecord {
  event_id: string;
  event_type: AuditEventType;
  user_id: string;
  timestamp: string;
  action: string;
  resource: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  source_ip?: string;
  user_agent?: string;
  outcome: AuditOutcome;
  error_message?: string;
  expires_at: number; // TTL in epoch seconds
  created_at: string;
}

/**
 * Query options for retrieving audit events
 */
export interface AuditQueryOptions {
  readonly userId?: string;
  readonly eventType?: AuditEventType;
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Result of audit event query
 */
export interface AuditQueryResult {
  readonly events: readonly AuditEvent[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly count: number;
}

/**
 * S3 export result
 */
export interface AuditExportResult {
  readonly bucket: string;
  readonly key: string;
  readonly eventsExported: number;
  readonly exportedAt: Date;
  readonly startTime: Date;
  readonly endTime: Date;
}

/**
 * Configuration for the audit logger
 */
export interface AuditLoggerConfig {
  readonly tableName: string;
  readonly s3Bucket: string;
  readonly region: string;
  readonly ttlDays: number;
  readonly exportPrefix: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TTL_DAYS = 365; // 1 year retention in DynamoDB
const DEFAULT_EXPORT_PREFIX = 'audit-logs';
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;

// Sensitive fields that should never be logged in metadata
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'apikey',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
  'secretKey',
  'secret_key',
  'credential',
  'credentials',
  'auth',
  'authorization',
]);

// ============================================================================
// AuditLoggerService
// ============================================================================

export class AuditLoggerService {
  private readonly logger = getLogger().child({ service: 'AuditLoggerService' });
  private readonly s3Client: S3Client;
  private readonly tableName: string;
  private readonly s3Bucket: string;
  private readonly region: string;
  private readonly ttlDays: number;
  private readonly exportPrefix: string;

  constructor(config?: Partial<AuditLoggerConfig>) {
    const appConfig = getConfig();

    this.tableName = config?.tableName ?? appConfig.dynamodb.auditTable;
    this.s3Bucket = config?.s3Bucket ?? process.env['AUDIT_S3_BUCKET'] ?? appConfig.s3.outputBucket;
    this.region = config?.region ?? appConfig.awsRegion;
    this.ttlDays = config?.ttlDays ?? DEFAULT_TTL_DAYS;
    this.exportPrefix = config?.exportPrefix ?? DEFAULT_EXPORT_PREFIX;

    this.s3Client = new S3Client({ region: this.region });

    this.logger.info({
      tableName: this.tableName,
      s3Bucket: this.s3Bucket,
      ttlDays: this.ttlDays,
    }, 'AuditLoggerService initialized');
  }

  // --------------------------------------------------------------------------
  // Core Logging Methods
  // --------------------------------------------------------------------------

  /**
   * Log an audit event to DynamoDB
   * This is an append-only operation - no updates or deletes allowed
   *
   * @param input - Audit event input data
   * @returns The created audit event with generated ID and timestamp
   */
  async log(input: AuditEventInput): Promise<AuditEvent> {
    // Build event object without undefined values for exactOptionalPropertyTypes
    const event = this.buildAuditEvent(input);

    this.logger.debug({
      eventId: event.eventId,
      eventType: event.eventType,
      userId: event.userId,
      action: event.action,
      resource: event.resource,
    }, 'Logging audit event');

    try {
      const record = this.toRecord(event);
      const rawClient = getDocClientRaw();

      await rawClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(record, {
            removeUndefinedValues: true,
            convertClassInstanceToMap: true,
          }),
          // Condition to ensure immutability - only insert, never update
          ConditionExpression: 'attribute_not_exists(event_id)',
        })
      );

      this.logger.info({
        eventId: event.eventId,
        eventType: event.eventType,
        userId: event.userId,
        action: event.action,
        outcome: event.outcome,
      }, 'Audit event logged successfully');

      return event;
    } catch (error) {
      this.logger.error({
        eventId: event.eventId,
        error,
      }, 'Failed to log audit event');

      throw new InternalError('Failed to log audit event', {
        eventId: event.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Log a dispatch request
   */
  async logDispatch(
    userId: string,
    dispatchId: string,
    action: 'create' | 'cancel' | 'retry',
    outcome: AuditOutcome,
    metadata?: Record<string, unknown>,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): Promise<AuditEvent> {
    const optionals = this.buildOptionals({ resourceId: dispatchId }, metadata, options);
    return this.log(this.buildAuditInput(
      {
        eventType: 'dispatch',
        userId,
        action: `dispatch.${action}`,
        resource: 'dispatch',
        outcome,
      },
      optionals
    ));
  }

  /**
   * Log a status query
   */
  async logStatusQuery(
    userId: string,
    resourceType: 'dispatch' | 'job' | 'workspace',
    resourceId: string,
    outcome: AuditOutcome,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): Promise<AuditEvent> {
    const optionals = this.buildOptionals({ resourceId }, undefined, options);
    return this.log(this.buildAuditInput(
      {
        eventType: 'status_query',
        userId,
        action: 'status.query',
        resource: resourceType,
        outcome,
      },
      optionals
    ));
  }

  /**
   * Log a workspace operation
   */
  async logWorkspaceOperation(
    userId: string,
    workspaceId: string,
    action: 'create' | 'delete' | 'mount' | 'unmount' | 'resize' | 'clone' | 'push',
    outcome: AuditOutcome,
    metadata?: Record<string, unknown>,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): Promise<AuditEvent> {
    const optionals = this.buildOptionals({ resourceId: workspaceId }, metadata, options);
    return this.log(this.buildAuditInput(
      {
        eventType: 'workspace_operation',
        userId,
        action: `workspace.${action}`,
        resource: 'workspace',
        outcome,
      },
      optionals
    ));
  }

  /**
   * Log secret access
   * IMPORTANT: Never log the actual secret value, only access metadata
   */
  async logSecretAccess(
    userId: string,
    secretPath: string,
    action: 'read' | 'inject' | 'validate',
    outcome: AuditOutcome,
    metadata?: Record<string, unknown>,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): Promise<AuditEvent> {
    // Extract secret name from path for logging, not the value
    const secretName = secretPath.split('/').pop() ?? 'unknown';

    // Build safe metadata that doesn't expose secret path
    const safeMetadata: Record<string, unknown> = {
      pathLength: secretPath.length, // Safe metric without exposing path
    };
    if (metadata !== undefined) {
      Object.assign(safeMetadata, metadata);
    }

    const optionals = this.buildOptionals({ resourceId: secretName, metadata: safeMetadata }, undefined, options);
    return this.log(this.buildAuditInput(
      {
        eventType: 'secret_access',
        userId,
        action: `secret.${action}`,
        resource: 'secret',
        outcome,
      },
      optionals
    ));
  }

  /**
   * Log a generic API call
   */
  async logApiCall(
    userId: string,
    method: string,
    path: string,
    statusCode: number,
    outcome: AuditOutcome,
    metadata?: Record<string, unknown>,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): Promise<AuditEvent> {
    // Build API-specific metadata
    const apiMetadata: Record<string, unknown> = {
      statusCode,
      method,
    };
    if (metadata !== undefined) {
      Object.assign(apiMetadata, metadata);
    }

    const optionals = this.buildOptionals({ metadata: apiMetadata }, undefined, options);
    return this.log(this.buildAuditInput(
      {
        eventType: 'api_call',
        userId,
        action: `api.${method.toLowerCase()}`,
        resource: path,
        outcome,
      },
      optionals
    ));
  }

  // --------------------------------------------------------------------------
  // Query Methods
  // --------------------------------------------------------------------------

  /**
   * Query audit events by user ID
   * Uses GSI: user_id-timestamp-index
   */
  async queryByUser(
    userId: string,
    options?: Omit<AuditQueryOptions, 'userId'>
  ): Promise<AuditQueryResult> {
    const limit = Math.min(options?.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    this.logger.info({
      userId,
      startTime: options?.startTime?.toISOString(),
      endTime: options?.endTime?.toISOString(),
      limit,
    }, 'Querying audit events by user');

    try {
      const rawClient = getDocClientRaw();

      // Build key condition expression
      let keyConditionExpression = 'user_id = :userId';
      const expressionAttributeValues: Record<string, unknown> = {
        ':userId': userId,
      };

      // Add time range if specified
      if (options?.startTime !== undefined && options?.endTime !== undefined) {
        keyConditionExpression += ' AND #ts BETWEEN :startTime AND :endTime';
        expressionAttributeValues[':startTime'] = options.startTime.toISOString();
        expressionAttributeValues[':endTime'] = options.endTime.toISOString();
      } else if (options?.startTime !== undefined) {
        keyConditionExpression += ' AND #ts >= :startTime';
        expressionAttributeValues[':startTime'] = options.startTime.toISOString();
      } else if (options?.endTime !== undefined) {
        keyConditionExpression += ' AND #ts <= :endTime';
        expressionAttributeValues[':endTime'] = options.endTime.toISOString();
      }

      // Add filter for event type if specified
      let filterExpression: string | undefined;
      if (options?.eventType !== undefined) {
        filterExpression = 'event_type = :eventType';
        expressionAttributeValues[':eventType'] = options.eventType;
      }

      const queryInput: QueryCommandInput = {
        TableName: this.tableName,
        IndexName: 'user_id-timestamp-index',
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeNames: {
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: marshall(expressionAttributeValues),
        FilterExpression: filterExpression,
        Limit: limit + 1, // Fetch one extra to check if there are more
        ScanIndexForward: false, // Most recent first
        ExclusiveStartKey: options?.cursor !== undefined
          ? JSON.parse(Buffer.from(options.cursor, 'base64').toString('utf-8'))
          : undefined,
      };

      const response = await rawClient.send(new QueryCommand(queryInput));

      const items = (response.Items ?? []).map((item) => this.fromRecord(unmarshall(item) as AuditEventRecord));

      // Check if there are more results
      const hasMore = items.length > limit;
      const events = hasMore ? items.slice(0, limit) : items;

      // Generate cursor for next page
      let nextCursor: string | undefined;
      if (hasMore && response.LastEvaluatedKey !== undefined) {
        nextCursor = Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64');
      }

      this.logger.info({
        userId,
        count: events.length,
        hasMore,
      }, 'Query completed');

      const result: AuditQueryResult = {
        events,
        hasMore,
        count: events.length,
      };

      // Only add nextCursor if it exists
      if (nextCursor !== undefined) {
        return { ...result, nextCursor };
      }

      return result;
    } catch (error) {
      this.logger.error({
        userId,
        error,
      }, 'Failed to query audit events');

      throw new InternalError('Failed to query audit events', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get a single audit event by ID
   */
  async getById(eventId: string): Promise<AuditEvent | null> {
    this.logger.debug({ eventId }, 'Getting audit event by ID');

    try {
      const rawClient = getDocClientRaw();

      const response = await rawClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'event_id = :eventId',
          ExpressionAttributeValues: marshall({
            ':eventId': eventId,
          }),
          Limit: 1,
        })
      );

      if (response.Items === undefined || response.Items.length === 0) {
        return null;
      }

      const firstItem = response.Items[0];
      if (firstItem === undefined) {
        return null;
      }

      return this.fromRecord(unmarshall(firstItem) as AuditEventRecord);
    } catch (error) {
      this.logger.error({
        eventId,
        error,
      }, 'Failed to get audit event');

      throw new InternalError('Failed to get audit event', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Export Methods
  // --------------------------------------------------------------------------

  /**
   * Export audit events to S3 for long-term retention
   * Exports events from a given time range as JSONL (newline-delimited JSON)
   */
  async exportToS3(
    startTime: Date,
    endTime: Date,
    options?: { prefix?: string }
  ): Promise<AuditExportResult> {
    const prefix = options?.prefix ?? this.exportPrefix;
    const exportDate = new Date();
    const key = this.generateExportKey(prefix, startTime, endTime, exportDate);

    this.logger.info({
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      key,
    }, 'Exporting audit events to S3');

    try {
      // Collect all events in the time range
      const events: AuditEvent[] = [];
      let cursor: string | undefined;

      // Scan all events in the time range
      // Note: For production scale, consider using a more efficient approach
      // like querying by time-based partition or using DynamoDB Streams
      do {
        const rawClient = getDocClientRaw();

        const response = await rawClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'timestamp-index',
            KeyConditionExpression: '#ts BETWEEN :startTime AND :endTime',
            ExpressionAttributeNames: {
              '#ts': 'timestamp',
            },
            ExpressionAttributeValues: marshall({
              ':startTime': startTime.toISOString(),
              ':endTime': endTime.toISOString(),
            }),
            Limit: 1000,
            ExclusiveStartKey: cursor !== undefined
              ? JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
              : undefined,
          })
        );

        for (const item of response.Items ?? []) {
          events.push(this.fromRecord(unmarshall(item) as AuditEventRecord));
        }

        cursor = response.LastEvaluatedKey !== undefined
          ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64')
          : undefined;
      } while (cursor !== undefined);

      if (events.length === 0) {
        this.logger.info({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        }, 'No events to export');

        return {
          bucket: this.s3Bucket,
          key,
          eventsExported: 0,
          exportedAt: exportDate,
          startTime,
          endTime,
        };
      }

      // Convert to JSONL format
      const jsonlContent = events
        .map((event) => JSON.stringify({
          ...event,
          timestamp: event.timestamp.toISOString(),
        }))
        .join('\n');

      // Upload to S3
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: Buffer.from(jsonlContent, 'utf-8'),
          ContentType: 'application/x-ndjson',
          Metadata: {
            'export-start-time': startTime.toISOString(),
            'export-end-time': endTime.toISOString(),
            'export-date': exportDate.toISOString(),
            'event-count': String(events.length),
          },
        })
      );

      this.logger.info({
        key,
        eventsExported: events.length,
      }, 'Audit events exported to S3');

      return {
        bucket: this.s3Bucket,
        key,
        eventsExported: events.length,
        exportedAt: exportDate,
        startTime,
        endTime,
      };
    } catch (error) {
      this.logger.error({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        error,
      }, 'Failed to export audit events to S3');

      throw new InternalError('Failed to export audit events', {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * List existing audit exports in S3
   */
  async listExports(options?: { limit?: number; prefix?: string }): Promise<{
    exports: Array<{ key: string; size: number; lastModified: Date }>;
    count: number;
  }> {
    const prefix = `${options?.prefix ?? this.exportPrefix}/`;

    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.s3Bucket,
          Prefix: prefix,
          MaxKeys: options?.limit ?? 100,
        })
      );

      const exports = (response.Contents ?? [])
        .filter((obj) => obj.Key !== undefined && obj.Size !== undefined && obj.LastModified !== undefined)
        .map((obj) => ({
          key: obj.Key!,
          size: obj.Size!,
          lastModified: obj.LastModified!,
        }));

      return {
        exports,
        count: exports.length,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to list audit exports');

      throw new InternalError('Failed to list audit exports', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  /**
   * Build an AuditEvent from input, handling optional properties correctly
   * for exactOptionalPropertyTypes
   */
  private buildAuditEvent(input: AuditEventInput): AuditEvent {
    // Start with required fields
    const event: AuditEvent = {
      eventId: uuidv4(),
      eventType: input.eventType,
      userId: input.userId,
      timestamp: new Date(),
      action: input.action,
      resource: input.resource,
      outcome: input.outcome,
    };

    // Add optional fields only if they are defined
    if (input.resourceId !== undefined) {
      (event as { resourceId: string }).resourceId = input.resourceId;
    }
    if (input.metadata !== undefined) {
      (event as { metadata: Record<string, unknown> }).metadata = this.sanitizeMetadata(input.metadata);
    }
    if (input.sourceIp !== undefined) {
      (event as { sourceIp: string }).sourceIp = input.sourceIp;
    }
    if (input.userAgent !== undefined) {
      (event as { userAgent: string }).userAgent = input.userAgent;
    }
    if (input.errorMessage !== undefined) {
      (event as { errorMessage: string }).errorMessage = input.errorMessage;
    }

    return event;
  }

  /**
   * Build optionals object without undefined values
   */
  private buildOptionals(
    extra: { resourceId?: string; metadata?: Record<string, unknown> },
    metadata?: Record<string, unknown>,
    options?: { sourceIp?: string; userAgent?: string; errorMessage?: string }
  ): {
    resourceId?: string;
    metadata?: Record<string, unknown>;
    sourceIp?: string;
    userAgent?: string;
    errorMessage?: string;
  } {
    const result: {
      resourceId?: string;
      metadata?: Record<string, unknown>;
      sourceIp?: string;
      userAgent?: string;
      errorMessage?: string;
    } = {};

    // Handle resourceId
    if (extra.resourceId !== undefined) {
      result.resourceId = extra.resourceId;
    }

    // Handle metadata - prefer extra.metadata, fall back to parameter
    if (extra.metadata !== undefined) {
      result.metadata = extra.metadata;
    } else if (metadata !== undefined) {
      result.metadata = metadata;
    }

    // Handle options
    if (options !== undefined) {
      if (options.sourceIp !== undefined) {
        result.sourceIp = options.sourceIp;
      }
      if (options.userAgent !== undefined) {
        result.userAgent = options.userAgent;
      }
      if (options.errorMessage !== undefined) {
        result.errorMessage = options.errorMessage;
      }
    }

    return result;
  }

  /**
   * Build an AuditEventInput, handling optional properties correctly
   */
  private buildAuditInput(
    base: Pick<AuditEventInput, 'eventType' | 'userId' | 'action' | 'resource' | 'outcome'>,
    optionals: {
      resourceId?: string;
      metadata?: Record<string, unknown>;
      sourceIp?: string;
      userAgent?: string;
      errorMessage?: string;
    }
  ): AuditEventInput {
    const input: AuditEventInput = { ...base };

    if (optionals.resourceId !== undefined) {
      (input as { resourceId: string }).resourceId = optionals.resourceId;
    }
    if (optionals.metadata !== undefined) {
      (input as { metadata: Record<string, unknown> }).metadata = optionals.metadata;
    }
    if (optionals.sourceIp !== undefined) {
      (input as { sourceIp: string }).sourceIp = optionals.sourceIp;
    }
    if (optionals.userAgent !== undefined) {
      (input as { userAgent: string }).userAgent = optionals.userAgent;
    }
    if (optionals.errorMessage !== undefined) {
      (input as { errorMessage: string }).errorMessage = optionals.errorMessage;
    }

    return input;
  }

  /**
   * Sanitize metadata to remove sensitive fields
   * This ensures secrets are never accidentally logged
   */
  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Check if key matches any sensitive field pattern
      const keyLower = key.toLowerCase();
      if (SENSITIVE_FIELDS.has(keyLower)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Recursively sanitize nested objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Convert AuditEvent to DynamoDB record format
   */
  private toRecord(event: AuditEvent): AuditEventRecord {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + this.ttlDays);

    const record: AuditEventRecord = {
      event_id: event.eventId,
      event_type: event.eventType,
      user_id: event.userId,
      timestamp: event.timestamp.toISOString(),
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
      expires_at: Math.floor(expiresAt.getTime() / 1000), // TTL in epoch seconds
      created_at: now.toISOString(),
    };

    // Only add optional fields if defined
    if (event.resourceId !== undefined) {
      record.resource_id = event.resourceId;
    }
    if (event.metadata !== undefined) {
      record.metadata = event.metadata;
    }
    if (event.sourceIp !== undefined) {
      record.source_ip = event.sourceIp;
    }
    if (event.userAgent !== undefined) {
      record.user_agent = event.userAgent;
    }
    if (event.errorMessage !== undefined) {
      record.error_message = event.errorMessage;
    }

    return record;
  }

  /**
   * Convert DynamoDB record to AuditEvent
   */
  private fromRecord(record: AuditEventRecord): AuditEvent {
    const event: AuditEvent = {
      eventId: record.event_id,
      eventType: record.event_type,
      userId: record.user_id,
      timestamp: new Date(record.timestamp),
      action: record.action,
      resource: record.resource,
      outcome: record.outcome,
    };

    // Only add optional fields if they exist in the record
    if (record.resource_id !== undefined) {
      (event as { resourceId: string }).resourceId = record.resource_id;
    }
    if (record.metadata !== undefined) {
      (event as { metadata: Record<string, unknown> }).metadata = record.metadata;
    }
    if (record.source_ip !== undefined) {
      (event as { sourceIp: string }).sourceIp = record.source_ip;
    }
    if (record.user_agent !== undefined) {
      (event as { userAgent: string }).userAgent = record.user_agent;
    }
    if (record.error_message !== undefined) {
      (event as { errorMessage: string }).errorMessage = record.error_message;
    }

    return event;
  }

  /**
   * Generate S3 key for audit export
   * Pattern: {prefix}/{year}/{month}/{start-date}_{end-date}_{export-timestamp}.jsonl
   */
  private generateExportKey(
    prefix: string,
    startTime: Date,
    endTime: Date,
    exportDate: Date
  ): string {
    const year = exportDate.getUTCFullYear();
    const month = String(exportDate.getUTCMonth() + 1).padStart(2, '0');
    const startStr = startTime.toISOString().split('T')[0];
    const endStr = endTime.toISOString().split('T')[0];
    const exportTimestamp = exportDate.getTime();

    return `${prefix}/${year}/${month}/${startStr}_${endStr}_${exportTimestamp}.jsonl`;
  }

  /**
   * Get configuration info for debugging
   */
  getConfig(): AuditLoggerConfig {
    return {
      tableName: this.tableName,
      s3Bucket: this.s3Bucket,
      region: this.region,
      ttlDays: this.ttlDays,
      exportPrefix: this.exportPrefix,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let auditLoggerInstance: AuditLoggerService | null = null;

/**
 * Get singleton instance of AuditLoggerService
 */
export function getAuditLoggerService(
  config?: Partial<AuditLoggerConfig>
): AuditLoggerService {
  if (auditLoggerInstance === null) {
    auditLoggerInstance = new AuditLoggerService(config);
  }
  return auditLoggerInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetAuditLoggerService(): void {
  auditLoggerInstance = null;
}

// ============================================================================
// Convenience Exports
// ============================================================================

export {
  DEFAULT_TTL_DAYS,
  DEFAULT_EXPORT_PREFIX,
  SENSITIVE_FIELDS,
};
