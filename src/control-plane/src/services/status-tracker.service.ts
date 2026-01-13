/**
 * Status tracker service - monitors job execution status
 */

import { getLogger } from '../utils/logger.js';
import { JobRepository } from '../repositories/job.repository.js';
import { TenantRepository } from '../repositories/tenant.repository.js';
import type { JobModel } from '../models/job.model.js';
import type { JobStatus } from '../types/job.js';

export interface JobStatusUpdate {
  jobId: string;
  status: JobStatus;
  workerId?: string;
  exitCode?: number;
  errorMessage?: string;
  outputS3Key?: string;
}

export class StatusTrackerService {
  private readonly logger = getLogger().child({ service: 'StatusTrackerService' });
  private readonly jobRepository: JobRepository;
  private readonly tenantRepository: TenantRepository;

  constructor() {
    this.jobRepository = new JobRepository();
    this.tenantRepository = new TenantRepository();
  }

  async updateStatus(update: JobStatusUpdate): Promise<JobModel> {
    this.logger.info({ jobId: update.jobId, status: update.status }, 'Updating job status');

    const job = await this.jobRepository.getById(update.jobId);

    const updates: Parameters<JobRepository['updateStatus']>[2] = {};

    if (update.status === 'RUNNING' && job.status === 'PENDING') {
      updates.startedAt = new Date();
      if (update.workerId !== undefined) {
        updates.workerId = update.workerId;
      }
    }

    if (
      update.status === 'COMPLETED' ||
      update.status === 'FAILED' ||
      update.status === 'TIMEOUT' ||
      update.status === 'CANCELLED'
    ) {
      updates.completedAt = new Date();

      if (update.exitCode !== undefined) {
        updates.exitCode = update.exitCode;
      }

      if (update.errorMessage !== undefined) {
        updates.errorMessage = update.errorMessage;
      }

      if (update.outputS3Key !== undefined) {
        updates.outputS3Key = update.outputS3Key;
      }

      // Decrement concurrent jobs on completion
      await this.tenantRepository.decrementConcurrentJobs(job.tenantId);
    }

    const updatedJob = await this.jobRepository.updateStatus(update.jobId, update.status, updates);

    this.logger.info(
      { jobId: update.jobId, previousStatus: job.status, newStatus: update.status },
      'Job status updated'
    );

    return updatedJob;
  }

  async getJobStatus(jobId: string): Promise<{
    status: JobStatus;
    progress?: number | undefined;
    startedAt?: Date | undefined;
    completedAt?: Date | undefined;
  }> {
    const job = await this.jobRepository.getById(jobId);

    return {
      status: job.status,
      startedAt: job.startedAt ?? undefined,
      completedAt: job.completedAt ?? undefined,
    };
  }

  async checkForTimeouts(): Promise<JobModel[]> {
    this.logger.debug('Checking for timed out jobs');

    // Get running jobs
    const runningJobs = await this.jobRepository.listByTenant('*', {
      status: 'RUNNING',
      limit: 100,
    });

    const timedOutJobs: JobModel[] = [];
    const now = Date.now();

    for (const job of runningJobs.items) {
      if (job.startedAt !== null) {
        const elapsedSeconds = (now - job.startedAt.getTime()) / 1000;

        if (elapsedSeconds > job.timeoutSeconds) {
          this.logger.warn({ jobId: job.jobId, elapsedSeconds }, 'Job timed out');

          const updatedJob = await this.updateStatus({
            jobId: job.jobId,
            status: 'TIMEOUT',
            errorMessage: `Job exceeded timeout of ${job.timeoutSeconds} seconds`,
          });

          timedOutJobs.push(updatedJob);
        }
      }
    }

    return timedOutJobs;
  }

  async getRunningJobsCount(): Promise<number> {
    const result = await this.jobRepository.listByTenant('*', {
      status: 'RUNNING',
      limit: 1,
    });

    // This is a simplified count - in production would use a counter or scan
    return result.items.length;
  }
}
