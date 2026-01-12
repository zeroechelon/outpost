/**
 * Secret Injector Service - Secure secret injection for ECS tasks
 *
 * Maps agent types to required API keys and builds container secrets
 * configuration for ECS task definitions using Secrets Manager ARNs.
 *
 * Security: Never logs or exposes secret values. Only handles ARNs.
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
}

/**
 * AWS Account and region constants for ARN construction
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';
const SECRET_PATH_PREFIX = '/outpost/secrets';
const USER_SECRET_PATH_PREFIX = '/outpost/users';

/**
 * Agent type to API key secret mapping
 * Each agent requires a specific API key for its LLM provider
 */
const AGENT_SECRET_MAPPINGS: Readonly<Record<AgentType, AgentSecretMapping>> = {
  claude: {
    envVar: 'ANTHROPIC_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/anthropic-api-key`,
  },
  codex: {
    envVar: 'OPENAI_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/openai-api-key`,
  },
  gemini: {
    envVar: 'GOOGLE_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/google-api-key`,
  },
  aider: {
    envVar: 'DEEPSEEK_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/deepseek-api-key`,
  },
  grok: {
    envVar: 'XAI_API_KEY',
    secretPath: `${SECRET_PATH_PREFIX}/xai-api-key`,
  },
} as const;

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
export { AGENT_SECRET_MAPPINGS, SECRET_PATH_PREFIX, USER_SECRET_PATH_PREFIX, buildSecretArn };
