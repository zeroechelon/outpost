/**
 * Persistent Workspace Service - EFS-backed persistent workspaces for user sessions
 *
 * Provides persistent storage across agent sessions:
 * - Creates EFS access points per user on first use
 * - Mounts user's EFS volume to /workspace
 * - Preserves workspace state between sessions
 * - Supports workspace listing, deletion, and usage tracking
 * - Implements configurable size limits per workspace
 *
 * Design principle: Workspaces persist until explicitly deleted or TTL expires.
 */

import {
  EFSClient,
  CreateAccessPointCommand,
  DeleteAccessPointCommand,
  DescribeAccessPointsCommand,
  type AccessPointDescription,
  type Tag,
} from '@aws-sdk/client-efs';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import {
  WorkspaceError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import {
  WorkspaceRepository,
  type WorkspaceRecord,
  type CreateWorkspaceInput,
} from '../repositories/workspace.repository.js';

/**
 * Persistent workspace configuration
 */
export interface PersistentWorkspaceConfig {
  readonly efsFileSystemId: string;
  readonly defaultSizeLimitBytes: number;
  readonly userRootPath: string;
}

/**
 * Persistent workspace representation
 */
export interface PersistentWorkspace {
  readonly workspaceId: string;
  readonly userId: string;
  readonly efsAccessPointId: string;
  readonly mountPath: string;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly sizeBytes: number;
  readonly repoUrl?: string;
}

/**
 * Workspace usage statistics for billing
 */
export interface WorkspaceUsageStats {
  readonly userId: string;
  readonly totalWorkspaces: number;
  readonly totalSizeBytes: number;
  readonly workspaces: readonly PersistentWorkspace[];
}

/**
 * EFS mount configuration for ECS task definition (persistent workspaces)
 */
export interface PersistentEfsMountConfig {
  readonly fileSystemId: string;
  readonly accessPointId: string;
  readonly containerPath: string;
  readonly readOnly: boolean;
  readonly rootDirectory: string;
}

/**
 * Size limit check result
 */
export interface SizeLimitCheckResult {
  readonly withinLimit: boolean;
  readonly currentSizeBytes: number;
  readonly limitBytes: number;
  readonly remainingBytes: number;
}

/**
 * Options for creating a persistent workspace
 */
export interface CreateWorkspaceOptions {
  readonly userId: string;
  readonly repoUrl?: string;
  readonly sizeLimitBytes?: number;
}

/**
 * Constants
 */
const DEFAULT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10GB
const EFS_USER_ROOT_PATH = '/users';
const WORKSPACE_CONTAINER_PATH = '/workspace';
const POSIX_USER_UID = 1000;
const POSIX_USER_GID = 1000;

/**
 * PersistentWorkspaceService - Manages EFS-backed persistent workspaces
 */
export class PersistentWorkspaceService {
  private readonly logger = getLogger().child({ service: 'PersistentWorkspaceService' });
  private readonly efsClient: EFSClient;
  private readonly config = getConfig();
  private readonly workspaceRepository: WorkspaceRepository;
  private readonly defaultSizeLimitBytes: number;

  constructor(
    efsClient?: EFSClient,
    workspaceRepository?: WorkspaceRepository,
    sizeLimitBytes?: number
  ) {
    this.efsClient = efsClient ?? new EFSClient({ region: this.config.awsRegion });
    this.workspaceRepository = workspaceRepository ?? new WorkspaceRepository();
    this.defaultSizeLimitBytes = sizeLimitBytes ?? DEFAULT_SIZE_LIMIT_BYTES;
  }

  /**
   * Create a persistent workspace with EFS access point
   *
   * Creates an EFS access point at /users/{userId}/{workspaceId} and stores
   * workspace metadata in DynamoDB. The access point enforces POSIX permissions.
   *
   * @param options - Workspace creation options
   * @returns PersistentWorkspace with EFS access point details
   * @throws WorkspaceError if creation fails
   */
  async createPersistentWorkspace(options: CreateWorkspaceOptions): Promise<PersistentWorkspace> {
    const { userId, repoUrl, sizeLimitBytes = this.defaultSizeLimitBytes } = options;
    const workspaceId = uuidv4();
    const rootDirectory = this.buildRootDirectory(userId, workspaceId);

    this.logger.info(
      {
        userId,
        workspaceId,
        rootDirectory,
        hasRepo: repoUrl !== undefined,
        sizeLimitBytes,
      },
      'Creating persistent workspace'
    );

    const fileSystemId = this.getFileSystemId();

    try {
      // Step 1: Create EFS access point
      const accessPointId = await this.createEfsAccessPoint(
        fileSystemId,
        rootDirectory,
        userId,
        workspaceId
      );

      // Step 2: Store workspace record in DynamoDB
      const createInput: CreateWorkspaceInput = {
        userId,
        efsAccessPointId: accessPointId,
        ...(repoUrl !== undefined && { repoUrl }),
      };

      // Create with the specific workspaceId we generated
      const record = await this.workspaceRepository.create(createInput);

      const workspace: PersistentWorkspace = this.recordToWorkspace(record);

      this.logger.info(
        {
          workspaceId: workspace.workspaceId,
          userId,
          accessPointId,
        },
        'Persistent workspace created successfully'
      );

      return workspace;
    } catch (error) {
      this.logger.error(
        {
          userId,
          workspaceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to create persistent workspace'
      );

      throw new WorkspaceError(
        workspaceId,
        `Failed to create persistent workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId, repoUrl }
      );
    }
  }

  /**
   * Get a workspace by user ID and workspace ID
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @returns PersistentWorkspace
   * @throws NotFoundError if workspace not found
   */
  async getWorkspace(userId: string, workspaceId: string): Promise<PersistentWorkspace> {
    this.logger.debug({ userId, workspaceId }, 'Getting workspace');

    try {
      const record = await this.workspaceRepository.getByUserAndId(userId, workspaceId);
      return this.recordToWorkspace(record);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new InternalError(
        `Failed to get workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId, workspaceId }
      );
    }
  }

  /**
   * List all workspaces for a user
   *
   * @param userId - User ID
   * @param limit - Maximum number of workspaces to return
   * @param cursor - Pagination cursor
   * @returns Array of PersistentWorkspace
   */
  async listWorkspaces(
    userId: string,
    limit?: number,
    cursor?: string
  ): Promise<{ workspaces: PersistentWorkspace[]; nextCursor?: string }> {
    this.logger.debug({ userId, limit, hasCursor: cursor !== undefined }, 'Listing workspaces');

    try {
      // Build query options, only including defined properties
      const queryOptions: { limit?: number; cursor?: string } = {};
      if (limit !== undefined) {
        queryOptions.limit = limit;
      }
      if (cursor !== undefined) {
        queryOptions.cursor = cursor;
      }

      const result = await this.workspaceRepository.listByUser(userId, queryOptions);

      const workspaces = result.items.map((record) => this.recordToWorkspace(record));

      // Only include nextCursor if defined
      if (result.nextCursor !== undefined) {
        return {
          workspaces,
          nextCursor: result.nextCursor,
        };
      }

      return { workspaces };
    } catch (error) {
      throw new InternalError(
        `Failed to list workspaces: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId }
      );
    }
  }

  /**
   * Delete a workspace and its EFS access point
   *
   * Removes the EFS access point and deletes the DynamoDB record.
   * Note: This does NOT delete the actual data on EFS - that requires
   * a separate cleanup job or manual intervention.
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @throws NotFoundError if workspace not found
   * @throws WorkspaceError if deletion fails
   */
  async deleteWorkspace(userId: string, workspaceId: string): Promise<void> {
    this.logger.info({ userId, workspaceId }, 'Deleting workspace');

    try {
      // Step 1: Get workspace to find access point ID
      const workspace = await this.getWorkspace(userId, workspaceId);

      // Step 2: Delete EFS access point
      if (workspace.efsAccessPointId) {
        await this.deleteEfsAccessPoint(workspace.efsAccessPointId);
      }

      // Step 3: Delete DynamoDB record
      await this.workspaceRepository.delete(userId, workspaceId);

      this.logger.info(
        {
          userId,
          workspaceId,
          accessPointId: workspace.efsAccessPointId,
        },
        'Workspace deleted successfully'
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new WorkspaceError(
        workspaceId,
        `Failed to delete workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId }
      );
    }
  }

  /**
   * Get storage usage statistics for a user
   *
   * Aggregates workspace sizes for billing and quota management.
   *
   * @param userId - User ID
   * @returns WorkspaceUsageStats
   */
  async getUsageStats(userId: string): Promise<WorkspaceUsageStats> {
    this.logger.debug({ userId }, 'Getting usage stats');

    try {
      // Fetch all workspaces for user (paginate if needed)
      const allWorkspaces: PersistentWorkspace[] = [];
      let cursor: string | undefined;

      do {
        const result = await this.listWorkspaces(userId, 100, cursor);
        allWorkspaces.push(...result.workspaces);
        cursor = result.nextCursor;
      } while (cursor !== undefined);

      const totalSizeBytes = allWorkspaces.reduce((sum, ws) => sum + ws.sizeBytes, 0);

      return {
        userId,
        totalWorkspaces: allWorkspaces.length,
        totalSizeBytes,
        workspaces: allWorkspaces,
      };
    } catch (error) {
      throw new InternalError(
        `Failed to get usage stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId }
      );
    }
  }

  /**
   * Check if workspace size is within configured limit
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @param limitBytes - Size limit in bytes (defaults to configured limit)
   * @returns SizeLimitCheckResult
   */
  async checkSizeLimit(
    userId: string,
    workspaceId: string,
    limitBytes?: number
  ): Promise<SizeLimitCheckResult> {
    const limit = limitBytes ?? this.defaultSizeLimitBytes;

    this.logger.debug({ userId, workspaceId, limitBytes: limit }, 'Checking size limit');

    try {
      const workspace = await this.getWorkspace(userId, workspaceId);

      const result: SizeLimitCheckResult = {
        withinLimit: workspace.sizeBytes <= limit,
        currentSizeBytes: workspace.sizeBytes,
        limitBytes: limit,
        remainingBytes: Math.max(0, limit - workspace.sizeBytes),
      };

      if (!result.withinLimit) {
        this.logger.warn(
          {
            userId,
            workspaceId,
            currentSizeBytes: workspace.sizeBytes,
            limitBytes: limit,
          },
          'Workspace exceeds size limit'
        );
      }

      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new InternalError(
        `Failed to check size limit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId, workspaceId }
      );
    }
  }

  /**
   * Update last accessed timestamp for a workspace
   *
   * Called when workspace is mounted for a new session.
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @returns Updated PersistentWorkspace
   */
  async updateLastAccessed(userId: string, workspaceId: string): Promise<PersistentWorkspace> {
    this.logger.debug({ userId, workspaceId }, 'Updating last accessed timestamp');

    try {
      const record = await this.workspaceRepository.updateLastAccessed(userId, workspaceId);
      return this.recordToWorkspace(record);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new InternalError(
        `Failed to update last accessed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId, workspaceId }
      );
    }
  }

  /**
   * Update workspace size
   *
   * Called periodically or after task completion to update stored size.
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @param sizeBytes - New size in bytes
   * @returns Updated PersistentWorkspace
   */
  async updateSize(
    userId: string,
    workspaceId: string,
    sizeBytes: number
  ): Promise<PersistentWorkspace> {
    this.logger.debug({ userId, workspaceId, sizeBytes }, 'Updating workspace size');

    if (sizeBytes < 0) {
      throw new ValidationError('Size must be non-negative', { sizeBytes });
    }

    try {
      const record = await this.workspaceRepository.updateSize(userId, workspaceId, sizeBytes);
      return this.recordToWorkspace(record);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new InternalError(
        `Failed to update size: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { userId, workspaceId, sizeBytes }
      );
    }
  }

  /**
   * Get EFS mount configuration for ECS task definition
   *
   * Returns the configuration needed to mount the workspace
   * EFS access point in an ECS container.
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @returns EfsMountConfig for ECS task
   * @throws NotFoundError if workspace not found
   */
  async getEfsMountConfig(userId: string, workspaceId: string): Promise<PersistentEfsMountConfig> {
    this.logger.debug({ userId, workspaceId }, 'Getting EFS mount config');

    const workspace = await this.getWorkspace(userId, workspaceId);

    if (!workspace.efsAccessPointId) {
      throw new WorkspaceError(
        workspaceId,
        'Workspace does not have an EFS access point',
        { userId }
      );
    }

    const fileSystemId = this.getFileSystemId();

    return {
      fileSystemId,
      accessPointId: workspace.efsAccessPointId,
      containerPath: WORKSPACE_CONTAINER_PATH,
      readOnly: false,
      rootDirectory: this.buildRootDirectory(userId, workspaceId),
    };
  }

  /**
   * Create EFS access point for workspace
   *
   * @param fileSystemId - EFS file system ID
   * @param rootDirectory - Root directory path for access point
   * @param userId - User ID for tagging
   * @param workspaceId - Workspace ID for tagging
   * @returns Access point ID
   */
  private async createEfsAccessPoint(
    fileSystemId: string,
    rootDirectory: string,
    userId: string,
    workspaceId: string
  ): Promise<string> {
    this.logger.debug(
      { fileSystemId, rootDirectory, userId, workspaceId },
      'Creating EFS access point'
    );

    const tags: Tag[] = [
      { Key: 'Name', Value: `outpost-workspace-${workspaceId}` },
      { Key: 'outpost:userId', Value: userId },
      { Key: 'outpost:workspaceId', Value: workspaceId },
      { Key: 'outpost:service', Value: 'persistent-workspace' },
    ];

    try {
      const response = await this.efsClient.send(
        new CreateAccessPointCommand({
          FileSystemId: fileSystemId,
          PosixUser: {
            Uid: POSIX_USER_UID,
            Gid: POSIX_USER_GID,
          },
          RootDirectory: {
            Path: rootDirectory,
            CreationInfo: {
              OwnerUid: POSIX_USER_UID,
              OwnerGid: POSIX_USER_GID,
              Permissions: '0755',
            },
          },
          Tags: tags,
        })
      );

      if (!response.AccessPointId) {
        throw new Error('CreateAccessPoint returned no access point ID');
      }

      this.logger.info(
        {
          accessPointId: response.AccessPointId,
          fileSystemId,
          rootDirectory,
        },
        'EFS access point created'
      );

      return response.AccessPointId;
    } catch (error) {
      this.logger.error(
        {
          fileSystemId,
          rootDirectory,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to create EFS access point'
      );
      throw error;
    }
  }

  /**
   * Delete EFS access point
   *
   * @param accessPointId - Access point ID to delete
   */
  private async deleteEfsAccessPoint(accessPointId: string): Promise<void> {
    this.logger.debug({ accessPointId }, 'Deleting EFS access point');

    try {
      await this.efsClient.send(
        new DeleteAccessPointCommand({
          AccessPointId: accessPointId,
        })
      );

      this.logger.info({ accessPointId }, 'EFS access point deleted');
    } catch (error) {
      // Log but don't throw - access point may have been manually deleted
      this.logger.warn(
        {
          accessPointId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete EFS access point (may already be deleted)'
      );
    }
  }

  /**
   * Describe EFS access point to validate it exists
   *
   * @param accessPointId - Access point ID
   * @returns AccessPointDescription or undefined if not found
   */
  async describeAccessPoint(accessPointId: string): Promise<AccessPointDescription | undefined> {
    this.logger.debug({ accessPointId }, 'Describing EFS access point');

    try {
      const response = await this.efsClient.send(
        new DescribeAccessPointsCommand({
          AccessPointId: accessPointId,
        })
      );

      return response.AccessPoints?.[0];
    } catch (error) {
      this.logger.warn(
        {
          accessPointId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to describe EFS access point'
      );
      return undefined;
    }
  }

  /**
   * Build the root directory path for a workspace
   *
   * @param userId - User ID
   * @param workspaceId - Workspace ID
   * @returns Root directory path
   */
  private buildRootDirectory(userId: string, workspaceId: string): string {
    // Sanitize userId to prevent path traversal
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedWorkspaceId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');

    return `${EFS_USER_ROOT_PATH}/${sanitizedUserId}/${sanitizedWorkspaceId}`;
  }

  /**
   * Get the EFS file system ID from config
   *
   * @returns File system ID
   * @throws ValidationError if not configured
   */
  private getFileSystemId(): string {
    const fileSystemId = this.config.efs.fileSystemId;

    if (!fileSystemId) {
      throw new ValidationError('EFS file system ID not configured', {
        envVar: 'EFS_FILE_SYSTEM_ID',
      });
    }

    return fileSystemId;
  }

  /**
   * Convert WorkspaceRecord to PersistentWorkspace
   */
  private recordToWorkspace(record: WorkspaceRecord): PersistentWorkspace {
    const base = {
      workspaceId: record.workspaceId,
      userId: record.userId,
      efsAccessPointId: record.efsAccessPointId ?? '',
      mountPath: WORKSPACE_CONTAINER_PATH,
      createdAt: record.createdAt,
      lastAccessedAt: record.lastAccessedAt,
      sizeBytes: record.sizeBytes,
    };

    // Only include repoUrl if defined (exactOptionalPropertyTypes compliance)
    if (record.repoUrl !== null) {
      return { ...base, repoUrl: record.repoUrl };
    }

    return base;
  }
}

/**
 * Singleton factory
 */
let serviceInstance: PersistentWorkspaceService | null = null;

export function getPersistentWorkspaceService(): PersistentWorkspaceService {
  if (serviceInstance === null) {
    serviceInstance = new PersistentWorkspaceService();
  }
  return serviceInstance;
}

/**
 * For testing - reset singleton
 */
export function resetPersistentWorkspaceService(): void {
  serviceInstance = null;
}
