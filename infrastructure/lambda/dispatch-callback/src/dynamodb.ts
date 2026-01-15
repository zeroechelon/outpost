/**
 * DynamoDB Operations Module
 *
 * Handles all DynamoDB interactions for dispatch status updates.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  QueryCommand,
  type UpdateCommandInput,
  type QueryCommandInput
} from '@aws-sdk/lib-dynamodb';
import {
  type UpdateDispatchStatusParams,
  DispatchStatus
} from './types.js';

// Table and index names from environment
const TABLE_NAME = process.env['DISPATCH_TABLE_NAME'] ?? 'outpost-dispatches';
const TASK_ARN_GSI = process.env['TASK_ARN_GSI_NAME'] ?? 'task_arn-index';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

/**
 * Result of an update operation.
 */
export interface UpdateResult {
  success: boolean;
  updated: boolean;
  error?: string;
  previousStatus?: string;
}

/**
 * Updates the dispatch status in DynamoDB.
 *
 * Uses conditional update to only update if current status is RUNNING.
 * This prevents race conditions and duplicate updates.
 *
 * @param params - Update parameters including dispatch ID, new status, and metadata
 * @returns Update result indicating success/failure
 */
export async function updateDispatchStatus(
  params: UpdateDispatchStatusParams
): Promise<UpdateResult> {
  const {
    dispatchId,
    status,
    endedAt,
    exitCode,
    errorMessage,
    stoppedReason
  } = params;

  // Build update expression
  const updateExpressionParts: string[] = [
    '#status = :status',
    '#ended_at = :ended_at',
    '#updated_at = :updated_at'
  ];

  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#ended_at': 'ended_at',
    '#updated_at': 'updated_at'
  };

  const expressionAttributeValues: Record<string, unknown> = {
    ':status': status,
    ':ended_at': endedAt,
    ':updated_at': new Date().toISOString(),
    ':running_status': DispatchStatus.RUNNING
  };

  // Add optional fields
  if (exitCode !== undefined) {
    updateExpressionParts.push('#exit_code = :exit_code');
    expressionAttributeNames['#exit_code'] = 'exit_code';
    expressionAttributeValues[':exit_code'] = exitCode;
  }

  if (errorMessage) {
    updateExpressionParts.push('#error_message = :error_message');
    expressionAttributeNames['#error_message'] = 'error_message';
    expressionAttributeValues[':error_message'] = errorMessage;
  }

  if (stoppedReason) {
    updateExpressionParts.push('#stopped_reason = :stopped_reason');
    expressionAttributeNames['#stopped_reason'] = 'stopped_reason';
    expressionAttributeValues[':stopped_reason'] = stoppedReason;
  }

  const updateInput: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      dispatch_id: dispatchId
    },
    UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
    ConditionExpression: '#status = :running_status',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_OLD'
  };

  try {
    const result = await docClient.send(new UpdateCommand(updateInput));

    return {
      success: true,
      updated: true,
      previousStatus: result.Attributes?.['status'] as string | undefined
    };
  } catch (error: unknown) {
    // Handle conditional check failure gracefully
    if (isConditionalCheckFailedException(error)) {
      console.log(`Conditional check failed for dispatch ${dispatchId} - likely already updated`);
      return {
        success: true,
        updated: false,
        error: 'Status already updated (not RUNNING)'
      };
    }

    // Handle other errors
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to update dispatch ${dispatchId}:`, errorMsg);

    return {
      success: false,
      updated: false,
      error: errorMsg
    };
  }
}

/**
 * Finds a dispatch record by ECS task ARN using the GSI.
 *
 * @param taskArn - ECS task ARN to search for
 * @returns Dispatch ID if found, undefined otherwise
 */
export async function findDispatchByTaskArn(taskArn: string): Promise<string | undefined> {
  const queryInput: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: TASK_ARN_GSI,
    KeyConditionExpression: '#task_arn = :task_arn',
    ExpressionAttributeNames: {
      '#task_arn': 'task_arn'
    },
    ExpressionAttributeValues: {
      ':task_arn': taskArn
    },
    Limit: 1
  };

  try {
    const result = await docClient.send(new QueryCommand(queryInput));

    if (result.Items && result.Items.length > 0) {
      return result.Items[0]?.['dispatch_id'] as string | undefined;
    }

    return undefined;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to query dispatch by task ARN ${taskArn}:`, errorMsg);
    return undefined;
  }
}

/**
 * Updates dispatch with task ARN after ECS task starts.
 * Used to link dispatch record with ECS task for later lookup.
 *
 * @param dispatchId - Dispatch ID to update
 * @param taskArn - ECS task ARN to associate
 * @returns Update result
 */
export async function updateDispatchTaskArn(
  dispatchId: string,
  taskArn: string
): Promise<UpdateResult> {
  const updateInput: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      dispatch_id: dispatchId
    },
    UpdateExpression: 'SET #task_arn = :task_arn, #updated_at = :updated_at',
    ExpressionAttributeNames: {
      '#task_arn': 'task_arn',
      '#updated_at': 'updated_at'
    },
    ExpressionAttributeValues: {
      ':task_arn': taskArn,
      ':updated_at': new Date().toISOString()
    }
  };

  try {
    await docClient.send(new UpdateCommand(updateInput));
    return { success: true, updated: true };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to update task ARN for dispatch ${dispatchId}:`, errorMsg);
    return { success: false, updated: false, error: errorMsg };
  }
}

/**
 * Type guard for ConditionalCheckFailedException.
 */
function isConditionalCheckFailedException(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { name?: string; __type?: string };
    return (
      err.name === 'ConditionalCheckFailedException' ||
      err.__type?.includes('ConditionalCheckFailedException') === true
    );
  }
  return false;
}

/**
 * Exports for testing - allows injecting mock clients.
 */
export const _testing = {
  getDocClient: () => docClient,
  getTableName: () => TABLE_NAME,
  getTaskArnGsi: () => TASK_ARN_GSI
};
