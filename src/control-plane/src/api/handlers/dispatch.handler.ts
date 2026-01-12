/**
 * Dispatch API handlers
 *
 * Implements request handlers for dispatch operations using
 * DispatcherOrchestrator and DispatchStatusTracker services.
 */

import type { Response, NextFunction } from 'express';
import { getDispatcherOrchestrator, type DispatchRequest } from '../../services/dispatcher.js';
import { getDispatchStatusTracker } from '../../services/status-tracker.js';
import { DispatchRepository } from '../../repositories/dispatch.repository.js';
import type { AuthenticatedRequest, ApiResponse } from '../../types/api.js';
import type { CreateDispatchInput, GetDispatchQuery, DispatchResponse } from '../../models/dispatch.model.js';
import { AuthorizationError } from '../../utils/errors.js';

const dispatcherOrchestrator = getDispatcherOrchestrator();
const statusTracker = getDispatchStatusTracker();
const dispatchRepository = new DispatchRepository();

export class DispatchHandler {
  /**
   * POST /dispatch - Create a new dispatch
   */
  static async create(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const input = req.body as CreateDispatchInput;

      // Build dispatch request with tenant ID as user ID
      // Use explicit object construction to satisfy exactOptionalPropertyTypes
      const dispatchRequest: DispatchRequest = {
        userId: req.tenantId,
        agent: input.agent,
        task: input.task,
        workspaceMode: input.workspaceMode,
        timeoutSeconds: input.timeoutSeconds,
        contextLevel: input.context,
      };

      // Add optional properties only if defined
      if (input.repo !== undefined) {
        (dispatchRequest as { repoUrl: string }).repoUrl = `https://github.com/${input.repo}`;
      }
      if (input.additionalSecrets !== undefined) {
        (dispatchRequest as { additionalSecrets: string[] }).additionalSecrets = input.additionalSecrets;
      }

      const result = await dispatcherOrchestrator.dispatch(dispatchRequest);

      const response: ApiResponse<{
        dispatchId: string;
        status: string;
        agent: string;
        modelId: string;
        estimatedStartTime: string;
      }> = {
        success: true,
        data: {
          dispatchId: result.dispatchId,
          status: result.status,
          agent: result.agent,
          modelId: result.modelId,
          estimatedStartTime: result.estimatedStartTime.toISOString(),
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

  /**
   * GET /dispatch/:dispatchId - Get dispatch status with logs
   */
  static async getStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dispatchIdParam = req.params['dispatchId'];
      const dispatchId = Array.isArray(dispatchIdParam) ? dispatchIdParam[0] : dispatchIdParam;
      if (dispatchId === undefined) {
        throw new Error('Dispatch ID required');
      }

      const query = req.query as unknown as GetDispatchQuery;

      // Verify dispatch belongs to tenant
      const dispatch = await dispatchRepository.getById(dispatchId);
      if (dispatch.userId !== req.tenantId) {
        throw new AuthorizationError('Dispatch not found or access denied', {
          dispatchId,
        });
      }

      // Get status with optional logs - build options carefully for exactOptionalPropertyTypes
      const statusOptions: { logLimit?: number; skipLogs?: boolean; logOffset?: string } = {};
      if (query.logOffset !== undefined) {
        statusOptions.logOffset = query.logOffset;
      }
      if (query.logLimit !== undefined) {
        statusOptions.logLimit = query.logLimit;
      }
      if (query.skipLogs !== undefined) {
        statusOptions.skipLogs = query.skipLogs;
      }

      const status = await statusTracker.getStatus(dispatchId, statusOptions);

      const responseData: DispatchResponse = {
        dispatchId: status.dispatchId,
        status: status.status,
        agent: dispatch.agent,
        modelId: dispatch.modelId,
        task: dispatch.task,
        progress: status.progress,
        ...(status.logs.length > 0 && { logs: status.logs }),
        ...(status.logOffset !== '' && { logOffset: status.logOffset }),
        ...(status.startedAt !== undefined && { startedAt: status.startedAt }),
        ...(status.endedAt !== undefined && { endedAt: status.endedAt }),
        ...(status.taskArn !== undefined && { taskArn: status.taskArn }),
        ...(status.exitCode !== undefined && { exitCode: status.exitCode }),
        ...(status.errorMessage !== undefined && { errorMessage: status.errorMessage }),
      };

      const response: ApiResponse<DispatchResponse> = {
        success: true,
        data: responseData,
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
   * DELETE /dispatch/:dispatchId - Cancel an active dispatch
   */
  static async cancel(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dispatchIdParam = req.params['dispatchId'];
      const dispatchId = Array.isArray(dispatchIdParam) ? dispatchIdParam[0] : dispatchIdParam;
      if (dispatchId === undefined) {
        throw new Error('Dispatch ID required');
      }

      // Verify dispatch belongs to tenant
      const dispatch = await dispatchRepository.getById(dispatchId);
      if (dispatch.userId !== req.tenantId) {
        throw new AuthorizationError('Dispatch not found or access denied', {
          dispatchId,
        });
      }

      // Parse optional reason from body
      const reason = (req.body as { reason?: string })?.reason ?? 'Cancelled by user';

      // Cancel the dispatch
      await dispatcherOrchestrator.cancelDispatch(dispatchId, reason);

      // Get updated status
      const status = await statusTracker.getStatus(dispatchId, { skipLogs: true });

      const response: ApiResponse<{
        dispatchId: string;
        status: string;
        message: string;
      }> = {
        success: true,
        data: {
          dispatchId,
          status: status.status,
          message: 'Dispatch cancelled successfully',
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
