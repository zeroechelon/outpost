/**
 * CloudWatch Metrics Module
 *
 * Publishes custom metrics for dispatch callback monitoring.
 */
/**
 * Publishes callback latency metric to CloudWatch.
 *
 * Measures the time between when an ECS task stops and when
 * the Lambda processes the event.
 *
 * @param stoppedAt - ISO timestamp when the ECS task stopped
 * @param processedAt - Date when the Lambda processed the event (defaults to now)
 * @returns True if metric was published successfully
 */
export declare function publishCallbackLatency(stoppedAt: string, processedAt?: Date): Promise<boolean>;
//# sourceMappingURL=cloudwatch.d.ts.map