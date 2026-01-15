/**
 * Token Counter Service - Parses agent output logs for token usage metrics
 *
 * Supports extraction from:
 * - Claude: API response metadata (input_tokens, output_tokens)
 * - Codex: 'Tokens used' line or API response
 * - Gemini: response metadata (promptTokenCount, candidatesTokenCount)
 * - Aider: cost summary (tokens sent/received)
 * - Grok: API response (usage.prompt_tokens, usage.completion_tokens)
 *
 * Falls back to character-based estimation when parsing fails.
 */

import { getLogger } from '../../utils/logger.js';
import type { AgentType } from '../../types/agent.js';

/**
 * Token usage metrics extracted from agent output
 */
export interface TokenUsage {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensTotal: number;
  readonly source: 'parsed' | 'estimated' | 'unavailable';
}

/**
 * Regex patterns for each agent's token output format
 */
const TOKEN_PATTERNS = {
  /**
   * Claude API response format:
   * {"usage":{"input_tokens":1500,"output_tokens":2500}}
   */
  claude: {
    // Match usage object with input_tokens and output_tokens
    usage: /"usage"\s*:\s*\{[^}]*"input_tokens"\s*:\s*(\d+)[^}]*"output_tokens"\s*:\s*(\d+)[^}]*\}/,
    // Alternative: output_tokens before input_tokens
    usageAlt: /"usage"\s*:\s*\{[^}]*"output_tokens"\s*:\s*(\d+)[^}]*"input_tokens"\s*:\s*(\d+)[^}]*\}/,
  },

  /**
   * Codex output formats:
   * Tokens used: 3500 (input: 1000, output: 2500)
   * Or JSON: {"usage":{"prompt_tokens":1000,"completion_tokens":2500}}
   */
  codex: {
    // Text format: "Tokens used: TOTAL (input: IN, output: OUT)"
    text: /Tokens?\s+used:\s*(\d+)\s*\(\s*input:\s*(\d+)\s*,\s*output:\s*(\d+)\s*\)/i,
    // OpenAI-style JSON format
    json: /"usage"\s*:\s*\{[^}]*"prompt_tokens"\s*:\s*(\d+)[^}]*"completion_tokens"\s*:\s*(\d+)[^}]*\}/,
    jsonAlt: /"usage"\s*:\s*\{[^}]*"completion_tokens"\s*:\s*(\d+)[^}]*"prompt_tokens"\s*:\s*(\d+)[^}]*\}/,
  },

  /**
   * Gemini response format:
   * Usage: {"promptTokenCount":1200,"candidatesTokenCount":800}
   * Or: {"usageMetadata":{"promptTokenCount":1200,"candidatesTokenCount":800}}
   */
  gemini: {
    // Direct format
    usage: /"promptTokenCount"\s*:\s*(\d+)[^}]*"candidatesTokenCount"\s*:\s*(\d+)/,
    usageAlt: /"candidatesTokenCount"\s*:\s*(\d+)[^}]*"promptTokenCount"\s*:\s*(\d+)/,
    // With totalTokenCount
    usageTotal: /"promptTokenCount"\s*:\s*(\d+)[^}]*"candidatesTokenCount"\s*:\s*(\d+)[^}]*"totalTokenCount"\s*:\s*(\d+)/,
  },

  /**
   * Aider cost summary format:
   * Tokens: 4,532 sent, 1,234 received
   * Or: tokens: 4532 sent, 1234 received
   */
  aider: {
    // With commas in numbers
    tokens: /Tokens?:\s*([\d,]+)\s*sent\s*,\s*([\d,]+)\s*received/i,
    // Cost format as fallback
    cost: /cost:\s*\$?([\d.]+)/i,
  },

  /**
   * Grok API response format:
   * {"usage":{"prompt_tokens":1000,"completion_tokens":500}}
   */
  grok: {
    // Same as OpenAI format
    usage: /"usage"\s*:\s*\{[^}]*"prompt_tokens"\s*:\s*(\d+)[^}]*"completion_tokens"\s*:\s*(\d+)[^}]*\}/,
    usageAlt: /"usage"\s*:\s*\{[^}]*"completion_tokens"\s*:\s*(\d+)[^}]*"prompt_tokens"\s*:\s*(\d+)[^}]*\}/,
  },
} as const;

/**
 * Average characters per token for estimation
 * Based on typical English text tokenization (~4 chars/token)
 */
const CHARS_PER_TOKEN = 4;

/**
 * Parse comma-separated number string to integer
 * E.g., "4,532" -> 4532
 */
function parseNumberWithCommas(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10);
}

/**
 * Safely extract match group as string
 * Returns empty string if group is undefined (should not happen with valid patterns)
 */
function getMatchGroup(match: RegExpExecArray, index: number): string {
  const value = match[index];
  return value !== undefined ? value : '';
}

/**
 * Safely parse integer from match group
 */
function parseMatchInt(match: RegExpExecArray, index: number): number {
  const value = getMatchGroup(match, index);
  return parseInt(value, 10);
}

/**
 * Safely parse integer with commas from match group
 */
function parseMatchIntWithCommas(match: RegExpExecArray, index: number): number {
  const value = getMatchGroup(match, index);
  return parseNumberWithCommas(value);
}

/**
 * TokenCounterService - Extracts token usage from agent output logs
 */
export class TokenCounterService {
  private readonly logger = getLogger().child({ service: 'TokenCounterService' });

  /**
   * Count tokens from agent output log
   *
   * Attempts to parse token counts from the output using agent-specific patterns.
   * Falls back to estimation if parsing fails.
   *
   * @param agent - The agent type (claude, codex, gemini, aider, grok)
   * @param outputLog - The full output log from the agent execution
   * @returns TokenUsage with extracted or estimated counts
   */
  countTokens(agent: AgentType, outputLog: string): TokenUsage {
    this.logger.debug({ agent, outputLength: outputLog.length }, 'Counting tokens from output');

    if (!outputLog || outputLog.trim().length === 0) {
      this.logger.debug({ agent }, 'Empty output log, returning unavailable');
      return {
        tokensInput: 0,
        tokensOutput: 0,
        tokensTotal: 0,
        source: 'unavailable',
      };
    }

    let result: TokenUsage | null = null;

    switch (agent) {
      case 'claude':
        result = this.parseClaudeTokens(outputLog);
        break;
      case 'codex':
        result = this.parseCodexTokens(outputLog);
        break;
      case 'gemini':
        result = this.parseGeminiTokens(outputLog);
        break;
      case 'aider':
        result = this.parseAiderTokens(outputLog);
        break;
      case 'grok':
        result = this.parseGrokTokens(outputLog);
        break;
      default:
        this.logger.warn({ agent }, 'Unknown agent type, falling back to estimation');
    }

    if (result !== null) {
      this.logger.info(
        {
          agent,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          tokensTotal: result.tokensTotal,
          source: result.source,
        },
        'Token count extracted'
      );
      return result;
    }

    // Fallback to estimation
    this.logger.debug({ agent }, 'Pattern matching failed, using estimation');
    return this.estimateTokens(outputLog);
  }

  /**
   * Estimate tokens from text using character count heuristic
   *
   * Uses ~4 characters per token approximation.
   * Returns estimated input tokens (assuming output is the entire text).
   *
   * @param text - Text to estimate token count for
   * @returns TokenUsage with estimated counts
   */
  estimateTokens(text: string): TokenUsage {
    if (!text || text.trim().length === 0) {
      return {
        tokensInput: 0,
        tokensOutput: 0,
        tokensTotal: 0,
        source: 'unavailable',
      };
    }

    const charCount = text.length;
    const estimatedTotal = Math.ceil(charCount / CHARS_PER_TOKEN);

    // Without more context, assume a 60/40 input/output split as typical for agent tasks
    const tokensInput = Math.ceil(estimatedTotal * 0.6);
    const tokensOutput = estimatedTotal - tokensInput;

    this.logger.debug(
      {
        charCount,
        estimatedTotal,
        tokensInput,
        tokensOutput,
      },
      'Token count estimated from character count'
    );

    return {
      tokensInput,
      tokensOutput,
      tokensTotal: estimatedTotal,
      source: 'estimated',
    };
  }

  /**
   * Parse Claude API response for token counts
   * Format: {"usage":{"input_tokens":1500,"output_tokens":2500}}
   */
  private parseClaudeTokens(outputLog: string): TokenUsage | null {
    const patterns = TOKEN_PATTERNS.claude;

    // Try primary pattern (input_tokens first)
    let match = patterns.usage.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 1);
      const tokensOutput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    // Try alternative pattern (output_tokens first)
    match = patterns.usageAlt.exec(outputLog);
    if (match !== null) {
      const tokensOutput = parseMatchInt(match, 1);
      const tokensInput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    return null;
  }

  /**
   * Parse Codex output for token counts
   * Format: Tokens used: 3500 (input: 1000, output: 2500)
   * Or JSON: {"usage":{"prompt_tokens":1000,"completion_tokens":2500}}
   */
  private parseCodexTokens(outputLog: string): TokenUsage | null {
    const patterns = TOKEN_PATTERNS.codex;

    // Try text format first
    let match = patterns.text.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 2);
      const tokensOutput = parseMatchInt(match, 3);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    // Try JSON format (prompt_tokens first)
    match = patterns.json.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 1);
      const tokensOutput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    // Try JSON format (completion_tokens first)
    match = patterns.jsonAlt.exec(outputLog);
    if (match !== null) {
      const tokensOutput = parseMatchInt(match, 1);
      const tokensInput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    return null;
  }

  /**
   * Parse Gemini response for token counts
   * Format: {"promptTokenCount":1200,"candidatesTokenCount":800}
   */
  private parseGeminiTokens(outputLog: string): TokenUsage | null {
    const patterns = TOKEN_PATTERNS.gemini;

    // Try with total token count
    let match = patterns.usageTotal.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 1);
      const tokensOutput = parseMatchInt(match, 2);
      const tokensTotal = parseMatchInt(match, 3);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal,
        source: 'parsed',
      };
    }

    // Try primary pattern (promptTokenCount first)
    match = patterns.usage.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 1);
      const tokensOutput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    // Try alternative pattern (candidatesTokenCount first)
    match = patterns.usageAlt.exec(outputLog);
    if (match !== null) {
      const tokensOutput = parseMatchInt(match, 1);
      const tokensInput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    return null;
  }

  /**
   * Parse Aider cost summary for token counts
   * Format: Tokens: 4,532 sent, 1,234 received
   */
  private parseAiderTokens(outputLog: string): TokenUsage | null {
    const patterns = TOKEN_PATTERNS.aider;

    const match = patterns.tokens.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchIntWithCommas(match, 1);
      const tokensOutput = parseMatchIntWithCommas(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    return null;
  }

  /**
   * Parse Grok API response for token counts
   * Format: {"usage":{"prompt_tokens":1000,"completion_tokens":500}}
   */
  private parseGrokTokens(outputLog: string): TokenUsage | null {
    const patterns = TOKEN_PATTERNS.grok;

    // Try primary pattern (prompt_tokens first)
    let match = patterns.usage.exec(outputLog);
    if (match !== null) {
      const tokensInput = parseMatchInt(match, 1);
      const tokensOutput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    // Try alternative pattern (completion_tokens first)
    match = patterns.usageAlt.exec(outputLog);
    if (match !== null) {
      const tokensOutput = parseMatchInt(match, 1);
      const tokensInput = parseMatchInt(match, 2);
      return {
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        source: 'parsed',
      };
    }

    return null;
  }
}

/**
 * Singleton factory
 */
let tokenCounterInstance: TokenCounterService | null = null;

export function getTokenCounterService(): TokenCounterService {
  if (tokenCounterInstance === null) {
    tokenCounterInstance = new TokenCounterService();
  }
  return tokenCounterInstance;
}

/**
 * For testing - reset singleton
 */
export function resetTokenCounterService(): void {
  tokenCounterInstance = null;
}
