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
 */
export function fromDynamoItem(item: Record<string, unknown>): JobModel {
  return JobSchema.parse({
    jobId: item['jobId'],
    tenantId: item['tenantId'],
    agent: item['agent'],
    task: item['task'],
    repo: item['repo'] ?? null,
    branch: item['branch'] ?? null,
    context: item['context'],
    status: item['status'],
    workerId: item['workerId'] ?? null,
    workspacePath: item['workspacePath'] ?? null,
    createdAt: item['createdAt'],
    startedAt: item['startedAt'] ?? null,
    completedAt: item['completedAt'] ?? null,
    timeoutSeconds: item['timeoutSeconds'],
    exitCode: item['exitCode'] ?? null,
    errorMessage: item['errorMessage'] ?? null,
    outputS3Key: item['outputS3Key'] ?? null,
  });
}

/**
 * Convert Job model to DynamoDB item
 */
export function toDynamoItem(job: JobModel): Record<string, unknown> {
  return {
    jobId: job.jobId,
    tenantId: job.tenantId,
    agent: job.agent,
    task: job.task,
    ...(job.repo !== null ? { repo: job.repo } : {}),
    ...(job.branch !== null ? { branch: job.branch } : {}),
    context: job.context,
    status: job.status,
    ...(job.workerId !== null ? { workerId: job.workerId } : {}),
    ...(job.workspacePath !== null ? { workspacePath: job.workspacePath } : {}),
    createdAt: job.createdAt.toISOString(),
    ...(job.startedAt !== null ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.completedAt !== null ? { completedAt: job.completedAt.toISOString() } : {}),
    timeoutSeconds: job.timeoutSeconds,
    ...(job.exitCode !== null ? { exitCode: job.exitCode } : {}),
    ...(job.errorMessage !== null ? { errorMessage: job.errorMessage } : {}),
    ...(job.outputS3Key !== null ? { outputS3Key: job.outputS3Key } : {}),
  };
}
