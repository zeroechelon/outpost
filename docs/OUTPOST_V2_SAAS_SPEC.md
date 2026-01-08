# Outpost v2.0 Multi-Tenant SaaS Specification

**Version:** 1.0
**Date:** 2026-01-08
**Status:** DRAFT
**Source:** Fleet Consultation (5 agents unanimous consensus)

---

## Executive Summary

Evolve Outpost from single-operator tool to multi-tenant SaaS platform capable of serving N concurrent users with API key authentication, per-user billing, and horizontal scalability.

**Target Timeline:** 4-6 weeks
**Target Cost:** ~$300/mo base (10 users), scales linearly

---

## Current State

| Component | Current | Limitation |
|-----------|---------|------------|
| Compute | Single EC2 t3.medium | No HA, vertical only |
| Auth | None (AWS SSM only) | No user identity |
| GitHub | Single hardcoded PAT | Users can't access their repos |
| API Keys | Server-side `.env` | Users can't use their own keys |
| Rate Limiting | None | No abuse protection |
| Billing | N/A | No usage tracking |
| Audit | Scattered logs | No centralized attribution |

**What's Already Production-Grade:**
- Workspace isolation (copy-on-dispatch)
- Run artifacts structure (`/runs/$RUN_ID/`)
- Context injection system
- 5-agent fleet (Claude, Codex, Gemini, Aider, Grok)

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                      │
│              (CLI, SDK, Web Console, IDE Plugins)                        │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS + API Key (op_live_xxx)
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    AWS API GATEWAY + Lambda Authorizer                    │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│   │ Rate Limit   │  │ API Key      │  │ Request      │  │ Usage       │ │
│   │ (per-user)   │  │ Validation   │  │ Validation   │  │ Metering    │ │
│   └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ Authenticated Request
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         SQS TASK QUEUE                                    │
│              Priority Queues: free │ pro │ enterprise                     │
│              Dead Letter Queue for failures                               │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ Dequeue
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    ECS FARGATE WORKER POOL (Auto-Scale)                   │
│   ┌────────────────────────────────────────────────────────────────────┐ │
│   │              dispatch-unified.sh (containerized)                    │ │
│   │   - Receives: user_id, task, repo, secrets_arn                     │ │
│   │   - Runs in: /workspace/$USER_ID-$RUN_ID/                          │ │
│   │   - Logs to: CloudWatch with user attribution                      │ │
│   └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│   Scale: 2-20 workers based on queue depth                              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ Results + Audit
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │   DynamoDB      │  │       S3        │  │    Secrets Manager       │ │
│  │                 │  │                 │  │                          │ │
│  │ - users         │  │ - runs/         │  │ - User GitHub tokens     │ │
│  │ - api_keys      │  │   $USER_ID/     │  │ - User API keys (BYOK)   │ │
│  │ - tasks         │  │   $RUN_ID/      │  │ - Encrypted at rest      │ │
│  │ - usage_events  │  │   artifacts     │  │                          │ │
│  │ - audit_log     │  │                 │  │                          │ │
│  └─────────────────┘  └─────────────────┘  └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Decision: BYOK Model

**Fleet Consensus:** Bring Your Own Keys (BYOK) for MVP

Users provide their own:
- GitHub PAT (for repo access)
- Claude API key (for Claude agent)
- OpenAI API key (for Codex agent)
- Google API key (for Gemini agent)
- DeepSeek API key (for Aider agent)
- xAI API key (for Grok agent)

**Benefits:**
- Zero billing complexity (users pay providers directly)
- No API key margin/markup disputes
- Users control their own costs
- No provider ToS issues
- Outpost charges for orchestration only

**Trade-off:** Users manage multiple keys (acceptable for developer audience)

---

## Requirements Breakdown

### 1. API Key Authentication

**Format:** Stripe-like API keys
```
Production: op_live_XXXXXXXXXXXXXXXXXXXXXXXX
Test:       op_test_XXXXXXXXXXXXXXXXXXXXXXXX
```

**Storage:** DynamoDB with hashed keys
```
users table:
  - user_id (PK)
  - email (GSI)
  - created_at
  - stripe_customer_id

api_keys table:
  - key_hash (PK) — SHA-256 of full key
  - user_id
  - key_prefix — "op_live_abc123" for display
  - environment — live | test
  - created_at
  - last_used_at
  - revoked_at
```

### 2. Per-User Quotas & Rate Limiting

**Tier Structure:**
| Tier | Requests/day | Concurrent | Agents | Price |
|------|-------------|------------|--------|-------|
| Free | 10 | 1 | Claude only | $0 |
| Pro | 100 | 3 | All 5 | $29/mo |
| Enterprise | Unlimited | 10 | All 5 + priority | Custom |

**Implementation:** Redis/DynamoDB for real-time counters

### 3. Billing Isolation

**Model:** Subscription + BYOK
- Users pay Outpost for orchestration (subscription tier)
- Users pay providers directly for AI usage (their own keys)

**Stripe Integration:**
- Subscriptions for tier access
- Usage metering for overage (future)

### 4. Horizontal Scalability

**Queue-Based Decoupling:**
- API Gateway enqueues to SQS
- Workers poll SQS and process
- Auto-scale on queue depth (target: 5 messages per worker)

**Worker Configuration:**
- ECS Fargate tasks
- 0.5 vCPU / 1GB RAM per worker
- Scale: 2 minimum, 20 maximum
- Container: Ubuntu + dispatch-unified.sh + all agent CLIs

### 5. Audit Trail

**Events Captured:**
- task_submitted (API Gateway)
- task_started (Worker)
- task_completed (Worker)
- task_failed (Worker)

**Attributes:**
- user_id, run_id, api_key_prefix
- executor, repo, timestamp
- duration, exit_code, changes

**Storage:** DynamoDB + CloudWatch Logs + S3 archive

---

## API Specification

### Submit Task
```
POST /v1/tasks
Authorization: Bearer op_live_xxx
Content-Type: application/json

{
  "repo": "owner/repo-name",
  "task": "Implement feature X",
  "executor": "claude",           // claude|codex|gemini|aider|grok|all
  "context": "standard"           // off|minimal|standard|full
}

Response 202:
{
  "task_id": "tsk_abc123",
  "status": "queued",
  "estimated_wait": "30s"
}
```

### Get Task Status
```
GET /v1/tasks/{task_id}
Authorization: Bearer op_live_xxx

Response 200:
{
  "task_id": "tsk_abc123",
  "status": "completed",          // queued|processing|completed|failed
  "executor": "claude",
  "started_at": "2026-01-08T12:00:00Z",
  "completed_at": "2026-01-08T12:01:30Z",
  "output_url": "https://s3.../output.log",
  "changes": "committed"          // committed|uncommitted|none
}
```

### Get Usage
```
GET /v1/usage
Authorization: Bearer op_live_xxx

Response 200:
{
  "period": "2026-01",
  "requests": 47,
  "quota": 100,
  "tier": "pro"
}
```

---

## Cost Estimates

### Infrastructure (AWS)

| Component | 10 Users | 100 Users | 1000 Users |
|-----------|----------|-----------|------------|
| API Gateway | $5 | $20 | $100 |
| Lambda | $10 | $30 | $100 |
| DynamoDB | $25 | $50 | $150 |
| SQS | $1 | $5 | $20 |
| ECS Fargate | $150 | $400 | $1500 |
| Secrets Manager | $5 | $20 | $100 |
| CloudWatch | $10 | $30 | $100 |
| S3 | $5 | $20 | $100 |
| **Total** | **~$210** | **~$575** | **~$2170** |

### Revenue Model

| Tier | Price | Break-Even Users |
|------|-------|------------------|
| Free | $0 | — |
| Pro | $29/mo | 8 Pro = $232 |
| Enterprise | $199/mo | 2 Enterprise = $398 |

---

## Migration Phases

### Phase 1: API Layer (2 weeks)
- DynamoDB schema (users, api_keys, tasks)
- Lambda authorizer for API key validation
- API Gateway endpoints (/tasks, /status, /usage)
- Keep existing SSM path for admin

### Phase 2: BYOK + Secrets (1 week)
- Secrets Manager integration for user credentials
- User onboarding flow (store keys)
- Modify dispatch-unified.sh to accept env vars

### Phase 3: Queue + Scaling (2 weeks)
- SQS task queue with DLQ
- Worker container image (ECR)
- ECS Fargate service with auto-scaling
- Queue-based dispatch replaces direct execution

### Phase 4: Billing + Quotas (1 week)
- Stripe subscription integration
- Tier enforcement in Lambda authorizer
- Usage metering to DynamoDB
- Overage alerts

---

## Security Requirements

1. **API Keys:** Hashed in database, never logged
2. **User Secrets:** AWS Secrets Manager, per-user isolation
3. **Network:** VPC with private subnets for workers
4. **IAM:** Least-privilege for all components
5. **Encryption:** TLS in transit, KMS at rest
6. **Audit:** Immutable logs with user attribution

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Uptime | 99.9% |
| Task latency (P95) | < 2 minutes |
| API latency (P95) | < 200ms |
| Concurrent users | 1000+ |
| Billing accuracy | > 99% |
| Audit completeness | 100% |

---

## Open Questions

1. **Domain:** api.outpost.dev or outpost.zeroechelon.com?
2. **Free tier:** Should it exist at all, or just trial period?
3. **Team support:** Organizations with multiple users? (Phase 2)
4. **Webhook notifications:** Task completion callbacks? (Phase 2)

---

*Outpost v2.0 Multi-Tenant SaaS Specification — Fleet Consensus 2026-01-08*
