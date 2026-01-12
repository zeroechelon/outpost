/**
 * Health check routes
 *
 * Provides health and fleet status endpoints:
 * - GET /health - Full health check with component status
 * - GET /health/live - Kubernetes liveness probe
 * - GET /health/ready - Kubernetes readiness probe
 * - GET /health/fleet - Fleet status with pool metrics
 */

import { Router } from 'express';
import { HealthHandler } from '../handlers/health.handler.js';

export const healthRouter = Router();

// GET /health - Full health check
healthRouter.get('/', (req, res, next) => {
  void HealthHandler.health(req, res, next);
});

// GET /health/live - Kubernetes liveness probe
healthRouter.get('/live', HealthHandler.liveness);

// GET /health/ready - Kubernetes readiness probe
healthRouter.get('/ready', HealthHandler.readiness);

// GET /health/fleet - Fleet status with pool metrics and agent availability
healthRouter.get('/fleet', (req, res, next) => {
  void HealthHandler.fleetStatus(req, res, next);
});
