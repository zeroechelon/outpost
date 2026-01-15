/**
 * Model definitions and Zod schemas for Outpost V2 Control Plane
 */

// Job model exports
export {
  AgentTypeSchema,
  ContextLevelSchema,
  JobStatusSchema,
  CreateJobSchema,
  JobSchema,
  ListJobsQuerySchema,
  type CreateJobInput,
  type JobModel,
  type ListJobsQuery,
  fromDynamoItem as jobFromDynamoItem,
  toDynamoItem as jobToDynamoItem,
} from './job.model.js';

// Tenant model exports
export {
  TenantStatusSchema,
  TenantTierSchema,
  CreateTenantSchema,
  TenantSchema,
  DEFAULT_USAGE_LIMITS,
  type TenantStatus,
  type TenantTier,
  type CreateTenantInput,
  type TenantModel,
  fromDynamoItem as tenantFromDynamoItem,
  toDynamoItem as tenantToDynamoItem,
} from './tenant.model.js';

// API Key model exports
export {
  ApiKeyStatusSchema,
  CreateApiKeySchema,
  ApiKeySchema,
  API_KEY_SCOPES,
  type ApiKeyStatus,
  type CreateApiKeyInput,
  type ApiKeyModel,
  type ApiKeyScope,
  fromDynamoItem as apiKeyFromDynamoItem,
  toDynamoItem as apiKeyToDynamoItem,
} from './api-key.model.js';
