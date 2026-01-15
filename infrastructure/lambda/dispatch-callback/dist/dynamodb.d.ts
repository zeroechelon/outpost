/**
 * DynamoDB Operations Module
 *
 * Handles all DynamoDB interactions for dispatch status updates.
 */
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { type UpdateDispatchStatusParams } from './types.js';
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
export declare function updateDispatchStatus(params: UpdateDispatchStatusParams): Promise<UpdateResult>;
/**
 * Finds a dispatch record by ECS task ARN using the GSI.
 *
 * @param taskArn - ECS task ARN to search for
 * @returns Dispatch ID if found, undefined otherwise
 */
export declare function findDispatchByTaskArn(taskArn: string): Promise<string | undefined>;
/**
 * Updates dispatch with task ARN after ECS task starts.
 * Used to link dispatch record with ECS task for later lookup.
 *
 * @param dispatchId - Dispatch ID to update
 * @param taskArn - ECS task ARN to associate
 * @returns Update result
 */
export declare function updateDispatchTaskArn(dispatchId: string, taskArn: string): Promise<UpdateResult>;
/**
 * Exports for testing - allows injecting mock clients.
 */
export declare const _testing: {
    getDocClient: () => DynamoDBDocumentClient;
    getTableName: () => string;
    getTaskArnGsi: () => string;
};
//# sourceMappingURL=dynamodb.d.ts.map