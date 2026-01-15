/**
 * Workspace API routes for control plane
 *
 * Provides REST endpoints for workspace management:
 * - GET /workspaces - List user workspaces
 * - GET /workspaces/:id - Get workspace details
 * - DELETE /workspaces/:id - Delete workspace
 */

import { Router } from 'express';
import { WorkspaceHandler } from '../handlers/workspace.handler.js';
import { authMiddleware, requireScope } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  ListWorkspacesQuerySchema,
  WorkspaceParamsSchema,
} from '../../models/workspace.model.js';
import type { AuthenticatedRequest } from '../../types/api.js';

export const workspaceRouter = Router();

// All workspace routes require authentication
workspaceRouter.use(authMiddleware);

/**
 * GET /workspaces
 * List all workspaces for the authenticated user
 */
workspaceRouter.get(
  '/',
  requireScope('list'),
  validateRequest({ query: ListWorkspacesQuerySchema }),
  (req, res, next) => {
    void WorkspaceHandler.list(req as AuthenticatedRequest, res, next);
  }
);

/**
 * GET /workspaces/:workspaceId
 * Get details for a specific workspace
 */
workspaceRouter.get(
  '/:workspaceId',
  requireScope('status'),
  validateRequest({ params: WorkspaceParamsSchema }),
  (req, res, next) => {
    void WorkspaceHandler.get(req as AuthenticatedRequest, res, next);
  }
);

/**
 * DELETE /workspaces/:workspaceId
 * Delete a workspace and its associated storage
 */
workspaceRouter.delete(
  '/:workspaceId',
  requireScope('delete'),
  validateRequest({ params: WorkspaceParamsSchema }),
  (req, res, next) => {
    void WorkspaceHandler.delete(req as AuthenticatedRequest, res, next);
  }
);
