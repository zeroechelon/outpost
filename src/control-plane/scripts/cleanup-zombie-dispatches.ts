#!/usr/bin/env npx ts-node

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const DISPATCHES_TABLE = 'outpost-dispatches';
const CLUSTER_ARN = 'arn:aws:ecs:us-east-1:311493921645:cluster/outpost-dev';
const STALE_THRESHOLD_HOURS = 1; // Dispatches older than 1 hour with no ECS task

async function main() {
  const ddb = new DynamoDBClient({ region: 'us-east-1' });
  const ecs = new ECSClient({ region: 'us-east-1' });

  // Scan for RUNNING and PENDING dispatches
  const result = await ddb.send(new ScanCommand({
    TableName: DISPATCHES_TABLE,
    FilterExpression: '#status IN (:running, :pending)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':running': { S: 'RUNNING' },
      ':pending': { S: 'PENDING' }
    }
  }));

  console.log(`Found ${result.Items?.length || 0} stale dispatches`);

  let cleanedUp = 0;
  for (const item of result.Items || []) {
    const dispatchId = item['dispatch_id']?.S;
    if (!dispatchId) continue;

    const taskArn = item['task_arn']?.S;
    const createdAt = new Date(item['created_at']?.S || item['started_at']?.S || Date.now());
    const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

    // Check if task exists in ECS
    let taskExists = false;
    if (taskArn) {
      try {
        const taskResult = await ecs.send(new DescribeTasksCommand({
          cluster: CLUSTER_ARN,
          tasks: [taskArn]
        }));
        taskExists = (taskResult.tasks?.length || 0) > 0 &&
                     !taskResult.failures?.some(f => f.reason === 'MISSING');
      } catch (e) {
        // Task doesn't exist
      }
    }

    // If task doesn't exist and dispatch is old, mark as TIMEOUT
    if (!taskExists && ageHours > STALE_THRESHOLD_HOURS) {
      console.log(`Marking ${dispatchId} as TIMEOUT (age: ${ageHours.toFixed(1)}h, status: ${item['status']?.S})`);

      await ddb.send(new UpdateItemCommand({
        TableName: DISPATCHES_TABLE,
        Key: { dispatch_id: { S: dispatchId } },
        UpdateExpression: 'SET #status = :timeout, ended_at = :now, error_message = :msg',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':timeout': { S: 'TIMEOUT' },
          ':now': { S: new Date().toISOString() },
          ':msg': { S: 'Cleaned up stale dispatch (ECS task no longer exists)' }
        }
      }));
      cleanedUp++;
    }
  }

  console.log(`Cleanup complete. Marked ${cleanedUp} dispatches as TIMEOUT.`);
}

main().catch(console.error);
