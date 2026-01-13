/**
 * Jest test setup file
 */

import { resetConfig } from '../utils/config.js';
import { resetLogger } from '../utils/logger.js';
import { resetDocClient } from '../repositories/base.repository.js';

// Set test environment variables
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error'; // Minimal logging during tests
process.env['LOG_PRETTY'] = 'false';

// Reset singletons before each test
beforeEach(() => {
  resetConfig();
  resetLogger();
  resetDocClient();
});

// Global test timeout
jest.setTimeout(10000);
