/**
 * Ephemeral Workspace Handler - Container-based workspace management for task execution
 *
 * Manages tmpfs workspaces within ECS containers:
 * - Creates ephemeral workspaces at /workspace
 * - Clones repositories if REPO_URL specified
 * - Configures git identity for commits
 * - Uploads artifacts to S3 on completion
 * - Automatic cleanup on task termination (container ephemeral storage)
 *
 * Design principle: No state persists after task termination.
 * Cleanup on failure is automatic since workspaces live in container tmpfs.
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { promises as fs, type Stats } from 'fs';
import { join, relative, basename } from 'path';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { WorkspaceError, InternalError, ValidationError } from '../utils/errors.js';

/**
 * Workspace initialization mode
 * - full: Full repository clone (default, existing behavior)
 * - minimal: Sparse checkout (only *.md, *.json, *.yaml, *.yml, src/)
 * - none: Empty workspace directory, skip git clone
 */
export type WorkspaceInitMode = 'full' | 'minimal' | 'none';

/**
 * Configuration for workspace creation
 */
export interface WorkspaceConfig {
  readonly dispatchId: string;
  readonly userId: string;
  readonly mode: 'ephemeral' | 'persistent';
  readonly initMode?: WorkspaceInitMode;
  readonly repoUrl?: string;
  readonly branch?: string;
  readonly artifactsBucket: string;
}

/**
 * Result of workspace creation
 */
export interface WorkspaceResult {
  readonly workspacePath: string;
  readonly workspaceId: string;
  readonly clonedRepo: boolean;
  readonly gitConfigured: boolean;
}

/**
 * Artifact upload result
 */
export interface ArtifactUploadResult {
  readonly filesUploaded: number;
  readonly totalBytes: number;
  readonly s3Prefix: string;
  readonly artifacts: readonly ArtifactMetadata[];
}

/**
 * Individual artifact metadata
 */
export interface ArtifactMetadata {
  readonly key: string;
  readonly sizeBytes: number;
  readonly relativePath: string;
}

/**
 * Git configuration for identity
 */
interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * Constants
 */
const WORKSPACE_BASE_PATH = '/workspace';
const DEFAULT_GIT_NAME = 'Outpost Agent';
const DEFAULT_GIT_EMAIL_DOMAIN = 'outpost.zeroechelon.com';
const GIT_CLONE_TIMEOUT_MS = 300000; // 5 minutes
const MAX_ARTIFACT_FILE_SIZE_BYTES = 1073741824; // 1GB per file
const IGNORED_PATHS = ['.git', 'node_modules', '__pycache__', '.venv', 'venv'];

/**
 * Execute a shell command with timeout
 */
async function execCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number = 60000,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args as string[], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Recursively get all files in a directory
 */
async function getFilesRecursive(dir: string, basePath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(basePath, fullPath);

    // Skip ignored paths
    if (IGNORED_PATHS.some((ignored) => relativePath.startsWith(ignored) || entry.name === ignored)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await getFilesRecursive(fullPath, basePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * EphemeralWorkspaceHandler - Manages container-based ephemeral workspaces
 */
export class EphemeralWorkspaceHandler {
  private readonly logger = getLogger().child({ service: 'EphemeralWorkspaceHandler' });
  private readonly s3Client: S3Client;
  private readonly config = getConfig();

  constructor(s3Client?: S3Client) {
    this.s3Client = s3Client ?? new S3Client({ region: this.config.awsRegion });
  }

  /**
   * Create an ephemeral workspace for task execution
   *
   * Creates a workspace directory at /workspace/{workspaceId}, optionally clones
   * a repository, and configures git identity for any commits made during execution.
   *
   * @param config - Workspace configuration
   * @returns WorkspaceResult with workspace details
   * @throws WorkspaceError if workspace creation fails
   */
  async createEphemeralWorkspace(config: WorkspaceConfig): Promise<WorkspaceResult> {
    const workspaceId = `${config.dispatchId}-${uuidv4().slice(0, 8)}`;
    const workspacePath = join(WORKSPACE_BASE_PATH, workspaceId);
    const initMode = config.initMode ?? 'full';

    this.logger.info(
      {
        dispatchId: config.dispatchId,
        workspaceId,
        workspacePath,
        mode: config.mode,
        initMode,
        hasRepo: config.repoUrl !== undefined,
      },
      'Creating ephemeral workspace'
    );

    try {
      // Step 1: Create workspace directory
      await this.createWorkspaceDirectory(workspacePath);

      // Step 2: Handle repository cloning based on initMode
      let clonedRepo = false;
      if (initMode === 'none') {
        // 'none' mode: Skip git clone, just use empty workspace directory
        this.logger.debug({ workspacePath, initMode }, 'Skipping repository clone (initMode=none)');
      } else if (config.repoUrl !== undefined) {
        if (initMode === 'minimal') {
          // 'minimal' mode: Use sparse checkout
          clonedRepo = await this.sparseCheckoutRepository(workspacePath, config.repoUrl, config.branch);
        } else {
          // 'full' mode (default): Full clone
          clonedRepo = await this.cloneRepository(workspacePath, config.repoUrl, config.branch);
        }
      }

      // Step 3: Configure git identity
      const gitConfigured = await this.configureGitIdentity(workspacePath, config.userId);

      this.logger.info(
        {
          workspaceId,
          workspacePath,
          clonedRepo,
          gitConfigured,
          initMode,
        },
        'Ephemeral workspace created successfully'
      );

      return {
        workspacePath,
        workspaceId,
        clonedRepo,
        gitConfigured,
      };
    } catch (error) {
      this.logger.error(
        {
          workspaceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to create ephemeral workspace'
      );

      // Attempt cleanup on failure
      await this.cleanup(workspacePath).catch((cleanupErr) => {
        this.logger.warn(
          { workspacePath, error: cleanupErr },
          'Cleanup after failed workspace creation also failed'
        );
      });

      throw new WorkspaceError(
        workspaceId,
        `Failed to create ephemeral workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { dispatchId: config.dispatchId }
      );
    }
  }

  /**
   * Create the workspace directory
   */
  private async createWorkspaceDirectory(workspacePath: string): Promise<void> {
    this.logger.debug({ workspacePath }, 'Creating workspace directory');

    // Ensure base path exists
    try {
      await fs.mkdir(WORKSPACE_BASE_PATH, { recursive: true });
    } catch (error) {
      // Ignore if already exists
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    // Create workspace directory
    await fs.mkdir(workspacePath, { recursive: true });

    // Set permissions (world writable for agent processes)
    await fs.chmod(workspacePath, 0o777);

    this.logger.debug({ workspacePath }, 'Workspace directory created');
  }

  /**
   * Clone a repository into the workspace
   *
   * @param workspacePath - Path to workspace directory
   * @param repoUrl - Git repository URL to clone
   * @param branch - Optional branch to checkout
   * @returns true if clone succeeded
   * @throws WorkspaceError if clone fails
   */
  async cloneRepository(workspacePath: string, repoUrl: string, branch?: string): Promise<boolean> {
    this.logger.info(
      {
        workspacePath,
        repoUrl,
        branch: branch ?? 'default',
      },
      'Cloning repository'
    );

    // Validate URL format
    if (!this.isValidGitUrl(repoUrl)) {
      throw new ValidationError('Invalid git repository URL', { repoUrl });
    }

    try {
      // Build clone arguments
      const cloneArgs: string[] = ['clone', '--depth', '1'];

      if (branch !== undefined && branch !== '') {
        cloneArgs.push('--branch', branch);
      }

      // Clone into workspace root (contents of repo go directly into workspace)
      cloneArgs.push(repoUrl, '.');

      const result = await execCommand('git', cloneArgs, workspacePath, GIT_CLONE_TIMEOUT_MS);

      if (result.exitCode !== 0) {
        this.logger.error(
          {
            exitCode: result.exitCode,
            stderr: result.stderr,
            repoUrl,
          },
          'Git clone failed'
        );
        throw new Error(`Git clone failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      this.logger.info(
        {
          workspacePath,
          repoUrl,
          branch: branch ?? 'default',
        },
        'Repository cloned successfully'
      );

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new WorkspaceError(
        basename(workspacePath),
        `Failed to clone repository: ${message}`,
        { repoUrl, branch }
      );
    }
  }

  /**
   * Sparse checkout a repository into the workspace (minimal mode)
   *
   * Only checks out specific file patterns to reduce download size:
   * - *.md, *.json, *.yaml, *.yml (config/docs)
   * - src/ directory (source code)
   *
   * Uses git sparse-checkout with --depth=1 for shallow clone.
   *
   * @param workspacePath - Path to workspace directory
   * @param repoUrl - Git repository URL to clone
   * @param branch - Optional branch to checkout
   * @returns true if sparse checkout succeeded
   * @throws WorkspaceError if sparse checkout fails
   */
  async sparseCheckoutRepository(workspacePath: string, repoUrl: string, branch?: string): Promise<boolean> {
    this.logger.info(
      {
        workspacePath,
        repoUrl,
        branch: branch ?? 'default',
      },
      'Performing sparse checkout (minimal mode)'
    );

    // Validate URL format
    if (!this.isValidGitUrl(repoUrl)) {
      throw new ValidationError('Invalid git repository URL', { repoUrl });
    }

    try {
      // Step 1: Initialize empty git repository
      const initResult = await execCommand('git', ['init'], workspacePath, 30000);
      if (initResult.exitCode !== 0) {
        throw new Error(`Git init failed: ${initResult.stderr}`);
      }

      // Step 2: Configure sparse checkout
      const sparseConfigResult = await execCommand(
        'git',
        ['config', 'core.sparseCheckout', 'true'],
        workspacePath,
        10000
      );
      if (sparseConfigResult.exitCode !== 0) {
        throw new Error(`Failed to enable sparse checkout: ${sparseConfigResult.stderr}`);
      }

      // Step 3: Define sparse checkout patterns
      const sparseCheckoutPatterns = [
        '*.md',
        '*.json',
        '*.yaml',
        '*.yml',
        'src/',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        '.gitignore',
        'README.md',
        'LICENSE',
      ];

      // Write sparse-checkout file
      const sparseCheckoutPath = join(workspacePath, '.git', 'info', 'sparse-checkout');
      await fs.mkdir(join(workspacePath, '.git', 'info'), { recursive: true });
      await fs.writeFile(sparseCheckoutPath, sparseCheckoutPatterns.join('\n') + '\n');

      this.logger.debug(
        { sparseCheckoutPath, patterns: sparseCheckoutPatterns },
        'Sparse checkout patterns configured'
      );

      // Step 4: Add remote
      const addRemoteResult = await execCommand(
        'git',
        ['remote', 'add', 'origin', repoUrl],
        workspacePath,
        10000
      );
      if (addRemoteResult.exitCode !== 0) {
        throw new Error(`Failed to add remote: ${addRemoteResult.stderr}`);
      }

      // Step 5: Fetch with depth=1 (shallow)
      const fetchArgs: string[] = ['fetch', '--depth', '1', 'origin'];
      if (branch !== undefined && branch !== '') {
        fetchArgs.push(branch);
      } else {
        fetchArgs.push('HEAD');
      }

      const fetchResult = await execCommand('git', fetchArgs, workspacePath, GIT_CLONE_TIMEOUT_MS);
      if (fetchResult.exitCode !== 0) {
        throw new Error(`Git fetch failed: ${fetchResult.stderr}`);
      }

      // Step 6: Checkout the fetched branch
      const checkoutRef = branch !== undefined && branch !== '' ? `origin/${branch}` : 'FETCH_HEAD';
      const checkoutResult = await execCommand(
        'git',
        ['checkout', checkoutRef],
        workspacePath,
        60000
      );
      if (checkoutResult.exitCode !== 0) {
        throw new Error(`Git checkout failed: ${checkoutResult.stderr}`);
      }

      this.logger.info(
        {
          workspacePath,
          repoUrl,
          branch: branch ?? 'default',
          patterns: sparseCheckoutPatterns.length,
        },
        'Sparse checkout completed successfully'
      );

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new WorkspaceError(
        basename(workspacePath),
        `Failed to perform sparse checkout: ${message}`,
        { repoUrl, branch }
      );
    }
  }

  /**
   * Configure git user identity for commits
   *
   * @param workspacePath - Path to workspace directory
   * @param userId - User ID for git identity
   * @returns true if configuration succeeded
   */
  async configureGitIdentity(workspacePath: string, userId: string): Promise<boolean> {
    const identity = this.buildGitIdentity(userId);

    this.logger.debug(
      {
        workspacePath,
        gitName: identity.name,
        gitEmail: identity.email,
      },
      'Configuring git identity'
    );

    try {
      // Check if .git directory exists (may not if no repo cloned)
      const gitDir = join(workspacePath, '.git');
      let hasGitDir = false;
      try {
        const stat = await fs.stat(gitDir);
        hasGitDir = stat.isDirectory();
      } catch {
        hasGitDir = false;
      }

      if (!hasGitDir) {
        // Initialize a new git repo for tracking changes
        const initResult = await execCommand('git', ['init'], workspacePath);
        if (initResult.exitCode !== 0) {
          this.logger.warn({ stderr: initResult.stderr }, 'Git init failed');
          return false;
        }
      }

      // Set user.name
      const nameResult = await execCommand(
        'git',
        ['config', 'user.name', identity.name],
        workspacePath
      );
      if (nameResult.exitCode !== 0) {
        this.logger.warn({ stderr: nameResult.stderr }, 'Failed to set git user.name');
        return false;
      }

      // Set user.email
      const emailResult = await execCommand(
        'git',
        ['config', 'user.email', identity.email],
        workspacePath
      );
      if (emailResult.exitCode !== 0) {
        this.logger.warn({ stderr: emailResult.stderr }, 'Failed to set git user.email');
        return false;
      }

      this.logger.debug(
        {
          workspacePath,
          gitName: identity.name,
        },
        'Git identity configured'
      );

      return true;
    } catch (error) {
      this.logger.warn(
        { error, workspacePath },
        'Failed to configure git identity (non-fatal)'
      );
      return false;
    }
  }

  /**
   * Build git identity from user ID
   */
  private buildGitIdentity(userId: string): GitIdentity {
    // Sanitize userId for email (remove special chars)
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');

    return {
      name: `${DEFAULT_GIT_NAME} (${sanitizedUserId})`,
      email: `${sanitizedUserId}@${DEFAULT_GIT_EMAIL_DOMAIN}`,
    };
  }

  /**
   * Validate git repository URL
   */
  private isValidGitUrl(url: string): boolean {
    // Support HTTPS and SSH URLs
    const httpsPattern = /^https:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+\//;
    const sshPattern = /^git@[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+:/;

    return httpsPattern.test(url) || sshPattern.test(url);
  }

  /**
   * Upload workspace artifacts to S3
   *
   * Uploads all files from the workspace to the artifacts bucket under
   * a dispatch-specific prefix. Ignores .git, node_modules, etc.
   *
   * @param workspacePath - Path to workspace directory
   * @param dispatchId - Dispatch ID for S3 prefix
   * @param bucket - S3 bucket for artifacts
   * @returns ArtifactUploadResult with upload details
   */
  async uploadArtifacts(
    workspacePath: string,
    dispatchId: string,
    bucket: string
  ): Promise<ArtifactUploadResult> {
    const s3Prefix = `artifacts/${dispatchId}`;

    this.logger.info(
      {
        workspacePath,
        dispatchId,
        bucket,
        s3Prefix,
      },
      'Uploading workspace artifacts to S3'
    );

    try {
      // Check if workspace exists
      await fs.access(workspacePath);

      // Get all files to upload
      const files = await getFilesRecursive(workspacePath, workspacePath);

      this.logger.debug(
        { fileCount: files.length },
        'Found files to upload'
      );

      const artifacts: ArtifactMetadata[] = [];
      let totalBytes = 0;

      for (const filePath of files) {
        const stat: Stats = await fs.stat(filePath);

        // Skip files that are too large
        if (stat.size > MAX_ARTIFACT_FILE_SIZE_BYTES) {
          this.logger.warn(
            { filePath, sizeBytes: stat.size, maxBytes: MAX_ARTIFACT_FILE_SIZE_BYTES },
            'Skipping oversized file'
          );
          continue;
        }

        const relativePath = relative(workspacePath, filePath);
        const s3Key = `${s3Prefix}/${relativePath}`;

        try {
          // Read file content and upload to S3
          // For very large files (>100MB), consider chunked uploads in production
          const content = await fs.readFile(filePath);
          await this.s3Client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: s3Key,
              Body: content,
            })
          );

          artifacts.push({
            key: s3Key,
            sizeBytes: stat.size,
            relativePath,
          });
          totalBytes += stat.size;

          this.logger.debug(
            { s3Key, sizeBytes: stat.size },
            'Uploaded artifact'
          );
        } catch (uploadError) {
          this.logger.warn(
            { filePath, s3Key, error: uploadError },
            'Failed to upload artifact (continuing)'
          );
        }
      }

      const result: ArtifactUploadResult = {
        filesUploaded: artifacts.length,
        totalBytes,
        s3Prefix,
        artifacts,
      };

      this.logger.info(
        {
          filesUploaded: result.filesUploaded,
          totalBytes: result.totalBytes,
          s3Prefix,
        },
        'Artifacts uploaded successfully'
      );

      return result;
    } catch (error) {
      this.logger.error(
        {
          workspacePath,
          dispatchId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to upload artifacts'
      );

      throw new InternalError(
        `Failed to upload artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { workspacePath, dispatchId, bucket }
      );
    }
  }

  /**
   * Cleanup workspace directory
   *
   * For ephemeral workspaces in containers, this is primarily a safety measure.
   * The actual cleanup happens automatically when the container terminates.
   *
   * @param workspacePath - Path to workspace directory
   */
  async cleanup(workspacePath: string): Promise<void> {
    this.logger.info({ workspacePath }, 'Cleaning up workspace');

    try {
      // Verify path is within expected base
      if (!workspacePath.startsWith(WORKSPACE_BASE_PATH)) {
        throw new ValidationError('Invalid workspace path - outside base directory', {
          workspacePath,
          basePath: WORKSPACE_BASE_PATH,
        });
      }

      // Remove directory recursively
      await fs.rm(workspacePath, { recursive: true, force: true });

      this.logger.info({ workspacePath }, 'Workspace cleaned up');
    } catch (error) {
      // Log but don't throw - cleanup failures are non-fatal for ephemeral workspaces
      // Container termination will clean up anyway
      this.logger.warn(
        {
          workspacePath,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Workspace cleanup failed (non-fatal for ephemeral workspaces)'
      );
    }
  }

  /**
   * Delete artifacts from S3 for a dispatch
   *
   * Used when cleaning up after failed dispatches or when artifacts
   * are no longer needed.
   *
   * @param dispatchId - Dispatch ID
   * @param bucket - S3 bucket
   */
  async deleteArtifacts(dispatchId: string, bucket: string): Promise<void> {
    const s3Prefix = `artifacts/${dispatchId}/`;

    this.logger.info(
      { dispatchId, bucket, s3Prefix },
      'Deleting artifacts from S3'
    );

    try {
      // List all objects with prefix
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: s3Prefix,
        })
      );

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        this.logger.debug({ s3Prefix }, 'No artifacts to delete');
        return;
      }

      // Delete objects
      const objectsToDelete = listResponse.Contents.filter((obj) => obj.Key !== undefined).map(
        (obj) => ({ Key: obj.Key! })
      );

      await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objectsToDelete,
          },
        })
      );

      this.logger.info(
        { dispatchId, deletedCount: objectsToDelete.length },
        'Artifacts deleted'
      );
    } catch (error) {
      this.logger.warn(
        {
          dispatchId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete artifacts (non-fatal)'
      );
    }
  }

  /**
   * Get workspace statistics
   *
   * @param workspacePath - Path to workspace
   * @returns Stats about the workspace
   */
  async getWorkspaceStats(workspacePath: string): Promise<{
    exists: boolean;
    sizeBytes: number;
    fileCount: number;
  }> {
    try {
      await fs.access(workspacePath);

      const files = await getFilesRecursive(workspacePath, workspacePath);
      let totalSize = 0;

      for (const file of files) {
        const stat = await fs.stat(file);
        totalSize += stat.size;
      }

      return {
        exists: true,
        sizeBytes: totalSize,
        fileCount: files.length,
      };
    } catch {
      return {
        exists: false,
        sizeBytes: 0,
        fileCount: 0,
      };
    }
  }
}

/**
 * Singleton factory
 */
let handlerInstance: EphemeralWorkspaceHandler | null = null;

export function getEphemeralWorkspaceHandler(): EphemeralWorkspaceHandler {
  if (handlerInstance === null) {
    handlerInstance = new EphemeralWorkspaceHandler();
  }
  return handlerInstance;
}

/**
 * For testing - reset singleton
 */
export function resetEphemeralWorkspaceHandler(): void {
  handlerInstance = null;
}
