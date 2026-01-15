/**
 * CloudWatch Metrics Module
 *
 * Publishes custom metrics for dispatch callback monitoring.
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type PutMetricDataCommandInput
} from '@aws-sdk/client-cloudwatch';

const client = new CloudWatchClient({});

const NAMESPACE = 'Outpost/DispatchCallback';
const ENVIRONMENT = process.env.ENVIRONMENT ?? 'dev';

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
export async function publishCallbackLatency(
  stoppedAt: string,
  processedAt: Date = new Date()
): Promise<boolean> {
  const stoppedAtDate = new Date(stoppedAt);
  const latencyMs = processedAt.getTime() - stoppedAtDate.getTime();

  // Guard against negative latency (clock skew) or invalid timestamps
  if (latencyMs < 0 || isNaN(latencyMs)) {
    console.warn('Invalid latency calculation:', {
      stoppedAt,
      processedAt: processedAt.toISOString(),
      latencyMs
    });
    return false;
  }

  const params: PutMetricDataCommandInput = {
    Namespace: NAMESPACE,
    MetricData: [
      {
        MetricName: 'CallbackLatencyMs',
        Dimensions: [
          {
            Name: 'Environment',
            Value: ENVIRONMENT
          }
        ],
        Value: latencyMs,
        Unit: 'Milliseconds',
        Timestamp: processedAt
      }
    ]
  };

  try {
    await client.send(new PutMetricDataCommand(params));
    console.log('Published callback latency metric:', {
      namespace: NAMESPACE,
      metricName: 'CallbackLatencyMs',
      environment: ENVIRONMENT,
      latencyMs,
      stoppedAt,
      processedAt: processedAt.toISOString()
    });
    return true;
  } catch (error) {
    console.error('Failed to publish callback latency metric:', error);
    return false;
  }
}
