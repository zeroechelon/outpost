/**
 * Artifacts model and validation schemas
 *
 * Defines Zod schemas for artifact request/response validation
 */

import { z } from 'zod';

/**
 * Schema for dispatch ID path parameter
 */
export const ArtifactsParamsSchema = z.object({
  dispatchId: z.string().min(1, 'Dispatch ID required'),
});

/**
 * Schema for artifacts query parameters
 */
export const ArtifactsQuerySchema = z.object({
  /**
   * Presigned URL expiration in seconds (default 3600 = 1 hour)
   */
  expiresIn: z.coerce.number().int().min(60).max(86400).default(3600),
});

export type ArtifactsQuery = z.infer<typeof ArtifactsQuerySchema>;

/**
 * Artifact type enumeration
 */
export const ArtifactTypeSchema = z.enum([
  'output',      // Primary output file (e.g., PR diff, response)
  'logs',        // Execution logs
  'workspace',   // Workspace snapshot
  'metadata',    // Execution metadata JSON
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

/**
 * Single artifact response
 */
export const ArtifactSchema = z.object({
  type: ArtifactTypeSchema,
  key: z.string(),
  url: z.string().url(),
  expiresAt: z.coerce.date(),
  sizeBytes: z.number().int().min(0).optional(),
  contentType: z.string().optional(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

/**
 * Artifacts response schema for API
 */
export const ArtifactsResponseSchema = z.object({
  dispatchId: z.string(),
  artifacts: z.array(ArtifactSchema),
  status: z.string(),
});

export type ArtifactsResponse = z.infer<typeof ArtifactsResponseSchema>;
