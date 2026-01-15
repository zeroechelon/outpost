/**
 * Integration test setup file
 *
 * Configures environment for integration tests.
 * Sets up logging and test environment detection.
 */

// Set test environment
process.env['NODE_ENV'] = 'test';

// Configure console output for integration tests
const isCI = process.env['CI'] === 'true';
const isVerbose = process.env['VERBOSE'] === 'true';

// Display test mode on startup
const apiUrl = process.env['OUTPOST_API_URL'];
const isRealEndpoint = apiUrl !== undefined;

if (!isCI) {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Outpost Integration Tests');
  console.log('='.repeat(60));
  console.log(`  Mode: ${isRealEndpoint ? 'REAL ENDPOINT' : 'MOCK'}`);
  if (isRealEndpoint) {
    console.log(`  API URL: ${apiUrl}`);
    console.log(`  API Key: ${process.env['OUTPOST_API_KEY'] !== undefined ? '****' : 'NOT SET'}`);
  }
  console.log('='.repeat(60));
  console.log('');
}

// Global test timeout for integration tests (2 minutes default)
jest.setTimeout(120000);

// Add custom matchers if needed
expect.extend({
  toBeDispatchId(received: string) {
    const pass = typeof received === 'string' && received.length > 0 && /^[a-zA-Z0-9-]+$/.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid dispatch ID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid dispatch ID (alphanumeric with dashes)`,
        pass: false,
      };
    }
  },
});

// Type declaration for custom matcher
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeDispatchId(): R;
    }
  }
}

// Cleanup handler for unhandled rejections during tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection during test:', reason);
});

// Export for TypeScript
export {};
