/**
 * Dispatcher service - handles job submission and routing
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger.js';
import { ValidationError, RateLimitError } from '../utils/errors.js';
import { JobRepository } from '../repositories/job.repository.js';
import { TenantRepository } from '../repositories/tenant.repository.js';
import type { JobModel, CreateJobInput } from '../models/job.model.js';
import type { AgentType } from '../types/agent.js';

export interface DispatchResult {
  job: JobModel;
  queued: boolean;
}

export class DispatcherService {
  private readonly logger = getLogger().child({ service: 'DispatcherService' });
  private readonly jobRepository: JobRepository;
  private readonly tenantRepository: TenantRepository;

  constructor() {
    this.jobRepository = new JobRepository();
    this.tenantRepository = new TenantRepository();
  }

  async dispatch(tenantId: string, input: CreateJobInput): Promise<DispatchResult> {
    this.logger.info({ tenantId, agent: input.agent }, 'Dispatching job');

    // Validate tenant limits
    const tenant = await this.tenantRepository.getById(tenantId);

    // Check if daily limit is exceeded
    const today = new Date().toISOString().split('T')[0];
    if (today === undefined) {
      throw new ValidationError('Failed to format date');
    }

    if (tenant.currentUsage.lastResetDate !== today) {
      // Reset daily counters if it's a new day
      await this.tenantRepository.resetDailyUsage(tenantId);
    } else if (tenant.currentUsage.jobsToday >= tenant.usageLimits.maxJobsPerDay) {
      throw new RateLimitError('Daily job limit exceeded', {
        limit: tenant.usageLimits.maxJobsPerDay,
        current: tenant.currentUsage.jobsToday,
      });
    }

    // Check concurrent job limit
    if (tenant.currentUsage.concurrentJobs >= tenant.usageLimits.maxConcurrentJobs) {
      throw new RateLimitError('Concurrent job limit exceeded', {
        limit: tenant.usageLimits.maxConcurrentJobs,
        current: tenant.currentUsage.concurrentJobs,
      });
    }

    // Validate timeout against tier limits
    const effectiveTimeout = Math.min(input.timeoutSeconds, tenant.usageLimits.maxJobTimeoutSeconds);

    // Create job
    const job = await this.jobRepository.create(tenantId, {
      ...input,
      timeoutSeconds: effectiveTimeout,
    });

    // Increment concurrent job counter
    await this.tenantRepository.incrementConcurrentJobs(tenantId);

    this.logger.info(
      { jobId: job.jobId, tenantId, agent: input.agent },
      'Job dispatched successfully'
    );

    return { job, queued: true };
  }

  async cancelJob(tenantId: string, jobId: string): Promise<JobModel> {
    this.logger.info({ tenantId, jobId }, 'Cancelling job');

    const job = await this.jobRepository.getByIdForTenant(jobId, tenantId);

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new ValidationError('Job cannot be cancelled in current state', {
        currentStatus: job.status,
      });
    }

    const updatedJob = await this.jobRepository.updateStatus(jobId, 'CANCELLED', {
      completedAt: new Date(),
    });

    // Decrement concurrent job counter
    await this.tenantRepository.decrementConcurrentJobs(tenantId);

    this.logger.info({ jobId }, 'Job cancelled');

    return updatedJob;
  }

  async getJob(tenantId: string, jobId: string): Promise<JobModel> {
    return this.jobRepository.getByIdForTenant(jobId, tenantId);
  }

  async listJobs(
    tenantId: string,
    query: { status?: string | undefined; agent?: AgentType | undefined; cursor?: string | undefined; limit?: number | undefined }
  ): Promise<{ items: JobModel[]; nextCursor?: string | undefined }> {
    return this.jobRepository.listByTenant(tenantId, {
      status: query.status as JobModel['status'] | undefined,
      agent: query.agent,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
  }
}
