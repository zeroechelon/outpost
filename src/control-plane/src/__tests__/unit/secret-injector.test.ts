/**
 * Secret Injector Service Tests
 *
 * Tests for validateAdditionalSecrets(), buildGitCredentialConfig(),
 * processAdditionalSecrets(), and audit logging functionality.
 */

import {
  SecretsManagerClient,
  DescribeSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import {
  SecretInjectorService,
  resetSecretInjectorService,
  SECRET_KEY_PATTERN,
  MAX_SECRET_KEY_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  PROTECTED_SECRET_KEYS,
} from '../../services/secret-injector.js';
import { ValidationError } from '../../utils/errors.js';

// Mock AWS SDK
jest.mock('@aws-sdk/client-secrets-manager');

describe('SecretInjectorService', () => {
  let service: SecretInjectorService;
  let mockClient: jest.Mocked<SecretsManagerClient>;

  beforeEach(() => {
    resetSecretInjectorService();
    mockClient = new SecretsManagerClient({}) as jest.Mocked<SecretsManagerClient>;
    mockClient.send = jest.fn();
    service = new SecretInjectorService(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAdditionalSecrets', () => {
    describe('valid inputs', () => {
      it('should accept valid uppercase keys with letters only', () => {
        const secrets = {
          'DATABASE_URL': 'postgres://localhost:5432/db',
          'API_KEY': 'sk-test-key',
        };

        expect(() => service.validateAdditionalSecrets(secrets)).not.toThrow();
      });

      it('should accept valid keys with numbers', () => {
        const secrets = {
          'API_KEY_V2': 'value',
          'SECRET123': 'value',
        };

        expect(() => service.validateAdditionalSecrets(secrets)).not.toThrow();
      });

      it('should accept single character key', () => {
        const secrets = { 'A': 'value' };
        expect(() => service.validateAdditionalSecrets(secrets)).not.toThrow();
      });

      it('should accept empty secrets object', () => {
        expect(() => service.validateAdditionalSecrets({})).not.toThrow();
      });

      it('should accept keys at max length', () => {
        const maxLengthKey = 'A'.repeat(MAX_SECRET_KEY_LENGTH);
        const secrets = { [maxLengthKey]: 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).not.toThrow();
      });

      it('should accept values at max size', () => {
        const maxSizeValue = 'x'.repeat(MAX_SECRET_VALUE_LENGTH);
        const secrets = { 'LARGE_VALUE': maxSizeValue };

        expect(() => service.validateAdditionalSecrets(secrets)).not.toThrow();
      });
    });

    describe('invalid key formats', () => {
      it('should reject keys starting with lowercase', () => {
        const secrets = { 'lowercase_key': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/must match pattern/);
      });

      it('should reject keys starting with number', () => {
        const secrets = { '123_KEY': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/must match pattern/);
      });

      it('should reject keys with lowercase letters', () => {
        const secrets = { 'API_key': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject keys with hyphens', () => {
        const secrets = { 'API-KEY': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject keys with spaces', () => {
        const secrets = { 'API KEY': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject keys with special characters', () => {
        const secrets = { 'API@KEY': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject empty string key', () => {
        const secrets = { '': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject keys starting with underscore', () => {
        const secrets = { '_PRIVATE': 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });
    });

    describe('oversized keys', () => {
      it('should reject keys exceeding max length', () => {
        const oversizedKey = 'A'.repeat(MAX_SECRET_KEY_LENGTH + 1);
        const secrets = { [oversizedKey]: 'value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/exceeds maximum length/);
      });
    });

    describe('oversized values', () => {
      it('should reject values exceeding 32KB', () => {
        const oversizedValue = 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1);
        const secrets = { 'LARGE_SECRET': oversizedValue };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/exceeds maximum length/);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/32KB/);
      });
    });

    describe('null bytes in values', () => {
      it('should reject values containing null bytes', () => {
        const secrets = { 'BINARY_DATA': 'test\0value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/null bytes/);
      });

      it('should reject values starting with null byte', () => {
        const secrets = { 'NULL_START': '\0value' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/null bytes/);
      });

      it('should reject values ending with null byte', () => {
        const secrets = { 'NULL_END': 'value\0' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/null bytes/);
      });
    });

    describe('protected keys', () => {
      it('should reject AWS_ACCESS_KEY_ID', () => {
        const secrets = { 'AWS_ACCESS_KEY_ID': 'AKIAIOSFODNN7EXAMPLE' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/protected system secret/);
      });

      it('should reject AWS_SECRET_ACCESS_KEY', () => {
        const secrets = { 'AWS_SECRET_ACCESS_KEY': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/protected system secret/);
      });

      it('should reject AWS_SESSION_TOKEN', () => {
        const secrets = { 'AWS_SESSION_TOKEN': 'token' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject AWS_REGION', () => {
        const secrets = { 'AWS_REGION': 'us-east-1' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject AWS_DEFAULT_REGION', () => {
        const secrets = { 'AWS_DEFAULT_REGION': 'us-east-1' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject ANTHROPIC_API_KEY', () => {
        const secrets = { 'ANTHROPIC_API_KEY': 'sk-ant-api...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/protected system secret/);
      });

      it('should reject OPENAI_API_KEY', () => {
        const secrets = { 'OPENAI_API_KEY': 'sk-...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject GOOGLE_API_KEY', () => {
        const secrets = { 'GOOGLE_API_KEY': 'AIza...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject DEEPSEEK_API_KEY', () => {
        const secrets = { 'DEEPSEEK_API_KEY': 'sk-...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject XAI_API_KEY', () => {
        const secrets = { 'XAI_API_KEY': 'xai-...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
      });

      it('should reject GITHUB_TOKEN', () => {
        const secrets = { 'GITHUB_TOKEN': 'ghp_...' };

        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(ValidationError);
        expect(() => service.validateAdditionalSecrets(secrets)).toThrow(/protected system secret/);
      });

      it('should verify PROTECTED_SECRET_KEYS contains expected keys', () => {
        expect(PROTECTED_SECRET_KEYS.has('AWS_ACCESS_KEY_ID')).toBe(true);
        expect(PROTECTED_SECRET_KEYS.has('AWS_SECRET_ACCESS_KEY')).toBe(true);
        expect(PROTECTED_SECRET_KEYS.has('ANTHROPIC_API_KEY')).toBe(true);
        expect(PROTECTED_SECRET_KEYS.has('OPENAI_API_KEY')).toBe(true);
        expect(PROTECTED_SECRET_KEYS.has('GITHUB_TOKEN')).toBe(true);
      });
    });

    describe('multiple validation errors', () => {
      it('should report all validation errors at once', () => {
        const secrets = {
          'lowercase': 'value1',
          '123_START': 'value2',
        };

        try {
          service.validateAdditionalSecrets(secrets);
          fail('Expected ValidationError to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          const validationError = error as ValidationError;
          // Should contain multiple error messages
          expect(validationError.message).toContain(';');
        }
      });
    });
  });

  describe('isProtectedSecretKey', () => {
    it('should return true for protected keys', () => {
      expect(service.isProtectedSecretKey('AWS_ACCESS_KEY_ID')).toBe(true);
      expect(service.isProtectedSecretKey('ANTHROPIC_API_KEY')).toBe(true);
      expect(service.isProtectedSecretKey('GITHUB_TOKEN')).toBe(true);
    });

    it('should return false for non-protected keys', () => {
      expect(service.isProtectedSecretKey('MY_CUSTOM_KEY')).toBe(false);
      expect(service.isProtectedSecretKey('DATABASE_URL')).toBe(false);
      expect(service.isProtectedSecretKey('NPM_TOKEN')).toBe(false);
    });
  });

  describe('buildGitCredentialConfig', () => {
    it('should return correct credentials path', () => {
      const config = service.buildGitCredentialConfig('ghp_testtoken123');

      expect(config.credentialsPath).toBe('/workspace/.git-credentials');
    });

    it('should use custom workspace path', () => {
      const config = service.buildGitCredentialConfig('ghp_testtoken123', '/custom/workspace');

      expect(config.credentialsPath).toBe('/custom/workspace/.git-credentials');
    });

    it('should return correct config commands', () => {
      const config = service.buildGitCredentialConfig('ghp_testtoken123', '/workspace');

      expect(config.configCommands).toHaveLength(2);
      expect(config.configCommands[0]).toContain('git config --global credential.helper');
      expect(config.configCommands[0]).toContain('store --file=/workspace/.git-credentials');
      expect(config.configCommands[1]).toBe('chmod 600 /workspace/.git-credentials');
    });

    it('should throw ValidationError for empty token', () => {
      expect(() => service.buildGitCredentialConfig('')).toThrow(ValidationError);
      expect(() => service.buildGitCredentialConfig('')).toThrow(/cannot be empty/);
    });

    it('should throw ValidationError for whitespace-only token', () => {
      expect(() => service.buildGitCredentialConfig('   ')).toThrow(ValidationError);
      expect(() => service.buildGitCredentialConfig('\t\n')).toThrow(ValidationError);
    });
  });

  describe('generateGitCredentialsContent', () => {
    it('should generate correct git-credentials format', () => {
      const content = service.generateGitCredentialsContent('ghp_testtoken123');

      expect(content).toBe('https://ghp_testtoken123:x-oauth-basic@github.com\n');
    });

    it('should include trailing newline', () => {
      const content = service.generateGitCredentialsContent('token');

      expect(content.endsWith('\n')).toBe(true);
    });

    it('should throw ValidationError for empty token', () => {
      expect(() => service.generateGitCredentialsContent('')).toThrow(ValidationError);
    });

    it('should throw ValidationError for whitespace-only token', () => {
      expect(() => service.generateGitCredentialsContent('   ')).toThrow(ValidationError);
    });
  });

  describe('extractGitHubToken', () => {
    it('should extract and remove GITHUB_TOKEN from secrets', () => {
      const secrets = {
        'DATABASE_URL': 'postgres://localhost',
        'GITHUB_TOKEN': 'ghp_testtoken123',
        'API_KEY': 'sk-test',
      };

      const token = service.extractGitHubToken(secrets);

      expect(token).toBe('ghp_testtoken123');
      expect(secrets['GITHUB_TOKEN']).toBeUndefined();
      expect(secrets['DATABASE_URL']).toBe('postgres://localhost');
      expect(secrets['API_KEY']).toBe('sk-test');
    });

    it('should return undefined when GITHUB_TOKEN not present', () => {
      const secrets = {
        'DATABASE_URL': 'postgres://localhost',
        'API_KEY': 'sk-test',
      };

      const token = service.extractGitHubToken(secrets);

      expect(token).toBeUndefined();
      expect(Object.keys(secrets)).toHaveLength(2);
    });
  });

  describe('logSecretInjectionAudit', () => {
    it('should log audit event without throwing', () => {
      // This should not throw and should complete successfully
      expect(() => {
        service.logSecretInjectionAudit('run-123', ['KEY1', 'KEY2'], 'additional');
      }).not.toThrow();
    });

    it('should handle empty secret keys', () => {
      expect(() => {
        service.logSecretInjectionAudit('run-123', [], 'agent');
      }).not.toThrow();
    });

    it('should handle different source types', () => {
      expect(() => {
        service.logSecretInjectionAudit('run-123', ['KEY'], 'agent');
        service.logSecretInjectionAudit('run-123', ['KEY'], 'additional');
        service.logSecretInjectionAudit('run-123', ['KEY'], 'user');
      }).not.toThrow();
    });
  });

  describe('processAdditionalSecrets', () => {
    it('should process valid secrets without GITHUB_TOKEN', () => {
      const result = service.processAdditionalSecrets('run-123', {
        'DATABASE_URL': 'postgres://localhost',
        'API_KEY': 'sk-test',
      });

      expect(result.environmentVariables).toHaveLength(2);
      expect(result.environmentVariables).toContainEqual({
        name: 'DATABASE_URL',
        value: 'postgres://localhost',
      });
      expect(result.environmentVariables).toContainEqual({
        name: 'API_KEY',
        value: 'sk-test',
      });
      expect(result.gitCredentialConfig).toBeUndefined();
      expect(result.gitCredentialsContent).toBeUndefined();
      expect(result.injectedKeys).toContain('DATABASE_URL');
      expect(result.injectedKeys).toContain('API_KEY');
    });

    it('should handle GITHUB_TOKEN specially', () => {
      const result = service.processAdditionalSecrets('run-123', {
        'DATABASE_URL': 'postgres://localhost',
        'GITHUB_TOKEN': 'ghp_testtoken',
      });

      // GITHUB_TOKEN should not be in environment variables
      expect(result.environmentVariables).toHaveLength(1);
      expect(result.environmentVariables[0]).toEqual({
        name: 'DATABASE_URL',
        value: 'postgres://localhost',
      });

      // Should have git credential config
      expect(result.gitCredentialConfig).toBeDefined();
      expect(result.gitCredentialConfig?.credentialsPath).toBe('/workspace/.git-credentials');
      expect(result.gitCredentialsContent).toBe('https://ghp_testtoken:x-oauth-basic@github.com\n');

      // Injected keys should include both
      expect(result.injectedKeys).toContain('DATABASE_URL');
      expect(result.injectedKeys).toContain('GITHUB_TOKEN');
    });

    it('should use custom workspace path for git credentials', () => {
      const result = service.processAdditionalSecrets(
        'run-123',
        { 'GITHUB_TOKEN': 'ghp_token' },
        '/custom/path'
      );

      expect(result.gitCredentialConfig?.credentialsPath).toBe('/custom/path/.git-credentials');
    });

    it('should throw ValidationError for protected keys (except GITHUB_TOKEN)', () => {
      expect(() => {
        service.processAdditionalSecrets('run-123', {
          'AWS_ACCESS_KEY_ID': 'AKIA...',
        });
      }).toThrow(ValidationError);
      expect(() => {
        service.processAdditionalSecrets('run-123', {
          'AWS_ACCESS_KEY_ID': 'AKIA...',
        });
      }).toThrow(/protected system secrets/);
    });

    it('should throw ValidationError for invalid key format', () => {
      expect(() => {
        service.processAdditionalSecrets('run-123', {
          'invalid_key': 'value',
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError for oversized values', () => {
      const oversizedValue = 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1);
      expect(() => {
        service.processAdditionalSecrets('run-123', {
          'LARGE_VALUE': oversizedValue,
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError for null bytes in values', () => {
      expect(() => {
        service.processAdditionalSecrets('run-123', {
          'BINARY': 'has\0null',
        });
      }).toThrow(ValidationError);
    });

    it('should handle empty secrets object', () => {
      const result = service.processAdditionalSecrets('run-123', {});

      expect(result.environmentVariables).toHaveLength(0);
      expect(result.gitCredentialConfig).toBeUndefined();
      expect(result.injectedKeys).toHaveLength(0);
    });
  });

  describe('buildEnvironmentFromAdditionalSecrets', () => {
    it('should build environment array from valid secrets', () => {
      const result = service.buildEnvironmentFromAdditionalSecrets({
        'KEY1': 'value1',
        'KEY2': 'value2',
      });

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ name: 'KEY1', value: 'value1' });
      expect(result).toContainEqual({ name: 'KEY2', value: 'value2' });
    });

    it('should throw for invalid secrets', () => {
      expect(() => {
        service.buildEnvironmentFromAdditionalSecrets({ 'invalid': 'value' });
      }).toThrow(ValidationError);
    });
  });

  describe('SECRET_KEY_PATTERN', () => {
    it('should match valid patterns', () => {
      expect(SECRET_KEY_PATTERN.test('A')).toBe(true);
      expect(SECRET_KEY_PATTERN.test('ABC')).toBe(true);
      expect(SECRET_KEY_PATTERN.test('A123')).toBe(true);
      expect(SECRET_KEY_PATTERN.test('ABC_DEF')).toBe(true);
      expect(SECRET_KEY_PATTERN.test('A_B_C_123')).toBe(true);
    });

    it('should not match invalid patterns', () => {
      expect(SECRET_KEY_PATTERN.test('a')).toBe(false);
      expect(SECRET_KEY_PATTERN.test('1ABC')).toBe(false);
      expect(SECRET_KEY_PATTERN.test('_ABC')).toBe(false);
      expect(SECRET_KEY_PATTERN.test('ABC-DEF')).toBe(false);
      expect(SECRET_KEY_PATTERN.test('')).toBe(false);
      expect(SECRET_KEY_PATTERN.test('ABCdef')).toBe(false);
    });
  });
});
