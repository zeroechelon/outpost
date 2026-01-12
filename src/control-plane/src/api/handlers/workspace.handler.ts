/**
 * Workspace API handlers
 *
 * Implements request handlers for workspace management operations
 * using WorkspaceRepository for data access.
 */

import type { Response, NextFunction } from 'express';
import { WorkspaceRepository, type WorkspaceRecord } from '../../repositories/workspace.repository.js';
import type { AuthenticatedRequest, ApiResponse, ListResponse } from '../../types/api.js';
import type { ListWorkspacesQuery, WorkspaceResponse } from '../../models/workspace.model.js';
import { formatBytes } from '../../models/workspace.model.js';
import { getLogger } from '../../utils/logger.js';

const workspaceRepository = new WorkspaceRepository();
const logger = getLogger().child({ handler: 'WorkspaceHandler' });

/**
 * Convert workspace record to API response format
 */
function toWorkspaceResponse(record: WorkspaceRecord): WorkspaceResponse {
  return {
    workspaceId: record.workspaceId,
    userId: record.userId,
    createdAt: record.createdAt,
    lastAccessedAt: record.lastAccessedAt,
    sizeBytes: record.sizeBytes,
    sizeFormatted: formatBytes(record.sizeBytes),
    repoUrl: record.repoUrl,
    efsAccessPointId: record.efsAccessPointId,
  };
}

export class WorkspaceHandler {
  /**
   * GET /workspaces - List workspaces for authenticated user
   */
  static async list(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const query = req.query as unknown as ListWorkspacesQuery;

      logger.debug(
        { tenantId: req.tenantId, limit: query.limit },
        'Listing workspaces'
      );

      // Build query options carefully for exactOptionalPropertyTypes
      const queryOptions: { cursor?: string; limit?: number } = {};
      if (query.cursor !== undefined) {
        queryOptions.cursor = query.cursor;
      }
      if (query.limit !== undefined) {
        queryOptions.limit = query.limit;
      }

      const result = await workspaceRepository.listByUser(req.tenantId, queryOptions);

      const items = result.items.map(toWorkspaceResponse);

      // Build response data carefully for exactOptionalPropertyTypes
      const responseData: {
        items: WorkspaceResponse[];
        nextCursor?: string;
        hasMore: boolean;
      } = {
        items,
        hasMore: result.nextCursor !== undefined,
      };
      if (result.nextCursor !== undefined) {
        responseData.nextCursor = result.nextCursor;
      }

      // Build pagination meta carefully
      const paginationMeta: {
        cursor?: string;
        hasMore: boolean;
        limit: number;
      } = {
        hasMore: result.nextCursor !== undefined,
        limit: query.limit,
      };
      if (result.nextCursor !== undefined) {
        paginationMeta.cursor = result.nextCursor;
      }

      const response: ApiResponse<typeof responseData> = {
        success: true,
        data: responseData,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
          pagination: paginationMeta,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /workspaces/:workspaceId - Get workspace details
   */
  static async get(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const workspaceIdParam = req.params['workspaceId'];
      const workspaceId = Array.isArray(workspaceIdParam) ? workspaceIdParam[0] : workspaceIdParam;
      if (workspaceId === undefined) {
        throw new Error('Workspace ID required');
      }

      logger.debug(
        { tenantId: req.tenantId, workspaceId },
        'Getting workspace'
      );

      // Get workspace - will throw NotFoundError if not found
      const workspace = await workspaceRepository.getByUserAndId(
        req.tenantId,
        workspaceId
      );

      // Update last accessed timestamp
      await workspaceRepository.updateLastAccessed(req.tenantId, workspaceId);

      const response: ApiResponse<{ workspace: WorkspaceResponse }> = {
        success: true,
        data: {
          workspace: toWorkspaceResponse(workspace),
        },
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

  /**
   * DELETE /workspaces/:workspaceId - Delete a workspace
   */
  static async delete(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const workspaceIdParam = req.params['workspaceId'];
      const workspaceId = Array.isArray(workspaceIdParam) ? workspaceIdParam[0] : workspaceIdParam;
      if (workspaceId === undefined) {
        throw new Error('Workspace ID required');
      }

      logger.info(
        { tenantId: req.tenantId, workspaceId },
        'Deleting workspace'
      );

      // Delete workspace record (EFS cleanup handled separately by workspace handler service)
      await workspaceRepository.delete(req.tenantId, workspaceId);

      const response: ApiResponse<{
        workspaceId: string;
        message: string;
      }> = {
        success: true,
        data: {
          workspaceId,
          message: 'Workspace deleted successfully',
        },
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
