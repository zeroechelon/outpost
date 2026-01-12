/**
 * Dispatch model and validation schemas
 *
 * Defines Zod schemas for dispatch request/response validation
 */

import { z } from 'zod';
import type { DispatchStatus } from '../repositories/dispatch.repository.js';

/**
 * Supported agent types
 */
export const AgentTypeSchema = z.enum(['claude', 'codex', 'gemini', 'aider', 'grok']);

/**
 * Context level for task execution
 */
export const ContextLevelSchema = z.enum(['minimal', 'standard', 'full']);

/**
 * Workspace mode
 */
export const WorkspaceModeSchema = z.enum(['ephemeral', 'persistent']);

/**
 * Schema for creating a new dispatch
 */
export const CreateDispatchSchema = z.object({
  agent: AgentTypeSchema,
  task: z
    .string()
    .min(10, 'Task must be at least 10 characters')
    .max(50000, 'Task must not exceed 50000 characters'),
  repo: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, 'Invalid repository format (owner/repo)')
    .optional(),
  branch: z.string().max(255, 'Branch name too long').optional(),
  context: ContextLevelSchema.default('standard'),
  workspaceMode: WorkspaceModeSchema.default('ephemeral'),
  timeoutSeconds: z.number().int().min(30).max(86400).default(600),
  additionalSecrets: z.array(z.string()).optional(),
});

export type CreateDispatchInput = z.infer<typeof CreateDispatchSchema>;

/**
 * Schema for dispatch ID path parameter
 */
export const GetDispatchParamsSchema = z.object({
  dispatchId: z.string().min(1, 'Dispatch ID required'),
});

/**
 * Schema for get dispatch query parameters (log streaming)
 */
export const GetDispatchQuerySchema = z.object({
  logOffset: z.string().optional(),
  logLimit: z.coerce.number().int().min(1).max(1000).default(100),
  skipLogs: z.coerce.boolean().default(false),
});

export type GetDispatchQuery = z.infer<typeof GetDispatchQuerySchema>;

/**
 * Dispatch status values for API responses
 */
export const DispatchStatusSchema = z.enum([
  'pending',
  'provisioning',
  'running',
  'completing',
  'success',
  'failed',
  'timeout',
  'cancelled',
]);

/**
 * Log entry schema
 */
export const LogEntrySchema = z.object({
  timestamp: z.coerce.date(),
  message: z.string(),
  level: z.enum(['info', 'warn', 'error', 'debug']),
});

/**
 * Dispatch response schema for API
 */
export const DispatchResponseSchema = z.object({
  dispatchId: z.string(),
  status: DispatchStatusSchema,
  agent: AgentTypeSchema,
  modelId: z.string(),
  task: z.string(),
  progress: z.number().min(0).max(100),
  logs: z.array(LogEntrySchema).optional(),
  logOffset: z.string().optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional(),
  taskArn: z.string().optional(),
  exitCode: z.number().optional(),
  errorMessage: z.string().optional(),
  estimatedStartTime: z.coerce.date().optional(),
});

export type DispatchResponse = z.infer<typeof DispatchResponseSchema>;

/**
 * Cancel dispatch request body schema
 */
export const CancelDispatchSchema = z.object({
  reason: z.string().max(500).default('Cancelled by user'),
});

export type CancelDispatchInput = z.infer<typeof CancelDispatchSchema>;
