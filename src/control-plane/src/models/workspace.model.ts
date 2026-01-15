/**
 * Workspace model and validation schemas
 *
 * Defines Zod schemas for workspace request/response validation
 */

import { z } from 'zod';

/**
 * Schema for workspace ID path parameter
 */
export const WorkspaceParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
});

/**
 * Schema for list workspaces query parameters
 */
export const ListWorkspacesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListWorkspacesQuery = z.infer<typeof ListWorkspacesQuerySchema>;

/**
 * Workspace response schema for API
 */
export const WorkspaceResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string(),
  createdAt: z.coerce.date(),
  lastAccessedAt: z.coerce.date(),
  sizeBytes: z.number().int().min(0),
  sizeFormatted: z.string(),
  repoUrl: z.string().nullable(),
  efsAccessPointId: z.string().nullable(),
});

export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  return `${size.toFixed(2)} ${units[i]}`;
}
