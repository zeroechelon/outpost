/**
 * Config utility tests
 */

import { getConfig, resetConfig } from '../../utils/config.js';

describe('Config', () => {
  beforeEach(() => {
    resetConfig();
    // Set minimal required env vars
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    resetConfig();
  });

  it('should load default configuration', () => {
    const config = getConfig();

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.awsRegion).toBe('us-east-1');
  });

  it('should return same instance on subsequent calls', () => {
    const config1 = getConfig();
    const config2 = getConfig();

    expect(config1).toBe(config2);
  });

  it('should have nested configuration objects', () => {
    const config = getConfig();

    expect(config.dynamodb).toBeDefined();
    expect(config.dynamodb.jobsTable).toBe('outpost-jobs');

    expect(config.ecs).toBeDefined();
    expect(config.s3).toBeDefined();
    expect(config.efs).toBeDefined();
    expect(config.worker).toBeDefined();
    expect(config.log).toBeDefined();
  });

  it('should respect environment variable overrides', () => {
    resetConfig();
    process.env['PORT'] = '8080';
    process.env['LOG_LEVEL'] = 'debug';

    const config = getConfig();

    expect(config.port).toBe(8080);
    expect(config.log.level).toBe('debug');
  });
});
