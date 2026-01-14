/**
 * Cost Calculator Service
 *
 * Calculates itemized costs for Outpost job executions based on:
 * - Compute (vCPU seconds)
 * - Memory (GB seconds)
 * - LLM tokens (input/output with model-specific rates)
 * - Storage (EFS for persistent workspaces)
 *
 * @module integrations/ledger/cost-calculator
 */

import type { AgentType } from '../../types/agent.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type WorkspaceMode = 'ephemeral' | 'persistent';

export type ModelTier = 'flagship' | 'balanced' | 'fast';

export interface CostInput {
  /** Agent type (claude, codex, gemini, aider, grok) */
  readonly agent: AgentType;
  /** Specific model identifier */
  readonly modelId: string;
  /** Job execution duration in seconds */
  readonly durationSeconds: number;
  /** vCPU units allocated */
  readonly vcpu: number;
  /** Memory allocated in megabytes */
  readonly memoryMb: number;
  /** Input tokens consumed */
  readonly tokensInput: number;
  /** Output tokens generated */
  readonly tokensOutput: number;
  /** EFS workspace size in bytes (optional) */
  readonly efsSizeBytes?: number;
  /** Workspace mode (ephemeral or persistent) */
  readonly workspaceMode: WorkspaceMode;
}

export interface CostBreakdown {
  /** Compute cost (vCPU) */
  readonly compute: number;
  /** Memory cost */
  readonly memory: number;
  /** LLM API cost */
  readonly llm: number;
  /** Storage cost (EFS) */
  readonly storage: number;
  /** Total cost */
  readonly total: number;
  /** Currency code */
  readonly currency: 'USD';
  /** Detailed rate information used in calculation */
  readonly details: {
    /** vCPU rate per second */
    readonly computeRate: number;
    /** Memory rate per GB-second */
    readonly memoryRate: number;
    /** LLM input token rate */
    readonly llmInputRate: number;
    /** LLM output token rate */
    readonly llmOutputRate: number;
    /** Storage rate per GB-month */
    readonly storageRate: number;
    /** Model tier multiplier applied */
    readonly tierMultiplier: number;
  };
}

interface LlmTokenRates {
  readonly input: number;
  readonly output: number;
}

// ============================================================================
// Pricing Constants
// ============================================================================

/**
 * Fargate compute rates (approximate)
 */
const COMPUTE_RATES = {
  /** $0.04/vCPU-hour = $0.000012/vCPU-second */
  vcpu_per_second: 0.000012,
  /** $0.004/GB-hour = $0.000001/GB-second */
  memory_gb_per_second: 0.000001,
  /** EFS standard storage rate */
  efs_gb_per_month: 0.30,
} as const;

/**
 * LLM token rates per agent (per token)
 * Based on API pricing for flagship models
 */
const LLM_TOKEN_RATES: Readonly<Record<AgentType, LlmTokenRates>> = {
  claude: { input: 0.000015, output: 0.000075 }, // Opus pricing
  codex: { input: 0.00001, output: 0.00003 }, // GPT-5 Codex
  gemini: { input: 0.00001, output: 0.00002 }, // Gemini 3 Pro
  aider: { input: 0.0000014, output: 0.0000028 }, // DeepSeek Coder
  grok: { input: 0.000005, output: 0.000015 }, // xAI Grok
} as const;

/**
 * Model tier multipliers
 * Applied to base LLM rates based on model capability tier
 */
const MODEL_TIER_MULTIPLIERS: Readonly<Record<ModelTier, number>> = {
  flagship: 1.0, // Full pricing
  balanced: 0.4, // 40% of flagship
  fast: 0.1, // 10% of flagship
} as const;

/**
 * Model ID to tier mapping
 * Maps specific model identifiers to their pricing tier
 */
const MODEL_TIER_MAP: Readonly<Record<string, ModelTier>> = {
  // Claude models
  'claude-opus-4-5-20251101': 'flagship',
  'claude-opus-4-20250514': 'flagship',
  'claude-sonnet-4-20250514': 'balanced',
  'claude-3-5-sonnet-20241022': 'balanced',
  'claude-3-5-haiku-20241022': 'fast',

  // OpenAI Codex models
  'gpt-5.1-codex-max': 'flagship',
  'gpt-4.1-codex': 'balanced',
  'gpt-4o-mini': 'fast',

  // Gemini models
  'gemini-3-flash-preview': 'flagship',
  'gemini-3-pro-preview': 'flagship',
  'gemini-2.5-pro': 'flagship',
  'gemini-2.0-flash': 'balanced',
  'gemini-2.0-flash-lite': 'fast',

  // DeepSeek (Aider)
  'deepseek/deepseek-coder': 'balanced',
  'deepseek-coder-v2': 'balanced',
  'deepseek-coder': 'fast',

  // xAI Grok models
  'grok-4-1-fast-reasoning': 'flagship',
  'grok-4-fast-reasoning': 'fast',
  'grok-3': 'balanced',
  'grok-2': 'fast',
} as const;

// ============================================================================
// Cost Calculator Service
// ============================================================================

/**
 * Service for calculating job execution costs
 *
 * @example
 * ```typescript
 * const calculator = new CostCalculatorService();
 * const cost = calculator.calculate({
 *   agent: 'claude',
 *   modelId: 'claude-opus-4-5-20251101',
 *   durationSeconds: 120,
 *   vcpu: 1,
 *   memoryMb: 2048,
 *   tokensInput: 5000,
 *   tokensOutput: 2000,
 *   workspaceMode: 'ephemeral',
 * });
 * console.log(`Total cost: $${cost.total.toFixed(6)}`);
 * ```
 */
export class CostCalculatorService {
  /**
   * Calculate itemized cost breakdown for a job execution
   *
   * @param input - Cost calculation input parameters
   * @returns Detailed cost breakdown with itemized charges
   */
  calculate(input: CostInput): CostBreakdown {
    // Validate input
    this.validateInput(input);

    // Get model tier multiplier
    const tierMultiplier = this.getModelTierMultiplier(input.modelId);

    // Get LLM token rates for agent
    const llmRates = LLM_TOKEN_RATES[input.agent];
    const adjustedInputRate = llmRates.input * tierMultiplier;
    const adjustedOutputRate = llmRates.output * tierMultiplier;

    // Calculate compute cost: duration_seconds * vcpu * rate
    const computeCost =
      input.durationSeconds * input.vcpu * COMPUTE_RATES.vcpu_per_second;

    // Calculate memory cost: duration_seconds * memory_gb * rate
    const memoryGb = input.memoryMb / 1024;
    const memoryCost =
      input.durationSeconds * memoryGb * COMPUTE_RATES.memory_gb_per_second;

    // Calculate LLM cost: tokens_input * input_rate + tokens_output * output_rate
    const llmCost =
      input.tokensInput * adjustedInputRate +
      input.tokensOutput * adjustedOutputRate;

    // Calculate storage cost: efs_size_bytes * storage_rate (persistent only)
    let storageCost = 0;
    if (input.workspaceMode === 'persistent' && input.efsSizeBytes) {
      // Convert bytes to GB and calculate monthly prorated cost
      // Assuming storage is billed per second of usage
      const efsSizeGb = input.efsSizeBytes / (1024 * 1024 * 1024);
      const secondsPerMonth = 30 * 24 * 60 * 60; // 2,592,000 seconds
      const storageRatePerSecond =
        COMPUTE_RATES.efs_gb_per_month / secondsPerMonth;
      storageCost = efsSizeGb * storageRatePerSecond * input.durationSeconds;
    }

    // Calculate total
    const total = computeCost + memoryCost + llmCost + storageCost;

    return {
      compute: this.roundToMicrodollars(computeCost),
      memory: this.roundToMicrodollars(memoryCost),
      llm: this.roundToMicrodollars(llmCost),
      storage: this.roundToMicrodollars(storageCost),
      total: this.roundToMicrodollars(total),
      currency: 'USD',
      details: {
        computeRate: COMPUTE_RATES.vcpu_per_second,
        memoryRate: COMPUTE_RATES.memory_gb_per_second,
        llmInputRate: adjustedInputRate,
        llmOutputRate: adjustedOutputRate,
        storageRate: COMPUTE_RATES.efs_gb_per_month,
        tierMultiplier,
      },
    };
  }

  /**
   * Get model tier multiplier for a given model ID
   *
   * @param modelId - Model identifier
   * @returns Tier multiplier (1.0 for flagship, 0.4 for balanced, 0.1 for fast)
   */
  getModelTierMultiplier(modelId: string): number {
    const tier = MODEL_TIER_MAP[modelId];
    if (tier) {
      return MODEL_TIER_MULTIPLIERS[tier];
    }

    // Default to flagship pricing for unknown models (conservative estimate)
    return MODEL_TIER_MULTIPLIERS.flagship;
  }

  /**
   * Get model tier for a given model ID
   *
   * @param modelId - Model identifier
   * @returns Model tier (flagship, balanced, or fast)
   */
  getModelTier(modelId: string): ModelTier {
    return MODEL_TIER_MAP[modelId] ?? 'flagship';
  }

  /**
   * Validate cost input parameters
   *
   * @param input - Cost input to validate
   * @throws Error if input is invalid
   */
  private validateInput(input: CostInput): void {
    if (input.durationSeconds < 0) {
      throw new Error('durationSeconds must be non-negative');
    }
    if (input.vcpu <= 0) {
      throw new Error('vcpu must be positive');
    }
    if (input.memoryMb <= 0) {
      throw new Error('memoryMb must be positive');
    }
    if (input.tokensInput < 0) {
      throw new Error('tokensInput must be non-negative');
    }
    if (input.tokensOutput < 0) {
      throw new Error('tokensOutput must be non-negative');
    }
    if (input.efsSizeBytes !== undefined && input.efsSizeBytes < 0) {
      throw new Error('efsSizeBytes must be non-negative');
    }
  }

  /**
   * Round to 6 decimal places (microdollars precision)
   *
   * @param value - Value to round
   * @returns Rounded value
   */
  private roundToMicrodollars(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { COMPUTE_RATES, LLM_TOKEN_RATES, MODEL_TIER_MULTIPLIERS, MODEL_TIER_MAP };
