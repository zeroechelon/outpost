/**
 * Outpost Workspace Cleanup Lambda
 *
 * Triggered by DynamoDB Streams when TTL expires workspace records.
 * Cleans up corresponding EFS access points to prevent resource leakage.
 *
 * Stream View Type: OLD_IMAGE (provides deleted item attributes)
 * Trigger Event: REMOVE (TTL deletion)
 */

const { EFSClient, DeleteAccessPointCommand } = require('@aws-sdk/client-efs');

const efs = new EFSClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  console.log('Workspace cleanup triggered:', JSON.stringify(event, null, 2));

  const results = {
    processed: 0,
    deleted: 0,
    skipped: 0,
    errors: []
  };

  for (const record of event.Records) {
    results.processed++;

    // Only process REMOVE events (TTL deletions)
    if (record.eventName !== 'REMOVE') {
      console.log(`Skipping non-REMOVE event: ${record.eventName}`);
      results.skipped++;
      continue;
    }

    const oldImage = record.dynamodb.OldImage;
    if (!oldImage) {
      console.log('No OldImage in record, skipping');
      results.skipped++;
      continue;
    }

    const workspaceId = oldImage.workspace_id?.S;
    const accessPointId = oldImage.access_point_id?.S;
    const runId = oldImage.run_id?.S;

    console.log(`Processing workspace cleanup:`, {
      workspaceId,
      accessPointId,
      runId,
      eventSource: record.eventSource,
      eventID: record.eventID
    });

    if (!accessPointId) {
      console.log(`No access_point_id for workspace ${workspaceId}, skipping EFS cleanup`);
      results.skipped++;
      continue;
    }

    try {
      console.log(`Deleting EFS access point ${accessPointId} for workspace ${workspaceId}`);

      await efs.send(new DeleteAccessPointCommand({
        AccessPointId: accessPointId
      }));

      console.log(`Successfully deleted access point ${accessPointId}`);
      results.deleted++;

    } catch (error) {
      if (error.name === 'AccessPointNotFound') {
        console.log(`Access point ${accessPointId} already deleted (not found)`);
        results.skipped++;
      } else {
        console.error(`Failed to delete access point ${accessPointId}:`, {
          error: error.message,
          code: error.code,
          name: error.name
        });
        results.errors.push({
          workspaceId,
          accessPointId,
          error: error.message
        });
        // Re-throw to trigger DLQ/retry if configured
        throw error;
      }
    }
  }

  console.log('Cleanup complete:', results);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Workspace cleanup complete',
      results
    })
  };
};
