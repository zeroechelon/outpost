/**
 * Artifact Manager Service
 *
 * Manages artifact storage and retrieval in S3 for dispatch outputs.
 * - Uploads task output (output.log, summary.json, diff.patch)
 * - Organizes by dispatch_id: s3://bucket/dispatches/{id}/
 * - Generates presigned URLs for download (configurable expiry)
 * - Lists artifacts for a dispatch
 * - Implements artifact retention policy (configurable, default 30 days)
 * - Supports large file uploads with multipart (>5MB)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, InternalError, ValidationError } from '../utils/errors.js';
import type { Readable } from 'stream';

// ============================================================================
// Types
// ============================================================================

export interface DispatchArtifactMetadata {
  key: string;
  filename: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
  expiresAt: Date;
}

export interface DispatchPresignedUrlResult {
  url: string;
  expiresAt: Date;
  method: 'GET' | 'PUT';
}

export interface DispatchArtifactUploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
}

export interface DispatchArtifactListResult {
  dispatchId: string;
  artifacts: DispatchArtifactMetadata[];
  totalSize: number;
  count: number;
}

export interface DispatchRetentionPolicyResult {
  deletedCount: number;
  freedBytes: number;
  dispatchesProcessed: number;
}

export interface ArtifactManagerConfig {
  bucket: string;
  region: string;
  retentionDays: number;
  defaultPresignExpirySeconds: number;
  multipartThresholdBytes: number;
  multipartPartSizeBytes: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 3600; // 1 hour
const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB
const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per part

// Standard artifact filenames
export const ARTIFACT_FILENAMES = {
  OUTPUT_LOG: 'output.log',
  SUMMARY_JSON: 'summary.json',
  DIFF_PATCH: 'diff.patch',
  STDOUT: 'stdout.txt',
  STDERR: 'stderr.txt',
} as const;

// Content types for standard artifacts
export const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  'output.log': 'text/plain',
  'summary.json': 'application/json',
  'diff.patch': 'text/x-patch',
  'stdout.txt': 'text/plain',
  'stderr.txt': 'text/plain',
};

// ============================================================================
// ArtifactManagerService
// ============================================================================

export class ArtifactManagerService {
  private readonly logger = getLogger().child({ service: 'ArtifactManagerService' });
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly retentionDays: number;
  private readonly defaultPresignExpirySeconds: number;
  private readonly multipartThresholdBytes: number;
  private readonly multipartPartSizeBytes: number;

  constructor(config?: Partial<ArtifactManagerConfig>) {
    const appConfig = getConfig();

    // Read bucket from ARTIFACTS_BUCKET env var first, fall back to config
    this.bucket = process.env['ARTIFACTS_BUCKET'] ?? config?.bucket ?? appConfig.s3.outputBucket;
    this.region = config?.region ?? appConfig.awsRegion;
    this.retentionDays = config?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.defaultPresignExpirySeconds = config?.defaultPresignExpirySeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;
    this.multipartThresholdBytes = config?.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES;
    this.multipartPartSizeBytes = config?.multipartPartSizeBytes ?? MULTIPART_PART_SIZE_BYTES;

    this.s3Client = new S3Client({ region: this.region });

    this.logger.info({
      bucket: this.bucket,
      region: this.region,
      retentionDays: this.retentionDays,
    }, 'ArtifactManagerService initialized');
  }

  // --------------------------------------------------------------------------
  // Key Generation
  // --------------------------------------------------------------------------

  /**
   * Generate S3 key for an artifact
   * Pattern: dispatches/{dispatch_id}/{filename}
   */
  private generateKey(dispatchId: string, filename: string): string {
    return `dispatches/${dispatchId}/${filename}`;
  }

  /**
   * Parse dispatch ID from S3 key
   */
  private parseDispatchIdFromKey(key: string): string | null {
    const match = key.match(/^dispatches\/([^/]+)\//);
    return match?.[1] ?? null;
  }

  /**
   * Calculate expiration date based on retention policy
   */
  private calculateExpirationDate(uploadedAt: Date = new Date()): Date {
    const expiresAt = new Date(uploadedAt);
    expiresAt.setDate(expiresAt.getDate() + this.retentionDays);
    return expiresAt;
  }

  // --------------------------------------------------------------------------
  // Upload Methods
  // --------------------------------------------------------------------------

  /**
   * Upload a single artifact to S3
   */
  async uploadArtifact(
    dispatchId: string,
    filename: string,
    content: Buffer | string,
    contentType?: string
  ): Promise<DispatchArtifactUploadResult> {
    const key = this.generateKey(dispatchId, filename);
    const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const resolvedContentType = contentType ?? ARTIFACT_CONTENT_TYPES[filename] ?? 'application/octet-stream';

    this.logger.info({
      dispatchId,
      filename,
      key,
      size: body.length,
      contentType: resolvedContentType,
    }, 'Uploading artifact');

    try {
      const response = await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: resolvedContentType,
          Metadata: {
            'dispatch-id': dispatchId,
            'uploaded-at': new Date().toISOString(),
            'expires-at': this.calculateExpirationDate().toISOString(),
          },
        })
      );

      this.logger.info({
        dispatchId,
        filename,
        key,
        etag: response.ETag,
      }, 'Artifact uploaded successfully');

      return {
        key,
        bucket: this.bucket,
        size: body.length,
        etag: response.ETag ?? '',
      };
    } catch (error) {
      this.logger.error({
        dispatchId,
        filename,
        key,
        error,
      }, 'Failed to upload artifact');
      throw new InternalError(`Failed to upload artifact: ${filename}`, {
        dispatchId,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Upload a large artifact using multipart upload
   * Supports streams and large buffers (>5MB)
   */
  async uploadLargeArtifact(
    dispatchId: string,
    filename: string,
    stream: Readable | Buffer,
    size: number,
    contentType?: string
  ): Promise<DispatchArtifactUploadResult> {
    // For small files, use regular upload
    if (size < this.multipartThresholdBytes) {
      if (Buffer.isBuffer(stream)) {
        return this.uploadArtifact(dispatchId, filename, stream, contentType);
      }
      // Convert stream to buffer for small files
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return this.uploadArtifact(dispatchId, filename, Buffer.concat(chunks), contentType);
    }

    const key = this.generateKey(dispatchId, filename);
    const resolvedContentType = contentType ?? ARTIFACT_CONTENT_TYPES[filename] ?? 'application/octet-stream';

    this.logger.info({
      dispatchId,
      filename,
      key,
      size,
      contentType: resolvedContentType,
    }, 'Starting multipart upload');

    let uploadId: string | undefined;

    try {
      // Initialize multipart upload
      const createResponse = await this.s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: resolvedContentType,
          Metadata: {
            'dispatch-id': dispatchId,
            'uploaded-at': new Date().toISOString(),
            'expires-at': this.calculateExpirationDate().toISOString(),
          },
        })
      );

      uploadId = createResponse.UploadId;
      if (uploadId === undefined) {
        throw new Error('Failed to initiate multipart upload: no upload ID returned');
      }

      const completedParts: CompletedPart[] = [];
      let partNumber = 1;

      if (Buffer.isBuffer(stream)) {
        // Upload buffer in parts
        let offset = 0;
        while (offset < stream.length) {
          const end = Math.min(offset + this.multipartPartSizeBytes, stream.length);
          const partData = stream.subarray(offset, end);

          const uploadPartResponse = await this.s3Client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: partData,
            })
          );

          completedParts.push({
            ETag: uploadPartResponse.ETag,
            PartNumber: partNumber,
          });

          this.logger.debug({
            dispatchId,
            filename,
            partNumber,
            partSize: partData.length,
          }, 'Uploaded part');

          offset = end;
          partNumber++;
        }
      } else {
        // Upload stream in parts
        let currentPart: Buffer[] = [];
        let currentPartSize = 0;

        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          currentPart.push(buffer);
          currentPartSize += buffer.length;

          if (currentPartSize >= this.multipartPartSizeBytes) {
            const partData = Buffer.concat(currentPart);
            const uploadPartResponse = await this.s3Client.send(
              new UploadPartCommand({
                Bucket: this.bucket,
                Key: key,
                UploadId: uploadId,
                PartNumber: partNumber,
                Body: partData,
              })
            );

            completedParts.push({
              ETag: uploadPartResponse.ETag,
              PartNumber: partNumber,
            });

            this.logger.debug({
              dispatchId,
              filename,
              partNumber,
              partSize: partData.length,
            }, 'Uploaded part');

            currentPart = [];
            currentPartSize = 0;
            partNumber++;
          }
        }

        // Upload remaining data as final part
        if (currentPart.length > 0) {
          const partData = Buffer.concat(currentPart);
          const uploadPartResponse = await this.s3Client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: partData,
            })
          );

          completedParts.push({
            ETag: uploadPartResponse.ETag,
            PartNumber: partNumber,
          });

          this.logger.debug({
            dispatchId,
            filename,
            partNumber,
            partSize: partData.length,
          }, 'Uploaded final part');
        }
      }

      // Complete multipart upload
      const completeResponse = await this.s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: completedParts,
          },
        })
      );

      this.logger.info({
        dispatchId,
        filename,
        key,
        etag: completeResponse.ETag,
        totalParts: completedParts.length,
      }, 'Multipart upload completed successfully');

      return {
        key,
        bucket: this.bucket,
        size,
        etag: completeResponse.ETag ?? '',
      };
    } catch (error) {
      // Abort multipart upload on failure
      if (uploadId !== undefined) {
        try {
          await this.s3Client.send(
            new AbortMultipartUploadCommand({
              Bucket: this.bucket,
              Key: key,
              UploadId: uploadId,
            })
          );
          this.logger.info({ dispatchId, filename, uploadId }, 'Aborted failed multipart upload');
        } catch (abortError) {
          this.logger.warn({
            dispatchId,
            filename,
            uploadId,
            error: abortError,
          }, 'Failed to abort multipart upload');
        }
      }

      this.logger.error({
        dispatchId,
        filename,
        key,
        error,
      }, 'Multipart upload failed');

      throw new InternalError(`Failed to upload large artifact: ${filename}`, {
        dispatchId,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Presigned URL Methods
  // --------------------------------------------------------------------------

  /**
   * Generate a presigned URL for downloading an artifact
   */
  async generateDownloadUrl(
    dispatchId: string,
    filename: string,
    expirySeconds?: number
  ): Promise<DispatchPresignedUrlResult> {
    const key = this.generateKey(dispatchId, filename);
    const expiry = expirySeconds ?? this.defaultPresignExpirySeconds;

    this.logger.info({
      dispatchId,
      filename,
      key,
      expirySeconds: expiry,
    }, 'Generating download presigned URL');

    // Verify artifact exists
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        throw new NotFoundError(`Artifact not found: ${filename}`, {
          dispatchId,
          filename,
          key,
        });
      }
      throw error;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiry,
    });

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiry);

    this.logger.info({
      dispatchId,
      filename,
      expiresAt: expiresAt.toISOString(),
    }, 'Download URL generated');

    return {
      url,
      expiresAt,
      method: 'GET',
    };
  }

  /**
   * Generate a presigned URL for uploading an artifact
   */
  async generateUploadUrl(
    dispatchId: string,
    filename: string,
    contentType: string,
    expirySeconds?: number
  ): Promise<DispatchPresignedUrlResult> {
    const key = this.generateKey(dispatchId, filename);
    const expiry = expirySeconds ?? this.defaultPresignExpirySeconds;

    this.logger.info({
      dispatchId,
      filename,
      key,
      contentType,
      expirySeconds: expiry,
    }, 'Generating upload presigned URL');

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Metadata: {
        'dispatch-id': dispatchId,
        'uploaded-at': new Date().toISOString(),
        'expires-at': this.calculateExpirationDate().toISOString(),
      },
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiry,
    });

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiry);

    this.logger.info({
      dispatchId,
      filename,
      expiresAt: expiresAt.toISOString(),
    }, 'Upload URL generated');

    return {
      url,
      expiresAt,
      method: 'PUT',
    };
  }

  // --------------------------------------------------------------------------
  // List & Query Methods
  // --------------------------------------------------------------------------

  /**
   * List all artifacts for a dispatch
   */
  async listArtifacts(dispatchId: string): Promise<DispatchArtifactListResult> {
    const prefix = `dispatches/${dispatchId}/`;

    this.logger.info({ dispatchId, prefix }, 'Listing artifacts');

    try {
      const artifacts: DispatchArtifactMetadata[] = [];
      let totalSize = 0;
      let continuationToken: string | undefined;

      do {
        const response = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents ?? []) {
          if (object.Key === undefined || object.Size === undefined) {
            continue;
          }

          const filename = object.Key.replace(prefix, '');
          if (filename === '' || filename.endsWith('/')) {
            continue; // Skip directory markers
          }

          // Get metadata for expiration info
          let uploadedAt = object.LastModified ?? new Date();
          let expiresAt = this.calculateExpirationDate(uploadedAt);

          try {
            const headResponse = await this.s3Client.send(
              new HeadObjectCommand({
                Bucket: this.bucket,
                Key: object.Key,
              })
            );

            if (headResponse.Metadata?.['uploaded-at'] !== undefined) {
              uploadedAt = new Date(headResponse.Metadata['uploaded-at']);
            }
            if (headResponse.Metadata?.['expires-at'] !== undefined) {
              expiresAt = new Date(headResponse.Metadata['expires-at']);
            }
          } catch {
            // Use defaults if metadata fetch fails
          }

          artifacts.push({
            key: object.Key,
            filename,
            size: object.Size,
            contentType: ARTIFACT_CONTENT_TYPES[filename] ?? 'application/octet-stream',
            uploadedAt,
            expiresAt,
          });

          totalSize += object.Size;
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken !== undefined);

      this.logger.info({
        dispatchId,
        count: artifacts.length,
        totalSize,
      }, 'Listed artifacts');

      return {
        dispatchId,
        artifacts,
        totalSize,
        count: artifacts.length,
      };
    } catch (error) {
      this.logger.error({
        dispatchId,
        error,
      }, 'Failed to list artifacts');
      throw new InternalError('Failed to list artifacts', {
        dispatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Delete Methods
  // --------------------------------------------------------------------------

  /**
   * Delete all artifacts for a dispatch
   */
  async deleteArtifacts(dispatchId: string): Promise<number> {
    const prefix = `dispatches/${dispatchId}/`;

    this.logger.info({ dispatchId, prefix }, 'Deleting artifacts');

    try {
      // List all objects to delete
      const objectsToDelete: { Key: string }[] = [];
      let continuationToken: string | undefined;

      do {
        const response = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents ?? []) {
          if (object.Key !== undefined) {
            objectsToDelete.push({ Key: object.Key });
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken !== undefined);

      if (objectsToDelete.length === 0) {
        this.logger.info({ dispatchId }, 'No artifacts to delete');
        return 0;
      }

      // Delete in batches of 1000 (S3 limit)
      const batchSize = 1000;
      for (let i = 0; i < objectsToDelete.length; i += batchSize) {
        const batch = objectsToDelete.slice(i, i + batchSize);
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: batch,
              Quiet: true,
            },
          })
        );
      }

      this.logger.info({
        dispatchId,
        deletedCount: objectsToDelete.length,
      }, 'Artifacts deleted');

      return objectsToDelete.length;
    } catch (error) {
      this.logger.error({
        dispatchId,
        error,
      }, 'Failed to delete artifacts');
      throw new InternalError('Failed to delete artifacts', {
        dispatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Retention Policy
  // --------------------------------------------------------------------------

  /**
   * Apply retention policy - delete artifacts older than retention period
   * This method should be called periodically (e.g., daily via cron/EventBridge)
   */
  async applyRetentionPolicy(): Promise<DispatchRetentionPolicyResult> {
    this.logger.info({
      retentionDays: this.retentionDays,
    }, 'Applying artifact retention policy');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    let deletedCount = 0;
    let freedBytes = 0;
    const processedDispatches = new Set<string>();

    try {
      let continuationToken: string | undefined;

      do {
        const response = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: 'dispatches/',
            ContinuationToken: continuationToken,
          })
        );

        const objectsToDelete: { Key: string; Size: number }[] = [];

        for (const object of response.Contents ?? []) {
          if (object.Key === undefined || object.LastModified === undefined) {
            continue;
          }

          // Check if object is older than retention period
          if (object.LastModified < cutoffDate) {
            const dispatchId = this.parseDispatchIdFromKey(object.Key);
            if (dispatchId !== null) {
              processedDispatches.add(dispatchId);
            }
            objectsToDelete.push({
              Key: object.Key,
              Size: object.Size ?? 0,
            });
          }
        }

        // Delete expired objects in batches
        if (objectsToDelete.length > 0) {
          const batchSize = 1000;
          for (let i = 0; i < objectsToDelete.length; i += batchSize) {
            const batch = objectsToDelete.slice(i, i + batchSize);
            await this.s3Client.send(
              new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: {
                  Objects: batch.map((o) => ({ Key: o.Key })),
                  Quiet: true,
                },
              })
            );

            deletedCount += batch.length;
            freedBytes += batch.reduce((sum, o) => sum + o.Size, 0);
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken !== undefined);

      const result: DispatchRetentionPolicyResult = {
        deletedCount,
        freedBytes,
        dispatchesProcessed: processedDispatches.size,
      };

      this.logger.info(result, 'Retention policy applied');

      return result;
    } catch (error) {
      this.logger.error({
        error,
      }, 'Failed to apply retention policy');
      throw new InternalError('Failed to apply retention policy', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get artifact content directly
   */
  async getArtifact(dispatchId: string, filename: string): Promise<Buffer> {
    const key = this.generateKey(dispatchId, filename);

    this.logger.info({ dispatchId, filename, key }, 'Getting artifact content');

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (response.Body === undefined) {
        throw new NotFoundError(`Artifact not found: ${filename}`, {
          dispatchId,
          filename,
          key,
        });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundError(`Artifact not found: ${filename}`, {
          dispatchId,
          filename,
          key,
        });
      }
      throw error;
    }
  }

  /**
   * Check if an artifact exists
   */
  async artifactExists(dispatchId: string, filename: string): Promise<boolean> {
    const key = this.generateKey(dispatchId, filename);

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get configuration info for debugging
   */
  getConfig(): Omit<ArtifactManagerConfig, 'region'> & { region: string } {
    return {
      bucket: this.bucket,
      region: this.region,
      retentionDays: this.retentionDays,
      defaultPresignExpirySeconds: this.defaultPresignExpirySeconds,
      multipartThresholdBytes: this.multipartThresholdBytes,
      multipartPartSizeBytes: this.multipartPartSizeBytes,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let artifactManagerInstance: ArtifactManagerService | null = null;

/**
 * Get singleton instance of ArtifactManagerService
 */
export function getArtifactManagerService(
  config?: Partial<ArtifactManagerConfig>
): ArtifactManagerService {
  if (artifactManagerInstance === null) {
    artifactManagerInstance = new ArtifactManagerService(config);
  }
  return artifactManagerInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetArtifactManagerService(): void {
  artifactManagerInstance = null;
}
