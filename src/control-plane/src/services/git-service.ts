/**
 * Git Service - Git operations for workspace management
 *
 * Provides comprehensive git operations for Outpost workspaces:
 * - Clone public and private repositories
 * - Branch checkout and management
 * - Configure git identity
 * - Commit and push changes
 * - Detect merge conflicts
 * - Handle authentication with GitHub PAT
 *
 * Uses child_process.execFile for secure command execution.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Options for cloning a repository
 */
export interface GitCloneOptions {
  /** Repository URL (HTTPS or SSH) */
  readonly repoUrl: string;
  /** Branch to checkout after clone */
  readonly branch?: string;
  /** Clone depth (shallow clone) */
  readonly depth?: number;
  /** Target directory path for clone */
  readonly targetPath: string;
  /** GitHub PAT for private repositories */
  readonly authToken?: string;
}

/**
 * Options for pushing changes to remote
 */
export interface GitPushOptions {
  /** Path to workspace directory */
  readonly workspacePath: string;
  /** Branch to push to */
  readonly branch: string;
  /** GitHub PAT for authentication */
  readonly authToken: string;
  /** Commit message */
  readonly commitMessage: string;
  /** Author name for the commit */
  readonly authorName: string;
  /** Author email for the commit */
  readonly authorEmail: string;
}

/**
 * Result of a git operation
 */
export interface GitOperationResult {
  /** Whether the operation succeeded */
  readonly success: boolean;
  /** Error message if operation failed */
  readonly error?: string;
  /** List of files with merge conflicts */
  readonly conflictFiles?: readonly string[];
  /** Commit SHA after successful commit */
  readonly commitSha?: string;
  /** Current branch name */
  readonly branchName?: string;
}

/**
 * Git status information
 */
export interface GitStatus {
  /** Current branch name */
  readonly branch: string;
  /** Whether working directory is clean */
  readonly isClean: boolean;
  /** List of staged files */
  readonly stagedFiles: readonly string[];
  /** List of modified files (unstaged) */
  readonly modifiedFiles: readonly string[];
  /** List of untracked files */
  readonly untrackedFiles: readonly string[];
  /** List of deleted files */
  readonly deletedFiles: readonly string[];
  /** Whether there are merge conflicts */
  readonly hasConflicts: boolean;
  /** List of files with conflicts */
  readonly conflictFiles: readonly string[];
  /** Commits ahead of remote */
  readonly ahead: number;
  /** Commits behind remote */
  readonly behind: number;
}

/**
 * Constants
 */
const GIT_COMMAND_TIMEOUT_MS = 300000; // 5 minutes
const GIT_PUSH_TIMEOUT_MS = 600000; // 10 minutes for large pushes

/**
 * Authentication failure patterns
 */
const AUTH_FAILURE_PATTERNS = [
  'Authentication failed',
  'Invalid credentials',
  'Permission denied',
  'Repository not found',
  'could not read Username',
  'could not read Password',
  'fatal: Authentication failed for',
  'remote: Invalid username or password',
  'The requested URL returned error: 403',
  'The requested URL returned error: 401',
];

/**
 * Git Service for repository operations
 */
export class GitService {
  private readonly logger = getLogger().child({ service: 'GitService' });

  /**
   * Clone a repository to the target path
   *
   * @param options - Clone configuration
   * @returns GitOperationResult with clone outcome
   */
  async clone(options: GitCloneOptions): Promise<GitOperationResult> {
    const { repoUrl, branch, depth, targetPath, authToken } = options;

    this.logger.info(
      {
        repoUrl: this.sanitizeUrlForLogging(repoUrl),
        branch: branch ?? 'default',
        depth,
        targetPath,
        hasAuth: authToken !== undefined,
      },
      'Cloning repository'
    );

    // Validate repository URL
    if (!this.isValidGitUrl(repoUrl)) {
      return {
        success: false,
        error: `Invalid git repository URL: ${this.sanitizeUrlForLogging(repoUrl)}`,
      };
    }

    // Ensure target directory exists
    try {
      await fs.mkdir(targetPath, { recursive: true });
    } catch (mkdirError) {
      return {
        success: false,
        error: `Failed to create target directory: ${mkdirError instanceof Error ? mkdirError.message : 'Unknown error'}`,
      };
    }

    // Build clone URL with authentication if provided
    const cloneUrl = authToken !== undefined
      ? this.injectAuthToken(repoUrl, authToken)
      : repoUrl;

    // Build clone arguments
    const args: string[] = ['clone'];

    if (depth !== undefined && depth > 0) {
      args.push('--depth', String(depth));
    }

    if (branch !== undefined && branch !== '') {
      args.push('--branch', branch);
    }

    // Clone into target path directly (contents of repo go into workspace)
    args.push(cloneUrl, '.');

    try {
      const { stderr } = await execFileAsync('git', args, {
        cwd: targetPath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // Disable interactive prompts
        },
      });

      // Check for warnings in stderr (non-fatal)
      if (stderr && !this.isAuthFailure(stderr)) {
        this.logger.debug({ stderr }, 'Git clone completed with warnings');
      }

      // Get the current branch name
      const branchResult = await this.getCurrentBranch(targetPath);

      this.logger.info(
        {
          targetPath,
          branch: branchResult ?? branch ?? 'default',
        },
        'Repository cloned successfully'
      );

      const resultBranch = branchResult ?? branch;
      return resultBranch !== undefined
        ? { success: true, branchName: resultBranch }
        : { success: true };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      // Check for authentication failures
      if (this.isAuthFailure(errorMessage)) {
        this.logger.error(
          { repoUrl: this.sanitizeUrlForLogging(repoUrl) },
          'Authentication failed for repository'
        );
        return {
          success: false,
          error: 'Authentication failed. Please verify your GitHub PAT has the required permissions.',
        };
      }

      this.logger.error(
        {
          repoUrl: this.sanitizeUrlForLogging(repoUrl),
          error: errorMessage,
        },
        'Failed to clone repository'
      );

      return {
        success: false,
        error: `Clone failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Checkout a specific branch
   *
   * @param workspacePath - Path to workspace directory
   * @param branch - Branch name to checkout
   * @returns GitOperationResult with checkout outcome
   */
  async checkout(workspacePath: string, branch: string): Promise<GitOperationResult> {
    this.logger.info({ workspacePath, branch }, 'Checking out branch');

    if (!branch || branch.trim() === '') {
      return {
        success: false,
        error: 'Branch name is required',
      };
    }

    try {
      // First try to checkout existing branch
      try {
        await execFileAsync('git', ['checkout', branch], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      } catch {
        // If branch doesn't exist locally, try to fetch and checkout
        await execFileAsync('git', ['fetch', 'origin', branch], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
        await execFileAsync('git', ['checkout', branch], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      }

      this.logger.info({ workspacePath, branch }, 'Branch checkout successful');

      return {
        success: true,
        branchName: branch,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error({ workspacePath, branch, error: errorMessage }, 'Failed to checkout branch');

      return {
        success: false,
        error: `Checkout failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Configure git user identity for the workspace
   *
   * @param workspacePath - Path to workspace directory
   * @param name - User name for commits
   * @param email - User email for commits
   * @returns GitOperationResult with configuration outcome
   */
  async configureIdentity(
    workspacePath: string,
    name: string,
    email: string
  ): Promise<GitOperationResult> {
    this.logger.debug({ workspacePath, name, email }, 'Configuring git identity');

    if (!name || name.trim() === '') {
      return {
        success: false,
        error: 'User name is required',
      };
    }

    if (!email || email.trim() === '') {
      return {
        success: false,
        error: 'User email is required',
      };
    }

    try {
      // Ensure git repo exists
      const gitDir = join(workspacePath, '.git');
      try {
        await fs.access(gitDir);
      } catch {
        // Initialize git repo if it doesn't exist
        await execFileAsync('git', ['init'], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      }

      // Set user.name
      await execFileAsync('git', ['config', 'user.name', name], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      // Set user.email
      await execFileAsync('git', ['config', 'user.email', email], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      this.logger.debug({ workspacePath, name, email }, 'Git identity configured');

      return { success: true };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error(
        { workspacePath, error: errorMessage },
        'Failed to configure git identity'
      );

      return {
        success: false,
        error: `Failed to configure git identity: ${errorMessage}`,
      };
    }
  }

  /**
   * Detect uncommitted changes in the workspace
   *
   * @param workspacePath - Path to workspace directory
   * @returns true if there are uncommitted changes
   */
  async detectChanges(workspacePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      const hasChanges = stdout.trim().length > 0;

      this.logger.debug({ workspacePath, hasChanges }, 'Checked for uncommitted changes');

      return hasChanges;
    } catch (error) {
      this.logger.warn(
        { workspacePath, error: this.extractErrorMessage(error) },
        'Failed to detect changes'
      );
      return false;
    }
  }

  /**
   * Create a commit with all staged changes
   *
   * @param workspacePath - Path to workspace directory
   * @param message - Commit message
   * @param authorName - Author name
   * @param authorEmail - Author email
   * @returns GitOperationResult with commit outcome
   */
  async commit(
    workspacePath: string,
    message: string,
    authorName: string,
    authorEmail: string
  ): Promise<GitOperationResult> {
    this.logger.info({ workspacePath, authorName }, 'Creating commit');

    if (!message || message.trim() === '') {
      return {
        success: false,
        error: 'Commit message is required',
      };
    }

    try {
      // Configure identity first
      const configResult = await this.configureIdentity(workspacePath, authorName, authorEmail);
      if (!configResult.success) {
        return configResult;
      }

      // Stage all changes
      await execFileAsync('git', ['add', '-A'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      // Check if there are changes to commit
      const hasChanges = await this.detectChanges(workspacePath);
      if (!hasChanges) {
        this.logger.info({ workspacePath }, 'No changes to commit');
        return {
          success: true,
          error: 'No changes to commit',
        };
      }

      // Create commit
      await execFileAsync('git', ['commit', '-m', message], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: authorName,
          GIT_AUTHOR_EMAIL: authorEmail,
          GIT_COMMITTER_NAME: authorName,
          GIT_COMMITTER_EMAIL: authorEmail,
        },
      });

      // Get commit SHA
      const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      const commitSha = sha.trim();

      this.logger.info({ workspacePath, commitSha }, 'Commit created successfully');

      return {
        success: true,
        commitSha,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error({ workspacePath, error: errorMessage }, 'Failed to create commit');

      return {
        success: false,
        error: `Commit failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Push changes to remote repository
   *
   * @param options - Push configuration
   * @returns GitOperationResult with push outcome
   */
  async push(options: GitPushOptions): Promise<GitOperationResult> {
    const { workspacePath, branch, authToken, commitMessage, authorName, authorEmail } = options;

    this.logger.info(
      {
        workspacePath,
        branch,
        authorName,
      },
      'Pushing changes to remote'
    );

    try {
      // First, create a commit if there are changes
      const commitResult = await this.commit(workspacePath, commitMessage, authorName, authorEmail);
      if (!commitResult.success && commitResult.error !== 'No changes to commit') {
        return commitResult;
      }

      // Get current remote URL
      const { stdout: remoteUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      // Inject auth token into remote URL
      const authenticatedUrl = this.injectAuthToken(remoteUrl.trim(), authToken);

      // Temporarily set authenticated remote URL
      await execFileAsync('git', ['remote', 'set-url', 'origin', authenticatedUrl], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      try {
        // Push to remote
        await execFileAsync('git', ['push', 'origin', branch], {
          cwd: workspacePath,
          timeout: GIT_PUSH_TIMEOUT_MS,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
          },
        });

        // Get the commit SHA
        const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });

        this.logger.info(
          {
            workspacePath,
            branch,
            commitSha: sha.trim(),
          },
          'Push completed successfully'
        );

        return {
          success: true,
          commitSha: commitResult.commitSha ?? sha.trim(),
          branchName: branch,
        };
      } finally {
        // Restore original remote URL (without auth token)
        await execFileAsync('git', ['remote', 'set-url', 'origin', remoteUrl.trim()], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        }).catch((restoreError) => {
          this.logger.warn(
            { error: this.extractErrorMessage(restoreError) },
            'Failed to restore original remote URL'
          );
        });
      }
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      // Check for authentication failures
      if (this.isAuthFailure(errorMessage)) {
        this.logger.error({ workspacePath, branch }, 'Push authentication failed');
        return {
          success: false,
          error: 'Authentication failed. Please verify your GitHub PAT has push permissions.',
        };
      }

      // Check for merge conflicts or rejected push
      if (errorMessage.includes('rejected') || errorMessage.includes('non-fast-forward')) {
        const conflicts = await this.detectConflicts(workspacePath);
        const result: GitOperationResult = {
          success: false,
          error: 'Push rejected. Remote contains changes that you do not have locally. Pull and merge first.',
        };
        if (conflicts.conflictFiles && conflicts.conflictFiles.length > 0) {
          return { ...result, conflictFiles: conflicts.conflictFiles };
        }
        return result;
      }

      this.logger.error({ workspacePath, branch, error: errorMessage }, 'Failed to push changes');

      return {
        success: false,
        error: `Push failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Detect merge conflicts in the workspace
   *
   * @param workspacePath - Path to workspace directory
   * @returns GitOperationResult with conflict information
   */
  async detectConflicts(workspacePath: string): Promise<GitOperationResult> {
    this.logger.debug({ workspacePath }, 'Detecting merge conflicts');

    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });

      const conflictFiles = stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      const hasConflicts = conflictFiles.length > 0;

      this.logger.debug(
        {
          workspacePath,
          hasConflicts,
          conflictCount: conflictFiles.length,
        },
        'Conflict detection complete'
      );

      return hasConflicts
        ? { success: true, conflictFiles }
        : { success: true };
    } catch (error) {
      // If the command fails, check status instead
      try {
        const { stdout: statusOutput } = await execFileAsync(
          'git',
          ['status', '--porcelain'],
          {
            cwd: workspacePath,
            timeout: GIT_COMMAND_TIMEOUT_MS,
          }
        );

        // Look for "UU" (both modified), "AA" (both added), etc.
        const conflictPatterns = /^(UU|AA|DD|AU|UA|DU|UD)\s+(.+)$/gm;
        const conflictFilesFromStatus: string[] = [];
        let match;

        while ((match = conflictPatterns.exec(statusOutput)) !== null) {
          const filePath = match[2];
          if (filePath !== undefined) {
            conflictFilesFromStatus.push(filePath);
          }
        }

        return conflictFilesFromStatus.length > 0
          ? { success: true, conflictFiles: conflictFilesFromStatus }
          : { success: true };
      } catch {
        return {
          success: false,
          error: `Failed to detect conflicts: ${this.extractErrorMessage(error)}`,
        };
      }
    }
  }

  /**
   * Get current git status for the workspace
   *
   * @param workspacePath - Path to workspace directory
   * @returns GitStatus with detailed status information
   */
  async getStatus(workspacePath: string): Promise<GitStatus> {
    this.logger.debug({ workspacePath }, 'Getting git status');

    const defaultStatus: GitStatus = {
      branch: 'unknown',
      isClean: true,
      stagedFiles: [],
      modifiedFiles: [],
      untrackedFiles: [],
      deletedFiles: [],
      hasConflicts: false,
      conflictFiles: [],
      ahead: 0,
      behind: 0,
    };

    try {
      // Get branch name
      const branch = await this.getCurrentBranch(workspacePath);

      // Get porcelain status (v2 format for more detail)
      const { stdout: statusOutput } = await execFileAsync(
        'git',
        ['status', '--porcelain=v1', '-b'],
        {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        }
      );

      const lines = statusOutput.trim().split('\n').filter((line) => line.length > 0);

      const stagedFiles: string[] = [];
      const modifiedFiles: string[] = [];
      const untrackedFiles: string[] = [];
      const deletedFiles: string[] = [];
      const conflictFiles: string[] = [];
      let ahead = 0;
      let behind = 0;

      for (const line of lines) {
        // Parse branch line for ahead/behind
        if (line.startsWith('##')) {
          const aheadMatch = line.match(/ahead (\d+)/);
          const behindMatch = line.match(/behind (\d+)/);
          if (aheadMatch !== null && aheadMatch[1] !== undefined) {
            ahead = parseInt(aheadMatch[1], 10);
          }
          if (behindMatch !== null && behindMatch[1] !== undefined) {
            behind = parseInt(behindMatch[1], 10);
          }
          continue;
        }

        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3).trim();

        // Conflict detection (both modified or similar)
        if (
          (indexStatus === 'U' || workTreeStatus === 'U') ||
          (indexStatus === 'A' && workTreeStatus === 'A') ||
          (indexStatus === 'D' && workTreeStatus === 'D')
        ) {
          conflictFiles.push(filePath);
          continue;
        }

        // Staged changes
        if (indexStatus !== ' ' && indexStatus !== '?') {
          stagedFiles.push(filePath);
          if (indexStatus === 'D') {
            deletedFiles.push(filePath);
          }
        }

        // Unstaged changes
        if (workTreeStatus === 'M') {
          modifiedFiles.push(filePath);
        } else if (workTreeStatus === 'D') {
          deletedFiles.push(filePath);
        }

        // Untracked files
        if (indexStatus === '?' && workTreeStatus === '?') {
          untrackedFiles.push(filePath);
        }
      }

      const isClean =
        stagedFiles.length === 0 &&
        modifiedFiles.length === 0 &&
        untrackedFiles.length === 0 &&
        deletedFiles.length === 0 &&
        conflictFiles.length === 0;

      const status: GitStatus = {
        branch: branch ?? 'unknown',
        isClean,
        stagedFiles,
        modifiedFiles,
        untrackedFiles,
        deletedFiles,
        hasConflicts: conflictFiles.length > 0,
        conflictFiles,
        ahead,
        behind,
      };

      this.logger.debug(
        {
          workspacePath,
          branch: status.branch,
          isClean: status.isClean,
          hasConflicts: status.hasConflicts,
        },
        'Git status retrieved'
      );

      return status;
    } catch (error) {
      this.logger.warn(
        { workspacePath, error: this.extractErrorMessage(error) },
        'Failed to get git status'
      );
      return defaultStatus;
    }
  }

  /**
   * Create a new branch and optionally check it out
   *
   * @param workspacePath - Path to workspace directory
   * @param branchName - Name for the new branch
   * @param checkout - Whether to checkout the new branch
   * @returns GitOperationResult with branch creation outcome
   */
  async createBranch(
    workspacePath: string,
    branchName: string,
    checkout: boolean = true
  ): Promise<GitOperationResult> {
    this.logger.info({ workspacePath, branchName, checkout }, 'Creating new branch');

    if (!branchName || branchName.trim() === '') {
      return {
        success: false,
        error: 'Branch name is required',
      };
    }

    try {
      if (checkout) {
        await execFileAsync('git', ['checkout', '-b', branchName], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      } else {
        await execFileAsync('git', ['branch', branchName], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      }

      this.logger.info({ workspacePath, branchName }, 'Branch created successfully');

      return {
        success: true,
        branchName,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error(
        { workspacePath, branchName, error: errorMessage },
        'Failed to create branch'
      );

      return {
        success: false,
        error: `Failed to create branch: ${errorMessage}`,
      };
    }
  }

  /**
   * Pull latest changes from remote
   *
   * @param workspacePath - Path to workspace directory
   * @param branch - Branch to pull (optional, uses current branch)
   * @param authToken - GitHub PAT for private repos
   * @returns GitOperationResult with pull outcome
   */
  async pull(
    workspacePath: string,
    branch?: string,
    authToken?: string
  ): Promise<GitOperationResult> {
    this.logger.info({ workspacePath, branch }, 'Pulling latest changes');

    try {
      let pullUrl: string | undefined;

      // If auth token provided, inject it into remote URL
      if (authToken !== undefined) {
        const { stdout: remoteUrl } = await execFileAsync(
          'git',
          ['remote', 'get-url', 'origin'],
          {
            cwd: workspacePath,
            timeout: GIT_COMMAND_TIMEOUT_MS,
          }
        );
        pullUrl = this.injectAuthToken(remoteUrl.trim(), authToken);

        // Temporarily update remote
        await execFileAsync('git', ['remote', 'set-url', 'origin', pullUrl], {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
        });
      }

      try {
        const args = ['pull', 'origin'];
        if (branch !== undefined && branch !== '') {
          args.push(branch);
        }

        await execFileAsync('git', args, {
          cwd: workspacePath,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
          },
        });

        // Check for conflicts after pull
        const conflictResult = await this.detectConflicts(workspacePath);

        if (conflictResult.conflictFiles && conflictResult.conflictFiles.length > 0) {
          this.logger.warn(
            {
              workspacePath,
              conflictCount: conflictResult.conflictFiles.length,
            },
            'Pull completed with merge conflicts'
          );

          return {
            success: false,
            error: 'Pull completed but merge conflicts detected',
            conflictFiles: conflictResult.conflictFiles,
          };
        }

        this.logger.info({ workspacePath }, 'Pull completed successfully');

        const currentBranch = branch ?? await this.getCurrentBranch(workspacePath);
        return currentBranch !== null && currentBranch !== undefined
          ? { success: true, branchName: currentBranch }
          : { success: true };
      } finally {
        // Restore original remote URL if we modified it
        if (authToken !== undefined) {
          const { stdout: remoteUrl } = await execFileAsync(
            'git',
            ['remote', 'get-url', 'origin'],
            {
              cwd: workspacePath,
              timeout: GIT_COMMAND_TIMEOUT_MS,
            }
          );

          // Remove auth token from URL
          const cleanUrl = this.sanitizeUrlForStorage(remoteUrl.trim());
          await execFileAsync('git', ['remote', 'set-url', 'origin', cleanUrl], {
            cwd: workspacePath,
            timeout: GIT_COMMAND_TIMEOUT_MS,
          }).catch(() => {
            // Ignore restore errors
          });
        }
      }
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      if (this.isAuthFailure(errorMessage)) {
        return {
          success: false,
          error: 'Authentication failed. Please verify your GitHub PAT has read permissions.',
        };
      }

      this.logger.error({ workspacePath, error: errorMessage }, 'Failed to pull changes');

      return {
        success: false,
        error: `Pull failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get the current branch name
   *
   * @param workspacePath - Path to workspace directory
   * @returns Current branch name or null if not in a git repo
   */
  private async getCurrentBranch(workspacePath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: workspacePath,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Validate git repository URL format
   */
  private isValidGitUrl(url: string): boolean {
    // Support HTTPS URLs
    const httpsPattern = /^https:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+\/.+/;
    // Support SSH URLs
    const sshPattern = /^git@[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+:.+/;

    return httpsPattern.test(url) || sshPattern.test(url);
  }

  /**
   * Inject authentication token into HTTPS git URL
   */
  private injectAuthToken(url: string, token: string): string {
    // Only inject into HTTPS URLs
    if (!url.startsWith('https://')) {
      return url;
    }

    // Handle URLs that already have auth
    const urlObj = new URL(url);
    urlObj.username = token;
    urlObj.password = 'x-oauth-basic';

    return urlObj.toString();
  }

  /**
   * Remove authentication from URL for storage
   */
  private sanitizeUrlForStorage(url: string): string {
    if (!url.startsWith('https://')) {
      return url;
    }

    try {
      const urlObj = new URL(url);
      urlObj.username = '';
      urlObj.password = '';
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Sanitize URL for logging (remove credentials)
   */
  private sanitizeUrlForLogging(url: string): string {
    if (!url.startsWith('https://')) {
      return url;
    }

    try {
      const urlObj = new URL(url);
      if (urlObj.username || urlObj.password) {
        urlObj.username = '[REDACTED]';
        urlObj.password = '';
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Check if error message indicates authentication failure
   */
  private isAuthFailure(message: string): boolean {
    return AUTH_FAILURE_PATTERNS.some((pattern) =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      // For execFile errors, the stderr is often in the error object
      const execError = error as Error & { stderr?: string; stdout?: string };
      if (execError.stderr) {
        return execError.stderr;
      }
      return error.message;
    }
    return String(error);
  }
}

/**
 * Singleton factory
 */
let gitServiceInstance: GitService | null = null;

export function getGitService(): GitService {
  if (gitServiceInstance === null) {
    gitServiceInstance = new GitService();
  }
  return gitServiceInstance;
}

/**
 * For testing - reset singleton
 */
export function resetGitService(): void {
  gitServiceInstance = null;
}
