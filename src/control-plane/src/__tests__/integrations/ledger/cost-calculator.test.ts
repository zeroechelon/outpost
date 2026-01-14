/**
 * Cost Calculator Service Tests
 */

import {
  CostCalculatorService,
  COMPUTE_RATES,
  LLM_TOKEN_RATES,
  MODEL_TIER_MULTIPLIERS,
  type CostInput,
} from '../../../integrations/ledger/cost-calculator.js';

describe('CostCalculatorService', () => {
  let calculator: CostCalculatorService;

  beforeEach(() => {
    calculator = new CostCalculatorService();
  });

  describe('calculate()', () => {
    const baseCostInput: CostInput = {
      agent: 'claude',
      modelId: 'claude-opus-4-5-20251101',
      durationSeconds: 60,
      vcpu: 1,
      memoryMb: 2048,
      tokensInput: 1000,
      tokensOutput: 500,
      workspaceMode: 'ephemeral',
    };

    it('should calculate compute cost: duration_seconds * vcpu * rate', () => {
      const result = calculator.calculate(baseCostInput);

      // Expected: 60 * 1 * 0.000012 = 0.00072
      const expectedComputeCost =
        baseCostInput.durationSeconds *
        baseCostInput.vcpu *
        COMPUTE_RATES.vcpu_per_second;

      expect(result.compute).toBeCloseTo(expectedComputeCost, 6);
    });

    it('should calculate memory cost: duration_seconds * memory_gb * rate', () => {
      const result = calculator.calculate(baseCostInput);

      // Expected: 60 * 2 * 0.000001 = 0.00012
      const memoryGb = baseCostInput.memoryMb / 1024;
      const expectedMemoryCost =
        baseCostInput.durationSeconds *
        memoryGb *
        COMPUTE_RATES.memory_gb_per_second;

      expect(result.memory).toBeCloseTo(expectedMemoryCost, 6);
    });

    it('should calculate LLM cost: tokens_input * input_rate + tokens_output * output_rate', () => {
      const result = calculator.calculate(baseCostInput);

      // Expected: 1000 * 0.000015 + 500 * 0.000075 = 0.015 + 0.0375 = 0.0525
      const expectedLlmCost =
        baseCostInput.tokensInput * LLM_TOKEN_RATES.claude.input +
        baseCostInput.tokensOutput * LLM_TOKEN_RATES.claude.output;

      expect(result.llm).toBeCloseTo(expectedLlmCost, 6);
    });

    it('should calculate storage cost for persistent workspace only', () => {
      const persistentInput: CostInput = {
        ...baseCostInput,
        workspaceMode: 'persistent',
        efsSizeBytes: 1024 * 1024 * 1024, // 1 GB
      };

      const result = calculator.calculate(persistentInput);

      // Expected: 1GB * ($0.30 / 2592000 seconds) * 60 seconds
      const secondsPerMonth = 30 * 24 * 60 * 60;
      const storageRatePerSecond =
        COMPUTE_RATES.efs_gb_per_month / secondsPerMonth;
      const expectedStorageCost = 1 * storageRatePerSecond * 60;

      expect(result.storage).toBeCloseTo(expectedStorageCost, 6);
    });

    it('should return zero storage cost for ephemeral workspace', () => {
      const result = calculator.calculate(baseCostInput);
      expect(result.storage).toBe(0);
    });

    it('should return zero storage cost for persistent workspace without EFS size', () => {
      const persistentNoEfs: CostInput = {
        ...baseCostInput,
        workspaceMode: 'persistent',
        efsSizeBytes: undefined,
      };

      const result = calculator.calculate(persistentNoEfs);
      expect(result.storage).toBe(0);
    });

    it('should apply model-specific cost multipliers for flagship tier', () => {
      const result = calculator.calculate(baseCostInput);

      // Flagship tier multiplier = 1.0
      expect(result.details.tierMultiplier).toBe(1.0);
      expect(result.details.llmInputRate).toBe(LLM_TOKEN_RATES.claude.input);
      expect(result.details.llmOutputRate).toBe(LLM_TOKEN_RATES.claude.output);
    });

    it('should apply model-specific cost multipliers for balanced tier', () => {
      const balancedInput: CostInput = {
        ...baseCostInput,
        modelId: 'claude-sonnet-4-20250514',
      };

      const result = calculator.calculate(balancedInput);

      // Balanced tier multiplier = 0.4
      expect(result.details.tierMultiplier).toBe(0.4);
      expect(result.details.llmInputRate).toBe(
        LLM_TOKEN_RATES.claude.input * 0.4
      );
      expect(result.details.llmOutputRate).toBe(
        LLM_TOKEN_RATES.claude.output * 0.4
      );
    });

    it('should apply model-specific cost multipliers for fast tier', () => {
      const fastInput: CostInput = {
        ...baseCostInput,
        modelId: 'claude-3-5-haiku-20241022',
      };

      const result = calculator.calculate(fastInput);

      // Fast tier multiplier = 0.1
      expect(result.details.tierMultiplier).toBe(0.1);
      expect(result.details.llmInputRate).toBe(
        LLM_TOKEN_RATES.claude.input * 0.1
      );
      expect(result.details.llmOutputRate).toBe(
        LLM_TOKEN_RATES.claude.output * 0.1
      );
    });

    it('should return itemized cost breakdown', () => {
      const result = calculator.calculate(baseCostInput);

      // Verify structure
      expect(result).toHaveProperty('compute');
      expect(result).toHaveProperty('memory');
      expect(result).toHaveProperty('llm');
      expect(result).toHaveProperty('storage');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('currency');
      expect(result).toHaveProperty('details');

      // Verify details structure
      expect(result.details).toHaveProperty('computeRate');
      expect(result.details).toHaveProperty('memoryRate');
      expect(result.details).toHaveProperty('llmInputRate');
      expect(result.details).toHaveProperty('llmOutputRate');
      expect(result.details).toHaveProperty('storageRate');
      expect(result.details).toHaveProperty('tierMultiplier');

      // Verify currency
      expect(result.currency).toBe('USD');
    });

    it('should calculate correct total', () => {
      const result = calculator.calculate(baseCostInput);

      const expectedTotal =
        result.compute + result.memory + result.llm + result.storage;

      expect(result.total).toBeCloseTo(expectedTotal, 6);
    });

    it('should handle all agent types', () => {
      const agents = ['claude', 'codex', 'gemini', 'aider', 'grok'] as const;

      for (const agent of agents) {
        const input: CostInput = { ...baseCostInput, agent };
        const result = calculator.calculate(input);

        expect(result.llm).toBeGreaterThan(0);
        expect(result.details.llmInputRate).toBe(LLM_TOKEN_RATES[agent].input);
        expect(result.details.llmOutputRate).toBe(LLM_TOKEN_RATES[agent].output);
      }
    });

    it('should scale with multiple vCPUs', () => {
      const multiVcpuInput: CostInput = { ...baseCostInput, vcpu: 4 };

      const singleVcpuResult = calculator.calculate(baseCostInput);
      const multiVcpuResult = calculator.calculate(multiVcpuInput);

      expect(multiVcpuResult.compute).toBeCloseTo(
        singleVcpuResult.compute * 4,
        6
      );
    });

    it('should scale with duration', () => {
      const longerInput: CostInput = { ...baseCostInput, durationSeconds: 120 };

      const shortResult = calculator.calculate(baseCostInput);
      const longResult = calculator.calculate(longerInput);

      expect(longResult.compute).toBeCloseTo(shortResult.compute * 2, 6);
      expect(longResult.memory).toBeCloseTo(shortResult.memory * 2, 6);
    });
  });

  describe('getModelTierMultiplier()', () => {
    it('should return 1.0 for flagship models', () => {
      expect(
        calculator.getModelTierMultiplier('claude-opus-4-5-20251101')
      ).toBe(1.0);
      expect(calculator.getModelTierMultiplier('gpt-5.1-codex-max')).toBe(1.0);
      expect(calculator.getModelTierMultiplier('gemini-3-pro-preview')).toBe(
        1.0
      );
    });

    it('should return 0.4 for balanced models', () => {
      expect(
        calculator.getModelTierMultiplier('claude-sonnet-4-20250514')
      ).toBe(0.4);
      expect(
        calculator.getModelTierMultiplier('deepseek/deepseek-coder')
      ).toBe(0.4);
      expect(calculator.getModelTierMultiplier('gemini-2.0-flash')).toBe(0.4);
    });

    it('should return 0.1 for fast models', () => {
      expect(
        calculator.getModelTierMultiplier('claude-3-5-haiku-20241022')
      ).toBe(0.1);
      expect(calculator.getModelTierMultiplier('gpt-4o-mini')).toBe(0.1);
      expect(calculator.getModelTierMultiplier('grok-2')).toBe(0.1);
    });

    it('should default to flagship (1.0) for unknown models', () => {
      expect(calculator.getModelTierMultiplier('unknown-model')).toBe(1.0);
    });
  });

  describe('getModelTier()', () => {
    it('should return correct tier for known models', () => {
      expect(calculator.getModelTier('claude-opus-4-5-20251101')).toBe(
        'flagship'
      );
      expect(calculator.getModelTier('claude-sonnet-4-20250514')).toBe(
        'balanced'
      );
      expect(calculator.getModelTier('claude-3-5-haiku-20241022')).toBe('fast');
    });

    it('should default to flagship for unknown models', () => {
      expect(calculator.getModelTier('unknown-model')).toBe('flagship');
    });
  });

  describe('input validation', () => {
    const baseCostInput: CostInput = {
      agent: 'claude',
      modelId: 'claude-opus-4-5-20251101',
      durationSeconds: 60,
      vcpu: 1,
      memoryMb: 2048,
      tokensInput: 1000,
      tokensOutput: 500,
      workspaceMode: 'ephemeral',
    };

    it('should throw on negative durationSeconds', () => {
      const input: CostInput = { ...baseCostInput, durationSeconds: -1 };
      expect(() => calculator.calculate(input)).toThrow(
        'durationSeconds must be non-negative'
      );
    });

    it('should throw on zero vcpu', () => {
      const input: CostInput = { ...baseCostInput, vcpu: 0 };
      expect(() => calculator.calculate(input)).toThrow('vcpu must be positive');
    });

    it('should throw on zero memoryMb', () => {
      const input: CostInput = { ...baseCostInput, memoryMb: 0 };
      expect(() => calculator.calculate(input)).toThrow(
        'memoryMb must be positive'
      );
    });

    it('should throw on negative tokensInput', () => {
      const input: CostInput = { ...baseCostInput, tokensInput: -1 };
      expect(() => calculator.calculate(input)).toThrow(
        'tokensInput must be non-negative'
      );
    });

    it('should throw on negative tokensOutput', () => {
      const input: CostInput = { ...baseCostInput, tokensOutput: -1 };
      expect(() => calculator.calculate(input)).toThrow(
        'tokensOutput must be non-negative'
      );
    });

    it('should throw on negative efsSizeBytes', () => {
      const input: CostInput = { ...baseCostInput, efsSizeBytes: -1 };
      expect(() => calculator.calculate(input)).toThrow(
        'efsSizeBytes must be non-negative'
      );
    });

    it('should allow zero durationSeconds', () => {
      const input: CostInput = { ...baseCostInput, durationSeconds: 0 };
      expect(() => calculator.calculate(input)).not.toThrow();
    });

    it('should allow zero tokens', () => {
      const input: CostInput = {
        ...baseCostInput,
        tokensInput: 0,
        tokensOutput: 0,
      };
      const result = calculator.calculate(input);
      expect(result.llm).toBe(0);
    });
  });

  describe('precision', () => {
    it('should round to 6 decimal places (microdollars)', () => {
      const input: CostInput = {
        agent: 'claude',
        modelId: 'claude-opus-4-5-20251101',
        durationSeconds: 1,
        vcpu: 1,
        memoryMb: 512,
        tokensInput: 1,
        tokensOutput: 1,
        workspaceMode: 'ephemeral',
      };

      const result = calculator.calculate(input);

      // Verify all values have at most 6 decimal places
      const checkDecimalPlaces = (value: number) => {
        const str = value.toString();
        const decimalIndex = str.indexOf('.');
        if (decimalIndex === -1) return true;
        return str.length - decimalIndex - 1 <= 6;
      };

      expect(checkDecimalPlaces(result.compute)).toBe(true);
      expect(checkDecimalPlaces(result.memory)).toBe(true);
      expect(checkDecimalPlaces(result.llm)).toBe(true);
      expect(checkDecimalPlaces(result.storage)).toBe(true);
      expect(checkDecimalPlaces(result.total)).toBe(true);
    });
  });

  describe('rate constants', () => {
    it('should have correct compute rates', () => {
      expect(COMPUTE_RATES.vcpu_per_second).toBe(0.000012);
      expect(COMPUTE_RATES.memory_gb_per_second).toBe(0.000001);
      expect(COMPUTE_RATES.efs_gb_per_month).toBe(0.3);
    });

    it('should have rates for all agents', () => {
      const agents = ['claude', 'codex', 'gemini', 'aider', 'grok'] as const;

      for (const agent of agents) {
        expect(LLM_TOKEN_RATES[agent]).toBeDefined();
        expect(LLM_TOKEN_RATES[agent].input).toBeGreaterThan(0);
        expect(LLM_TOKEN_RATES[agent].output).toBeGreaterThan(0);
      }
    });

    it('should have correct tier multipliers', () => {
      expect(MODEL_TIER_MULTIPLIERS.flagship).toBe(1.0);
      expect(MODEL_TIER_MULTIPLIERS.balanced).toBe(0.4);
      expect(MODEL_TIER_MULTIPLIERS.fast).toBe(0.1);
    });
  });
});
