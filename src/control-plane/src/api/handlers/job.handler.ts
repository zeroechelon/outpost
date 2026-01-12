/**
 * Job API handlers
 */

import type { Response, NextFunction } from 'express';
import { DispatcherService } from '../../services/dispatcher.service.js';
import { CreateJobSchema, ListJobsQuerySchema } from '../../models/job.model.js';
import type { AuthenticatedRequest, ApiResponse, ListResponse } from '../../types/api.js';
import type { JobModel } from '../../models/job.model.js';

const dispatcherService = new DispatcherService();

export class JobHandler {
  static async dispatch(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const input = CreateJobSchema.parse(req.body);
      const result = await dispatcherService.dispatch(req.tenantId, input);

      const response: ApiResponse<{ job: JobModel; queued: boolean }> = {
        success: true,
        data: {
          job: result.job,
          queued: result.queued,
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  static async get(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const jobId = req.params['jobId'];
      if (jobId === undefined) {
        throw new Error('Job ID required');
      }

      const job = await dispatcherService.getJob(req.tenantId, jobId);

      const response: ApiResponse<{ job: JobModel }> = {
        success: true,
        data: { job },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  static async list(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const query = ListJobsQuerySchema.parse(req.query);
      const result = await dispatcherService.listJobs(req.tenantId, query);

      const response: ApiResponse<ListResponse<JobModel>> = {
        success: true,
        data: {
          items: result.items,
          nextCursor: result.nextCursor,
          hasMore: result.nextCursor !== undefined,
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
          pagination: {
            cursor: result.nextCursor,
            hasMore: result.nextCursor !== undefined,
            limit: query.limit,
          },
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  static async cancel(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const jobId = req.params['jobId'];
      if (jobId === undefined) {
        throw new Error('Job ID required');
      }

      const job = await dispatcherService.cancelJob(req.tenantId, jobId);

      const response: ApiResponse<{ job: JobModel }> = {
        success: true,
        data: { job },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}
