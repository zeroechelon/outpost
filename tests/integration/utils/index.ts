/**
 * Integration test utilities - barrel export
 */

// API Client
export {
  ApiClient,
  createApiClient,
  isRealEndpointMode,
  skipIfMockMode,
  skipIfRealMode,
  type ApiClientConfig,
  type DispatchPayload,
  type DispatchCreatedResponse,
  type DispatchStatusResponse,
  type CancelDispatchResponse,
  type ApiErrorResponse,
  type HttpResponse,
  type LogEntry,
} from './api-client.js';

// Test Fixtures
export {
  // Valid payloads
  MINIMAL_DISPATCH_PAYLOAD,
  FULL_DISPATCH_PAYLOAD,
  REPO_DISPATCH_PAYLOAD,
  SHORT_TIMEOUT_PAYLOAD,
  LONG_RUNNING_PAYLOAD,
  AGENT_PAYLOADS,
  // Invalid payloads
  MISSING_AGENT_PAYLOAD,
  MISSING_TASK_PAYLOAD,
  SHORT_TASK_PAYLOAD,
  INVALID_AGENT_PAYLOAD,
  INVALID_REPO_PAYLOAD,
  INVALID_TIMEOUT_LOW_PAYLOAD,
  INVALID_TIMEOUT_HIGH_PAYLOAD,
  // Mock response factories
  createMockDispatchCreatedResponse,
  createMockDispatchStatusResponse,
  createMockErrorResponse,
  // Common error responses
  VALIDATION_ERROR_RESPONSE,
  UNAUTHORIZED_ERROR_RESPONSE,
  NOT_FOUND_ERROR_RESPONSE,
  RATE_LIMIT_ERROR_RESPONSE,
  INTERNAL_ERROR_RESPONSE,
  // Data generators
  generateDispatchId,
  generateRequestId,
  generateTaskOfLength,
  // Status sequences
  SUCCESS_STATUS_SEQUENCE,
  FAILED_STATUS_SEQUENCE,
  TIMEOUT_STATUS_SEQUENCE,
  createStatusSequenceGenerator,
} from './fixtures.js';

// Cleanup utilities
export {
  DispatchCleanupManager,
  waitForTerminalState,
  createCleanupCallback,
  withRetry,
  withTimeout,
  assertDispatchCompletes,
} from './cleanup.js';
