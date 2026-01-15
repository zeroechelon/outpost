/**
 * Dispatch API routes for control plane
 *
 * Provides REST endpoints for dispatch operations:
 * - POST /dispatch - Create new dispatch
 * - GET /dispatch/:id - Get dispatch status
 * - DELETE /dispatch/:id - Cancel dispatch
 */

import { Router } from 'express';
import { DispatchHandler } from '../handlers/dispatch.handler.js';
import { authMiddleware, requireScope } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import { CreateDispatchSchema, GetDispatchParamsSchema, GetDispatchQuerySchema } from '../../models/dispatch.model.js';
import type { AuthenticatedRequest } from '../../types/api.js';

export const dispatchRouter = Router();

// All dispatch routes require authentication
dispatchRouter.use(authMiddleware);

/**
 * POST /dispatch
 * Create a new dispatch to execute a task on an agent
 */
dispatchRouter.post(
  '/',
  requireScope('dispatch'),
  validateRequest({ body: CreateDispatchSchema }),
  (req, res, next) => {
    void DispatchHandler.create(req as AuthenticatedRequest, res, next);
  }
);

/**
 * GET /dispatch/:dispatchId
 * Get dispatch status with optional log streaming
 */
dispatchRouter.get(
  '/:dispatchId',
  requireScope('status'),
  validateRequest({
    params: GetDispatchParamsSchema,
    query: GetDispatchQuerySchema,
  }),
  (req, res, next) => {
    void DispatchHandler.getStatus(req as AuthenticatedRequest, res, next);
  }
);

/**
 * DELETE /dispatch/:dispatchId
 * Cancel an active dispatch
 */
dispatchRouter.delete(
  '/:dispatchId',
  requireScope('cancel'),
  validateRequest({ params: GetDispatchParamsSchema }),
  (req, res, next) => {
    void DispatchHandler.cancel(req as AuthenticatedRequest, res, next);
  }
);
