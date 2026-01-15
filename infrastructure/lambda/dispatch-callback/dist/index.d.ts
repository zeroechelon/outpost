/**
 * Dispatch Status Callback Lambda Handler
 *
 * Processes ECS Task State Change events from EventBridge and updates
 * dispatch status in DynamoDB.
 *
 * Event flow:
 * 1. ECS task stops (STOPPED status)
 * 2. EventBridge routes event to this Lambda
 * 3. Lambda extracts dispatch ID from task metadata
 * 4. Lambda maps ECS status to dispatch status
 * 5. Lambda updates DynamoDB with conditional check
 */
import type { EventBridgeEvent } from 'aws-lambda';
import { type EcsTaskDetail, type HandlerResponse } from './types.js';
/**
 * Main Lambda handler for ECS Task State Change events.
 *
 * @param event - EventBridge event containing ECS task state change
 * @returns Handler response with status update result
 */
export declare function handler(event: EventBridgeEvent<'ECS Task State Change', EcsTaskDetail>): Promise<HandlerResponse>;
/**
 * Validates that the event is a valid ECS Task State Change event.
 *
 * @param event - Event to validate
 * @returns True if valid, false otherwise
 */
export declare function isValidEcsTaskStateChangeEvent(event: unknown): event is EventBridgeEvent<'ECS Task State Change', EcsTaskDetail>;
/**
 * Extracts key metrics from task for logging and monitoring.
 *
 * @param task - ECS task detail
 * @returns Object with key metrics
 */
export declare function extractTaskMetrics(task: EcsTaskDetail): Record<string, unknown>;
export type { EcsTaskDetail, EcsTaskStateChangeEvent, HandlerResponse } from './types.js';
export { DispatchStatus } from './types.js';
//# sourceMappingURL=index.d.ts.map