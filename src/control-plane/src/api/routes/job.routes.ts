/**
 * Job API routes
 */

import { Router } from 'express';
import { JobHandler } from '../handlers/job.handler.js';
import { authMiddleware, requireScope } from '../middleware/auth.middleware.js';
import type { AuthenticatedRequest } from '../../types/api.js';

export const jobRouter = Router();

// All job routes require authentication
jobRouter.use(authMiddleware);

// POST /jobs - Dispatch a new job
jobRouter.post(
  '/',
  requireScope('dispatch'),
  (req, res, next) => {
    void JobHandler.dispatch(req as AuthenticatedRequest, res, next);
  }
);

// GET /jobs - List jobs
jobRouter.get(
  '/',
  requireScope('list'),
  (req, res, next) => {
    void JobHandler.list(req as AuthenticatedRequest, res, next);
  }
);

// GET /jobs/:jobId - Get job details
jobRouter.get(
  '/:jobId',
  requireScope('status'),
  (req, res, next) => {
    void JobHandler.get(req as AuthenticatedRequest, res, next);
  }
);

// POST /jobs/:jobId/cancel - Cancel a job
jobRouter.post(
  '/:jobId/cancel',
  requireScope('cancel'),
  (req, res, next) => {
    void JobHandler.cancel(req as AuthenticatedRequest, res, next);
  }
);
