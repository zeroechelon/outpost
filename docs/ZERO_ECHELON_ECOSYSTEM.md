# Zero Echelon LLC Product Ecosystem

> **Outpost's Role in the Zero Echelon Infrastructure**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Author:** Richie G. Suarez

---

## Executive Summary

Outpost serves as the **execution backbone** of Zero Echelon LLC's AI infrastructure portfolio. It transforms single-agent interactions into distributed, multi-agent workflows by orchestrating five specialized AI models across isolated ECS Fargate containers. This document details how Outpost integrates with each product in the Zero Echelon ecosystem.

---

## Ecosystem Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ZERO ECHELON LLC                                    │
│                     AI Infrastructure Portfolio                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        USER INTERFACES                                  │ │
│  │                                                                         │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │   │  Commander   │  │  Geaux File  │  │ Swords of    │                │ │
│  │   │  (zeOS CLI)  │  │  (SaaS)      │  │ Chaos (Game) │                │ │
│  │   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │ │
│  │          │                 │                 │                         │ │
│  └──────────┼─────────────────┼─────────────────┼─────────────────────────┘ │
│             │                 │                 │                           │
│             └─────────────────┼─────────────────┘                           │
│                               │                                             │
│  ┌────────────────────────────▼────────────────────────────────────────────┐│
│  │                      MCPify GATEWAY                                      ││
│  │              Unified MCP Tool Interface (v2.0.0)                        ││
│  │                                                                          ││
│  │  Available Providers:                                                    ││
│  │  ├─ outpost      (fleet execution)                                      ││
│  │  ├─ blueprint    (spec generation)                                      ││
│  │  ├─ ledger       (billing)                                              ││
│  │  ├─ identity     (auth)                                                 ││
│  │  ├─ awsaudit     (compliance)                                           ││
│  │  └─ ...          (12 providers total)                                   ││
│  └────────────────────────────┬────────────────────────────────────────────┘│
│                               │                                             │
│  ┌───────────┬────────────────┼────────────────┬───────────────┐           │
│  │           │                │                │               │           │
│  ▼           ▼                ▼                ▼               ▼           │
│┌──────────┐┌──────────┐┌────────────┐┌──────────┐┌──────────┐             │
││Blueprint ││Identity  ││  OUTPOST   ││ Ledger   ││  zeOS    │             │
││          ││          ││            ││          ││          │             │
││Spec Gen  ││Auth &    ││ EXECUTION  ││Financial ││Context   │             │
││Engine    ││AuthZ     ││ BACKBONE   ││Tracking  ││Memory    │             │
│└────┬─────┘└────┬─────┘└─────┬──────┘└────┬─────┘└────┬─────┘             │
│     │           │            │            │           │                   │
│     │           │     ┌──────┴──────┐     │           │                   │
│     │           │     │ AGENT FLEET │     │           │                   │
│     │           │     │             │     │           │                   │
│     │           │     │ ┌─────────┐ │     │           │                   │
│     │           │     │ │ Claude  │ │     │           │                   │
│     │           │     │ │ Codex   │ │     │           │                   │
│     │           │     │ │ Gemini  │ │     │           │                   │
│     │           │     │ │ Aider   │ │     │           │                   │
│     │           │     │ │ Grok    │ │     │           │                   │
│     │           │     │ └─────────┘ │     │           │                   │
│     │           │     └─────────────┘     │           │                   │
│     │           │            │            │           │                   │
│     └───────────┴────────────┼────────────┴───────────┘                   │
│                              │                                             │
│                    ┌─────────▼─────────┐                                   │
│                    │   AWS SERVICES    │                                   │
│                    │                   │                                   │
│                    │ ECS, DynamoDB, S3 │                                   │
│                    │ Secrets, CloudWatch│                                  │
│                    └───────────────────┘                                   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Product Integration Details

### 1. MCPify (MCP Gateway)

**Type:** Infrastructure / Gateway
**Purpose:** Unified MCP (Model Context Protocol) entry point for all zeOS services
**Version:** v2.0.0
**Repository:** `rgsuarez/mcpify`

#### Integration with Outpost

**Connection Type:** HTTP REST API (v2.0)
**Endpoint:** `http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com`

**MCP Tools Exposed:**

| Tool | Purpose | HTTP Endpoint |
|------|---------|---------------|
| `outpost:dispatch` | Create task, launch agent | `POST /dispatch` |
| `outpost:get_run` | Retrieve run status & logs | `GET /dispatch/:id` |
| `outpost:list_runs` | List recent executions | `GET /runs` |
| `outpost:promote` | Push workspace to GitHub | `POST /promote` |
| `outpost:fleet_status` | Check agent availability | `GET /fleet` |
| `outpost:cancel` | Cancel running task | `DELETE /dispatch/:id` |

**Request Flow:**
```
Claude Code (MCP Consumer)
         │
         │ MCP tool_use: outpost:dispatch
         ▼
MCPify MCP Server (stdio transport)
         │
         │ HTTP POST /dispatch
         ▼
Outpost Control Plane (ALB → ECS)
         │
         │ RunTaskCommand
         ▼
ECS Fargate Worker (Agent Container)
```

**Configuration:**
```json
{
  "mcpServers": {
    "mcpify": {
      "command": "node",
      "args": ["/path/to/mcpify/dist/server.js"],
      "env": {
        "OUTPOST_API_URL": "http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com",
        "AWS_REGION": "us-east-1",
        "AWS_PROFILE": "soc"
      }
    }
  }
}
```

**Key Innovation:** MCPify v2.1.0 introduced **dual-mode architecture** supporting both HTTP (v2 ECS) and SSM (v1 legacy) with automatic detection via environment variables.

---

### 2. Blueprint (Specification Compiler)

**Type:** Infrastructure / Spec Generation Engine
**Purpose:** Convert natural language goals to executable specifications
**Classification:** MISSION_CRITICAL_INFRASTRUCTURE
**Version:** v2.5.2
**Repository:** `rgsuarez/blueprint`

#### Integration with Outpost

**Connection Type:** Python HTTP Client
**Library:** `blueprint.outpost.client.OutpostClient`

**Usage Pattern:**
```python
from blueprint.outpost.client import OutpostClient
from blueprint.outpost.types import AgentType, ContextLevel

# Generate a blueprint specification
spec = blueprint.generate("Implement user authentication", depth=3)

# Execute specification via Outpost
with OutpostClient() as client:
    dispatch = client.dispatch(
        agent=AgentType.CLAUDE,
        task=spec.as_task_prompt(),
        repo="myorg/myapp",
        context_level=ContextLevel.STANDARD,
        timeout_seconds=600
    )

    # Wait for completion
    result = client.wait_for_completion(dispatch.dispatch_id)
    print(f"Status: {result.status}")
```

**Execution Flow:**
```
User Goal: "Add JWT authentication"
         │
         │ blueprint.generate()
         ▼
Blueprint Specification (.bp.md)
         │
         │ Parsed into task prompt
         ▼
OutpostClient.dispatch()
         │
         │ HTTP POST /dispatch
         ▼
Outpost → Agent executes spec
         │
         │ Changes committed
         ▼
OutpostClient.wait_for_completion()
         │
         │ Polls until COMPLETED/FAILED
         ▼
Result with logs, diff, artifacts
```

**Why This Matters:**
Blueprint's core value proposition—generating specifications for multi-agent execution—**requires Outpost** to actually execute those specifications. Without Outpost, Blueprint specs are documents; with Outpost, they become automated workflows.

---

### 3. Identity (Authentication & Authorization)

**Type:** SaaS / Infrastructure Service
**Purpose:** Unified identity layer for zeOS products
**Version:** v1.0.0
**Repository:** `rgsuarez/identity`

#### Integration with Outpost

**Connection Type:** JWT Validation + API Key Vault
**Protocol:** OAuth 2.0, JWT (RS256)

**Authentication Flow:**
```
User Login (Google OAuth)
         │
         │ Identity.POST /auth/google
         ▼
JWT Token Issued (contains: userId, tenantId, scopes)
         │
         │ Token stored in Claude Code session
         ▼
MCPify includes JWT in Outpost calls
         │
         │ Authorization: Bearer <jwt>
         ▼
Outpost ALB validates JWT signature
         │
         │ Extract tenantId for isolation
         ▼
Request authorized → Dispatch proceeds
```

**API Key Management:**
```
Outpost Dispatch Request (with API Key)
         │
         │ X-API-Key: otp_xxx...
         ▼
Outpost Control Plane
         │
         │ Hash key, lookup in DynamoDB
         ▼
Identity.GET /keys/validate (optional external validation)
         │
         │ Check subscription tier + usage quota
         ▼
Return: authorized | 401 Unauthorized | 402 Payment Required
```

**Key Vault Integration:**
Identity manages encrypted storage of third-party API keys (Anthropic, OpenAI, Google, xAI, DeepSeek) that agents need:

```
Outpost Task Launch
         │
         │ Request: additionalSecrets: ["OPENAI_API_KEY"]
         ▼
SecretInjector Service
         │
         │ Fetch from AWS Secrets Manager
         ▼
Agent container receives decrypted key
         │
         │ Key available as environment variable
         ▼
Agent executes with access to external API
```

---

### 4. Ledger (Financial Accounting)

**Type:** SaaS / Financial Infrastructure
**Purpose:** Audit-ready accounting system for Zero Echelon portfolio
**Version:** Phase 3 (Security Hardening)
**Repository:** `rgsuarez/ledger`

#### Integration with Outpost

**Connection Type:** EventBridge (Async Cost Events)
**Protocol:** CloudEvents JSON

**Cost Event Flow:**
```
Outpost Dispatch Completes
         │
         │ Usage metrics collected
         ▼
EventBridge.PutEvents()
         │
         │ Event: outpost.dispatch.completed
         ▼
EventBridge Rule → Ledger SQS Queue
         │
         │ Ledger worker processes event
         ▼
Ledger Billing Engine
         │
         │ 1. Lookup customer subscription tier
         │ 2. Calculate charges
         │ 3. Create journal entry
         │ 4. Update usage quota
         ▼
Double-entry recorded:
  Debit: Accounts Receivable
  Credit: Service Revenue (Outpost)
```

**Cost Event Schema:**
```json
{
  "source": "outpost",
  "type": "outpost.dispatch.completed",
  "data": {
    "dispatchId": "01HXYZ...",
    "tenantId": "tenant-123",
    "userId": "user-456",
    "agent": "claude",
    "modelId": "claude-opus-4-5-20251101",
    "tier": "flagship",
    "durationSeconds": 45,
    "tokensInput": 5000,
    "tokensOutput": 3000,
    "resourceUnits": {
      "cpuSeconds": 90,
      "memoryMBSeconds": 180000
    },
    "completedAt": "2026-01-14T12:00:45Z"
  }
}
```

**Revenue Recognition:**
- Per-agent subscription costs tracked monthly
- Per-job billing for API-based agents (Aider, Grok)
- Usage-based pricing for enterprise customers
- All transactions audit-ready for tax reporting

---

### 5. zeOS (Operating System / Orchestration Kernel)

**Type:** Infrastructure / Meta-Framework
**Purpose:** Kernel for AI-augmented operator workflows
**Version:** v5.3.0
**Repository:** `rgsuarez/zeOS`

#### Integration with Outpost

**Connection Type:** Context Injection System
**Protocol:** File-based (SOUL, profile, journal) → Task prompt

**Context Injection Flow:**
```
zeOS Session
├─ SOUL.md (project identity)
├─ PROFILE.md (operator preferences)
├─ session-journals/*.md (recent state)
└─ ANCHORS (long-lived decisions)
         │
         │ assemble-context.sh
         ▼
Context Payload (token-budgeted)
         │
         │ Prepended to task prompt
         ▼
Outpost Dispatch (--context=standard)
         │
         │ Agent receives: context + task
         ▼
Agent executes with project awareness
```

**Context Levels:**

| Level | Token Budget | Sections Included |
|-------|--------------|-------------------|
| `minimal` | ~600 | SOUL, JOURNAL |
| `standard` | ~1,200 | SOUL, ANCHORS, PROFILE, JOURNAL |
| `full` | ~1,800 | All + ROADMAP |

**Provenance Logging:**
Each dispatch with context generates metadata:
```json
{
  "injection_id": "INJ-20260114-120000-abc123",
  "level": "standard",
  "sections": ["soul", "anchors", "profile", "journal"],
  "token_counts": { "total": 850 },
  "provenance": {
    "soul": "apps/myproject/PROJECT_SOUL.md",
    "journal": "session-journals/2026-01-14-001.md"
  }
}
```

**SOUL Integration:**
Every zeOS project defines its identity in a SOUL file:
```yaml
# OUTPOST_SOUL.md
name: "Outpost"
type: "Multi-Agent Headless Executor"
purpose: "Enable Claude UI to dispatch coding tasks to remote AI agents"
status: "OPERATIONAL"
architecture: "ECS Fargate with ALB control plane"
```

---

## Cross-Product Data Flow

### Complete Task Execution Example

```
User: "Refactor the database module and add tests"
         │
         │ Commander interprets intent
         ▼
Blueprint.generate(goal="Refactor DB + add tests", depth=3)
         │
         │ Returns: SPEC.bp.md with 3 sub-tasks
         ▼
MCPify.outpost:dispatch({
  agent: "claude",
  task: "[Spec from Blueprint]",
  repo: "myorg/myapp",
  context: "full"
})
         │
         │ 1. Identity validates API key/JWT
         │ 2. Ledger checks usage quota
         │ 3. zeOS context injected
         ▼
Outpost Control Plane
         │
         │ RunTaskCommand → ECS Fargate
         ▼
Claude Agent Executes:
  - Clone repo
  - Read blueprint spec
  - Refactor database module
  - Write tests
  - Run test suite
  - Commit changes
         │
         │ Task completes
         ▼
Outpost emits cost event → Ledger
         │
         │ Usage recorded
         ▼
MCPify.outpost:promote({
  runId: "01HXYZ...",
  createPr: true,
  prTitle: "feat: Refactor DB module with tests"
})
         │
         │ GitHub PR created
         ▼
User reviews and merges
```

---

## Dependency Graph

### What Outpost Depends On

```
Outpost requires:
├── AWS Services
│   ├── ECS Fargate (container orchestration)
│   ├── ALB (load balancing)
│   ├── DynamoDB (state persistence)
│   ├── S3 (artifacts)
│   ├── Secrets Manager (credentials)
│   └── CloudWatch (observability)
├── GitHub (repository operations)
├── Agent APIs
│   ├── Anthropic API (Claude)
│   ├── OpenAI API (Codex)
│   ├── Google AI API (Gemini)
│   ├── DeepSeek API (Aider)
│   └── xAI API (Grok)
└── zeOS (context injection, optional)
```

### What Depends On Outpost

```
Products requiring Outpost:
├── MCPify
│   └── Outpost HTTP Provider routes tool calls to fleet
├── Blueprint
│   └── Specification execution requires Outpost dispatch
├── Commander (zeOS CLI)
│   └── Delegation of work to remote agents
└── Application Projects
    ├── Geaux File (automated development)
    ├── Swords of Chaos (game feature development)
    ├── AI Boardroom (orchestration tasks)
    └── ... (all zeOS-managed projects)
```

---

## Shared Infrastructure

### AWS Resources by Product

| Resource | Owner | Shared With | Purpose |
|----------|-------|-------------|---------|
| **ECS Cluster** | Outpost | — | Agent container execution |
| **ALB** | Outpost | — | Control plane ingress |
| **DynamoDB (runs)** | Outpost | Ledger (read) | Dispatch state |
| **S3 (artifacts)** | Outpost | MCPify (presigned URLs) | Large outputs |
| **Secrets Manager** | Identity | Outpost | API key vault |
| **CloudWatch** | Outpost | All (observability) | Logs and metrics |
| **EventBridge** | Outpost | Ledger | Cost event routing |
| **Cognito** | Identity | All (auth) | User authentication |
| **KMS** | Identity | All (encryption) | Envelope encryption |

### Version Compatibility Matrix

| Component | Version | Outpost Compatibility | Notes |
|-----------|---------|----------------------|-------|
| MCPify | v2.0.0+ | Required | HTTP provider |
| Blueprint | v2.5.0+ | Recommended | Python client |
| Identity | v1.0.0+ | Recommended | JWT validation |
| Ledger | Phase 3+ | Optional | Cost tracking |
| zeOS | v5.3.0+ | Optional | Context injection |

---

## Market Positioning

### Competitive Landscape

```
┌─────────────────────────────────────────────────────────────────┐
│              LLM-Powered Development Tools                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Single-Agent Solutions (Competitors):                          │
│  ├─ GitHub Copilot (single model, IDE integration)             │
│  ├─ Cursor IDE (single model, desktop-only)                    │
│  ├─ Replit Agent (single model, web-based)                     │
│  └─ AWS CodeWhisperer (single model, enterprise)               │
│                                                                 │
│  ────────────────────────────────────────────────────          │
│                                                                 │
│  Multi-Agent Orchestration (Zero Echelon):                      │
│  ├─ OUTPOST (5 agents, distributed execution)                  │
│  ├─ Blueprint (spec generation for multi-agent)                │
│  └─ MCPify (unified tool gateway)                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Zero Echelon's Competitive Moat

1. **Multi-Agent Redundancy:** Task failure on one agent doesn't block execution
2. **Intelligent Model Selection:** Route tasks to optimal agent based on characteristics
3. **Workspace Persistence:** Enables stateful, multi-step workflows (rare in market)
4. **Cost Optimization:** LLM arbitrage across pricing tiers
5. **Enterprise-Ready:** Multi-tenant isolation, audit trails, billing integration

---

## Revenue Model

### How Outpost Generates Revenue

```
Revenue Streams:
├── API Key Sales
│   └── Customers purchase API keys for Outpost access
│       └── Per-key pricing: $X/month for Y dispatches
├── Per-Agent Subscriptions (Cost Pass-Through)
│   ├── Claude: $100/mo → Customer + margin
│   ├── Codex: $20/mo → Customer + margin
│   └── Gemini: $50/mo → Customer + margin
├── Usage-Based Billing (API Agents)
│   ├── Aider: $0.14/MTok + margin
│   └── Grok: xAI pricing + margin
└── Enterprise Contracts
    └── Custom pricing for high-volume customers
```

### Revenue Flow

```
Customer → API Key Purchase → Ledger records sale
         │
         │ Customer uses Outpost
         ▼
Outpost Dispatch → Usage event → Ledger
         │
         │ Monthly invoice generated
         ▼
Customer pays → Cash collected → Ledger
         │
         │ Revenue recognized
         ▼
Financial statements (audit-ready)
```

---

## Contact & Support

**Primary Architect:** Richie G. Suarez
**Organization:** Zero Echelon LLC
**Website:** [zeroechelon.com](https://zeroechelon.com)
**Documentation:** This file and linked docs in `/docs/`

---

*Zero Echelon LLC — AI Infrastructure for the Enterprise*
*Outpost: The Execution Backbone*
