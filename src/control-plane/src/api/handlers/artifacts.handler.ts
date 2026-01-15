/**
 * Artifacts API handlers
 *
 * Implements request handlers for artifact retrieval with presigned S3 URLs.
 */

import type { Response, NextFunction } from 'express';
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DispatchRepository } from '../../repositories/dispatch.repository.js';
import { getConfig } from '../../utils/config.js';
import { getLogger } from '../../utils/logger.js';
import { AuthorizationError } from '../../utils/errors.js';
import type { AuthenticatedRequest, ApiResponse } from '../../types/api.js';
import type { ArtifactsQuery, Artifact, ArtifactsResponse, ArtifactType } from '../../models/artifacts.model.js';

const config = getConfig();
const s3Client = new S3Client({ region: config.awsRegion });
const dispatchRepository = new DispatchRepository();
const logger = getLogger().child({ handler: 'ArtifactsHandler' });

/**
 * Map S3 key suffix to artifact type
 */
function getArtifactType(key: string): ArtifactType {
  if (key.endsWith('.log') || key.includes('/logs/')) {
    return 'logs';
  }
  if (key.endsWith('.json') && key.includes('metadata')) {
    return 'metadata';
  }
  if (key.includes('/workspace/')) {
    return 'workspace';
  }
  return 'output';
}

/**
 * Map content type from S3 key
 */
function getContentType(key: string): string {
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.log') || key.endsWith('.txt')) return 'text/plain';
  if (key.endsWith('.tar.gz') || key.endsWith('.tgz')) return 'application/gzip';
  if (key.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

export class ArtifactsHandler {
  /**
   * GET /artifacts/:dispatchId - Get presigned URLs for dispatch artifacts
   */
  static async getArtifacts(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dispatchIdParam = req.params['dispatchId'];
      const dispatchId = Array.isArray(dispatchIdParam) ? dispatchIdParam[0] : dispatchIdParam;
      if (dispatchId === undefined) {
        throw new Error('Dispatch ID required');
      }

      const query = req.query as unknown as ArtifactsQuery;

      logger.debug(
        { dispatchId, tenantId: req.tenantId },
        'Getting artifacts'
      );

      // Verify dispatch belongs to tenant
      const dispatch = await dispatchRepository.getById(dispatchId);
      if (dispatch.userId !== req.tenantId) {
        throw new AuthorizationError('Dispatch not found or access denied', {
          dispatchId,
        });
      }

      // List artifacts in S3 for this dispatch
      const bucket = config.s3.outputBucket;
      const prefix = `dispatches/${dispatchId}/`;

      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
        })
      );

      const contents = listResponse.Contents ?? [];

      if (contents.length === 0) {
        // No artifacts yet - dispatch may still be running
        const response: ApiResponse<ArtifactsResponse> = {
          success: true,
          data: {
            dispatchId,
            artifacts: [],
            status: dispatch.status,
          },
          meta: {
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        };

        res.status(200).json(response);
        return;
      }

      // Generate presigned URLs for each artifact
      const expiresIn = query.expiresIn;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const artifacts: Artifact[] = await Promise.all(
        contents
          .filter((obj): obj is { Key: string; Size?: number } => obj.Key !== undefined)
          .map(async (obj) => {
            const key = obj.Key;

            // Get presigned URL
            const url = await getSignedUrl(
              s3Client,
              new GetObjectCommand({
                Bucket: bucket,
                Key: key,
              }),
              { expiresIn }
            );

            // Get object metadata for content type
            let sizeBytes = obj.Size;
            let contentType = getContentType(key);

            try {
              const headResponse = await s3Client.send(
                new HeadObjectCommand({
                  Bucket: bucket,
                  Key: key,
                })
              );
              if (headResponse.ContentType !== undefined) {
                contentType = headResponse.ContentType;
              }
              if (headResponse.ContentLength !== undefined) {
                sizeBytes = headResponse.ContentLength;
              }
            } catch {
              // Ignore head errors, use defaults
            }

            // Build artifact object carefully for exactOptionalPropertyTypes
            const artifact: Artifact = {
              type: getArtifactType(key),
              key: key.replace(prefix, ''),
              url,
              expiresAt,
              contentType,
            };
            if (sizeBytes !== undefined) {
              (artifact as { sizeBytes: number }).sizeBytes = sizeBytes;
            }
            return artifact;
          })
      );

      const response: ApiResponse<ArtifactsResponse> = {
        success: true,
        data: {
          dispatchId,
          artifacts,
          status: dispatch.status,
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}
