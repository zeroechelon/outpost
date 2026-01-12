/**
 * Workspace handler service - manages EFS workspaces for job execution
 */

import {
  EFSClient,
  DescribeFileSystemsCommand,
  DescribeAccessPointsCommand,
} from '@aws-sdk/client-efs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getConfig } from '../utils/config.js';
import { getLogger } from '../utils/logger.js';
import { InternalError, NotFoundError, WorkspaceError } from '../utils/errors.js';
import type { Workspace, WorkspaceStatus, CreateWorkspaceRequest } from '../types/workspace.js';
import { v4 as uuidv4 } from 'uuid';

export class WorkspaceHandlerService {
  private readonly logger = getLogger().child({ service: 'WorkspaceHandlerService' });
  private readonly efsClient: EFSClient;
  private readonly s3Client: S3Client;
  private readonly config = getConfig();

  // In-memory workspace tracking
  private readonly workspaces: Map<string, Workspace> = new Map();

  constructor() {
    this.efsClient = new EFSClient({ region: this.config.awsRegion });
    this.s3Client = new S3Client({ region: this.config.awsRegion });
  }

  async createWorkspace(request: CreateWorkspaceRequest): Promise<Workspace> {
    this.logger.info({ jobId: request.jobId }, 'Creating workspace');

    const workspaceId = uuidv4();
    const now = new Date();
    const ttlSeconds = request.ttlSeconds ?? 3600; // Default 1 hour

    const workspace: Workspace = {
      workspaceId,
      jobId: request.jobId,
      path: `${this.config.efs.mountPath}/${workspaceId}`,
      sizeBytes: 0,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      status: 'creating',
    };

    this.workspaces.set(workspaceId, workspace);

    // If repo is specified, clone it
    if (request.repo !== undefined) {
      this.logger.info({ workspaceId, repo: request.repo }, 'Workspace will clone repository');
      // Actual cloning happens in worker task
    }

    // Mark as ready (in production, would wait for EFS setup)
    this.workspaces.set(workspaceId, {
      ...workspace,
      status: 'ready',
    });

    this.logger.info({ workspaceId, path: workspace.path }, 'Workspace created');

    return workspace;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace === undefined) {
      throw new NotFoundError(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  async getWorkspaceByJobId(jobId: string): Promise<Workspace | null> {
    for (const workspace of this.workspaces.values()) {
      if (workspace.jobId === jobId) {
        return workspace;
      }
    }
    return null;
  }

  async updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<Workspace> {
    const workspace = await this.getWorkspace(workspaceId);

    const updated: Workspace = {
      ...workspace,
      status,
    };

    this.workspaces.set(workspaceId, updated);

    this.logger.info({ workspaceId, status }, 'Workspace status updated');

    return updated;
  }

  async archiveWorkspace(workspaceId: string): Promise<string> {
    this.logger.info({ workspaceId }, 'Archiving workspace');

    const workspace = await this.getWorkspace(workspaceId);

    await this.updateStatus(workspaceId, 'archiving');

    // Create S3 archive key
    const archiveKey = `workspaces/${workspaceId}/archive.tar.gz`;

    // In production, would:
    // 1. Create tarball of workspace directory
    // 2. Upload to S3
    // 3. Delete EFS directory

    this.logger.info({ workspaceId, archiveKey }, 'Workspace archived');

    await this.updateStatus(workspaceId, 'archived');

    return archiveKey;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.logger.info({ workspaceId }, 'Deleting workspace');

    const workspace = await this.getWorkspace(workspaceId);

    // In production, would delete EFS directory
    this.workspaces.set(workspaceId, {
      ...workspace,
      status: 'deleted',
    });

    this.logger.info({ workspaceId }, 'Workspace deleted');
  }

  async cleanupExpiredWorkspaces(): Promise<number> {
    this.logger.debug('Cleaning up expired workspaces');

    const now = Date.now();
    let deletedCount = 0;

    for (const workspace of this.workspaces.values()) {
      if (
        workspace.expiresAt !== null &&
        workspace.expiresAt.getTime() < now &&
        workspace.status !== 'archived' &&
        workspace.status !== 'deleted'
      ) {
        this.logger.info({ workspaceId: workspace.workspaceId }, 'Deleting expired workspace');
        await this.archiveWorkspace(workspace.workspaceId);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async uploadOutput(
    workspaceId: string,
    outputKey: string,
    content: Buffer
  ): Promise<string> {
    this.logger.info({ workspaceId, outputKey }, 'Uploading output to S3');

    const s3Key = `outputs/${workspaceId}/${outputKey}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.outputBucket,
        Key: s3Key,
        Body: content,
      })
    );

    return s3Key;
  }

  async getOutput(workspaceId: string, outputKey: string): Promise<Buffer> {
    const s3Key = `outputs/${workspaceId}/${outputKey}`;

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.s3.outputBucket,
        Key: s3Key,
      })
    );

    if (response.Body === undefined) {
      throw new NotFoundError(`Output not found: ${outputKey}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async checkEfsHealth(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const fileSystemId = this.config.efs.fileSystemId;
      if (fileSystemId === undefined) {
        return { healthy: false, message: 'EFS file system ID not configured' };
      }

      const response = await this.efsClient.send(
        new DescribeFileSystemsCommand({
          FileSystemId: fileSystemId,
        })
      );

      const fs = response.FileSystems?.[0];
      if (fs === undefined) {
        return { healthy: false, message: 'EFS file system not found' };
      }

      if (fs.LifeCycleState !== 'available') {
        return { healthy: false, message: `EFS state: ${fs.LifeCycleState ?? 'unknown'}` };
      }

      return { healthy: true };
    } catch (error) {
      this.logger.error({ error }, 'EFS health check failed');
      return { healthy: false, message: 'EFS health check failed' };
    }
  }
}
