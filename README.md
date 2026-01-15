# Outpost

**Multi-Agent Fleet Orchestration Platform** | **v2.0.0**

> *"The execution backbone for distributed AI-powered software engineering."*

---

## Executive Summary

**Outpost** is a production-grade, multi-tenant platform that transforms single-agent AI assistants into distributed fleets of specialized AI workers. By orchestrating five distinct AI models (Claude, Codex, Gemini, Aider, Grok) across isolated ECS Fargate containers, Outpost enables parallel task execution, intelligent model selection, and enterprise-scale software development automation.

**Key Differentiators:**
- **Multi-Agent Parallelism:** Execute tasks across 5 agents simultaneously (up to 25 concurrent workers)
- **Workspace Isolation:** Cryptographic tenant separation with ephemeral or persistent workspaces
- **Model Tier Intelligence:** Automatic resource allocation based on model capability class
- **Cost Event Decoupling:** Flexible billing integration via EventBridge (supports subscription, per-task, and hybrid models)
- **Zero-Credential Client Access:** Simple HTTP REST API requires only an API key (no AWS credentials)

**Primary Architect:** Richie G. Suarez
**Organization:** Zero Echelon LLC
**Status:** Production (v2.0.0)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER                                       │
│                                                                              │
│   ┌────────────────┐    ┌────────────────┐    ┌────────────────┐           │
│   │  Claude Code   │    │   MCPify MCP   │    │   REST API     │           │
│   │  (CLI/UI)      │    │   Gateway      │    │   Consumers    │           │
│   └───────┬────────┘    └───────┬────────┘    └───────┬────────┘           │
│           │                     │                     │                     │
│           └─────────────────────┴─────────────────────┘                     │
│                                 │                                           │
│                         HTTP POST /dispatch                                 │
│                     (X-API-Key authentication)                              │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         AWS INFRASTRUCTURE                                    │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                  APPLICATION LOAD BALANCER (ALB)                      │  │
│   │              outpost-control-plane-dev-140603164                      │  │
│   │                  Health checks: /health (fast path)                   │  │
│   └──────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                       │
│   ┌──────────────────────────────────▼───────────────────────────────────┐  │
│   │               ECS FARGATE CONTROL PLANE (Stateless)                   │  │
│   │                                                                       │  │
│   │   ┌─────────────────────────────────────────────────────────────┐   │  │
│   │   │  Express.js HTTP API                                         │   │  │
│   │   │  ├─ POST /dispatch     Create task, launch worker           │   │  │
│   │   │  ├─ GET  /dispatch/:id Poll status, stream logs             │   │  │
│   │   │  ├─ DELETE /dispatch/:id Cancel running task                │   │  │
│   │   │  ├─ GET  /health       ALB health check (bypasses auth)     │   │  │
│   │   │  ├─ GET  /fleet        Fleet status and availability        │   │  │
│   │   │  └─ POST /promote      Push workspace to GitHub             │   │  │
│   │   └─────────────────────────────────────────────────────────────┘   │  │
│   │                                                                       │  │
│   │   ┌─────────────────────────────────────────────────────────────┐   │  │
│   │   │  Core Services                                               │   │  │
│   │   │  ├─ PoolManager      Worker allocation & lifecycle          │   │  │
│   │   │  ├─ Dispatcher       Request orchestration                  │   │  │
│   │   │  ├─ TaskLauncher     ECS RunTaskCommand                     │   │  │
│   │   │  ├─ SecretInjector   Secrets Manager integration            │   │  │
│   │   │  ├─ WorkspaceHandler EFS mount & S3 archive                 │   │  │
│   │   │  ├─ StatusTracker    Real-time dispatch status              │   │  │
│   │   │  └─ AuditLogger      DynamoDB audit trail                   │   │  │
│   │   └─────────────────────────────────────────────────────────────┘   │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                             RunTaskCommand                                   │
│                                      │                                       │
│   ┌──────────────────────────────────▼───────────────────────────────────┐  │
│   │               ECS FARGATE WORKER POOL (Auto-Scaling)                  │  │
│   │                                                                       │  │
│   │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │  │
│   │   │ CLAUDE  │ │ CODEX   │ │ GEMINI  │ │ AIDER   │ │  GROK   │       │  │
│   │   │ Opus 4.5│ │ GPT-5.2 │ │ 3 Pro   │ │DeepSeek │ │ Grok-4.1│       │  │
│   │   │         │ │         │ │ Preview │ │ Coder   │ │         │       │  │
│   │   │Flagship │ │Balanced │ │Balanced │ │  Fast   │ │  Fast   │       │  │
│   │   │2048 CPU │ │1024 CPU │ │1024 CPU │ │ 512 CPU │ │ 512 CPU │       │  │
│   │   │4096 MB  │ │2048 MB  │ │2048 MB  │ │1024 MB  │ │1024 MB  │       │  │
│   │   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │  │
│   │        │           │           │           │           │             │  │
│   │        └───────────┴───────────┼───────────┴───────────┘             │  │
│   │                                │                                     │  │
│   │                    ┌───────────▼───────────┐                         │  │
│   │                    │   ISOLATED WORKSPACE  │                         │  │
│   │                    │   (EFS Mount Point)   │                         │  │
│   │                    │                       │                         │  │
│   │                    │  ├─ Git repo clone    │                         │  │
│   │                    │  ├─ Task execution    │                         │  │
│   │                    │  ├─ Artifact output   │                         │  │
│   │                    │  └─ S3 archive (opt)  │                         │  │
│   │                    └───────────────────────┘                         │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │                      PERSISTENCE LAYER                              │    │
│   │                                                                     │    │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│   │  │  DynamoDB    │  │     S3       │  │  Secrets     │             │    │
│   │  │              │  │              │  │  Manager     │             │    │
│   │  │ ├─ jobs      │  │ ├─ artifacts │  │              │             │    │
│   │  │ ├─ api-keys  │  │ ├─ logs      │  │ ├─ API keys  │             │    │
│   │  │ ├─ audit     │  │ └─ workspaces│  │ └─ Agent creds│            │    │
│   │  │ └─ workspaces│  │              │  │              │             │    │
│   │  └──────────────┘  └──────────────┘  └──────────────┘             │    │
│   │                                                                     │    │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│   │  │ CloudWatch   │  │ EventBridge  │  │ CloudTrail   │             │    │
│   │  │              │  │              │  │              │             │    │
│   │  │ ├─ Logs      │  │ Cost events  │  │ AWS API      │             │    │
│   │  │ └─ Metrics   │  │ → Ledger     │  │ audit trail  │             │    │
│   │  └──────────────┘  └──────────────┘  └──────────────┘             │    │
│   └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Fleet Agents

| Agent | Model ID | Tier | Resources | Cost Model | Strengths |
|-------|----------|------|-----------|------------|-----------|
| **Claude Code** | `claude-opus-4-5-20251101` | Flagship | 2 vCPU, 4 GB | $100/mo subscription | Complex reasoning, architecture, multi-file refactoring |
| **OpenAI Codex** | `gpt-5.2-codex` | Balanced | 1 vCPU, 2 GB | $20/mo subscription | Code generation, test writing, boilerplate |
| **Gemini CLI** | `gemini-3-pro-preview` | Balanced | 1 vCPU, 2 GB | $50/mo subscription | Documentation, analysis, broad context windows |
| **Aider** | `deepseek/deepseek-coder` | Fast | 0.5 vCPU, 1 GB | ~$0.14/MTok API | High-volume, cost-efficient, iterative editing |
| **Grok** | `grok-4.1` | Fast | 0.5 vCPU, 1 GB | xAI API pricing | Risk analysis, contrarian review, fast reasoning |

**Fleet Capacity:** Up to 25 concurrent workers (5 agents × 5 max concurrent each)
**Monthly Subscription Cost:** $170 (Claude + Codex + Gemini)
**API-Based Agents:** Aider (DeepSeek) and Grok (xAI) are pay-per-use

---

## Quick Start

### 1. Dispatch a Task

```bash
curl -X POST "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/dispatch" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "userId": "user-123",
    "agent": "claude",
    "task": "Refactor the authentication module to use JWT tokens",
    "repo": "myorg/myapp",
    "contextLevel": "standard",
    "timeoutSeconds": 600
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dispatchId": "01HXYZ...",
    "status": "PENDING",
    "agent": "claude",
    "estimatedStartTime": "2026-01-14T12:00:00Z"
  }
}
```

### 2. Poll Status

```bash
curl "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/dispatch/01HXYZ..." \
  -H "X-API-Key: YOUR_API_KEY"
```

### 3. Promote Changes to GitHub

```bash
curl -X POST "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com/promote" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "runId": "01HXYZ...",
    "createPr": true,
    "prTitle": "feat: Refactor auth to use JWT"
  }'
```

---

## Key Innovations

### 1. Ephemeral + Persistent Workspace Duality
Unlike competitors that offer only stateless execution, Outpost supports both:
- **Ephemeral (default):** Complete isolation, automatic cleanup, zero state leakage
- **Persistent:** Enables multi-step workflows, mid-task handoffs, and session continuity

### 2. Model Tier Resource Allocation
Resources automatically scale with model capability:
```
Flagship (Claude Opus)    → 2048 CPU, 4096 MB RAM, 20 GB storage
Balanced (Codex, Gemini)  → 1024 CPU, 2048 MB RAM, 10 GB storage
Fast (Aider, Grok)        → 512 CPU, 1024 MB RAM, 5 GB storage
```

### 3. ULID-Based Dispatch IDs
- Time-ordered, lexicographically sortable (unlike UUID)
- Natural chronological ordering in DynamoDB queries
- Collision-resistant with millisecond precision

### 4. Cost Event Decoupling
Billing events emit to EventBridge asynchronously:
- Dispatch doesn't wait for billing (zero latency impact)
- Enables flexible pricing models (subscription, per-task, hybrid)
- Future-proofs for enterprise billing integrations

### 5. Context Injection System
Tasks receive zeOS context (SOUL, profile, journals) for continuity-aware execution:

| Level | Token Budget | Sections Included |
|-------|--------------|-------------------|
| `minimal` | ~600 | SOUL, JOURNAL |
| `standard` | ~1,200 | SOUL, ANCHORS, PROFILE, JOURNAL |
| `full` | ~1,800 | All + ROADMAP |

---

## Performance Characteristics

### Latency Profile

| Scenario | Latency | Notes |
|----------|---------|-------|
| **Cold Start** | 25-45s | New ECS task launch + container init |
| **Warm Start** | ~1.2s | Reused worker from pool (25-30x faster) |
| **Status Poll** | 50-150ms | DynamoDB query |
| **Fleet Status** | 100-200ms | Aggregated worker state |

### Throughput

| Mode | Capacity | Cost Estimate |
|------|----------|---------------|
| Sequential | 2 jobs/min (30s avg) | Variable |
| Parallel (5 agents) | 20-40 jobs/min | ~$0.30/job |
| Full Fleet (25 workers) | 100+ jobs/min | At scale pricing |

### v1 SSM vs v2 HTTP Performance

| Metric | v1 (SSM) | v2 (HTTP) | Improvement |
|--------|----------|-----------|-------------|
| Dispatch Latency | 2-5s | 100-300ms | **10-50x faster** |
| Status Polling | 1-2s | 50-150ms | **10-20x faster** |
| Fleet Status | 5-10s | 100-200ms | **25-50x faster** |
| Scalability | 1 instance | Auto-scaling ECS | **Unlimited** |

---

## Security Model

### Authentication
- **API Key:** SHA-256 hashed, never stored in plaintext
- **Key Format:** `otp_` + 32 random bytes (72 chars total)
- **Scopes:** `dispatch`, `status`, `list`, `cancel`, `promote`, `admin`

### Tenant Isolation
- Per-tenant API keys with cryptographic isolation
- DynamoDB partition by `tenantId` (no cross-tenant queries possible)
- Workspace isolation via EFS access points

### Secrets Management
- Agent credentials stored in AWS Secrets Manager
- Secret injection at runtime (never in task definition)
- Audit logging for all secret access events

### Audit Trail
- All API calls logged to DynamoDB `audit` table
- CloudTrail for AWS API activity
- 90-day retention with automatic TTL cleanup

---

## Zero Echelon LLC Ecosystem

Outpost is the **execution backbone** of the Zero Echelon product portfolio:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Zero Echelon LLC                            │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                    MCPify Gateway                        │  │
│   │            Unified MCP tool interface                    │  │
│   └───────────────────────┬─────────────────────────────────┘  │
│                           │                                     │
│   ┌───────────┬───────────┼───────────┬───────────┐           │
│   │           │           │           │           │           │
│   ▼           ▼           ▼           ▼           ▼           │
│ Blueprint  Identity    OUTPOST     Ledger      zeOS          │
│ (Spec Gen) (Auth)    (Execution)  (Billing)  (Context)       │
│                           │                                    │
│                    ┌──────┴──────┐                             │
│                    │ Agent Fleet │                             │
│                    │ Claude      │                             │
│                    │ Codex       │                             │
│                    │ Gemini      │                             │
│                    │ Aider       │                             │
│                    │ Grok        │                             │
│                    └─────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### Product Integrations

| Product | Integration | Purpose |
|---------|-------------|---------|
| **MCPify** | HTTP Provider | Routes MCP tool calls to Outpost fleet |
| **Blueprint** | Python Client | Executes generated specifications |
| **Identity** | JWT/API Key Validation | Authentication and authorization |
| **Ledger** | EventBridge Events | Usage billing and revenue tracking |
| **zeOS** | Context Injection | Session continuity and project awareness |

See [ZERO_ECHELON_ECOSYSTEM.md](docs/ZERO_ECHELON_ECOSYSTEM.md) for detailed integration documentation.

---

## Documentation

### Getting Started
| Document | Description |
|----------|-------------|
| [INVOKE.md](INVOKE.md) | **Quick reference** — Copy-paste ready commands |
| [OUTPOST_INTERFACE.md](OUTPOST_INTERFACE.md) | Full API contract and specification |

### Architecture & Design
| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE_OVERVIEW.md](docs/ARCHITECTURE_OVERVIEW.md) | System architecture (single source of truth) |
| [docs/CONTROL_PLANE_ARCHITECTURE.md](docs/CONTROL_PLANE_ARCHITECTURE.md) | Deep dive into control plane design |
| [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md) | Security posture and threat model |

### Operations
| Document | Description |
|----------|-------------|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Step-by-step production deployment |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Terraform modules and AWS services |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [docs/ENV_SPECIFICATION.md](docs/ENV_SPECIFICATION.md) | Environment variables reference |

### Integration
| Document | Description |
|----------|-------------|
| [docs/ZERO_ECHELON_ECOSYSTEM.md](docs/ZERO_ECHELON_ECOSYSTEM.md) | Product portfolio integrations |
| [docs/API.md](docs/API.md) | REST API reference |
| [docs/MULTI_AGENT_INTEGRATION.md](docs/MULTI_AGENT_INTEGRATION.md) | Agent selection and use cases |

### Development
| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developer contribution guidelines |
| [docs/CONTEXT_INJECTION_SPEC.md](docs/CONTEXT_INJECTION_SPEC.md) | Context injection system |
| [CHANGELOG.md](CHANGELOG.md) | Version history and release notes |

---

## Roadmap

### Current: v2.0.0 (Production)
- ECS Fargate control plane (replaced SSM-based v1)
- HTTP REST API (no AWS credentials required)
- Multi-tenant isolation with per-tenant API keys
- 5-agent fleet with model tier resource allocation

### Planned: v2.1.0 (Q1 2026)
- WebSocket support for real-time log streaming
- Intelligent agent routing (ML-based task classification)
- Multi-tenant usage dashboards
- Secret rotation automation

### Planned: v3.0.0 (Q2 2026)
- BYOK (Bring Your Own Keys) for enterprise customers
- REST SDK releases (Python, TypeScript, Go)
- SLA guarantees (99.5% uptime)
- Multi-region failover

---

## Infrastructure

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **ECS Fargate** | Control plane + worker containers | us-east-1, ARM64 |
| **Application Load Balancer** | HTTPS ingress, health checks | Public-facing |
| **DynamoDB** | Job state, API keys, audit logs | PAY_PER_REQUEST, PITR enabled |
| **S3** | Large outputs, workspace archives | Lifecycle policies |
| **Secrets Manager** | Agent credentials, API keys | Automatic rotation |
| **CloudWatch** | Logs, metrics, alarms | 7-day retention |
| **EventBridge** | Cost events to Ledger | Async decoupling |
| **CloudTrail** | AWS API audit trail | 90-day retention |

---

## Cost Structure

### Fixed Costs (Monthly)
| Item | Cost |
|------|------|
| Claude Code subscription | $100 |
| OpenAI Codex subscription | $20 |
| Gemini CLI subscription | $50 |
| **Subtotal (Agent Subscriptions)** | **$170** |

### Variable Costs (Per-Use)
| Item | Cost |
|------|------|
| Aider (DeepSeek API) | ~$0.14/MTok |
| Grok (xAI API) | Variable |
| ECS Fargate compute | ~$0.05/vCPU-hour |
| DynamoDB (PAY_PER_REQUEST) | ~$1.25/million requests |
| S3 storage | ~$0.023/GB-month |

### Estimated Monthly (1000 Tasks)
| Scenario | Estimated Cost |
|----------|----------------|
| Light usage (100 tasks) | ~$190 |
| Standard usage (1000 tasks) | ~$250 |
| Heavy usage (10000 tasks) | ~$500 |

---

## License

Proprietary. Copyright 2026 Zero Echelon LLC. All rights reserved.

---

## Credits

**Primary Architect & Visionary:** Richie G. Suarez
**Organization:** Zero Echelon LLC
**Contact:** [Zero Echelon LLC](https://zeroechelon.com)

---

*Outpost v2.0.0 — Multi-Agent Fleet Orchestration Platform*
*"The execution backbone for distributed AI-powered software engineering."*
