/**
 * Service layer exports
 */

export { DispatcherService } from './dispatcher.service.js';
export { StatusTrackerService } from './status-tracker.service.js';
export { PoolManagerService } from './pool-manager.service.js';
export { WorkspaceHandlerService } from './workspace-handler.service.js';
export {
  selectTaskDefinition,
  validateTaskSelection,
  getValidModelsForAgent,
  getSupportedAgents,
  isValidModelForAgent,
  type TaskSelectionResult,
  type ModelTier,
} from './task-selector.js';
export {
  SecretInjectorService,
  getSecretInjectorService,
  resetSecretInjectorService,
  AGENT_SECRET_MAPPINGS,
  SECRET_PATH_PREFIX,
  USER_SECRET_PATH_PREFIX,
  buildSecretArn,
  // Tier 4 validation constants
  SECRET_KEY_PATTERN,
  MAX_SECRET_KEY_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  PROTECTED_SECRET_KEYS,
  type ContainerSecret,
  type SecretInjectionResult,
  type GitCredentialConfig,
  type AdditionalSecrets,
  type SecretInjectionAuditLog,
} from './secret-injector.js';
export {
  TaskLauncherService,
  getTaskLauncherService,
  resetTaskLauncherService,
  type TaskLaunchRequest,
  type TaskLaunchResult,
} from './task-launcher.js';
export {
  DispatcherOrchestrator,
  getDispatcherOrchestrator,
  resetDispatcherOrchestrator,
  generateUlid,
  type DispatchRequest,
  type DispatchResult,
  type EfsMountConfig,
} from './dispatcher.js';
export {
  WarmPoolManager,
  getWarmPoolManager,
  resetWarmPoolManager,
  type PooledTask,
  type PoolMetrics,
  type AggregatePoolMetrics,
  type PoolConfig,
} from './pool-manager.js';
export {
  DispatchStatusTracker,
  getDispatchStatusTracker,
  resetDispatchStatusTracker,
  type DispatchStatus,
  type DispatchStatusValue,
  type LogEntry,
  type GetStatusOptions,
} from './status-tracker.js';
export {
  EphemeralWorkspaceHandler,
  getEphemeralWorkspaceHandler,
  resetEphemeralWorkspaceHandler,
  type WorkspaceConfig,
  type WorkspaceResult,
  type ArtifactUploadResult,
  type ArtifactMetadata,
} from './workspace-handler.js';
export {
  ArtifactManagerService,
  getArtifactManagerService,
  resetArtifactManagerService,
  ARTIFACT_FILENAMES,
  ARTIFACT_CONTENT_TYPES,
  type DispatchArtifactMetadata,
  type DispatchPresignedUrlResult,
  type DispatchArtifactUploadResult,
  type DispatchArtifactListResult,
  type DispatchRetentionPolicyResult,
  type ArtifactManagerConfig,
} from './artifact-manager.js';
export {
  PersistentWorkspaceService,
  getPersistentWorkspaceService,
  resetPersistentWorkspaceService,
  type PersistentWorkspace,
  type WorkspaceUsageStats,
  type PersistentEfsMountConfig,
  type SizeLimitCheckResult,
  type CreateWorkspaceOptions,
  type PersistentWorkspaceConfig,
} from './persistent-workspace.js';
export {
  GitService,
  getGitService,
  resetGitService,
  type GitCloneOptions,
  type GitPushOptions,
  type GitOperationResult,
  type GitStatus,
} from './git-service.js';
export {
  PoolAutoscaler,
  getPoolAutoscaler,
  resetPoolAutoscaler,
  type AutoscalerConfig,
  type ScalingDecision,
  type DemandMetrics,
  type ScalingHistoryEntry,
} from './pool-autoscaler.js';
export {
  PoolLifecycleService,
  getPoolLifecycleService,
  resetPoolLifecycleService,
  type PoolLifecycleConfig,
  type TaskHealthStatus,
  type PoolHealthStatus,
} from './pool-lifecycle.js';
export {
  LogStreamerService,
  getLogStreamerService,
  resetLogStreamerService,
  type LogEntry as StreamLogEntry,
  type LogStreamOptions,
  type LogStreamResult,
  type StreamSubscription,
  type LogStreamerConfig,
} from './log-streamer.js';
export {
  AuditLoggerService,
  getAuditLoggerService,
  resetAuditLoggerService,
  DEFAULT_TTL_DAYS,
  DEFAULT_EXPORT_PREFIX,
  SENSITIVE_FIELDS,
  type AuditEvent,
  type AuditEventInput,
  type AuditEventType,
  type AuditOutcome,
  type AuditQueryOptions,
  type AuditQueryResult,
  type AuditExportResult,
  type AuditLoggerConfig,
} from './audit-logger.js';
