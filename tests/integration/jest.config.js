/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '../../src/control-plane/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Integration tests have longer timeouts
  testTimeout: 120000,
  // Don't collect coverage for integration tests
  collectCoverage: false,
  // Verbose output for debugging
  verbose: true,
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  // Setup file for environment configuration
  setupFilesAfterEnv: ['./setup.ts'],
};
