# Contributing to Outpost

> **Guidelines for contributing to the Outpost multi-agent fleet platform**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Maintained by:** Richie G. Suarez, Zero Echelon LLC

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Submitting Changes](#submitting-changes)
8. [Documentation](#documentation)
9. [Security](#security)

---

## Code of Conduct

This project adheres to professional standards of conduct. Contributors are expected to:

- Be respectful and constructive in all interactions
- Focus on technical merit in discussions
- Protect confidential information and credentials
- Follow security best practices

---

## Getting Started

### Prerequisites

- **Node.js:** v20 LTS or later
- **Python:** 3.11+ (for legacy components)
- **Docker:** 24.0+ (for container builds)
- **AWS CLI:** v2 with configured credentials
- **Terraform:** 1.5+ (for infrastructure changes)
- **Git:** 2.40+

### Required Access

| Resource | Purpose | How to Request |
|----------|---------|----------------|
| GitHub repo | Code access | Request from maintainer |
| AWS soc profile | Infrastructure | Contact Richie G. Suarez |
| ECR registry | Container push | Granted with AWS access |
| Secrets Manager | API keys | Granted with AWS access |

---

## Development Setup

### 1. Clone the Repository

```bash
git clone git@github.com:rgsuarez/outpost.git
cd outpost
```

### 2. Install Control Plane Dependencies

```bash
cd src/control-plane
npm install
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit with your local configuration
# Required variables:
# - AWS_REGION=us-east-1
# - AWS_PROFILE=soc
# - NODE_ENV=development
```

### 4. Run Control Plane Locally

```bash
# Development mode (hot reload)
npm run dev

# Production build
npm run build && npm start
```

### 5. Run Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Full test suite with coverage
npm run test:coverage
```

---

## Project Structure

```
outpost/
├── src/
│   ├── control-plane/              # TypeScript control plane (v2.0)
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── routes/         # Express route definitions
│   │   │   │   ├── handlers/       # Request handlers
│   │   │   │   └── middleware/     # Auth, validation, logging
│   │   │   ├── services/           # Business logic
│   │   │   │   ├── dispatcher.ts   # Task orchestration
│   │   │   │   ├── pool-manager.ts # Worker lifecycle
│   │   │   │   └── workspace-handler.ts
│   │   │   ├── repositories/       # DynamoDB data access
│   │   │   ├── models/             # TypeScript interfaces
│   │   │   ├── types/              # Type definitions
│   │   │   └── utils/              # Config, logger, errors
│   │   ├── __tests__/              # Jest test suites
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── outpost/                    # Python legacy (v1.x, SSM-based)
│   │   ├── worker/                 # Job poller
│   │   ├── models/                 # SQLAlchemy ORM
│   │   └── services/               # Business services
│   │
│   └── mcp/                        # MCPify integration schemas
│
├── containers/                     # Docker container definitions
│   ├── base/                       # Base image (Node + Rust)
│   ├── claude/                     # Claude Code container
│   ├── codex/                      # OpenAI Codex container
│   ├── gemini/                     # Gemini CLI container
│   ├── aider/                      # Aider container
│   └── grok/                       # Grok container
│
├── infrastructure/
│   └── terraform/                  # Infrastructure as Code
│       ├── modules/                # Reusable modules
│       │   ├── alb/
│       │   ├── ecs/
│       │   ├── dynamodb/
│       │   ├── efs/
│       │   ├── vpc/
│       │   └── ...
│       └── environments/
│           ├── dev/
│           └── prod/
│
├── scripts/                        # Operational scripts
│   ├── dispatch-unified.sh         # Main dispatcher
│   ├── dispatch-*.sh               # Per-agent wrappers
│   └── assemble-context.sh         # Context injection
│
├── frontend/                       # Next.js dashboard (planned)
│
├── docs/                           # Documentation
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── ...
│
├── tests/                          # Test suites
│   ├── unit/
│   ├── integration/
│   ├── performance/
│   └── security/
│
├── session-journals/               # zeOS session continuity
│
├── README.md
├── CONTRIBUTING.md                 # This file
├── CHANGELOG.md
└── package.json                    # Root package (workspaces)
```

---

## Coding Standards

### TypeScript (Control Plane)

**Style Guide:** Follow the existing codebase patterns

```typescript
// File naming: kebab-case
// dispatch.handler.ts, pool-manager.ts

// Interfaces: PascalCase with 'I' prefix optional
interface DispatchRequest {
  userId: string;
  agent: AgentType;
  task: string;
}

// Types: PascalCase
type AgentType = 'claude' | 'codex' | 'gemini' | 'aider' | 'grok';

// Functions: camelCase
async function createDispatch(request: DispatchRequest): Promise<DispatchResult> {
  // Implementation
}

// Constants: SCREAMING_SNAKE_CASE
const MAX_TASK_LENGTH = 50000;
const DEFAULT_TIMEOUT_SECONDS = 600;

// Classes: PascalCase
class DispatcherService {
  // Use private fields with underscore
  private readonly _repository: DispatchRepository;

  constructor(repository: DispatchRepository) {
    this._repository = repository;
  }
}
```

**JSDoc Requirements:**

```typescript
/**
 * Creates a new dispatch request and launches an ECS worker task.
 *
 * @param request - The dispatch request parameters
 * @param request.userId - Unique identifier for the requesting user
 * @param request.agent - The agent type to use for execution
 * @param request.task - The task description (max 50,000 chars)
 * @returns Promise resolving to the dispatch result with status
 * @throws {ValidationError} When request validation fails
 * @throws {ServiceUnavailableError} When worker pool is exhausted
 *
 * @example
 * const result = await createDispatch({
 *   userId: 'user-123',
 *   agent: 'claude',
 *   task: 'Refactor the auth module'
 * });
 */
async function createDispatch(request: DispatchRequest): Promise<DispatchResult> {
  // Implementation
}
```

### Python (Legacy Components)

**Style Guide:** PEP 8 with type hints

```python
from typing import Optional, List
from dataclasses import dataclass

@dataclass
class DispatchRequest:
    """Request parameters for creating a dispatch."""
    user_id: str
    agent: str
    task: str
    timeout_seconds: int = 600


def create_dispatch(request: DispatchRequest) -> DispatchResult:
    """
    Create a new dispatch and launch worker.

    Args:
        request: The dispatch request parameters

    Returns:
        DispatchResult with status and dispatch ID

    Raises:
        ValidationError: When request validation fails
    """
    pass
```

### Terraform (Infrastructure)

```hcl
# Resource naming: lowercase with hyphens
resource "aws_ecs_service" "control-plane" {
  name = "outpost-control-plane-${var.environment}"

  # Group related arguments
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.control-plane.arn
  desired_count   = var.desired_count

  # Add tags for all resources
  tags = merge(var.common_tags, {
    Name = "outpost-control-plane-${var.environment}"
  })
}

# Variables: descriptive names with validation
variable "desired_count" {
  description = "Number of control plane instances to run"
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 1 && var.desired_count <= 10
    error_message = "Desired count must be between 1 and 10."
  }
}
```

---

## Testing

### Test Categories

| Category | Location | Command | Purpose |
|----------|----------|---------|---------|
| Unit | `src/control-plane/__tests__/` | `npm test` | Service logic |
| Integration | `tests/integration/` | `npm run test:integration` | API endpoints |
| Performance | `tests/performance/` | `npm run test:performance` | Load testing |
| Security | `tests/security/` | `npm run test:security` | Vulnerability scanning |
| Smoke | `tests/smoke/` | `npm run test:smoke` | Basic functionality |

### Writing Unit Tests

```typescript
// __tests__/services/dispatcher.test.ts
import { DispatcherService } from '../../src/services/dispatcher';
import { MockDispatchRepository } from '../mocks/repositories';

describe('DispatcherService', () => {
  let service: DispatcherService;
  let mockRepository: MockDispatchRepository;

  beforeEach(() => {
    mockRepository = new MockDispatchRepository();
    service = new DispatcherService(mockRepository);
  });

  describe('createDispatch', () => {
    it('should create dispatch with valid request', async () => {
      const request = {
        userId: 'user-123',
        agent: 'claude' as const,
        task: 'Test task'
      };

      const result = await service.createDispatch(request);

      expect(result.status).toBe('PENDING');
      expect(result.dispatchId).toBeDefined();
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    it('should throw ValidationError for empty task', async () => {
      const request = {
        userId: 'user-123',
        agent: 'claude' as const,
        task: ''
      };

      await expect(service.createDispatch(request))
        .rejects
        .toThrow('Task cannot be empty');
    });
  });
});
```

### Test Coverage Requirements

- **Minimum:** 80% line coverage
- **Target:** 90% line coverage
- **Critical paths:** 100% coverage required

```bash
# Run with coverage report
npm run test:coverage

# Coverage thresholds (configured in jest.config.js)
# branches: 80
# functions: 80
# lines: 80
# statements: 80
```

---

## Submitting Changes

### Branch Naming

```
feature/   # New features
fix/       # Bug fixes
docs/      # Documentation only
refactor/  # Code refactoring
test/      # Test additions/changes
infra/     # Infrastructure changes
```

**Examples:**
- `feature/websocket-streaming`
- `fix/dispatch-timeout-handling`
- `docs/api-reference-update`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Tests
- `chore`: Maintenance

**Examples:**

```bash
# Feature
git commit -m "feat(dispatch): add WebSocket streaming support

- Implement WebSocket handler for real-time log streaming
- Add client reconnection logic
- Update API documentation

Closes #123"

# Bug fix
git commit -m "fix(pool-manager): prevent worker leak on timeout

Workers were not being released when tasks timed out,
causing pool exhaustion after ~20 dispatches.

Root cause: Missing cleanup in error handler.
Solution: Add finally block to ensure worker release.

Fixes #456"
```

### Pull Request Process

1. **Create feature branch** from `main`
2. **Make changes** following coding standards
3. **Run tests** locally: `npm test && npm run lint`
4. **Push branch** to GitHub
5. **Open PR** with template:

```markdown
## Summary
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Infrastructure

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No secrets in code
```

6. **Address review feedback**
7. **Merge** after approval

---

## Documentation

### When to Update Documentation

- New features require corresponding docs
- API changes require API.md update
- Configuration changes require ENV_SPECIFICATION.md update
- Architecture changes require ARCHITECTURE_OVERVIEW.md update

### Documentation Standards

```markdown
# Title

**Document Version:** X.Y.Z
**Last Updated:** YYYY-MM-DD
**Author:** Name

---

## Section

Clear, concise content with:
- Bullet points for lists
- Code blocks with language tags
- Tables for structured data

### Subsection

Detailed information.

```code
Example code with proper formatting
```

---

*Footer with context*
```

---

## Security

### Critical Rules

1. **Never commit credentials** to the repository
2. **Use Secrets Manager** for all sensitive values
3. **Validate all inputs** at API boundaries
4. **Follow least-privilege** for IAM roles
5. **Report vulnerabilities** to maintainer privately

### Credential Handling

```typescript
// WRONG: Hardcoded credentials
const apiKey = 'sk-1234567890abcdef';

// CORRECT: From environment or Secrets Manager
const apiKey = process.env.API_KEY;
// or
const apiKey = await secretsManager.getSecret('api-key');
```

### Security Testing

```bash
# Run security scan
npm run test:security

# Check for vulnerabilities
npm audit

# Scan Docker images
docker scan outpost-control-plane:latest
```

### Reporting Security Issues

**Do NOT** open public issues for security vulnerabilities.

Contact: security@zeroechelon.com (or maintainer directly)

Include:
- Description of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if known)

---

## Questions & Support

- **Documentation:** See `/docs/` directory
- **Issues:** GitHub Issues (non-security)
- **Maintainer:** Richie G. Suarez

---

*Thank you for contributing to Outpost!*
*Zero Echelon LLC*
