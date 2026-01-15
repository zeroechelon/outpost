/**
 * Job model and validation schemas
 */

import { z } from 'zod';
import type { AgentType, ContextLevel, JobStatus } from '../types/index.js';

export const AgentTypeSchema = z.enum(['claude', 'codex', 'gemini', 'aider', 'grok']);
export const ContextLevelSchema = z.enum(['minimal', 'standard', 'full']);
export const JobStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
]);

export const CreateJobSchema = z.object({
  agent: AgentTypeSchema,
  task: z
    .string()
    .min(10, 'Task must be at least 10 characters')
    .max(5000, 'Task must not exceed 5000 characters'),
  repo: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, 'Invalid repository format (owner/repo)')
    .optional(),
  branch: z.string().max(255, 'Branch name too long').optional(),
  context: ContextLevelSchema.default('standard'),
  timeoutSeconds: z.number().int().min(1).max(3600).default(600),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const JobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  agent: AgentTypeSchema,
  task: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  context: ContextLevelSchema,
  status: JobStatusSchema,
  workerId: z.string().nullable(),
  workspacePath: z.string().nullable(),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  timeoutSeconds: z.number(),
  exitCode: z.number().nullable(),
  errorMessage: z.string().nullable(),
  outputS3Key: z.string().nullable(),
});

export type JobModel = z.infer<typeof JobSchema>;

export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  agent: AgentTypeSchema.optional(),
  repo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  since: z.coerce.date().optional(),
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

/**
 * Convert DynamoDB item to Job model
 * Note: DynamoDB uses snake_case attribute names, model uses camelCase
 */
export function fromDynamoItem(item: Record<string, unknown>): JobModel {
  return JobSchema.parse({
    jobId: item['job_id'],
    tenantId: item['tenant_id'],
    agent: item['agent'],
    task: item['task'],
    repo: item['repo'] ?? null,
    branch: item['branch'] ?? null,
    context: item['context'],
    status: item['status'],
    workerId: item['worker_id'] ?? null,
    workspacePath: item['workspace_path'] ?? null,
    createdAt: item['created_at'],
    startedAt: item['started_at'] ?? null,
    completedAt: item['completed_at'] ?? null,
    timeoutSeconds: item['timeout_seconds'],
    exitCode: item['exit_code'] ?? null,
    errorMessage: item['error_message'] ?? null,
    outputS3Key: item['output_s3_key'] ?? null,
  });
}

/**
 * Convert Job model to DynamoDB item
 * Note: DynamoDB uses snake_case attribute names, model uses camelCase
 */
export function toDynamoItem(job: JobModel): Record<string, unknown> {
  return {
    job_id: job.jobId,
    tenant_id: job.tenantId,
    agent: job.agent,
    task: job.task,
    ...(job.repo !== null ? { repo: job.repo } : {}),
    ...(job.branch !== null ? { branch: job.branch } : {}),
    context: job.context,
    status: job.status,
    ...(job.workerId !== null ? { worker_id: job.workerId } : {}),
    ...(job.workspacePath !== null ? { workspace_path: job.workspacePath } : {}),
    created_at: job.createdAt.toISOString(),
    ...(job.startedAt !== null ? { started_at: job.startedAt.toISOString() } : {}),
    ...(job.completedAt !== null ? { completed_at: job.completedAt.toISOString() } : {}),
    timeout_seconds: job.timeoutSeconds,
    ...(job.exitCode !== null ? { exit_code: job.exitCode } : {}),
    ...(job.errorMessage !== null ? { error_message: job.errorMessage } : {}),
    ...(job.outputS3Key !== null ? { output_s3_key: job.outputS3Key } : {}),
  };
}
