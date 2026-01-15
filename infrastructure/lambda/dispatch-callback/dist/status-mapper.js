/**
 * Status Mapper Module
 *
 * Maps ECS task states to dispatch status values.
 */
import { DispatchStatus } from './types.js';
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
export function mapEcsTaskToDispatchStatus(task) {
    const stoppedReason = task.stoppedReason?.toLowerCase() ?? '';
    const stopCode = task.stopCode;
    // Find the main container (usually named 'worker' or first container)
    const mainContainer = task.containers.find(c => c.name === 'worker') ?? task.containers[0];
    const exitCode = mainContainer?.exitCode;
    // Build error message from available information
    let errorMessage;
    if (task.stoppedReason) {
        errorMessage = task.stoppedReason;
    }
    else if (mainContainer?.reason) {
        errorMessage = mainContainer.reason;
    }
    // Check for cancellation first (UserInitiated stop)
    if (stopCode === 'UserInitiated') {
        if (stoppedReason.includes('cancel') || stoppedReason.includes('abort')) {
            return {
                status: DispatchStatus.CANCELLED,
                exitCode,
                errorMessage: errorMessage ?? 'Task cancelled by user'
            };
        }
        // UserInitiated without cancel keywords could still be a cancel
        // Check if there's no exit code or task never started
        if (exitCode === undefined && !task.startedAt) {
            return {
                status: DispatchStatus.CANCELLED,
                exitCode,
                errorMessage: errorMessage ?? 'Task stopped before starting'
            };
        }
    }
    // Check for timeout conditions
    if (stoppedReason.includes('timeout') ||
        stoppedReason.includes('timed out') ||
        stoppedReason.includes('exceeded time limit')) {
        return {
            status: DispatchStatus.TIMEOUT,
            exitCode,
            errorMessage: errorMessage ?? 'Task execution timed out'
        };
    }
    // Check for explicit error conditions in stopped reason
    if (stoppedReason.includes('error') ||
        stoppedReason.includes('failed') ||
        stoppedReason.includes('oom') ||
        stoppedReason.includes('out of memory')) {
        return {
            status: DispatchStatus.FAILED,
            exitCode,
            errorMessage
        };
    }
    // Check stopCode for failure conditions
    if (stopCode === 'TaskFailedToStart') {
        return {
            status: DispatchStatus.FAILED,
            exitCode,
            errorMessage: errorMessage ?? 'Task failed to start'
        };
    }
    // Check exit code (most reliable indicator when task ran to completion)
    if (exitCode !== undefined) {
        if (exitCode === 0) {
            return {
                status: DispatchStatus.COMPLETED,
                exitCode,
                errorMessage: undefined
            };
        }
        else {
            return {
                status: DispatchStatus.FAILED,
                exitCode,
                errorMessage: errorMessage ?? `Task exited with code ${exitCode}`
            };
        }
    }
    // Check for Spot Interruption or Termination
    if (stopCode === 'SpotInterruption' || stopCode === 'TerminationNotice') {
        return {
            status: DispatchStatus.FAILED,
            exitCode,
            errorMessage: errorMessage ?? `Task terminated: ${stopCode}`
        };
    }
    // Default: if task is STOPPED without clear success indicators, mark as FAILED
    if (task.lastStatus === 'STOPPED') {
        return {
            status: DispatchStatus.FAILED,
            exitCode,
            errorMessage: errorMessage ?? 'Task stopped without completion status'
        };
    }
    // Fallback for unexpected states
    return {
        status: DispatchStatus.FAILED,
        exitCode,
        errorMessage: errorMessage ?? 'Unknown task termination state'
    };
}
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
export function extractDispatchId(task) {
    // 1. Check container environment overrides for DISPATCH_ID
    if (task.overrides?.containerOverrides) {
        for (const containerOverride of task.overrides.containerOverrides) {
            if (containerOverride.environment) {
                const dispatchEnv = containerOverride.environment.find(env => env.name === 'DISPATCH_ID');
                if (dispatchEnv?.value) {
                    return dispatchEnv.value;
                }
            }
        }
    }
    // 2. Check task group (format: "dispatch:UUID" or "family:dispatch-UUID")
    if (task.group) {
        // Try "dispatch:UUID" format
        const dispatchMatch = task.group.match(/^dispatch:([a-f0-9-]{36})$/i);
        if (dispatchMatch?.[1]) {
            return dispatchMatch[1];
        }
        // Try extracting UUID from group name
        const uuidMatch = task.group.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch?.[1]) {
            return uuidMatch[1];
        }
    }
    // 3. Check task tags
    if (task.tags) {
        const dispatchTag = task.tags.find(tag => tag.key === 'dispatch_id' || tag.key === 'dispatchId' || tag.key === 'DISPATCH_ID');
        if (dispatchTag?.value) {
            return dispatchTag.value;
        }
    }
    // 4. Check startedBy field (might contain dispatch ID)
    if (task.startedBy) {
        const uuidMatch = task.startedBy.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch?.[1]) {
            return uuidMatch[1];
        }
    }
    return undefined;
}
/**
 * Checks if an ECS task event should be processed.
 *
 * Only STOPPED tasks with a dispatch ID should be processed.
 *
 * @param task - ECS task detail from EventBridge event
 * @returns Object indicating if task should be processed and reason if not
 */
export function shouldProcessTask(task) {
    // Only process STOPPED tasks
    if (task.lastStatus !== 'STOPPED') {
        return {
            process: false,
            reason: `Task status is ${task.lastStatus}, not STOPPED`
        };
    }
    // Check for dispatch ID
    const dispatchId = extractDispatchId(task);
    if (!dispatchId) {
        return {
            process: false,
            reason: 'No dispatch ID found in task'
        };
    }
    return { process: true };
}
//# sourceMappingURL=status-mapper.js.map