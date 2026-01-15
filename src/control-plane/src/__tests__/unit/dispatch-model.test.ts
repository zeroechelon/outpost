/**
 * Dispatch Model Tests
 *
 * Tests for Zod validation schemas including workspaceInitMode enum,
 * resourceConstraints bounds, idempotencyKey format, and tags validation.
 */

import {
  CreateDispatchSchema,
  WorkspaceInitModeSchema,
  ResourceConstraintsSchema,
  AgentTypeSchema,
  ContextLevelSchema,
  WorkspaceModeSchema,
  ListDispatchesQuerySchema,
  DispatchResponseSchema,
} from '../../models/dispatch.model.js';

describe('Dispatch Model Schemas', () => {
  describe('WorkspaceInitModeSchema', () => {
    it('should accept "full" mode', () => {
      const result = WorkspaceInitModeSchema.parse('full');
      expect(result).toBe('full');
    });

    it('should accept "minimal" mode', () => {
      const result = WorkspaceInitModeSchema.parse('minimal');
      expect(result).toBe('minimal');
    });

    it('should accept "none" mode', () => {
      const result = WorkspaceInitModeSchema.parse('none');
      expect(result).toBe('none');
    });

    it('should reject invalid mode', () => {
      expect(() => WorkspaceInitModeSchema.parse('partial')).toThrow();
      expect(() => WorkspaceInitModeSchema.parse('invalid')).toThrow();
      expect(() => WorkspaceInitModeSchema.parse('')).toThrow();
    });

    it('should default to "full" when undefined', () => {
      const result = WorkspaceInitModeSchema.parse(undefined);
      expect(result).toBe('full');
    });
  });

  describe('ResourceConstraintsSchema', () => {
    describe('maxMemoryMb', () => {
      it('should accept valid memory values', () => {
        expect(ResourceConstraintsSchema.parse({ maxMemoryMb: 512 }).maxMemoryMb).toBe(512);
        expect(ResourceConstraintsSchema.parse({ maxMemoryMb: 4096 }).maxMemoryMb).toBe(4096);
        expect(ResourceConstraintsSchema.parse({ maxMemoryMb: 30720 }).maxMemoryMb).toBe(30720);
      });

      it('should reject memory below minimum (512)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 256 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 511 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 0 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: -1024 })).toThrow();
      });

      it('should reject memory above maximum (30720)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 30721 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 50000 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 100000 })).toThrow();
      });

      it('should reject non-integer values', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 1024.5 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxMemoryMb: 2048.9 })).toThrow();
      });

      it('should accept undefined (optional)', () => {
        const result = ResourceConstraintsSchema.parse({});
        expect(result.maxMemoryMb).toBeUndefined();
      });
    });

    describe('maxCpuUnits', () => {
      it('should accept valid CPU values', () => {
        expect(ResourceConstraintsSchema.parse({ maxCpuUnits: 256 }).maxCpuUnits).toBe(256);
        expect(ResourceConstraintsSchema.parse({ maxCpuUnits: 1024 }).maxCpuUnits).toBe(1024);
        expect(ResourceConstraintsSchema.parse({ maxCpuUnits: 4096 }).maxCpuUnits).toBe(4096);
      });

      it('should reject CPU below minimum (256)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 128 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 255 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 0 })).toThrow();
      });

      it('should reject CPU above maximum (4096)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 4097 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 8192 })).toThrow();
      });

      it('should reject non-integer values', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxCpuUnits: 512.5 })).toThrow();
      });
    });

    describe('maxDiskGb', () => {
      it('should accept valid disk values', () => {
        expect(ResourceConstraintsSchema.parse({ maxDiskGb: 21 }).maxDiskGb).toBe(21);
        expect(ResourceConstraintsSchema.parse({ maxDiskGb: 100 }).maxDiskGb).toBe(100);
        expect(ResourceConstraintsSchema.parse({ maxDiskGb: 200 }).maxDiskGb).toBe(200);
      });

      it('should reject disk below minimum (21)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxDiskGb: 20 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxDiskGb: 10 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxDiskGb: 0 })).toThrow();
      });

      it('should reject disk above maximum (200)', () => {
        expect(() => ResourceConstraintsSchema.parse({ maxDiskGb: 201 })).toThrow();
        expect(() => ResourceConstraintsSchema.parse({ maxDiskGb: 500 })).toThrow();
      });
    });

    describe('combined constraints', () => {
      it('should accept all valid constraints together', () => {
        const result = ResourceConstraintsSchema.parse({
          maxMemoryMb: 8192,
          maxCpuUnits: 2048,
          maxDiskGb: 100,
        });

        expect(result.maxMemoryMb).toBe(8192);
        expect(result.maxCpuUnits).toBe(2048);
        expect(result.maxDiskGb).toBe(100);
      });

      it('should accept empty object (all optional)', () => {
        const result = ResourceConstraintsSchema.parse({});
        expect(result.maxMemoryMb).toBeUndefined();
        expect(result.maxCpuUnits).toBeUndefined();
        expect(result.maxDiskGb).toBeUndefined();
      });

      it('should accept partial constraints', () => {
        const result = ResourceConstraintsSchema.parse({
          maxMemoryMb: 4096,
        });
        expect(result.maxMemoryMb).toBe(4096);
        expect(result.maxCpuUnits).toBeUndefined();
        expect(result.maxDiskGb).toBeUndefined();
      });
    });
  });

  describe('CreateDispatchSchema', () => {
    const validInput = {
      agent: 'claude',
      task: 'This is a test task that is at least 10 characters long',
    };

    describe('idempotencyKey validation', () => {
      it('should accept valid idempotency key', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          idempotencyKey: 'my-unique-key-123',
        });
        expect(result.idempotencyKey).toBe('my-unique-key-123');
      });

      it('should accept UUID format idempotency key', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.idempotencyKey).toBe('550e8400-e29b-41d4-a716-446655440000');
      });

      it('should accept idempotency key up to max length (128)', () => {
        const maxLengthKey = 'a'.repeat(128);
        const result = CreateDispatchSchema.parse({
          ...validInput,
          idempotencyKey: maxLengthKey,
        });
        expect(result.idempotencyKey).toBe(maxLengthKey);
        expect(result.idempotencyKey?.length).toBe(128);
      });

      it('should reject idempotency key exceeding max length', () => {
        const tooLongKey = 'a'.repeat(129);
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            idempotencyKey: tooLongKey,
          })
        ).toThrow();
      });

      it('should accept undefined idempotency key (optional)', () => {
        const result = CreateDispatchSchema.parse(validInput);
        expect(result.idempotencyKey).toBeUndefined();
      });

      it('should accept empty string idempotency key', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          idempotencyKey: '',
        });
        expect(result.idempotencyKey).toBe('');
      });
    });

    describe('tags validation', () => {
      it('should accept valid tags as Record<string, string>', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          tags: {
            environment: 'production',
            team: 'backend',
          },
        });
        expect(result.tags).toEqual({
          environment: 'production',
          team: 'backend',
        });
      });

      it('should accept empty tags object', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          tags: {},
        });
        expect(result.tags).toEqual({});
      });

      it('should accept undefined tags (optional)', () => {
        const result = CreateDispatchSchema.parse(validInput);
        expect(result.tags).toBeUndefined();
      });

      it('should reject tags with non-string values', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            tags: {
              count: 123, // number instead of string
            },
          })
        ).toThrow();
      });

      it('should accept tags with special characters in values', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          tags: {
            description: 'This has spaces & special chars!',
            unicode: 'Hello 世界',
          },
        });
        expect(result.tags?.description).toBe('This has spaces & special chars!');
        expect(result.tags?.unicode).toBe('Hello 世界');
      });

      it('should accept tags with empty string values', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          tags: {
            empty: '',
          },
        });
        expect(result.tags?.empty).toBe('');
      });
    });

    describe('resourceConstraints validation', () => {
      it('should accept valid resource constraints', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          resourceConstraints: {
            maxMemoryMb: 8192,
            maxCpuUnits: 2048,
            maxDiskGb: 50,
          },
        });
        expect(result.resourceConstraints?.maxMemoryMb).toBe(8192);
        expect(result.resourceConstraints?.maxCpuUnits).toBe(2048);
        expect(result.resourceConstraints?.maxDiskGb).toBe(50);
      });

      it('should accept undefined resource constraints (optional)', () => {
        const result = CreateDispatchSchema.parse(validInput);
        expect(result.resourceConstraints).toBeUndefined();
      });

      it('should reject invalid resource constraints', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            resourceConstraints: {
              maxMemoryMb: 100, // Too low
            },
          })
        ).toThrow();
      });
    });

    describe('workspaceInitMode validation', () => {
      it('should accept valid workspace init modes', () => {
        expect(CreateDispatchSchema.parse({ ...validInput, workspaceInitMode: 'full' }).workspaceInitMode).toBe('full');
        expect(CreateDispatchSchema.parse({ ...validInput, workspaceInitMode: 'minimal' }).workspaceInitMode).toBe('minimal');
        expect(CreateDispatchSchema.parse({ ...validInput, workspaceInitMode: 'none' }).workspaceInitMode).toBe('none');
      });

      it('should default to "full"', () => {
        const result = CreateDispatchSchema.parse(validInput);
        expect(result.workspaceInitMode).toBe('full');
      });

      it('should reject invalid workspace init mode', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            workspaceInitMode: 'invalid',
          })
        ).toThrow();
      });
    });

    describe('agent validation', () => {
      it('should accept all valid agent types', () => {
        const agents = ['claude', 'codex', 'gemini', 'aider', 'grok'];
        for (const agent of agents) {
          const result = CreateDispatchSchema.parse({ ...validInput, agent });
          expect(result.agent).toBe(agent);
        }
      });

      it('should reject invalid agent type', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            agent: 'invalid-agent',
          })
        ).toThrow();
      });
    });

    describe('task validation', () => {
      it('should accept task at minimum length (10)', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          task: '1234567890', // Exactly 10 chars
        });
        expect(result.task.length).toBe(10);
      });

      it('should reject task below minimum length', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            task: '123456789', // 9 chars
          })
        ).toThrow();
      });

      it('should accept task at maximum length (50000)', () => {
        const maxTask = 'a'.repeat(50000);
        const result = CreateDispatchSchema.parse({
          ...validInput,
          task: maxTask,
        });
        expect(result.task.length).toBe(50000);
      });

      it('should reject task exceeding maximum length', () => {
        const tooLongTask = 'a'.repeat(50001);
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            task: tooLongTask,
          })
        ).toThrow();
      });
    });

    describe('timeout validation', () => {
      it('should accept valid timeout values', () => {
        expect(CreateDispatchSchema.parse({ ...validInput, timeoutSeconds: 30 }).timeoutSeconds).toBe(30);
        expect(CreateDispatchSchema.parse({ ...validInput, timeoutSeconds: 600 }).timeoutSeconds).toBe(600);
        expect(CreateDispatchSchema.parse({ ...validInput, timeoutSeconds: 86400 }).timeoutSeconds).toBe(86400);
      });

      it('should reject timeout below minimum (30)', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            timeoutSeconds: 29,
          })
        ).toThrow();
      });

      it('should reject timeout above maximum (86400)', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            timeoutSeconds: 86401,
          })
        ).toThrow();
      });

      it('should default to 600', () => {
        const result = CreateDispatchSchema.parse(validInput);
        expect(result.timeoutSeconds).toBe(600);
      });
    });

    describe('repo validation', () => {
      it('should accept valid owner/repo format', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          repo: 'owner/repo-name',
        });
        expect(result.repo).toBe('owner/repo-name');
      });

      it('should accept repo with numbers and dashes', () => {
        const result = CreateDispatchSchema.parse({
          ...validInput,
          repo: 'my-org123/my-repo-456',
        });
        expect(result.repo).toBe('my-org123/my-repo-456');
      });

      it('should reject invalid repo format', () => {
        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            repo: 'not-a-valid-repo',
          })
        ).toThrow();

        expect(() =>
          CreateDispatchSchema.parse({
            ...validInput,
            repo: 'owner/repo/extra',
          })
        ).toThrow();
      });
    });
  });

  describe('ListDispatchesQuerySchema', () => {
    describe('tags filter validation', () => {
      it('should accept tags filter', () => {
        const result = ListDispatchesQuerySchema.parse({
          tags: { env: 'prod', team: 'backend' },
        });
        expect(result.tags).toEqual({ env: 'prod', team: 'backend' });
      });

      it('should accept empty tags filter', () => {
        const result = ListDispatchesQuerySchema.parse({
          tags: {},
        });
        expect(result.tags).toEqual({});
      });

      it('should accept undefined tags filter', () => {
        const result = ListDispatchesQuerySchema.parse({});
        expect(result.tags).toBeUndefined();
      });
    });

    it('should validate limit range', () => {
      expect(ListDispatchesQuerySchema.parse({ limit: 1 }).limit).toBe(1);
      expect(ListDispatchesQuerySchema.parse({ limit: 100 }).limit).toBe(100);
      expect(() => ListDispatchesQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() => ListDispatchesQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('should default limit to 20', () => {
      const result = ListDispatchesQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });
  });

  describe('DispatchResponseSchema', () => {
    const validResponse = {
      dispatchId: 'TEST123',
      status: 'running',
      agent: 'claude',
      modelId: 'claude-opus-4-5-20251101',
      task: 'Test task',
      progress: 50,
    };

    it('should accept idempotent flag', () => {
      const result = DispatchResponseSchema.parse({
        ...validResponse,
        idempotent: true,
      });
      expect(result.idempotent).toBe(true);
    });

    it('should accept tags in response', () => {
      const result = DispatchResponseSchema.parse({
        ...validResponse,
        tags: { env: 'test' },
      });
      expect(result.tags).toEqual({ env: 'test' });
    });

    it('should accept undefined optional fields', () => {
      const result = DispatchResponseSchema.parse(validResponse);
      expect(result.idempotent).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.logs).toBeUndefined();
    });

    it('should validate progress range', () => {
      expect(DispatchResponseSchema.parse({ ...validResponse, progress: 0 }).progress).toBe(0);
      expect(DispatchResponseSchema.parse({ ...validResponse, progress: 100 }).progress).toBe(100);
      expect(() => DispatchResponseSchema.parse({ ...validResponse, progress: -1 })).toThrow();
      expect(() => DispatchResponseSchema.parse({ ...validResponse, progress: 101 })).toThrow();
    });
  });

  describe('AgentTypeSchema', () => {
    it('should accept all valid agent types', () => {
      expect(AgentTypeSchema.parse('claude')).toBe('claude');
      expect(AgentTypeSchema.parse('codex')).toBe('codex');
      expect(AgentTypeSchema.parse('gemini')).toBe('gemini');
      expect(AgentTypeSchema.parse('aider')).toBe('aider');
      expect(AgentTypeSchema.parse('grok')).toBe('grok');
    });

    it('should reject invalid agent types', () => {
      expect(() => AgentTypeSchema.parse('invalid')).toThrow();
      expect(() => AgentTypeSchema.parse('')).toThrow();
      expect(() => AgentTypeSchema.parse('Claude')).toThrow(); // Case sensitive
    });
  });

  describe('ContextLevelSchema', () => {
    it('should accept all valid context levels', () => {
      expect(ContextLevelSchema.parse('minimal')).toBe('minimal');
      expect(ContextLevelSchema.parse('standard')).toBe('standard');
      expect(ContextLevelSchema.parse('full')).toBe('full');
    });

    it('should reject invalid context levels', () => {
      expect(() => ContextLevelSchema.parse('invalid')).toThrow();
      expect(() => ContextLevelSchema.parse('maximum')).toThrow();
    });
  });

  describe('WorkspaceModeSchema', () => {
    it('should accept valid workspace modes', () => {
      expect(WorkspaceModeSchema.parse('ephemeral')).toBe('ephemeral');
      expect(WorkspaceModeSchema.parse('persistent')).toBe('persistent');
    });

    it('should reject invalid workspace modes', () => {
      expect(() => WorkspaceModeSchema.parse('temporary')).toThrow();
      expect(() => WorkspaceModeSchema.parse('invalid')).toThrow();
    });
  });
});
