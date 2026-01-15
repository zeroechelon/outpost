/**
 * Secret Injector Service - Secure secret injection for ECS tasks
 *
 * Maps agent types to required API keys and builds container secrets
 * configuration for ECS task definitions using Secrets Manager ARNs.
 *
 * Also supports additionalSecrets parameter for injecting user-provided
 * secrets (key/value pairs) as environment variables. Special handling
 * for GITHUB_TOKEN to configure git credential store.
 *
 * Security: Never logs or exposes secret values. Only handles ARNs.
 * Audit logging records secret key names only, never values.
 */

import {
  SecretsManagerClient,
  DescribeSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { getLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import type { AgentType } from '../types/agent.js';

/**
 * Container secret configuration for ECS task definition
 */
export interface ContainerSecret {
  readonly name: string; // Environment variable name
  readonly valueFrom: string; // Secrets Manager ARN
}

/**
 * Secret mapping for each agent type
 */
interface AgentSecretMapping {
  readonly envVar: string;
  readonly secretPath: string;
}

/**
 * Result of secret injection including all secrets and validation status
 */
export interface SecretInjectionResult {
  readonly secrets: readonly ContainerSecret[];
  readonly agentType: AgentType;
  readonly userId?: string | undefined;
  readonly validatedAt: Date;
  /** Additional secrets that were injected (key names only for audit) */
  readonly additionalSecretKeys?: readonly string[];
  /** Git credential configuration if GITHUB_TOKEN was injected */
  readonly gitCredentialConfig?: GitCredentialConfig;
}

/**
 * Git credential configuration for GITHUB_TOKEN injection
 */
export interface GitCredentialConfig {
  /** Path to .git-credentials file */
  readonly credentialsPath: string;
  /** Commands to configure git credential store */
  readonly configCommands: readonly string[];
}

/**
 * Additional secrets input as key-value pairs
 * Keys must be uppercase with underscores (environment variable format)
 */
export type AdditionalSecrets = Record<string, string>;

/**
 * Audit log entry for secret injection (values never logged)
 */
export interface SecretInjectionAuditLog {
  readonly runId: string;
  readonly secretKeys: readonly string[];
  readonly source: 'agent' | 'additional' | 'user';
  readonly timestamp: Date;
}

/**
 * AWS Account and region constants for ARN construction
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';
const SECRET_PATH_PREFIX = '/outpost/api-keys';
const USER_SECRET_PATH_PREFIX = '/outpost/users';

/**
 * Validation constants for additionalSecrets
 */
const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_SECRET_KEY_LENGTH = 128;
const MAX_SECRET_VALUE_LENGTH = 32 * 1024; // 32KB

/**
 * System secrets that cannot be overridden by additionalSecrets
 * These are reserved for agent API keys and AWS credentials
 */
const PROTECTED_SECRET_KEYS = new Set([
  // AWS credentials (prevent override of instance role credentials)
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  // Agent API keys (managed by system)
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
  // GitHub token (has special handling)
  'GITHUB_TOKEN',
]);

/**
 * Agent type to API key secret mapping
 * Each agent requires a specific API key for its LLM provider
 */
const AGENT_SECRET_MAPPINGS: Readonly<Record<AgentType, AgentSecretMapping>> = {
  claude: {
    envVar: 'ANTHROPIC_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/anthropic`,
  },
  codex: {
    envVar: 'OPENAI_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/openai`,
  },
  gemini: {
    envVar: 'GOOGLE_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/google`,
  },
  aider: {
    envVar: 'DEEPSEEK_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/deepseek`,
  },
  grok: {
    envVar: 'XAI_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/xai`,
  },
} as const;

/**
 * Common secrets injected into all agents
 * These are shared across all agent types (e.g., GitHub access for private repos)
 */
const COMMON_SECRETS: readonly AgentSecretMapping[] = [
  {
    envVar: 'GITHUB_TOKEN',
    secretPath: `${SECRET_PATH_PREFIX}/github`,
  },
] as const;

/**
 * Constructs a Secrets Manager ARN from a secret path
 */
function buildSecretArn(secretPath: string, region: string = AWS_REGION): string {
  return `arn:aws:secretsmanager:${region}:${AWS_ACCOUNT_ID}:secret:${secretPath}`;
}

/**
 * SecretInjectorService - Handles secure secret injection for ECS worker tasks
 */
export class SecretInjectorService {
  private readonly logger = getLogger().child({ service: 'SecretInjectorService' });
  private readonly client: SecretsManagerClient;
  private readonly region: string;

  constructor(client?: SecretsManagerClient) {
    const config = getConfig();
    this.region = config.awsRegion;
    this.client =
      client ??
      new SecretsManagerClient({
        region: this.region,
      });
  }

  /**
   * Build container secrets configuration for an agent type
   * Validates all required secrets exist before returning
   *
   * @param agentType - The agent type requiring secrets
   * @param userId - Optional user ID for user-specific secrets
   * @param additionalSecrets - Optional additional secret paths to include
   * @returns SecretInjectionResult with validated secrets
   * @throws NotFoundError if required secrets don't exist
   * @throws ValidationError if agent type is invalid
   */
  async buildContainerSecrets(
    agentType: AgentType,
    userId?: string,
    additionalSecrets?: readonly string[]
  ): Promise<SecretInjectionResult> {
    this.logger.info(
      { agentType, hasUserId: userId !== undefined, additionalCount: additionalSecrets?.length ?? 0 },
      'Building container secrets'
    );

    // Get required secrets for agent type
    const agentMapping = AGENT_SECRET_MAPPINGS[agentType];
    if (agentMapping === undefined) {
      throw new ValidationError(`Unknown agent type: ${agentType}`);
    }

    const secrets: ContainerSecret[] = [];
    const secretPathsToValidate: string[] = [];

    // Add primary agent secret
    const primaryArn = buildSecretArn(agentMapping.secretPath, this.region);
    secrets.push({
      name: agentMapping.envVar,
      valueFrom: primaryArn,
    });
    secretPathsToValidate.push(agentMapping.secretPath);

    // Add common secrets (shared across all agents)
    for (const commonSecret of COMMON_SECRETS) {
      const commonArn = buildSecretArn(commonSecret.secretPath, this.region);
      secrets.push({
        name: commonSecret.envVar,
        valueFrom: commonArn,
      });
      secretPathsToValidate.push(commonSecret.secretPath);
    }

    // Add user-specific secrets if userId provided
    if (userId !== undefined) {
      const userSecrets = await this.getUserSecretPaths(userId);
      for (const userSecret of userSecrets) {
        const userArn = buildSecretArn(userSecret.path, this.region);
        secrets.push({
          name: userSecret.envVar,
          valueFrom: userArn,
        });
        secretPathsToValidate.push(userSecret.path);
      }
    }

    // Add any additional secrets
    if (additionalSecrets !== undefined && additionalSecrets.length > 0) {
      for (const secretPath of additionalSecrets) {
        const additionalArn = buildSecretArn(secretPath, this.region);
        // Use the last segment of the path as env var name, uppercased
        const envVarName = this.pathToEnvVar(secretPath);
        secrets.push({
          name: envVarName,
          valueFrom: additionalArn,
        });
        secretPathsToValidate.push(secretPath);
      }
    }

    // Validate all secrets exist in parallel
    await this.validateSecretsExist(secretPathsToValidate);

    this.logger.info(
      { agentType, secretCount: secrets.length },
      'Container secrets built successfully'
    );

    return {
      secrets,
      agentType,
      userId,
      validatedAt: new Date(),
    };
  }

  /**
   * Validate that a single secret exists in Secrets Manager
   * Does NOT retrieve or log the secret value
   *
   * @param secretPath - The secret path to validate
   * @returns true if secret exists
   * @throws NotFoundError if secret doesn't exist
   */
  async validateSecretExists(secretPath: string): Promise<boolean> {
    const arn = buildSecretArn(secretPath, this.region);

    try {
      // DescribeSecret only returns metadata, not the secret value
      await this.client.send(
        new DescribeSecretCommand({
          SecretId: arn,
        })
      );
      this.logger.debug({ secretPath }, 'Secret validated');
      return true;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        this.logger.warn({ secretPath }, 'Secret not found');
        throw new NotFoundError(`Secret not found: ${secretPath}`, {
          secretPath,
          arn,
        });
      }
      // Re-throw other errors
      this.logger.error({ secretPath, error }, 'Error validating secret');
      throw error;
    }
  }

  /**
   * Validate multiple secrets exist in parallel
   *
   * @param secretPaths - Array of secret paths to validate
   * @throws NotFoundError if any secret doesn't exist (includes all missing secrets)
   */
  async validateSecretsExist(secretPaths: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      secretPaths.map((path) => this.validateSecretExists(path))
    );

    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result !== undefined && result.status === 'rejected') {
        const path = secretPaths[i];
        if (path !== undefined) {
          failures.push(path);
        }
      }
    }

    if (failures.length > 0) {
      throw new NotFoundError(`Required secrets not found: ${failures.join(', ')}`, {
        missingSecrets: failures,
        totalRequired: secretPaths.length,
      });
    }
  }

  /**
   * Get the secret mapping for a specific agent type
   *
   * @param agentType - The agent type
   * @returns The secret mapping with envVar and secretPath
   */
  getAgentSecretMapping(agentType: AgentType): AgentSecretMapping {
    const mapping = AGENT_SECRET_MAPPINGS[agentType];
    if (mapping === undefined) {
      throw new ValidationError(`Unknown agent type: ${agentType}`);
    }
    return mapping;
  }

  /**
   * Get the ARN for an agent's primary secret
   *
   * @param agentType - The agent type
   * @returns The Secrets Manager ARN for the agent's API key
   */
  getAgentSecretArn(agentType: AgentType): string {
    const mapping = this.getAgentSecretMapping(agentType);
    return buildSecretArn(mapping.secretPath, this.region);
  }

  /**
   * Build user-specific secret path
   *
   * @param userId - The user ID
   * @param secretName - The secret name
   * @returns Full secret path for user-specific secret
   */
  buildUserSecretPath(userId: string, secretName: string): string {
    return `${USER_SECRET_PATH_PREFIX}/${userId}/${secretName}`;
  }

  /**
   * Get all secret paths for a user (discovers user-specific secrets)
   * This is a placeholder - in production, would list secrets with prefix
   *
   * @param userId - The user ID
   * @returns Array of user secret paths with env var names
   */
  private async getUserSecretPaths(
    userId: string
  ): Promise<Array<{ path: string; envVar: string }>> {
    // In production, this would use ListSecrets with a filter
    // For now, return common user-specific secrets if they exist
    const potentialSecrets = [
      { path: this.buildUserSecretPath(userId, 'github-token'), envVar: 'GITHUB_TOKEN' },
      { path: this.buildUserSecretPath(userId, 'npm-token'), envVar: 'NPM_TOKEN' },
    ];

    const validSecrets: Array<{ path: string; envVar: string }> = [];

    for (const secret of potentialSecrets) {
      try {
        await this.validateSecretExists(secret.path);
        validSecrets.push(secret);
      } catch {
        // Secret doesn't exist for this user, skip it
        this.logger.debug({ userId, secretPath: secret.path }, 'User secret not found, skipping');
      }
    }

    return validSecrets;
  }

  /**
   * Convert a secret path to an environment variable name
   * Example: /outpost/secrets/my-api-key -> MY_API_KEY
   *
   * @param secretPath - The secret path
   * @returns Environment variable name
   */
  private pathToEnvVar(secretPath: string): string {
    const lastSegment = secretPath.split('/').pop();
    if (lastSegment === undefined || lastSegment === '') {
      throw new ValidationError(`Invalid secret path: ${secretPath}`);
    }
    return lastSegment.toUpperCase().replace(/-/g, '_');
  }

  // ============================================================================
  // Additional Secrets Handling (T4.1, T4.2, T4.3, T4.4)
  // ============================================================================

  /**
   * Validate additional secrets (key/value pairs) before injection
   *
   * Validates:
   * - Key format: /^[A-Z][A-Z0-9_]*$/
   * - Max key length: 128 chars
   * - Max value length: 32KB
   * - No null bytes in values
   * - No override of protected system secrets
   *
   * @param additionalSecrets - Key/value pairs to validate
   * @throws ValidationError if validation fails
   */
  validateAdditionalSecrets(additionalSecrets: AdditionalSecrets): void {
    const errors: string[] = [];

    for (const [key, value] of Object.entries(additionalSecrets)) {
      // Validate key format
      if (!SECRET_KEY_PATTERN.test(key)) {
        errors.push(
          `Invalid secret key '${key}': must match pattern ${SECRET_KEY_PATTERN.toString()} (uppercase, start with letter)`
        );
        continue;
      }

      // Validate key length
      if (key.length > MAX_SECRET_KEY_LENGTH) {
        errors.push(
          `Secret key '${key}' exceeds maximum length of ${MAX_SECRET_KEY_LENGTH} characters`
        );
      }

      // Check for protected keys (cannot override system secrets)
      if (PROTECTED_SECRET_KEYS.has(key)) {
        errors.push(
          `Cannot override protected system secret '${key}'`
        );
      }

      // Validate value length
      if (value.length > MAX_SECRET_VALUE_LENGTH) {
        errors.push(
          `Secret value for key '${key}' exceeds maximum length of ${MAX_SECRET_VALUE_LENGTH} bytes (32KB)`
        );
      }

      // Check for null bytes in value
      if (value.includes('\0')) {
        errors.push(
          `Secret value for key '${key}' contains null bytes which are not allowed`
        );
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(`Additional secrets validation failed: ${errors.join('; ')}`, {
        validationErrors: errors,
        keyCount: Object.keys(additionalSecrets).length,
      });
    }

    this.logger.debug(
      { keyCount: Object.keys(additionalSecrets).length },
      'Additional secrets validation passed'
    );
  }

  /**
   * Check if a secret key is protected (cannot be overridden)
   *
   * @param key - The secret key to check
   * @returns true if the key is protected
   */
  isProtectedSecretKey(key: string): boolean {
    return PROTECTED_SECRET_KEYS.has(key);
  }

  /**
   * Build environment variables from additional secrets
   *
   * @param additionalSecrets - Validated key/value pairs
   * @returns Array of environment variable objects for ECS
   */
  buildEnvironmentFromAdditionalSecrets(
    additionalSecrets: AdditionalSecrets
  ): Array<{ name: string; value: string }> {
    // Validate first
    this.validateAdditionalSecrets(additionalSecrets);

    return Object.entries(additionalSecrets).map(([key, value]) => ({
      name: key,
      value,
    }));
  }

  /**
   * Build Git credential configuration for GITHUB_TOKEN
   *
   * Configures git credential store with the provided GitHub token:
   * - Creates .git-credentials file path with proper format
   * - Generates commands to configure git to use credential store
   * - Uses file permissions 600 (owner read/write only)
   *
   * @param githubToken - The GitHub personal access token
   * @param workspacePath - Path to workspace directory
   * @returns GitCredentialConfig with file path and config commands
   */
  buildGitCredentialConfig(
    githubToken: string,
    workspacePath: string = '/workspace'
  ): GitCredentialConfig {
    // Validate token is not empty
    if (!githubToken || githubToken.trim() === '') {
      throw new ValidationError('GITHUB_TOKEN cannot be empty');
    }

    // Build .git-credentials content
    // Format: https://<token>:x-oauth-basic@github.com
    const credentialsPath = `${workspacePath}/.git-credentials`;

    // Commands to configure git credential store
    // These should be run in the workspace before git operations
    const configCommands = [
      `git config --global credential.helper 'store --file=${credentialsPath}'`,
      `chmod 600 ${credentialsPath}`,
    ];

    this.logger.debug(
      { credentialsPath, workspacePath },
      'Built git credential configuration'
    );

    return {
      credentialsPath,
      configCommands,
    };
  }

  /**
   * Generate .git-credentials file content for GitHub authentication
   *
   * The file format follows git-credential-store format:
   * https://<username>:<password>@<host>
   *
   * For GitHub PAT: https://<token>:x-oauth-basic@github.com
   *
   * @param githubToken - The GitHub personal access token
   * @returns File content for .git-credentials
   */
  generateGitCredentialsContent(githubToken: string): string {
    if (!githubToken || githubToken.trim() === '') {
      throw new ValidationError('GITHUB_TOKEN cannot be empty');
    }

    // Using x-oauth-basic as password is the standard pattern for GitHub PATs
    // The token goes in the username position
    return `https://${githubToken}:x-oauth-basic@github.com\n`;
  }

  /**
   * Extract GITHUB_TOKEN from additional secrets if present
   * Returns the token value and removes it from the secrets object
   *
   * @param additionalSecrets - Mutable object of additional secrets
   * @returns The GITHUB_TOKEN value if present, undefined otherwise
   */
  extractGitHubToken(
    additionalSecrets: Record<string, string>
  ): string | undefined {
    const token = additionalSecrets['GITHUB_TOKEN'];

    // Remove from additionalSecrets if present (special handling)
    if (token !== undefined) {
      delete additionalSecrets['GITHUB_TOKEN'];
      this.logger.debug('Extracted GITHUB_TOKEN for special handling');
    }

    return token;
  }

  /**
   * Log secret injection event for audit purposes
   * NEVER logs secret values, only key names and metadata
   *
   * @param runId - The dispatch/run ID
   * @param secretKeys - Names of secrets being injected
   * @param source - Source of the secrets (agent, additional, user)
   */
  logSecretInjectionAudit(
    runId: string,
    secretKeys: readonly string[],
    source: 'agent' | 'additional' | 'user'
  ): void {
    const auditLog: SecretInjectionAuditLog = {
      runId,
      secretKeys,
      source,
      timestamp: new Date(),
    };

    // Log to structured logger for audit trail
    this.logger.info(
      {
        audit: 'secret_injection',
        runId: auditLog.runId,
        secretKeys: auditLog.secretKeys,
        source: auditLog.source,
        timestamp: auditLog.timestamp.toISOString(),
        keyCount: secretKeys.length,
      },
      'Secret injection audit log'
    );
  }

  /**
   * Process additional secrets with full validation and optional GitHub token handling
   *
   * This is the main entry point for Tier 4 additional secrets processing:
   * 1. Validates all secrets
   * 2. Extracts and handles GITHUB_TOKEN specially
   * 3. Builds environment variables
   * 4. Logs audit events
   *
   * @param runId - The dispatch/run ID for audit logging
   * @param additionalSecrets - Key/value pairs from user
   * @param workspacePath - Optional workspace path for git credentials
   * @returns Processed result with env vars, git config, and audit info
   */
  processAdditionalSecrets(
    runId: string,
    additionalSecrets: AdditionalSecrets,
    workspacePath?: string
  ): {
    environmentVariables: Array<{ name: string; value: string }>;
    gitCredentialConfig?: GitCredentialConfig;
    gitCredentialsContent?: string;
    injectedKeys: readonly string[];
  } {
    // Make a copy to avoid mutating input
    const secretsCopy = { ...additionalSecrets };

    // Validate before processing
    // Note: We validate the original to ensure GITHUB_TOKEN follows format rules
    // even though it will be handled specially
    const allKeys = Object.keys(secretsCopy);
    const protectedAttempts = allKeys.filter((key) =>
      PROTECTED_SECRET_KEYS.has(key) && key !== 'GITHUB_TOKEN'
    );

    if (protectedAttempts.length > 0) {
      throw new ValidationError(
        `Cannot override protected system secrets: ${protectedAttempts.join(', ')}`,
        { protectedAttempts }
      );
    }

    // Validate key formats and value constraints (excluding GITHUB_TOKEN)
    for (const [key, value] of Object.entries(secretsCopy)) {
      if (key === 'GITHUB_TOKEN') continue; // Special handling

      if (!SECRET_KEY_PATTERN.test(key)) {
        throw new ValidationError(
          `Invalid secret key '${key}': must match pattern ${SECRET_KEY_PATTERN.toString()}`
        );
      }
      if (key.length > MAX_SECRET_KEY_LENGTH) {
        throw new ValidationError(
          `Secret key '${key}' exceeds maximum length of ${MAX_SECRET_KEY_LENGTH}`
        );
      }
      if (value.length > MAX_SECRET_VALUE_LENGTH) {
        throw new ValidationError(
          `Secret value for '${key}' exceeds maximum of ${MAX_SECRET_VALUE_LENGTH} bytes`
        );
      }
      if (value.includes('\0')) {
        throw new ValidationError(
          `Secret value for '${key}' contains null bytes`
        );
      }
    }

    // Extract GitHub token for special handling
    const githubToken = this.extractGitHubToken(secretsCopy);

    // Build result
    let gitCredentialConfig: GitCredentialConfig | undefined;
    let gitCredentialsContent: string | undefined;

    if (githubToken !== undefined) {
      const effectiveWorkspacePath = workspacePath ?? '/workspace';
      gitCredentialConfig = this.buildGitCredentialConfig(
        githubToken,
        effectiveWorkspacePath
      );
      gitCredentialsContent = this.generateGitCredentialsContent(githubToken);
    }

    // Build environment variables from remaining secrets
    const environmentVariables = Object.entries(secretsCopy).map(
      ([name, value]) => ({ name, value })
    );

    // Log audit events
    const injectedKeys = [...Object.keys(secretsCopy)];
    if (githubToken !== undefined) {
      injectedKeys.push('GITHUB_TOKEN');
    }

    this.logSecretInjectionAudit(runId, injectedKeys, 'additional');

    this.logger.info(
      {
        runId,
        envVarCount: environmentVariables.length,
        hasGitHubToken: githubToken !== undefined,
      },
      'Additional secrets processed successfully'
    );

    const result: {
      environmentVariables: Array<{ name: string; value: string }>;
      injectedKeys: readonly string[];
      gitCredentialConfig?: GitCredentialConfig;
      gitCredentialsContent?: string;
    } = {
      environmentVariables,
      injectedKeys,
    };

    if (gitCredentialConfig !== undefined) {
      result.gitCredentialConfig = gitCredentialConfig;
    }
    if (gitCredentialsContent !== undefined) {
      result.gitCredentialsContent = gitCredentialsContent;
    }

    return result;
  }
}

/**
 * Export singleton-friendly factory
 */
let serviceInstance: SecretInjectorService | null = null;

export function getSecretInjectorService(): SecretInjectorService {
  if (serviceInstance === null) {
    serviceInstance = new SecretInjectorService();
  }
  return serviceInstance;
}

/**
 * For testing - allows resetting the service instance
 */
export function resetSecretInjectorService(): void {
  serviceInstance = null;
}

/**
 * Export constants for external use
 */
export {
  AGENT_SECRET_MAPPINGS,
  COMMON_SECRETS,
  SECRET_PATH_PREFIX,
  USER_SECRET_PATH_PREFIX,
  buildSecretArn,
  // Tier 4 validation constants
  SECRET_KEY_PATTERN,
  MAX_SECRET_KEY_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  PROTECTED_SECRET_KEYS,
};
