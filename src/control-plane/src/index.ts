/**
 * Outpost V2 Control Plane - Main Entry Point
 *
 * Express application setup with middleware, routes, and graceful shutdown.
 */

import express from 'express';
import { getConfig } from './utils/config.js';
import { getLogger } from './utils/logger.js';
import { requestLogger } from './api/middleware/request-logger.middleware.js';
import { errorHandler } from './api/middleware/error.middleware.js';
import { jobRouter } from './api/routes/job.routes.js';
import { healthRouter } from './api/routes/health.routes.js';

// Initialize logger and config
const logger = getLogger();
const config = getConfig();

// Create Express app
const app = express();

// Trust proxy (for X-Forwarded-* headers in AWS)
app.set('trust proxy', true);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/health', healthRouter);
app.use('/api/v2/jobs', jobRouter);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'outpost-control-plane',
    version: process.env['npm_package_version'] ?? '2.0.0',
    status: 'operational',
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// Start server
function startServer(): void {
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      {
        port: config.port,
        host: config.host,
        env: config.nodeEnv,
      },
      'Outpost Control Plane started'
    );
  });

  // Graceful shutdown
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutdown signal received');

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

// Start the server
startServer();

export { app };
