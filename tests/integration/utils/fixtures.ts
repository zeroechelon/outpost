/**
 * Test fixtures for integration tests
 *
 * Provides pre-defined payloads, mock responses, and test data
 * for dispatch flow integration testing.
 */

import type { DispatchPayload, DispatchCreatedResponse, DispatchStatusResponse, ApiErrorResponse } from './api-client.js';

// ============================================================================
// Valid Dispatch Payloads
// ============================================================================

/**
 * Minimal valid dispatch payload (Claude agent)
 */
export const MINIMAL_DISPATCH_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Echo test task: please respond with "Hello World"',
};

/**
 * Full dispatch payload with all optional fields
 */
export const FULL_DISPATCH_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Test task with all options specified for integration testing purposes.',
  repo: 'rgsuarez/outpost',
  branch: 'main',
  context: 'standard',
  workspaceMode: 'ephemeral',
  timeoutSeconds: 300,
};

/**
 * Dispatch payload with repository context
 */
export const REPO_DISPATCH_PAYLOAD: DispatchPayload = {
  agent: 'codex',
  task: 'List files in the repository root directory and describe the project structure.',
  repo: 'rgsuarez/outpost',
  branch: 'main',
  context: 'full',
};

/**
 * Dispatch payload with minimal timeout
 */
export const SHORT_TIMEOUT_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Simple echo test that should complete very quickly.',
  timeoutSeconds: 30,
};

/**
 * Dispatch payload expected to take longer
 */
export const LONG_RUNNING_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Perform a comprehensive analysis of the codebase, including file structure, dependencies, and code quality metrics.',
  context: 'full',
  timeoutSeconds: 600,
};

/**
 * All supported agent payloads for parameterized testing
 */
export const AGENT_PAYLOADS: Record<string, DispatchPayload> = {
  claude: {
    agent: 'claude',
    task: 'Claude agent integration test - respond with agent name.',
  },
  codex: {
    agent: 'codex',
    task: 'Codex agent integration test - respond with agent name.',
  },
  gemini: {
    agent: 'gemini',
    task: 'Gemini agent integration test - respond with agent name.',
  },
  aider: {
    agent: 'aider',
    task: 'Aider agent integration test - respond with agent name.',
  },
  grok: {
    agent: 'grok',
    task: 'Grok agent integration test - respond with agent name.',
  },
};

// ============================================================================
// Invalid Dispatch Payloads (for error testing)
// ============================================================================

/**
 * Missing required agent field
 */
export const MISSING_AGENT_PAYLOAD = {
  task: 'Valid task but missing agent field',
} as unknown as DispatchPayload;

/**
 * Missing required task field
 */
export const MISSING_TASK_PAYLOAD = {
  agent: 'claude',
} as unknown as DispatchPayload;

/**
 * Task too short
 */
export const SHORT_TASK_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'short', // Less than 10 characters
};

/**
 * Invalid agent type
 */
export const INVALID_AGENT_PAYLOAD = {
  agent: 'invalid-agent',
  task: 'Valid task but invalid agent type',
} as unknown as DispatchPayload;

/**
 * Invalid repository format
 */
export const INVALID_REPO_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Valid task but invalid repo format',
  repo: 'not-a-valid-repo-format',
};

/**
 * Invalid timeout (below minimum)
 */
export const INVALID_TIMEOUT_LOW_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Valid task but timeout below minimum',
  timeoutSeconds: 10, // Minimum is 30
};

/**
 * Invalid timeout (above maximum)
 */
export const INVALID_TIMEOUT_HIGH_PAYLOAD: DispatchPayload = {
  agent: 'claude',
  task: 'Valid task but timeout above maximum',
  timeoutSeconds: 100000, // Maximum is 86400
};

// ============================================================================
// Mock Response Factories
// ============================================================================

/**
 * Create mock dispatch created response
 */
export function createMockDispatchCreatedResponse(
  overrides: Partial<DispatchCreatedResponse['data']> = {}
): DispatchCreatedResponse {
  return {
    success: true,
    data: {
      dispatchId: `dispatch-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      status: 'pending',
      agent: 'claude',
      modelId: 'claude-opus-4-5-20251101',
      estimatedStartTime: new Date(Date.now() + 30000).toISOString(),
      ...overrides,
    },
    meta: {
      requestId: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Create mock dispatch status response
 */
export function createMockDispatchStatusResponse(
  status: DispatchStatusResponse['data']['status'],
  overrides: Partial<DispatchStatusResponse['data']> = {}
): DispatchStatusResponse {
  const baseData: DispatchStatusResponse['data'] = {
    dispatchId: `dispatch-${Date.now()}`,
    status,
    agent: 'claude',
    modelId: 'claude-opus-4-5-20251101',
    task: 'Test task',
    progress: 0,
  };

  // Set progress based on status
  switch (status) {
    case 'pending':
      baseData.progress = 0;
      break;
    case 'provisioning':
      baseData.progress = 10;
      break;
    case 'running':
      baseData.progress = 50;
      break;
    case 'completing':
      baseData.progress = 90;
      break;
    case 'success':
    case 'failed':
    case 'timeout':
    case 'cancelled':
      baseData.progress = 100;
      break;
  }

  // Add timestamps for terminal states
  if (['success', 'failed', 'timeout', 'cancelled'].includes(status)) {
    baseData.startedAt = new Date(Date.now() - 60000).toISOString();
    baseData.endedAt = new Date().toISOString();
  } else if (status !== 'pending') {
    baseData.startedAt = new Date(Date.now() - 30000).toISOString();
  }

  return {
    success: true,
    data: {
      ...baseData,
      ...overrides,
    },
    meta: {
      requestId: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Create mock API error response
 */
export function createMockErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiErrorResponse {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      requestId: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
    },
  };

  if (details !== undefined) {
    response.error.details = details;
  }

  return response;
}

// ============================================================================
// Common Error Responses
// ============================================================================

export const VALIDATION_ERROR_RESPONSE = createMockErrorResponse(
  'VALIDATION_ERROR',
  'Request validation failed',
  { field: 'task', issue: 'must be at least 10 characters' }
);

export const UNAUTHORIZED_ERROR_RESPONSE = createMockErrorResponse(
  'UNAUTHORIZED',
  'Invalid or missing API key'
);

export const NOT_FOUND_ERROR_RESPONSE = createMockErrorResponse(
  'NOT_FOUND',
  'Dispatch not found or access denied'
);

export const RATE_LIMIT_ERROR_RESPONSE = createMockErrorResponse(
  'RATE_LIMIT_EXCEEDED',
  'Too many requests, please slow down',
  { retryAfter: 60 }
);

export const INTERNAL_ERROR_RESPONSE = createMockErrorResponse(
  'INTERNAL_ERROR',
  'An unexpected error occurred'
);

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate unique dispatch ID
 */
export function generateDispatchId(): string {
  return `dispatch-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generate a task string of specified length
 */
export function generateTaskOfLength(length: number): string {
  const base = 'Integration test task with padding: ';
  if (length <= base.length) {
    return base.substring(0, length);
  }
  return base + 'x'.repeat(length - base.length);
}

// ============================================================================
// Dispatch Status Sequences (for mock polling tests)
// ============================================================================

/**
 * Status progression for successful dispatch
 */
export const SUCCESS_STATUS_SEQUENCE: Array<DispatchStatusResponse['data']['status']> = [
  'pending',
  'provisioning',
  'running',
  'completing',
  'success',
];

/**
 * Status progression for failed dispatch
 */
export const FAILED_STATUS_SEQUENCE: Array<DispatchStatusResponse['data']['status']> = [
  'pending',
  'provisioning',
  'running',
  'failed',
];

/**
 * Status progression for timed out dispatch
 */
export const TIMEOUT_STATUS_SEQUENCE: Array<DispatchStatusResponse['data']['status']> = [
  'pending',
  'provisioning',
  'running',
  'timeout',
];

/**
 * Create mock status sequence generator
 */
export function createStatusSequenceGenerator(
  dispatchId: string,
  sequence: Array<DispatchStatusResponse['data']['status']>
): () => DispatchStatusResponse {
  let index = 0;

  return () => {
    const status = sequence[Math.min(index, sequence.length - 1)];
    if (status === undefined) {
      throw new Error('Status sequence exhausted');
    }
    index++;
    return createMockDispatchStatusResponse(status, { dispatchId });
  };
}
