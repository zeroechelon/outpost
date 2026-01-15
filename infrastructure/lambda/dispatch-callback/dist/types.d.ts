/**
 * Dispatch Status Callback Lambda Types
 *
 * Type definitions for ECS Task State Change events and dispatch status handling.
 */
/**
 * Dispatch status enum representing the lifecycle states of a dispatch job.
 */
export declare enum DispatchStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    TIMEOUT = "TIMEOUT",
    CANCELLED = "CANCELLED"
}
/**
 * ECS container details from task state change event.
 */
export interface EcsContainer {
    /** Container name */
    name: string;
    /** Exit code (0 = success, non-zero = failure) */
    exitCode?: number;
    /** Current container status */
    lastStatus: string;
    /** Container image */
    image?: string;
    /** Reason for container exit */
    reason?: string;
    /** Container ARN */
    containerArn?: string;
    /** Network bindings */
    networkBindings?: unknown[];
    /** Network interfaces */
    networkInterfaces?: unknown[];
    /** CPU units */
    cpu?: string;
    /** Memory in MB */
    memory?: string;
    /** Memory reservation in MB */
    memoryReservation?: string;
    /** Runtime ID */
    runtimeId?: string;
}
/**
 * Environment variable override in container.
 */
export interface EnvironmentOverride {
    name: string;
    value: string;
}
/**
 * Container override from task definition.
 */
export interface ContainerOverride {
    name: string;
    command?: string[];
    environment?: EnvironmentOverride[];
    cpu?: number;
    memory?: number;
    memoryReservation?: number;
}
/**
 * Task overrides containing container-level overrides.
 */
export interface TaskOverrides {
    containerOverrides?: ContainerOverride[];
    taskRoleArn?: string;
    executionRoleArn?: string;
    cpu?: string;
    memory?: string;
}
/**
 * ECS task detail from EventBridge event.
 */
export interface EcsTaskDetail {
    /** Task ARN */
    taskArn: string;
    /** Cluster ARN */
    clusterArn: string;
    /** Task definition ARN */
    taskDefinitionArn: string;
    /** Container instances */
    containers: EcsContainer[];
    /** Current task status */
    lastStatus: string;
    /** Desired task status */
    desiredStatus: string;
    /** Reason the task was stopped */
    stoppedReason?: string;
    /** Stop code indicating why task stopped */
    stopCode?: 'TaskFailedToStart' | 'EssentialContainerExited' | 'UserInitiated' | 'ServiceSchedulerInitiated' | 'SpotInterruption' | 'TerminationNotice';
    /** When task was created */
    createdAt: string;
    /** When task started */
    startedAt?: string;
    /** When task stopped */
    stoppedAt?: string;
    /** Task group (often contains dispatch info) */
    group?: string;
    /** Task overrides */
    overrides?: TaskOverrides;
    /** Launch type */
    launchType?: 'EC2' | 'FARGATE' | 'EXTERNAL';
    /** Platform version (Fargate) */
    platformVersion?: string;
    /** Connectivity status */
    connectivity?: string;
    /** Connectivity timestamp */
    connectivityAt?: string;
    /** Pull start time */
    pullStartedAt?: string;
    /** Pull stop time */
    pullStoppedAt?: string;
    /** Execution stop time */
    executionStoppedAt?: string;
    /** CPU units */
    cpu?: string;
    /** Memory in MB */
    memory?: string;
    /** Version counter */
    version?: number;
    /** Started by identifier */
    startedBy?: string;
    /** Task tags */
    tags?: Array<{
        key: string;
        value: string;
    }>;
    /** Attachments (ENI, etc.) */
    attachments?: unknown[];
    /** Availability zone */
    availabilityZone?: string;
    /** Capacity provider name */
    capacityProviderName?: string;
    /** Health status */
    healthStatus?: string;
}
/**
 * EventBridge event structure for ECS Task State Change.
 */
export interface EcsTaskStateChangeEvent {
    /** Event version */
    version: string;
    /** Unique event ID */
    id: string;
    /** Event detail type */
    'detail-type': 'ECS Task State Change';
    /** Event source */
    source: 'aws.ecs';
    /** AWS account ID */
    account: string;
    /** Event timestamp */
    time: string;
    /** AWS region */
    region: string;
    /** Resources involved */
    resources: string[];
    /** Event detail */
    detail: EcsTaskDetail;
}
/**
 * Parameters for updating dispatch status in DynamoDB.
 */
export interface UpdateDispatchStatusParams {
    /** Dispatch job ID */
    dispatchId: string;
    /** New status */
    status: DispatchStatus;
    /** When the task ended */
    endedAt: string;
    /** Container exit code */
    exitCode?: number;
    /** Error message if failed */
    errorMessage?: string;
    /** Stopped reason from ECS */
    stoppedReason?: string;
}
/**
 * Result of status mapping operation.
 */
export interface StatusMappingResult {
    /** Mapped dispatch status */
    status: DispatchStatus;
    /** Exit code from container */
    exitCode?: number;
    /** Error message extracted from task */
    errorMessage?: string;
}
/**
 * Lambda handler response.
 */
export interface HandlerResponse {
    /** HTTP status code */
    statusCode: number;
    /** Response body */
    body: {
        /** Whether update was successful */
        success: boolean;
        /** Dispatch ID that was updated */
        dispatchId?: string;
        /** New status */
        status?: DispatchStatus;
        /** Error message if failed */
        error?: string;
        /** Whether the event was skipped */
        skipped?: boolean;
        /** Reason for skipping */
        skipReason?: string;
    };
}
//# sourceMappingURL=types.d.ts.map