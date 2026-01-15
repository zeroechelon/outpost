# Architecture Overview

> **Single Source of Truth for Outpost System Design**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Primary Architect:** Richie G. Suarez, Zero Echelon LLC

---

## Executive Summary

Outpost v2.0 is a **multi-agent fleet orchestration platform** built on AWS ECS Fargate. It provides a stateless HTTP API that dispatches coding tasks to five specialized AI agents (Claude, Codex, Gemini, Aider, Grok) running in isolated containers with cryptographic tenant separation.

**Key Architectural Decisions:**
1. **Stateless Control Plane:** Enables horizontal scaling via ALB
2. **ECS Fargate Workers:** Serverless containers eliminate server management
3. **DynamoDB for State:** Low-latency, auto-scaling persistence
4. **EFS for Workspaces:** Persistent storage that survives container restarts
5. **EventBridge Decoupling:** Async billing events prevent latency impact

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                     │
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │   Claude Code   │    │   MCPify MCP    │    │   HTTP Clients  │        │
│   │   (Primary UI)  │    │   Gateway       │    │   (curl, SDK)   │        │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘        │
│            │                      │                      │                  │
│            └──────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│                          HTTP/HTTPS Request                                 │
│                      (X-API-Key authentication)                             │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                            INGRESS LAYER                                       │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                  APPLICATION LOAD BALANCER (ALB)                       │  │
│   │                                                                         │  │
│   │   DNS: outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com│  │
│   │                                                                         │  │
│   │   Features:                                                             │  │
│   │   ├─ Health check: GET /health (5s interval, 2 threshold)             │  │
│   │   ├─ Sticky sessions: Disabled (stateless)                            │  │
│   │   ├─ Cross-zone: Enabled                                               │  │
│   │   └─ Idle timeout: 60 seconds                                          │  │
│   │                                                                         │  │
│   │   Listener Rules:                                                       │  │
│   │   ├─ HTTP:80 → Target Group (control-plane)                           │  │
│   │   └─ HTTPS:443 → Target Group (with ACM certificate)                  │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
└────────────────────────────────────┼──────────────────────────────────────────┘
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                         CONTROL PLANE LAYER                                    │
│                    (ECS Fargate - Stateless Service)                          │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                    EXPRESS.JS HTTP API                                  │  │
│   │                                                                         │  │
│   │   Endpoints:                                                            │  │
│   │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│   │   │ GET  /health              │ ALB health check (fast path)        │ │  │
│   │   │ POST /dispatch            │ Create dispatch, launch worker       │ │  │
│   │   │ GET  /dispatch/:id        │ Get dispatch status and logs         │ │  │
│   │   │ DELETE /dispatch/:id      │ Cancel running dispatch              │ │  │
│   │   │ GET  /fleet               │ Fleet status and availability        │ │  │
│   │   │ POST /promote             │ Push workspace to GitHub             │ │  │
│   │   │ GET  /runs                │ List recent dispatches               │ │  │
│   │   │ GET  /artifacts/:id       │ Download workspace artifacts         │ │  │
│   │   └─────────────────────────────────────────────────────────────────┘ │  │
│   │                                                                         │  │
│   │   Middleware Stack:                                                     │  │
│   │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│   │   │ 1. Health Bypass   │ /health skips auth for ALB checks          │ │  │
│   │   │ 2. Body Parser     │ JSON + URL-encoded (10MB limit)            │ │  │
│   │   │ 3. Request Logger  │ Pino structured logging                    │ │  │
│   │   │ 4. Auth Middleware │ API key validation                         │ │  │
│   │   │ 5. Rate Limiter    │ Per-tenant limits (optional)               │ │  │
│   │   │ 6. Route Handler   │ Business logic execution                   │ │  │
│   │   │ 7. Error Handler   │ Standardized error responses               │ │  │
│   │   └─────────────────────────────────────────────────────────────────┘ │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                      CORE SERVICES                                      │  │
│   │                                                                         │  │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│   │   │ Dispatcher  │  │PoolManager  │  │TaskLauncher │                   │  │
│   │   │             │  │             │  │             │                   │  │
│   │   │ Orchestrate │  │ Worker      │  │ ECS         │                   │  │
│   │   │ requests    │  │ lifecycle   │  │ RunTask     │                   │  │
│   │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                   │  │
│   │          │                │                │                           │  │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│   │   │SecretInject │  │Workspace    │  │AuditLogger  │                   │  │
│   │   │             │  │Handler      │  │             │                   │  │
│   │   │ Secrets     │  │ EFS + S3    │  │ DynamoDB    │                   │  │
│   │   │ Manager     │  │ management  │  │ audit table │                   │  │
│   │   └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│   │                                                                         │  │
│   │   ┌─────────────┐  ┌─────────────┐                                    │  │
│   │   │StatusTracker│  │ArtifactMgr  │                                    │  │
│   │   │             │  │             │                                    │  │
│   │   │ Real-time   │  │ S3 upload   │                                    │  │
│   │   │ status      │  │ presigned   │                                    │  │
│   │   └─────────────┘  └─────────────┘                                    │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   Container Spec:                                                             │
│   ├─ Image: outpost-control-plane:latest                                     │
│   ├─ CPU: 512 units (0.5 vCPU)                                               │
│   ├─ Memory: 1024 MB                                                         │
│   ├─ Platform: linux/arm64 (Graviton)                                        │
│   └─ Health check: GET /health                                               │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │
                              RunTaskCommand
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           WORKER LAYER                                         │
│                    (ECS Fargate - Task-per-Dispatch)                          │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                      WORKER POOL                                        │  │
│   │                                                                         │  │
│   │   ┌───────────────────────────────────────────────────────────────┐   │  │
│   │   │ FLAGSHIP TIER (Claude Opus)                                    │   │  │
│   │   │ ├─ CPU: 2048 units (2 vCPU)                                   │   │  │
│   │   │ ├─ Memory: 4096 MB                                             │   │  │
│   │   │ ├─ Ephemeral Storage: 20 GB                                    │   │  │
│   │   │ ├─ Warm-up: 30s                                                │   │  │
│   │   │ └─ Max Concurrent: 5                                           │   │  │
│   │   └───────────────────────────────────────────────────────────────┘   │  │
│   │                                                                         │  │
│   │   ┌───────────────────────────────────────────────────────────────┐   │  │
│   │   │ BALANCED TIER (Codex, Gemini)                                  │   │  │
│   │   │ ├─ CPU: 1024 units (1 vCPU)                                   │   │  │
│   │   │ ├─ Memory: 2048 MB                                             │   │  │
│   │   │ ├─ Ephemeral Storage: 10 GB                                    │   │  │
│   │   │ ├─ Warm-up: 20s                                                │   │  │
│   │   │ └─ Max Concurrent: 5 each                                      │   │  │
│   │   └───────────────────────────────────────────────────────────────┘   │  │
│   │                                                                         │  │
│   │   ┌───────────────────────────────────────────────────────────────┐   │  │
│   │   │ FAST TIER (Aider, Grok)                                        │   │  │
│   │   │ ├─ CPU: 512 units (0.5 vCPU)                                  │   │  │
│   │   │ ├─ Memory: 1024 MB                                             │   │  │
│   │   │ ├─ Ephemeral Storage: 5 GB                                     │   │  │
│   │   │ ├─ Warm-up: 15s                                                │   │  │
│   │   │ └─ Max Concurrent: 5 each                                      │   │  │
│   │   └───────────────────────────────────────────────────────────────┘   │  │
│   │                                                                         │  │
│   │   Worker Lifecycle:                                                     │  │
│   │   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │  │
│   │   │ starting │───▶│   idle   │◀──▶│   busy   │───▶│ stopping │       │  │
│   │   └──────────┘    └──────────┘    └──────────┘    └──────────┘       │  │
│   │                                                                         │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                    AGENT CONTAINERS                                     │  │
│   │                                                                         │  │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│   │   │   CLAUDE    │  │   CODEX     │  │   GEMINI    │                   │  │
│   │   │             │  │             │  │             │                   │  │
│   │   │ claude-opus │  │ gpt-5.2     │  │ gemini-3    │                   │  │
│   │   │ 4-5-202511  │  │ codex       │  │ pro-preview │                   │  │
│   │   │             │  │             │  │             │                   │  │
│   │   │ Complex     │  │ Code gen    │  │ Analysis    │                   │  │
│   │   │ reasoning   │  │ Tests       │  │ Docs        │                   │  │
│   │   └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│   │                                                                         │  │
│   │   ┌─────────────┐  ┌─────────────┐                                    │  │
│   │   │   AIDER     │  │    GROK     │                                    │  │
│   │   │             │  │             │                                    │  │
│   │   │ deepseek/   │  │ grok-4.1    │                                    │  │
│   │   │ deepseek-   │  │             │                                    │  │
│   │   │ coder       │  │ Risk        │                                    │  │
│   │   │             │  │ analysis    │                                    │  │
│   │   │ Cost-       │  │ Contrarian  │                                    │  │
│   │   │ efficient   │  │ review      │                                    │  │
│   │   └─────────────┘  └─────────────┘                                    │  │
│   │                                                                         │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │                    ISOLATED WORKSPACE                                   │  │
│   │                                                                         │  │
│   │   Mount: /workspace/{workspaceId}                                       │  │
│   │                                                                         │  │
│   │   Contents:                                                             │  │
│   │   ├─ /workspace/{id}/repo/        # Cloned repository                 │  │
│   │   ├─ /workspace/{id}/task.md      # Task description                  │  │
│   │   ├─ /workspace/{id}/context.json # zeOS context injection            │  │
│   │   ├─ /workspace/{id}/output.log   # Agent stdout/stderr               │  │
│   │   └─ /workspace/{id}/artifacts/   # Generated files                   │  │
│   │                                                                         │  │
│   │   Modes:                                                                │  │
│   │   ├─ Ephemeral: tmpfs, auto-delete on completion                      │  │
│   │   └─ Persistent: EFS, survives task, TTL-based cleanup                │  │
│   │                                                                         │  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                         PERSISTENCE LAYER                                      │
│                                                                               │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│   │      DYNAMODB       │  │         S3          │  │  SECRETS MANAGER    │ │
│   │                     │  │                     │  │                     │ │
│   │ Tables:             │  │ Buckets:            │  │ Secrets:            │ │
│   │ ├─ outpost-jobs     │  │ ├─ outpost-artifacts│  │ ├─ outpost/agents/* │ │
│   │ │  (dispatches)     │  │ │  (large outputs)  │  │ │  (API keys)       │ │
│   │ │                   │  │ │                   │  │ │                   │ │
│   │ ├─ outpost-api-keys │  │ ├─ outpost-logs     │  │ └─ outpost/github   │ │
│   │ │  (authentication) │  │ │  (archived logs)  │  │    (repo token)     │ │
│   │ │                   │  │ │                   │  │                     │ │
│   │ ├─ outpost-audit    │  │ └─ outpost-workspaces│ │                     │ │
│   │ │  (audit trail)    │  │    (archived state) │  │                     │ │
│   │ │                   │  │                     │  │                     │ │
│   │ └─ outpost-workspaces│ │                     │  │                     │ │
│   │    (workspace meta) │  │                     │  │                     │ │
│   │                     │  │                     │  │                     │ │
│   │ Features:           │  │ Features:           │  │ Features:           │ │
│   │ ├─ PAY_PER_REQUEST  │  │ ├─ Lifecycle rules  │  │ ├─ Auto rotation    │ │
│   │ ├─ PITR enabled     │  │ ├─ Presigned URLs   │  │ ├─ Version history  │ │
│   │ └─ TTL cleanup      │  │ └─ Intelligent tier │  │ └─ IAM policy       │ │
│   └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                               │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│   │        EFS          │  │     CLOUDWATCH      │  │    EVENTBRIDGE      │ │
│   │                     │  │                     │  │                     │ │
│   │ File System:        │  │ Log Groups:         │  │ Event Bus:          │ │
│   │ ├─ Workspace mounts │  │ ├─ /ecs/outpost-*   │  │ ├─ outpost-events   │ │
│   │ ├─ Access points    │  │ │  (container logs) │  │ │                   │ │
│   │ │  per workspace    │  │ │                   │  │ │                   │ │
│   │ └─ Lifecycle mgmt   │  │ ├─ Metrics:         │  │ Rules:              │ │
│   │                     │  │ │  ├─ Dispatch count│  │ ├─ Cost events      │ │
│   │ Mount targets:      │  │ │  ├─ Duration      │  │ │  → Ledger SQS     │ │
│   │ ├─ us-east-1a       │  │ │  └─ Error rate    │  │ │                   │ │
│   │ └─ us-east-1b       │  │ │                   │  │ └─ Audit events     │ │
│   │                     │  │ └─ Alarms:          │  │    → CloudWatch     │ │
│   │                     │  │    ├─ High CPU      │  │                     │ │
│   │                     │  │    └─ Unhealthy     │  │                     │ │
│   └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Dispatch Request Flow

```
1. Client sends POST /dispatch with API key
         │
         ▼
2. ALB routes to Control Plane ECS task
         │
         ▼
3. Auth Middleware validates API key
   ├─ Extract key from X-API-Key header
   ├─ SHA256 hash the key
   ├─ Lookup hash in DynamoDB api-keys table
   ├─ Verify status == "active"
   └─ Extract tenantId for isolation
         │
         ▼
4. Dispatcher Service processes request
   ├─ Validate request schema (Zod)
   ├─ Generate ULID dispatch ID
   ├─ Select task definition by agent + tier
   └─ Prepare container overrides
         │
         ▼
5. SecretInjector loads agent credentials
   ├─ Get secret from Secrets Manager
   ├─ Add to container environment
   └─ Log access (masked)
         │
         ▼
6. TaskLauncher executes ECS RunTaskCommand
   ├─ Specify task definition
   ├─ Apply container overrides
   ├─ Configure networking (VPC, subnets)
   └─ Wait for task ARN
         │
         ▼
7. Write dispatch record to DynamoDB
   ├─ dispatchId (ULID)
   ├─ tenantId
   ├─ status: PENDING
   ├─ taskArn
   └─ createdAt
         │
         ▼
8. Return immediate response to client
   {
     "dispatchId": "01HXYZ...",
     "status": "PENDING"
   }
```

### Task Execution Flow

```
1. ECS Fargate provisions container
   ├─ Pull image from ECR
   ├─ Attach to VPC subnet
   ├─ Mount EFS workspace (if persistent)
   └─ Inject environment variables
         │
         ▼
2. Container entrypoint executes
   ├─ /usr/bin/tini (init system)
   └─ /entrypoint.sh (agent setup)
         │
         ▼
3. Agent CLI initializes
   ├─ Load credentials from env
   ├─ Configure model ID
   └─ Set timeout
         │
         ▼
4. Workspace setup
   ├─ Clone repository (if specified)
   ├─ Read task.md
   ├─ Load context.json (zeOS injection)
   └─ Change to repo directory
         │
         ▼
5. Agent executes task
   ├─ Parse task instructions
   ├─ Make changes to codebase
   ├─ Run tests (if specified)
   └─ Commit changes
         │
         ▼
6. Output collection
   ├─ Capture stdout/stderr
   ├─ Generate git diff
   ├─ Package artifacts
   └─ Upload large outputs to S3
         │
         ▼
7. Task completion
   ├─ Update DynamoDB status
   ├─ Emit cost event to EventBridge
   └─ Container exits
```

### Status Polling Flow

```
1. Client sends GET /dispatch/:id
         │
         ▼
2. Auth Middleware validates API key
         │
         ▼
3. StatusTracker queries DynamoDB
   ├─ Get dispatch by (tenantId, dispatchId)
   └─ Return current status
         │
         ▼
4. If status == RUNNING
   ├─ Query ECS for task status
   └─ Fetch recent CloudWatch logs
         │
         ▼
5. If status == COMPLETED
   ├─ Include exit code
   ├─ Include output summary
   └─ Generate presigned URL for artifacts
         │
         ▼
6. Return response to client
   {
     "status": "COMPLETED",
     "exitCode": 0,
     "output": "...",
     "artifactUrl": "https://..."
   }
```

---

## Component Details

### Control Plane Services

| Service | Responsibility | Dependencies |
|---------|---------------|--------------|
| **Dispatcher** | Request orchestration, validation | PoolManager, TaskLauncher |
| **PoolManager** | Worker lifecycle, allocation | ECS Client |
| **TaskLauncher** | ECS RunTaskCommand execution | AWS SDK |
| **SecretInjector** | Secrets Manager integration | AWS SDK |
| **WorkspaceHandler** | EFS/S3 workspace management | AWS SDK |
| **StatusTracker** | Real-time dispatch status | DynamoDB, CloudWatch |
| **AuditLogger** | Audit trail persistence | DynamoDB |
| **ArtifactManager** | S3 artifact upload/download | AWS SDK |

### DynamoDB Table Schemas

**outpost-jobs (Dispatches)**
```
PK: tenantId (String)
SK: dispatchId (String, ULID)
GSI1: status-createdAt (status, createdAt)
GSI2: userId-createdAt (userId, createdAt)

Attributes:
├─ dispatchId (String, ULID)
├─ tenantId (String, UUID)
├─ userId (String)
├─ agent (String: claude|codex|gemini|aider|grok)
├─ modelId (String)
├─ task (String, max 50KB)
├─ repo (String, optional)
├─ branch (String, optional)
├─ contextLevel (String: minimal|standard|full)
├─ workspaceMode (String: ephemeral|persistent)
├─ status (String: PENDING|QUEUED|RUNNING|COMPLETED|FAILED|TIMEOUT|CANCELLED)
├─ taskArn (String, ECS task ARN)
├─ workspaceId (String, UUID)
├─ exitCode (Number, null until complete)
├─ errorMessage (String, null if success)
├─ outputS3Key (String, for large outputs)
├─ createdAt (String, ISO8601)
├─ startedAt (String, ISO8601)
├─ completedAt (String, ISO8601)
├─ timeoutSeconds (Number)
└─ ttl (Number, epoch seconds for auto-cleanup)
```

**outpost-api-keys**
```
PK: apiKeyId (String, UUID)
GSI1: tenantId (tenantId)
GSI2: keyHash (keyHash)

Attributes:
├─ apiKeyId (String, UUID)
├─ tenantId (String, UUID)
├─ keyHash (String, SHA256)
├─ keyPrefix (String, first 15 chars)
├─ scopes (List: dispatch, status, list, cancel, promote, admin)
├─ status (String: active|revoked|expired)
├─ createdAt (String, ISO8601)
├─ expiresAt (String, ISO8601, optional)
├─ lastUsedAt (String, ISO8601)
├─ usageCount (Number)
└─ ttl (Number, for expired keys)
```

### Security Model

**Authentication:**
```
API Key Flow:
1. Client includes X-API-Key header
2. Server extracts key value
3. SHA256(key) → keyHash
4. Query DynamoDB by keyHash (GSI)
5. Verify status == "active"
6. Extract tenantId for request context
7. Proceed with authorized request
```

**Tenant Isolation:**
```
All queries include tenantId:
├─ DynamoDB: PK always includes tenantId
├─ S3: Bucket paths include tenantId
├─ EFS: Access points scoped to workspace
└─ Logs: Filtered by tenantId tag
```

**Secrets Management:**
```
Never stored in code or config:
├─ Agent API keys → Secrets Manager
├─ GitHub token → Secrets Manager
├─ Tenant API key hashes → DynamoDB (hashed only)
└─ Runtime injection via ECS task overrides
```

---

## Scaling Characteristics

### Horizontal Scaling

| Component | Scaling Method | Limits |
|-----------|---------------|--------|
| Control Plane | ALB + ECS Service Auto Scaling | 1-10 tasks |
| Workers | ECS Task per dispatch | 25 concurrent (5 agents × 5) |
| DynamoDB | PAY_PER_REQUEST (auto) | Unlimited (throttled) |
| S3 | Auto-scaling | Unlimited |

### Vertical Scaling (Resource Tiers)

| Tier | CPU | Memory | Storage | Agents |
|------|-----|--------|---------|--------|
| Flagship | 2048 (2 vCPU) | 4096 MB | 20 GB | Claude |
| Balanced | 1024 (1 vCPU) | 2048 MB | 10 GB | Codex, Gemini |
| Fast | 512 (0.5 vCPU) | 1024 MB | 5 GB | Aider, Grok |

### Latency Characteristics

| Operation | P50 | P99 | Notes |
|-----------|-----|-----|-------|
| Health check | 5ms | 20ms | Fast path, no auth |
| Dispatch create | 200ms | 500ms | DynamoDB + ECS API |
| Status poll | 50ms | 150ms | DynamoDB query |
| Cold start (task) | 25s | 45s | Container provisioning |
| Warm start (reuse) | 1s | 3s | In-pool worker |

---

## Failure Modes

### Control Plane Failures

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Task crash | ECS health check | Auto-restart (desired count) |
| Memory exhaustion | CloudWatch alarm | Scale up or restart |
| DynamoDB throttling | SDK retry | Exponential backoff |

### Worker Failures

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Task timeout | AGENT_TIMEOUT env | Kill task, mark TIMEOUT |
| Agent crash | Non-zero exit | Mark FAILED, log error |
| OOM kill | Exit code 137 | Increase memory tier |

### Infrastructure Failures

| Failure | Detection | Recovery |
|---------|-----------|----------|
| AZ outage | ALB health checks | Route to healthy AZ |
| DynamoDB outage | SDK errors | Retry with backoff |
| S3 outage | SDK errors | Retry with backoff |

---

## Cost Model

### Fixed Costs (Monthly)

| Item | Cost | Notes |
|------|------|-------|
| ALB | ~$16 | Base + LCU hours |
| NAT Gateway | ~$32 | Per AZ |
| Secrets Manager | ~$1 | Per secret/month |
| **Total Fixed** | ~$50 | |

### Variable Costs (Per Dispatch)

| Item | Cost | Notes |
|------|------|-------|
| ECS Fargate (Flagship) | $0.04/task | 2 vCPU × 10 min |
| ECS Fargate (Balanced) | $0.02/task | 1 vCPU × 10 min |
| ECS Fargate (Fast) | $0.01/task | 0.5 vCPU × 5 min |
| DynamoDB | $0.00025/request | ~4 requests/dispatch |
| S3 | ~$0.0001/dispatch | Artifact storage |
| CloudWatch | ~$0.001/dispatch | Log ingestion |

### Agent Subscription Costs

| Agent | Monthly Cost | Type |
|-------|--------------|------|
| Claude Code | $100 | Subscription |
| OpenAI Codex | $20 | Subscription |
| Gemini CLI | $50 | Subscription |
| Aider (DeepSeek) | ~$0.14/MTok | API |
| Grok (xAI) | Variable | API |
| **Total Subscriptions** | $170 | |

---

## Related Documentation

- [API Reference](API.md) - REST API specification
- [Deployment Guide](DEPLOYMENT.md) - Production deployment steps
- [Infrastructure](INFRASTRUCTURE.md) - Terraform module details
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions
- [Security Assessment](SECURITY_ASSESSMENT.md) - Security posture analysis

---

**Primary Architect:** Richie G. Suarez
**Organization:** Zero Echelon LLC
**Document Version:** 1.0.0

---

*Outpost Architecture Overview — "The execution backbone for distributed AI-powered software engineering."*
