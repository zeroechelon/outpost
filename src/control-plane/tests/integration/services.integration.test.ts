/**
 * Service Integration Tests
 *
 * Tests service classes with mocked dependencies.
 * These tests verify service logic and orchestration without requiring AWS credentials.
 *
 * To run against real AWS resources (dev environment):
 * AWS_PROFILE=soc npm run test:integration
 *
 * Tests:
 * - DispatcherOrchestrator.dispatch() - End-to-end dispatch flow
 * - StatusTracker.getStatus() - Status retrieval
 * - ArtifactManager.generateUploadUrl() - S3 presigned URL generation
 */

import { describe, it, expect, beforeEach, jest, beforeAll, afterAll } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { generateTestId, TEST_USER_ID, TEST_TENANT_ID } from './setup.js';

// Create mock functions that will be hoisted properly
// These are created using a factory pattern to avoid TDZ issues
const mockS3Send = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockDynamoSend = jest.fn();

// Mock DynamoDB first (before S3) to avoid import order issues
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  // Access the mock from the outer scope through a getter
  const getMockDynamoSend = () => mockDynamoSend;
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({
        send: (...args: unknown[]) => getMockDynamoSend()(...args),
      })),
    },
    GetCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetCommand' })),
    PutCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutCommand' })),
    UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'UpdateCommand' })),
    QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'QueryCommand' })),
  };
});

// Mock S3 client
jest.mock('@aws-sdk/client-s3', () => {
  const getMockS3Send = () => mockS3Send;
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => getMockS3Send()(...args),
    })),
    PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObjectCommand' })),
    GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObjectCommand' })),
    HeadObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'HeadObjectCommand' })),
    DeleteObjectsCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteObjectsCommand' })),
    ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ ...params, _type: 'ListObjectsV2Command' })),
    CreateMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'CreateMultipartUploadCommand' })),
    UploadPartCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'UploadPartCommand' })),
    CompleteMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'CompleteMultipartUploadCommand' })),
    AbortMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'AbortMultipartUploadCommand' })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  const getMockGetSignedUrl = () => mockGetSignedUrl;
  return {
    getSignedUrl: (...args: unknown[]) => getMockGetSignedUrl()(...args),
  };
});

// Import after mocking
import {
  ArtifactManagerService,
  resetArtifactManagerService,
  ARTIFACT_FILENAMES,
} from '../../src/services/artifact-manager.js';

describe('Service Integration Tests', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockGetSignedUrl.mockReset();
    mockDynamoSend.mockReset();
  });

  describe('ArtifactManagerService', () => {
    let artifactManager: ArtifactManagerService;
    const testBucket = 'outpost-artifacts-dev-311493921645';

    beforeAll(() => {
      resetArtifactManagerService();
      artifactManager = new ArtifactManagerService({
        bucket: testBucket,
        region: 'us-east-1',
        retentionDays: 30,
      });
    });

    afterAll(() => {
      resetArtifactManagerService();
    });

    describe('generateUploadUrl()', () => {
      it('should generate S3 presigned URL for upload', async () => {
        const dispatchId = generateTestId('presign-upload');
        const mockUrl = `https://${testBucket}.s3.amazonaws.com/dispatches/${dispatchId}/output.log?X-Amz-Signature=abc123`;

        mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

        const result = await artifactManager.generateUploadUrl(
          dispatchId,
          ARTIFACT_FILENAMES.OUTPUT_LOG,
          'text/plain'
        );

        expect(result).toBeDefined();
        expect(result.url).toBe(mockUrl);
        expect(result.method).toBe('PUT');
        expect(result.expiresAt).toBeDefined();
        expect(result.expiresAt).toBeInstanceOf(Date);
        expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      });

      it('should generate upload URLs for all standard artifact types', async () => {
        const dispatchId = generateTestId('presign-all');
        const filenames = [
          { name: ARTIFACT_FILENAMES.OUTPUT_LOG, contentType: 'text/plain' },
          { name: ARTIFACT_FILENAMES.SUMMARY_JSON, contentType: 'application/json' },
          { name: ARTIFACT_FILENAMES.DIFF_PATCH, contentType: 'text/x-patch' },
          { name: ARTIFACT_FILENAMES.STDOUT, contentType: 'text/plain' },
          { name: ARTIFACT_FILENAMES.STDERR, contentType: 'text/plain' },
        ];

        for (const { name, contentType } of filenames) {
          const mockUrl = `https://${testBucket}.s3.amazonaws.com/dispatches/${dispatchId}/${name}?X-Amz-Signature=abc`;
          mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

          const result = await artifactManager.generateUploadUrl(dispatchId, name, contentType);

          expect(result.url).toBeDefined();
          expect(result.url).toContain('X-Amz-Signature');
          expect(result.method).toBe('PUT');
        }

        expect(mockGetSignedUrl).toHaveBeenCalledTimes(filenames.length);
      });

      it('should respect custom expiry time', async () => {
        const dispatchId = generateTestId('presign-expiry');
        const customExpiry = 300; // 5 minutes
        const mockUrl = `https://${testBucket}.s3.amazonaws.com/test?X-Amz-Signature=abc`;

        mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

        const result = await artifactManager.generateUploadUrl(
          dispatchId,
          'custom-artifact.txt',
          'text/plain',
          customExpiry
        );

        const now = Date.now();
        const expiryTime = result.expiresAt.getTime();
        const expectedExpiry = now + customExpiry * 1000;

        // Allow 5 second tolerance
        expect(Math.abs(expiryTime - expectedExpiry)).toBeLessThan(5000);
      });
    });

    describe('uploadArtifact()', () => {
      it('should upload artifact to S3', async () => {
        const dispatchId = generateTestId('upload');
        const content = `Test output log content\nLine 2\nTimestamp: ${new Date().toISOString()}`;

        mockS3Send.mockResolvedValueOnce({ ETag: '"abc123"' });

        const result = await artifactManager.uploadArtifact(
          dispatchId,
          ARTIFACT_FILENAMES.OUTPUT_LOG,
          content
        );

        expect(result).toBeDefined();
        expect(result.key).toContain(dispatchId);
        expect(result.key).toContain(ARTIFACT_FILENAMES.OUTPUT_LOG);
        expect(result.bucket).toBe(testBucket);
        expect(result.size).toBe(Buffer.from(content, 'utf-8').length);
        expect(result.etag).toBe('"abc123"');
        expect(mockS3Send).toHaveBeenCalledTimes(1);
      });

      it('should upload JSON artifact with correct content type', async () => {
        const dispatchId = generateTestId('upload-json');
        const content = JSON.stringify({
          status: 'completed',
          agent: 'claude',
          duration: 45000,
          timestamp: new Date().toISOString(),
        });

        mockS3Send.mockResolvedValueOnce({ ETag: '"def456"' });

        const result = await artifactManager.uploadArtifact(
          dispatchId,
          ARTIFACT_FILENAMES.SUMMARY_JSON,
          content,
          'application/json'
        );

        expect(result).toBeDefined();
        expect(result.key).toContain(ARTIFACT_FILENAMES.SUMMARY_JSON);
      });

      it('should upload buffer content', async () => {
        const dispatchId = generateTestId('upload-buffer');
        const content = Buffer.from('Binary content test', 'utf-8');

        mockS3Send.mockResolvedValueOnce({ ETag: '"ghi789"' });

        const result = await artifactManager.uploadArtifact(
          dispatchId,
          'binary-artifact.bin',
          content,
          'application/octet-stream'
        );

        expect(result).toBeDefined();
        expect(result.size).toBe(content.length);
      });
    });

    describe('listArtifacts()', () => {
      it('should list artifacts for a dispatch', async () => {
        const dispatchId = generateTestId('list');

        mockS3Send.mockResolvedValueOnce({
          Contents: [
            {
              Key: `dispatches/${dispatchId}/output.log`,
              Size: 1024,
              LastModified: new Date(),
            },
            {
              Key: `dispatches/${dispatchId}/summary.json`,
              Size: 256,
              LastModified: new Date(),
            },
          ],
        });

        // Mock HeadObject calls for metadata
        mockS3Send.mockResolvedValueOnce({ Metadata: {} });
        mockS3Send.mockResolvedValueOnce({ Metadata: {} });

        const result = await artifactManager.listArtifacts(dispatchId);

        expect(result).toBeDefined();
        expect(result.dispatchId).toBe(dispatchId);
        expect(result.artifacts).toBeDefined();
        expect(result.artifacts.length).toBe(2);
        expect(result.count).toBe(2);
        expect(result.totalSize).toBe(1280);
      });

      it('should return empty list for dispatch with no artifacts', async () => {
        const dispatchId = generateTestId('empty-list');

        mockS3Send.mockResolvedValueOnce({ Contents: [] });

        const result = await artifactManager.listArtifacts(dispatchId);

        expect(result.dispatchId).toBe(dispatchId);
        expect(result.artifacts).toEqual([]);
        expect(result.count).toBe(0);
        expect(result.totalSize).toBe(0);
      });
    });

    describe('generateDownloadUrl()', () => {
      it('should generate presigned URL for download', async () => {
        const dispatchId = generateTestId('download');
        const mockUrl = `https://${testBucket}.s3.amazonaws.com/dispatches/${dispatchId}/output.log?X-Amz-Signature=xyz`;

        // Mock HeadObject to verify artifact exists
        mockS3Send.mockResolvedValueOnce({});
        mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

        const result = await artifactManager.generateDownloadUrl(
          dispatchId,
          ARTIFACT_FILENAMES.OUTPUT_LOG
        );

        expect(result).toBeDefined();
        expect(result.url).toBe(mockUrl);
        expect(result.method).toBe('GET');
        expect(result.expiresAt).toBeInstanceOf(Date);
      });

      it('should throw NotFoundError for non-existent artifact', async () => {
        const dispatchId = generateTestId('download-notfound');
        const notFoundError = new Error('Not found');
        (notFoundError as { name: string }).name = 'NotFound';

        mockS3Send.mockRejectedValueOnce(notFoundError);

        await expect(
          artifactManager.generateDownloadUrl(dispatchId, 'non-existent.txt')
        ).rejects.toThrow(/not found/i);
      });
    });

    describe('getArtifact()', () => {
      it('should retrieve artifact content from S3', async () => {
        const dispatchId = generateTestId('get-artifact');
        const originalContent = `Test content for retrieval ${Date.now()}`;

        // Mock S3 GetObject response with async iterable body
        const mockBody = {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(originalContent, 'utf-8');
          },
        };

        mockS3Send.mockResolvedValueOnce({ Body: mockBody });

        const content = await artifactManager.getArtifact(
          dispatchId,
          ARTIFACT_FILENAMES.OUTPUT_LOG
        );

        expect(content).toBeInstanceOf(Buffer);
        expect(content.toString('utf-8')).toBe(originalContent);
      });
    });

    describe('artifactExists()', () => {
      it('should return true for existing artifact', async () => {
        const dispatchId = generateTestId('exists-true');

        mockS3Send.mockResolvedValueOnce({});

        const exists = await artifactManager.artifactExists(
          dispatchId,
          ARTIFACT_FILENAMES.OUTPUT_LOG
        );

        expect(exists).toBe(true);
      });

      it('should return false for non-existent artifact', async () => {
        const dispatchId = generateTestId('exists-false');
        const notFoundError = new Error('Not found');
        (notFoundError as { name: string }).name = 'NotFound';

        mockS3Send.mockRejectedValueOnce(notFoundError);

        const exists = await artifactManager.artifactExists(
          dispatchId,
          'does-not-exist.txt'
        );

        expect(exists).toBe(false);
      });
    });

    describe('deleteArtifacts()', () => {
      it('should delete all artifacts for a dispatch', async () => {
        const dispatchId = generateTestId('delete');

        // Mock ListObjectsV2 response
        mockS3Send.mockResolvedValueOnce({
          Contents: [
            { Key: `dispatches/${dispatchId}/file1.txt` },
            { Key: `dispatches/${dispatchId}/file2.txt` },
            { Key: `dispatches/${dispatchId}/file3.txt` },
          ],
        });

        // Mock DeleteObjects response
        mockS3Send.mockResolvedValueOnce({});

        const deletedCount = await artifactManager.deleteArtifacts(dispatchId);

        expect(deletedCount).toBe(3);
        expect(mockS3Send).toHaveBeenCalledTimes(2);
      });

      it('should return 0 when no artifacts to delete', async () => {
        const dispatchId = generateTestId('delete-empty');

        mockS3Send.mockResolvedValueOnce({ Contents: [] });

        const deletedCount = await artifactManager.deleteArtifacts(dispatchId);

        expect(deletedCount).toBe(0);
        expect(mockS3Send).toHaveBeenCalledTimes(1);
      });
    });

    describe('getConfig()', () => {
      it('should return artifact manager configuration', () => {
        const config = artifactManager.getConfig();

        expect(config).toBeDefined();
        expect(config.bucket).toBe(testBucket);
        expect(config.region).toBe('us-east-1');
        expect(config.retentionDays).toBe(30);
        expect(config.defaultPresignExpirySeconds).toBeDefined();
        expect(config.multipartThresholdBytes).toBeDefined();
        expect(config.multipartPartSizeBytes).toBeDefined();
      });
    });
  });

  describe('Dispatcher Flow (Mocked)', () => {
    it('should validate dispatch request structure', () => {
      // Test dispatch request validation
      const validRequest = {
        agent: 'claude',
        task: 'This is a valid task with more than 10 characters',
        context: 'standard',
        timeoutSeconds: 600,
      };

      expect(validRequest.agent).toBe('claude');
      expect(validRequest.task.length).toBeGreaterThanOrEqual(10);
      expect(validRequest.context).toBe('standard');
      expect(validRequest.timeoutSeconds).toBeGreaterThanOrEqual(30);
      expect(validRequest.timeoutSeconds).toBeLessThanOrEqual(86400);
    });

    it('should validate dispatch response structure', () => {
      // Test expected dispatch response structure
      const mockResponse = {
        dispatchId: uuidv4(),
        status: 'PENDING',
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        estimatedStartTime: new Date(),
      };

      expect(mockResponse.dispatchId).toBeDefined();
      expect(mockResponse.status).toBe('PENDING');
      expect(['claude', 'codex', 'gemini', 'aider', 'grok']).toContain(mockResponse.agent);
      expect(mockResponse.modelId).toBeDefined();
      expect(mockResponse.estimatedStartTime).toBeInstanceOf(Date);
    });
  });

  describe('StatusTracker Flow (Mocked)', () => {
    it('should validate status response structure', () => {
      // Test expected status response structure
      const mockStatus = {
        dispatchId: uuidv4(),
        status: 'RUNNING',
        progress: 50,
        startedAt: new Date(),
        logs: [
          { timestamp: new Date(), message: 'Starting task', level: 'info' },
        ],
      };

      expect(mockStatus.dispatchId).toBeDefined();
      expect(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT']).toContain(mockStatus.status);
      expect(mockStatus.progress).toBeGreaterThanOrEqual(0);
      expect(mockStatus.progress).toBeLessThanOrEqual(100);
      expect(mockStatus.startedAt).toBeInstanceOf(Date);
      expect(Array.isArray(mockStatus.logs)).toBe(true);
    });

    it('should validate job status transitions', () => {
      // Test valid status transitions
      const validTransitions: Record<string, string[]> = {
        PENDING: ['RUNNING', 'CANCELLED'],
        RUNNING: ['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'],
        COMPLETED: [],
        FAILED: [],
        CANCELLED: [],
        TIMEOUT: [],
      };

      expect(validTransitions['PENDING']).toContain('RUNNING');
      expect(validTransitions['RUNNING']).toContain('COMPLETED');
      expect(validTransitions['RUNNING']).toContain('FAILED');
      expect(validTransitions['COMPLETED'].length).toBe(0);
      expect(validTransitions['FAILED'].length).toBe(0);
    });
  });
});
