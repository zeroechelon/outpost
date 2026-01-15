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
import { mapEcsTaskToDispatchStatus, extractDispatchId, shouldProcessTask } from './status-mapper.js';
import { updateDispatchStatus, findDispatchByTaskArn } from './dynamodb.js';
/**
 * Main Lambda handler for ECS Task State Change events.
 *
 * @param event - EventBridge event containing ECS task state change
 * @returns Handler response with status update result
 */
export async function handler(event) {
    const task = event.detail;
    console.log('Received ECS Task State Change event:', JSON.stringify({
        taskArn: task.taskArn,
        lastStatus: task.lastStatus,
        desiredStatus: task.desiredStatus,
        stopCode: task.stopCode,
        stoppedReason: task.stoppedReason,
        group: task.group
    }));
    // Check if this event should be processed
    const processCheck = shouldProcessTask(task);
    if (!processCheck.process) {
        console.log(`Skipping event: ${processCheck.reason}`);
        return {
            statusCode: 200,
            body: {
                success: true,
                skipped: true,
                skipReason: processCheck.reason
            }
        };
    }
    // Extract dispatch ID from task
    let dispatchId = extractDispatchId(task);
    // If not found in task metadata, try to look up by task ARN in DynamoDB
    if (!dispatchId) {
        console.log('Dispatch ID not in task metadata, querying by task ARN');
        dispatchId = await findDispatchByTaskArn(task.taskArn);
    }
    if (!dispatchId) {
        console.warn('Could not determine dispatch ID for task:', task.taskArn);
        return {
            statusCode: 200,
            body: {
                success: true,
                skipped: true,
                skipReason: 'No dispatch ID found in task or DynamoDB'
            }
        };
    }
    console.log(`Processing dispatch ${dispatchId} for task ${task.taskArn}`);
    // Map ECS task status to dispatch status
    const statusMapping = mapEcsTaskToDispatchStatus(task);
    console.log('Status mapping result:', JSON.stringify({
        dispatchId,
        status: statusMapping.status,
        exitCode: statusMapping.exitCode,
        errorMessage: statusMapping.errorMessage
    }));
    // Update DynamoDB
    const updateResult = await updateDispatchStatus({
        dispatchId,
        status: statusMapping.status,
        endedAt: task.stoppedAt ?? new Date().toISOString(),
        exitCode: statusMapping.exitCode,
        errorMessage: statusMapping.errorMessage,
        stoppedReason: task.stoppedReason
    });
    if (!updateResult.success) {
        console.error('Failed to update dispatch status:', updateResult.error);
        return {
            statusCode: 500,
            body: {
                success: false,
                dispatchId,
                error: updateResult.error ?? 'Unknown error updating dispatch status'
            }
        };
    }
    if (!updateResult.updated) {
        console.log(`Dispatch ${dispatchId} was not updated: ${updateResult.error}`);
        return {
            statusCode: 200,
            body: {
                success: true,
                dispatchId,
                status: statusMapping.status,
                skipped: true,
                skipReason: updateResult.error
            }
        };
    }
    console.log(`Successfully updated dispatch ${dispatchId} to status ${statusMapping.status}`);
    return {
        statusCode: 200,
        body: {
            success: true,
            dispatchId,
            status: statusMapping.status
        }
    };
}
/**
 * Validates that the event is a valid ECS Task State Change event.
 *
 * @param event - Event to validate
 * @returns True if valid, false otherwise
 */
export function isValidEcsTaskStateChangeEvent(event) {
    if (!event || typeof event !== 'object') {
        return false;
    }
    const e = event;
    return (e['source'] === 'aws.ecs' &&
        e['detail-type'] === 'ECS Task State Change' &&
        typeof e['detail'] === 'object' &&
        e['detail'] !== null);
}
/**
 * Extracts key metrics from task for logging and monitoring.
 *
 * @param task - ECS task detail
 * @returns Object with key metrics
 */
export function extractTaskMetrics(task) {
    const startedAt = task.startedAt ? new Date(task.startedAt) : null;
    const stoppedAt = task.stoppedAt ? new Date(task.stoppedAt) : null;
    let durationMs = null;
    if (startedAt && stoppedAt) {
        durationMs = stoppedAt.getTime() - startedAt.getTime();
    }
    return {
        taskArn: task.taskArn,
        clusterArn: task.clusterArn,
        launchType: task.launchType,
        cpu: task.cpu,
        memory: task.memory,
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        durationMs,
        stopCode: task.stopCode,
        stoppedReason: task.stoppedReason,
        containerCount: task.containers.length,
        exitCodes: task.containers.map(c => ({
            name: c.name,
            exitCode: c.exitCode
        }))
    };
}
export { DispatchStatus } from './types.js';
//# sourceMappingURL=index.js.map