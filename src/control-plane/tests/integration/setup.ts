/**
 * Integration test setup file
 *
 * Configures test environment for integration tests against real AWS resources.
 * Uses dev environment tables: outpost-jobs-dev, outpost-tenants-dev, outpost-audit-dev
 * Uses S3 bucket: outpost-artifacts-dev-311493921645
 *
 * Note: These tests require AWS credentials configured via environment or ~/.aws/credentials
 * Use AWS_PROFILE=soc for Outpost dev resources.
 */

import { resetConfig } from '../../src/utils/config.js';
import { resetLogger } from '../../src/utils/logger.js';
import { resetDocClient } from '../../src/repositories/base.repository.js';

// Set integration test environment variables
process.env['NODE_ENV'] = 'test';
process.env['AWS_REGION'] = 'us-east-1';
process.env['LOG_LEVEL'] = 'error'; // Minimal logging during tests
process.env['LOG_PRETTY'] = 'false';

// DynamoDB dev tables
process.env['DYNAMODB_JOBS_TABLE'] = 'outpost-jobs-dev';
process.env['DYNAMODB_TENANTS_TABLE'] = 'outpost-tenants-dev';
process.env['DYNAMODB_AUDIT_TABLE'] = 'outpost-audit-dev';
process.env['DYNAMODB_API_KEYS_TABLE'] = 'outpost-api-keys-dev';
process.env['DYNAMODB_TABLE_PREFIX'] = 'outpost-dev';

// S3 artifact bucket
process.env['S3_OUTPUT_BUCKET'] = 'outpost-artifacts-dev-311493921645';
process.env['ARTIFACTS_BUCKET'] = 'outpost-artifacts-dev-311493921645';

// ECS cluster (for reference - most tests mock ECS interactions)
process.env['ECS_CLUSTER_ARN'] = 'arn:aws:ecs:us-east-1:311493921645:cluster/outpost-dev';

// Reset singletons before each test
beforeEach(() => {
  resetConfig();
  resetLogger();
  resetDocClient();
});

// Global test timeout for integration tests (30 seconds)
jest.setTimeout(30000);

/**
 * Test utilities
 */
export const TEST_TENANT_ID = 'integration-test-tenant-00000000-0000-0000-0000-000000000001';
export const TEST_USER_ID = 'integration-test-user-00000000-0000-0000-0000-000000000001';

/**
 * Generate unique test identifiers to avoid collisions
 */
export function generateTestId(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Wait for a condition to be true (polling)
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 500
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Check if AWS credentials are available
 */
export function hasAwsCredentials(): boolean {
  return (
    process.env['AWS_ACCESS_KEY_ID'] !== undefined ||
    process.env['AWS_PROFILE'] !== undefined ||
    process.env['AWS_SESSION_TOKEN'] !== undefined
  );
}

/**
 * Skip test if no AWS credentials available
 */
export function skipIfNoCredentials(testFn: () => void | Promise<void>): () => void | Promise<void> {
  return async () => {
    if (!hasAwsCredentials()) {
      console.log('Skipping test: No AWS credentials available');
      return;
    }
    return testFn();
  };
}
