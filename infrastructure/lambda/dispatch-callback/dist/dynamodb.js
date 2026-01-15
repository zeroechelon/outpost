/**
 * DynamoDB Operations Module
 *
 * Handles all DynamoDB interactions for dispatch status updates.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DispatchStatus } from './types.js';
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
 * Updates the dispatch status in DynamoDB.
 *
 * Uses conditional update to only update if current status is RUNNING.
 * This prevents race conditions and duplicate updates.
 *
 * @param params - Update parameters including dispatch ID, new status, and metadata
 * @returns Update result indicating success/failure
 */
export async function updateDispatchStatus(params) {
    const { dispatchId, status, endedAt, exitCode, errorMessage, stoppedReason } = params;
    // Build update expression
    const updateExpressionParts = [
        '#status = :status',
        '#ended_at = :ended_at',
        '#updated_at = :updated_at'
    ];
    const expressionAttributeNames = {
        '#status': 'status',
        '#ended_at': 'ended_at',
        '#updated_at': 'updated_at'
    };
    const expressionAttributeValues = {
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
    const updateInput = {
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
            previousStatus: result.Attributes?.['status']
        };
    }
    catch (error) {
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
export async function findDispatchByTaskArn(taskArn) {
    const queryInput = {
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
            return result.Items[0]?.['dispatch_id'];
        }
        return undefined;
    }
    catch (error) {
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
export async function updateDispatchTaskArn(dispatchId, taskArn) {
    const updateInput = {
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
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to update task ARN for dispatch ${dispatchId}:`, errorMsg);
        return { success: false, updated: false, error: errorMsg };
    }
}
/**
 * Type guard for ConditionalCheckFailedException.
 */
function isConditionalCheckFailedException(error) {
    if (error && typeof error === 'object') {
        const err = error;
        return (err.name === 'ConditionalCheckFailedException' ||
            err.__type?.includes('ConditionalCheckFailedException') === true);
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
//# sourceMappingURL=dynamodb.js.map