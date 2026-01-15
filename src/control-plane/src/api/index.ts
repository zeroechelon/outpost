/**
 * API Router Configuration
 *
 * Main router aggregation for the Outpost V2 Control Plane API.
 * Mounts all route modules under their respective path prefixes.
 */

import { Router, json } from 'express';
import {
  jobRouter,
  healthRouter,
  dispatchRouter,
  workspaceRouter,
  artifactsRouter,
} from './routes/index.js';
import { errorHandler, requestLogger } from './middleware/index.js';

/**
 * Create and configure the main API router
 */
export function createApiRouter(): Router {
  const router = Router();

  // Apply JSON body parser
  router.use(json({ limit: '1mb' }));

  // Apply request logger to all routes
  router.use(requestLogger);

  // Mount route modules
  router.use('/health', healthRouter);
  router.use('/jobs', jobRouter);
  router.use('/dispatch', dispatchRouter);
  router.use('/workspaces', workspaceRouter);
  router.use('/artifacts', artifactsRouter);

  // Apply error handler (must be last)
  router.use(errorHandler);

  return router;
}

// Export individual routers for testing
export {
  jobRouter,
  healthRouter,
  dispatchRouter,
  workspaceRouter,
  artifactsRouter,
};

// Export handlers
export * from './handlers/index.js';

// Export middleware
export * from './middleware/index.js';

// Default export for convenience
export default createApiRouter;
