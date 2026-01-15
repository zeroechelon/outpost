/**
 * Job type definitions for Outpost task execution
 */

import type { AgentType } from './agent.js';

export type JobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

export type ContextLevel = 'minimal' | 'standard' | 'full';

export interface Job {
  readonly jobId: string;
  readonly tenantId: string;
  readonly agent: AgentType;
  readonly task: string;
  readonly repo: string | null;
  readonly branch: string | null;
  readonly context: ContextLevel;
  readonly status: JobStatus;
  readonly workerId: string | null;
  readonly workspacePath: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly timeoutSeconds: number;
  readonly exitCode: number | null;
  readonly errorMessage: string | null;
  readonly outputS3Key: string | null;
}

export interface CreateJobRequest {
  readonly agent: AgentType;
  readonly task: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly context?: ContextLevel;
  readonly timeoutSeconds?: number;
}

export interface JobOutput {
  readonly jobId: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly outputFiles: ReadonlyArray<string>;
}

export interface JobProgressEvent {
  readonly jobId: string;
  readonly timestamp: Date;
  readonly type: 'status_change' | 'output' | 'progress';
  readonly data: Record<string, unknown>;
}
