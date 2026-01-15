/**
 * Base repository with DynamoDB client setup
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';

let rawClientInstance: DynamoDBClient | null = null;
let docClientInstance: DynamoDBDocumentClient | null = null;

/**
 * Get the raw DynamoDB client (for operations requiring manual marshalling)
 */
export function getDocClientRaw(): DynamoDBClient {
  if (rawClientInstance === null) {
    const config = getConfig();
    const logger = getLogger();

    logger.debug({ region: config.awsRegion }, 'Initializing raw DynamoDB client');

    rawClientInstance = new DynamoDBClient({
      region: config.awsRegion,
    });
  }

  return rawClientInstance;
}

/**
 * Get the DynamoDB Document client (auto-marshalling)
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (docClientInstance === null) {
    const config = getConfig();
    const logger = getLogger();

    logger.debug({ region: config.awsRegion }, 'Initializing DynamoDB document client');

    const client = getDocClientRaw();

    docClientInstance = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        convertEmptyValues: false,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }

  return docClientInstance;
}

// For testing
export function resetDocClient(): void {
  rawClientInstance = null;
  docClientInstance = null;
}
