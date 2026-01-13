/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Look for integration tests in both local and project-level directories
  roots: [
    '<rootDir>/tests/integration',
    '<rootDir>/../../tests/integration',
  ],
  // Match both .integration.test.ts and regular .test.ts in integration dirs
  testMatch: ['**/*.integration.test.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: false, // Disable ESM for AWS SDK compatibility
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
  },
  // Try both setup file locations
  setupFilesAfterEnv: ['<rootDir>/../../tests/integration/setup.ts'],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 120000, // 2 minute timeout for integration tests
  // Integration test specific settings
  maxWorkers: 1, // Run sequentially to avoid DynamoDB contention
  bail: false, // Continue running tests even if one fails
  collectCoverage: false, // Don't collect coverage for integration tests
  // Display mode
  displayName: {
    name: 'INTEGRATION',
    color: 'cyan',
  },
  // Ensure AWS SDK works correctly in Jest
  transformIgnorePatterns: [
    '/node_modules/(?!(@aws-sdk|@smithy)/)',
  ],
};
