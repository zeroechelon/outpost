/**
 * Workspace type definitions for EFS-based job workspaces
 */

/**
 * Workspace initialization mode for controlling repository cloning behavior
 * - full: Full repository clone (default, existing behavior)
 * - minimal: Sparse checkout (only *.md, *.json, *.yaml, *.yml, src/)
 * - none: Empty workspace directory, skip git clone
 */
export type WorkspaceInitMode = 'full' | 'minimal' | 'none';

export interface Workspace {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly status: WorkspaceStatus;
}

export type WorkspaceStatus = 'creating' | 'ready' | 'in_use' | 'archiving' | 'archived' | 'deleted';

export interface WorkspaceFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
  readonly isDirectory: boolean;
}

export interface WorkspaceSnapshot {
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly s3Key: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

export interface CreateWorkspaceRequest {
  readonly jobId: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly ttlSeconds?: number;
}

export interface WorkspaceConfig {
  readonly mountPath: string;
  readonly maxSizeBytes: number;
  readonly defaultTtlSeconds: number;
}
