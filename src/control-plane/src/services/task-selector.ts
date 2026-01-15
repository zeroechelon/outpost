/**
 * Task Selector Service - Agent and model selection logic for ECS task dispatch
 *
 * Maps agent types to ECS task definitions and validates model IDs against
 * the agent registry. Returns resource configuration based on model tier.
 */

import { ValidationError } from '../utils/errors.js';
import type { AgentType } from '../types/agent.js';

/**
 * Model tier determines resource allocation
 */
export type ModelTier = 'flagship' | 'balanced' | 'fast';

/**
 * Result of task definition selection
 */
export interface TaskSelectionResult {
  readonly taskDefinitionArn: string;
  readonly cpu: number;
  readonly memory: number;
  readonly modelId: string;
  readonly tier: ModelTier;
}

/**
 * Model configuration with tier classification
 */
interface ModelConfig {
  readonly modelId: string;
  readonly tier: ModelTier;
}

/**
 * Agent registry defining supported models per agent type
 * First model in each list is the flagship (default)
 */
const AGENT_MODEL_REGISTRY: Readonly<Record<AgentType, readonly ModelConfig[]>> = {
  claude: [
    { modelId: 'claude-opus-4-5-20251101', tier: 'flagship' },
    { modelId: 'claude-sonnet-4-5-20250929', tier: 'balanced' },
    { modelId: 'claude-haiku-4-5-20250801', tier: 'fast' },
  ],
  codex: [
    { modelId: 'gpt-5.1-codex-max', tier: 'flagship' },
    { modelId: 'gpt-4o-codex', tier: 'balanced' },
  ],
  gemini: [
    { modelId: 'gemini-3-flash-preview', tier: 'flagship' },
    { modelId: 'gemini-3-flash', tier: 'fast' },
  ],
  aider: [
    { modelId: 'deepseek/deepseek-coder', tier: 'flagship' },
    { modelId: 'deepseek/deepseek-chat', tier: 'balanced' },
  ],
  grok: [
    { modelId: 'grok-4-1-fast-reasoning', tier: 'flagship' },
    { modelId: 'grok-4-fast-reasoning', tier: 'fast' },
  ],
} as const;

/**
 * Resource configuration per model tier
 */
const TIER_RESOURCES: Readonly<Record<ModelTier, { cpu: number; memory: number }>> = {
  flagship: { cpu: 2048, memory: 4096 },
  balanced: { cpu: 1024, memory: 2048 },
  fast: { cpu: 512, memory: 1024 },
} as const;

/**
 * AWS account ID for task definition ARN construction
 */
const AWS_ACCOUNT_ID = '311493921645';
const AWS_REGION = 'us-east-1';

/**
 * Validates that the provided agent type is supported
 */
function isValidAgentType(agent: string): agent is AgentType {
  return agent in AGENT_MODEL_REGISTRY;
}

/**
 * Gets the model configuration for a specific model ID within an agent
 */
function getModelConfig(agent: AgentType, modelId: string): ModelConfig | undefined {
  const models = AGENT_MODEL_REGISTRY[agent];
  return models.find((m) => m.modelId === modelId);
}

/**
 * Gets the flagship (default) model for an agent
 */
function getFlagshipModel(agent: AgentType): ModelConfig {
  const models = AGENT_MODEL_REGISTRY[agent];
  const flagship = models[0];
  if (flagship === undefined) {
    // This should never happen given our const registry, but TypeScript requires the check
    throw new ValidationError(`No models configured for agent: ${agent}`);
  }
  return flagship;
}

/**
 * Builds the ECS task definition ARN for an agent
 * Note: Omitting revision number allows ECS to use the latest ACTIVE revision
 */
function buildTaskDefinitionArn(agent: AgentType): string {
  const env = process.env['ENVIRONMENT'] ?? 'dev';
  return `arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:task-definition/outpost-${env}-${agent}`;
}

/**
 * Gets the list of valid model IDs for an agent
 */
export function getValidModelsForAgent(agent: AgentType): readonly string[] {
  const models = AGENT_MODEL_REGISTRY[agent];
  return models.map((m) => m.modelId);
}

/**
 * Gets all supported agent types
 */
export function getSupportedAgents(): readonly AgentType[] {
  return Object.keys(AGENT_MODEL_REGISTRY) as AgentType[];
}

/**
 * Checks if a model ID is valid for a given agent
 */
export function isValidModelForAgent(agent: AgentType, modelId: string): boolean {
  return getModelConfig(agent, modelId) !== undefined;
}

/**
 * Selects the appropriate ECS task definition and resource configuration
 * for a given agent and optional model ID.
 *
 * @param agent - The agent type (claude, codex, gemini, aider, grok)
 * @param modelId - Optional model ID. Falls back to flagship if not specified.
 * @returns TaskSelectionResult with task ARN, resources, and model info
 * @throws ValidationError if agent or model is invalid
 */
export function selectTaskDefinition(
  agent: string,
  modelId?: string | undefined
): TaskSelectionResult {
  // Validate agent type
  if (!isValidAgentType(agent)) {
    const supportedAgents = getSupportedAgents().join(', ');
    throw new ValidationError(`Unknown agent type: ${agent}`, {
      agent,
      supportedAgents,
    });
  }

  // Resolve model configuration
  let modelConfig: ModelConfig;

  if (modelId === undefined || modelId === '') {
    // Fall back to flagship model
    modelConfig = getFlagshipModel(agent);
  } else {
    // Validate specified model
    const config = getModelConfig(agent, modelId);
    if (config === undefined) {
      const validModels = getValidModelsForAgent(agent);
      throw new ValidationError(`Invalid model for agent ${agent}: ${modelId}`, {
        agent,
        modelId,
        validModels,
      });
    }
    modelConfig = config;
  }

  // Get resource configuration for the tier
  const resources = TIER_RESOURCES[modelConfig.tier];

  return {
    taskDefinitionArn: buildTaskDefinitionArn(agent),
    cpu: resources.cpu,
    memory: resources.memory,
    modelId: modelConfig.modelId,
    tier: modelConfig.tier,
  };
}

/**
 * Validates a task selection request without performing the selection
 * Returns validation errors if any, or null if valid
 */
export function validateTaskSelection(
  agent: string,
  modelId?: string | undefined
): { valid: true } | { valid: false; error: string; details: Record<string, unknown> } {
  if (!isValidAgentType(agent)) {
    return {
      valid: false,
      error: `Unknown agent type: ${agent}`,
      details: {
        agent,
        supportedAgents: getSupportedAgents(),
      },
    };
  }

  if (modelId !== undefined && modelId !== '' && !isValidModelForAgent(agent, modelId)) {
    return {
      valid: false,
      error: `Invalid model for agent ${agent}: ${modelId}`,
      details: {
        agent,
        modelId,
        validModels: getValidModelsForAgent(agent),
      },
    };
  }

  return { valid: true };
}
