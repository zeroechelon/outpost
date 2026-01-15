/**
 * Status Mapper Module
 *
 * Maps ECS task states to dispatch status values.
 */
import { type EcsTaskDetail, type StatusMappingResult } from './types.js';
/**
 * Maps an ECS task's state to a dispatch status.
 *
 * Logic:
 * - Exit code 0 → COMPLETED
 * - Exit code non-zero → FAILED
 * - stoppedReason contains 'timeout' → TIMEOUT
 * - stoppedReason contains 'error' or 'failed' → FAILED
 * - stopCode 'UserInitiated' with cancel indicators → CANCELLED
 * - Default for STOPPED tasks → FAILED
 *
 * @param task - ECS task detail from EventBridge event
 * @returns Status mapping result with status, exit code, and error message
 */
export declare function mapEcsTaskToDispatchStatus(task: EcsTaskDetail): StatusMappingResult;
/**
 * Extracts the dispatch ID from an ECS task.
 *
 * Search order:
 * 1. DISPATCH_ID environment variable in container overrides
 * 2. Task group name (format: "dispatch:UUID")
 * 3. Task tags with key "dispatch_id"
 *
 * @param task - ECS task detail from EventBridge event
 * @returns Dispatch ID or undefined if not found
 */
export declare function extractDispatchId(task: EcsTaskDetail): string | undefined;
/**
 * Checks if an ECS task event should be processed.
 *
 * Only STOPPED tasks with a dispatch ID should be processed.
 *
 * @param task - ECS task detail from EventBridge event
 * @returns Object indicating if task should be processed and reason if not
 */
export declare function shouldProcessTask(task: EcsTaskDetail): {
    process: boolean;
    reason?: string;
};
//# sourceMappingURL=status-mapper.d.ts.map