# Outpost System Architecture

> **Document Status**: Blueprint T5.2 Deliverable
> **Last Updated**: 2026-01-13
> **Version**: 2.0.0
> **Owner**: Platform Team

---

## Overview

Outpost is a multi-agent code execution platform that orchestrates AI coding agents (Claude, Codex, Gemini, Aider, Grok) in isolated containers. The system transforms task requests into containerized executions with full workspace isolation, real-time log streaming, and artifact collection.

---

## High-Level System Diagram

```
                                 OUTPOST SYSTEM ARCHITECTURE
+================================================================================================+
|                                                                                                |
|                                    EXTERNAL CLIENTS                                            |
|    +------------------+     +------------------+     +------------------+                      |
|    |   Claude Code    |     |   IDE Plugins    |     |   CI/CD Systems  |                     |
|    |   (MCP Client)   |     |   (REST API)     |     |   (REST API)     |                     |
|    +--------+---------+     +--------+---------+     +--------+---------+                     |
|             |                        |                        |                               |
|             +------------------------+------------------------+                               |
|                                      |                                                        |
|                                      v                                                        |
|    +-------------------------------------------------------------------------------------+    |
|    |                           MCPify MCP Server                                         |    |
|    |  +---------------+  +---------------+  +---------------+  +---------------+        |    |
|    |  |   dispatch    |  |   get_run     |  |  list_runs    |  |    promote    |        |    |
|    |  +---------------+  +---------------+  +---------------+  +---------------+        |    |
|    +-------------------------------------------------------------------------------------+    |
|                                      |                                                        |
|                                      | HTTP/REST                                              |
|                                      v                                                        |
|    +-------------------------------------------------------------------------------------+    |
|    |                         CONTROL PLANE SERVICE                                       |    |
|    |                                                                                     |    |
|    |  +-------------+   +----------------+   +----------------+   +-----------------+   |    |
|    |  |             |   |                |   |                |   |                 |   |    |
|    |  | Dispatcher  |<->| Pool Manager   |   | Status Tracker |   | Workspace       |   |    |
|    |  | Orchestrator|   | (Warm Pool)    |   | (Log Stream)   |   | Handler         |   |    |
|    |  |             |   |                |   |                |   |                 |   |    |
|    |  +------+------+   +-------+--------+   +-------+--------+   +--------+--------+   |    |
|    |         |                  |                    |                     |            |    |
|    +---------|------------------|--------------------|--------------------|------------+    |
|              |                  |                    |                     |                  |
+==============|==================|====================|=====================|==================+
               |                  |                    |                     |
               v                  v                    v                     v
+==============|==================|====================|=====================|==================+
|              |                  |                    |                     |                  |
|    +---------+---------+  +-----+------+  +----------+---------+  +--------+---------+       |
|    |                   |  |            |  |                    |  |                  |       |
|    |   ECS Fargate     |  |  DynamoDB  |  |    CloudWatch      |  |       EFS        |       |
|    |   Cluster         |  |  Tables    |  |    Logs            |  |   File System    |       |
|    |   (5 Agents)      |  |            |  |                    |  |                  |       |
|    +-------------------+  +------------+  +--------------------+  +------------------+       |
|              |                  |                    |                     |                  |
|              |                  |                    |                     |                  |
|    +---------+---------+  +-----+------+  +----------+---------+  +--------+---------+       |
|    |                   |  |            |  |                    |  |                  |       |
|    | Secrets Manager   |  |    SQS     |  |   EventBridge      |  |       S3         |       |
|    | (API Keys)        |  |  (Queue)   |  |   (Events)         |  |   (Artifacts)    |       |
|    |                   |  |            |  |                    |  |                  |       |
|    +-------------------+  +------------+  +--------------------+  +------------------+       |
|                                                                                              |
|                                     AWS INFRASTRUCTURE                                       |
+==============================================================================================+
```

---

## Component Descriptions

### Control Plane

The Control Plane is the central orchestration service that manages the entire dispatch lifecycle.

#### Dispatcher Orchestrator

**Purpose**: Receives dispatch requests, validates parameters, and coordinates task execution.

**Responsibilities**:
- Request validation (agent, task, permissions, quotas)
- Task definition selection based on agent type
- Coordination with Pool Manager for warm task acquisition
- Fallback to cold launch if pool exhausted
- Dispatch ID generation and state persistence

**Key Flow**:
```
Request --> Validate --> Select Task Def --> Acquire/Launch --> Return ID
    |           |              |                   |              |
    v           v              v                   v              v
 [Parse]    [Schema]      [Registry]         [Pool/ECS]      [DynamoDB]
```

#### Pool Manager (Warm Pool)

**Purpose**: Maintains pre-warmed ECS tasks for each agent type to minimize cold start latency.

**Configuration**:
| Agent | Min Pool | Max Pool | Warm Timeout |
|-------|----------|----------|--------------|
| claude | 2 | 5 | 300s |
| codex | 2 | 5 | 300s |
| gemini | 1 | 3 | 300s |
| aider | 1 | 3 | 300s |
| grok | 1 | 3 | 300s |

**State Machine**:
```
    +-----------+     +------------+     +------------+
    |   WARM    |---->|  ACQUIRED  |---->|  RUNNING   |
    | (waiting) |     | (assigned) |     | (active)   |
    +-----------+     +------------+     +------------+
          ^                                    |
          |           +-----------+            |
          +-----------| REPLENISH |<-----------+
                      +-----------+
```

#### Status Tracker

**Purpose**: Monitors dispatch lifecycle and provides real-time status updates.

**Event Sources**:
- ECS Task State Change events (via EventBridge)
- CloudWatch Logs subscription filters
- DynamoDB Streams for status changes

**Responsibilities**:
- Subscribe to ECS task state changes
- Update dispatch status in DynamoDB
- Aggregate logs from CloudWatch
- Handle timeout enforcement
- Emit completion events

#### Workspace Handler

**Purpose**: Manages workspace lifecycle for both ephemeral and persistent modes.

**Modes**:
```
    EPHEMERAL                          PERSISTENT
    +-------------+                    +-------------+
    | /workspace/ |                    |    EFS      |
    | (tmpfs)     |                    | /mnt/users/ |
    +-------------+                    +------+------+
         |                                    |
         v                                    v
    [Destroyed on                       [Retained]
     task exit]                         /users/{user_id}/
                                        /workspaces/{repo}/
```

---

### Workers (ECS Fargate Tasks)

Each agent runs in an isolated ECS Fargate container with:
- 1 vCPU, 2GB RAM (default)
- Network isolation via awsvpc mode
- Secrets injection from Secrets Manager
- CloudWatch Logs integration
- EFS mount for persistent workspaces

**Agent Container Images**:
| Agent | Image Repository | CLI Tool |
|-------|------------------|----------|
| claude | outpost-claude | Claude Code CLI |
| codex | outpost-codex | OpenAI Codex CLI |
| gemini | outpost-gemini | Gemini CLI |
| aider | outpost-aider | Aider |
| grok | outpost-grok | Grok CLI |

---

### MCPify Provider

**Purpose**: Exposes Outpost functionality via Model Context Protocol (MCP) for AI assistant integration.

**MCP Tools**:
| Tool | Operation | Description |
|------|-----------|-------------|
| `dispatch` | POST /dispatch | Submit task to agent |
| `get_run` | GET /dispatch/:id | Get execution status |
| `list_runs` | GET /workspaces | List recent runs |
| `promote` | POST /promote | Promote workspace to PR |
| `fleet_status` | GET /health/fleet | Check fleet health |

---

## Data Flow: Dispatch Lifecycle

```
                              DISPATCH LIFECYCLE FLOW

    1. REQUEST SUBMISSION
    +-------------+     +-------------+     +--------------+     +-------------+
    |   MCPify    |---->|   Control   |---->|  Dispatcher  |---->|  DynamoDB   |
    |   Client    |     |   Plane     |     |  Service     |     | (dispatches)|
    +-------------+     +-------------+     +------+-------+     +-------------+
                                                   |
    2. TASK ACQUISITION                            v
    +-------------+     +-------------+     +--------------+
    |    Pool     |<----|  Dispatcher |     |   DynamoDB   |
    |   Manager   |     |   Service   |     |   (pool)     |
    +------+------+     +-------------+     +--------------+
           |
           | (a) Pool Hit: Acquire warm task
           | (b) Pool Miss: Launch cold task
           v
    3. ECS LAUNCH
    +-------------+     +-------------+     +--------------+
    |     ECS     |<----|  Dispatcher |     |   Secrets    |
    |   Fargate   |     |   or Pool   |     |   Manager    |
    +------+------+     +-------------+     +--------------+
           |
    4. TASK EXECUTION
           |
           +--------> CloudWatch Logs --------> Status Tracker
           |                                          |
           +--------> ECS Events (EventBridge) -------+
                                                      |
    5. STATUS UPDATES                                 v
    +-------------+     +-------------+     +--------------+
    |   Status    |---->|  DynamoDB   |---->|   MCPify     |
    |   Tracker   |     | (dispatches)|     |   Clients    |
    +------+------+     +-------------+     +--------------+
           |
    6. COMPLETION
           |
           +--------> S3 (Artifacts)
           |
           +--------> Pool Manager (Replenish)
```

### State Machine

```
                         DISPATCH STATE MACHINE

    +-------------------+
    |      PENDING      |  Initial state after dispatch request accepted
    +--------+----------+
             |
             | Pool task acquired OR cold launch initiated
             v
    +-------------------+
    |   PROVISIONING    |  ECS task starting, secrets injecting
    +--------+----------+
             |
             | Container running, agent CLI started
             v
    +-------------------+
    |     RUNNING       |  Agent executing task, logs streaming
    +--------+----------+
             |
             +---------------+---------------+---------------+
             |               |               |               |
             v               v               v               v
    +-----------+    +-----------+    +-----------+    +-----------+
    | COMPLETING|    |  TIMEOUT  |    | CANCELLED |    |  FAILED   |
    +-----------+    +-----------+    +-----------+    +-----------+
             |
             | Artifacts uploaded
             v
    +-------------------+
    |     SUCCESS       |  Terminal state
    +-------------------+
```

---

## AWS Infrastructure Components

### ECS (Elastic Container Service)

**Cluster**: `outpost-prod`
**Launch Type**: Fargate
**Networking**: awsvpc mode with private subnets

**Task Definitions** (per agent):
- `outpost-claude:latest`
- `outpost-codex:latest`
- `outpost-gemini:latest`
- `outpost-aider:latest`
- `outpost-grok:latest`

### ALB (Application Load Balancer)

**Purpose**: Routes API traffic to Control Plane service

**Listeners**:
- HTTPS (443) -> Control Plane target group
- HTTP (80) -> Redirect to HTTPS

**Health Checks**: `/health/live`

### DynamoDB

**Tables**:

| Table | Partition Key | Sort Key | Purpose |
|-------|--------------|----------|---------|
| `outpost-dispatches` | `dispatchId` | - | Dispatch records and status |
| `outpost-workspaces` | `userId` | `workspaceId` | Persistent workspace metadata |
| `outpost-pool` | `agentType` | `taskArn` | Warm pool task tracking |
| `outpost-api-keys` | `tenantId` | `apiKeyId` | API key storage |

**Billing**: On-demand (PAY_PER_REQUEST)
**TTL**: Enabled on dispatches (30-day retention)

### S3

**Buckets**:

| Bucket | Purpose | Lifecycle |
|--------|---------|-----------|
| `outpost-artifacts-prod` | Dispatch artifacts (logs, output) | 90-day expiration |
| `outpost-context-prod` | Context injection files | 30-day expiration |

### SQS

**Queues**:

| Queue | Purpose |
|-------|---------|
| `outpost-dispatch-queue` | Async dispatch processing |
| `outpost-events-dlq` | Dead letter queue for failed events |

### EFS (Elastic File System)

**File System**: `fs-outpost-prod`
**Purpose**: Persistent workspace storage for `persistent` mode dispatches

**Structure**:
```
/mnt/efs/
└── users/
    └── {userId}/
        └── workspaces/
            └── {repo-slug}/
                └── ... repository files ...
```

**Access Points**: Created per-user for isolation

---

## Security Model

### VPC Architecture

```
    +---------------------------+
    |         VPC               |
    |  CIDR: 10.0.0.0/16        |
    |                           |
    |  +--------------------+   |
    |  | Public Subnets     |   |
    |  | 10.0.1.0/24 (AZ-a) |   |
    |  | 10.0.2.0/24 (AZ-b) |   |
    |  | - NAT Gateway      |   |
    |  | - ALB              |   |
    |  +--------------------+   |
    |                           |
    |  +--------------------+   |
    |  | Private Subnets    |   |
    |  | 10.0.10.0/24 (AZ-a)|   |
    |  | 10.0.11.0/24 (AZ-b)|   |
    |  | - ECS Tasks        |   |
    |  | - Control Plane    |   |
    |  | - EFS Mount Targets|   |
    |  +--------------------+   |
    |                           |
    +---------------------------+
```

### Security Groups

| Security Group | Inbound | Outbound |
|----------------|---------|----------|
| `sg-alb` | 443 from 0.0.0.0/0 | All to VPC |
| `sg-control-plane` | 8080 from ALB | HTTPS to AWS APIs |
| `sg-ecs-tasks` | None | HTTPS (443) for API calls |
| `sg-efs` | 2049 from ECS tasks | None |

### IAM Roles

**Control Plane Service Role** (`outpost-control-plane-role`):
- ECS task management (RunTask, StopTask, DescribeTasks)
- DynamoDB read/write on outpost-* tables
- S3 read/write on outpost-* buckets
- Secrets Manager read for API keys
- CloudWatch Logs write

**ECS Task Execution Role** (`outpost-task-execution-role`):
- ECR image pull
- CloudWatch Logs write
- Secrets Manager read (task-scoped)

**ECS Task Role** (`outpost-task-role`):
- S3 write to artifacts bucket
- Secrets Manager read for user secrets
- EFS access (IAM-authorized)

### API Authentication Flow

```
    API Request
         |
         v
    +------------------+
    | Extract API Key  |
    | (Bearer/X-API-Key)|
    +--------+---------+
             |
             v
    +------------------+
    | Validate Key     |
    | (DynamoDB lookup)|
    +--------+---------+
             |
             | Verify: active, not expired
             v
    +------------------+
    | Check Scopes     |
    | (dispatch, status|
    |  cancel, etc.)   |
    +--------+---------+
             |
             v
    +------------------+
    | Inject tenantId  |
    | into request     |
    +------------------+
```

### Secret Isolation

```
    Secrets Manager Namespace:

    /outpost/
    +-- system/
    |   +-- ANTHROPIC_API_KEY      (platform key)
    |   +-- OPENAI_API_KEY         (platform key)
    |   +-- GEMINI_API_KEY         (platform key)
    |   +-- DEEPSEEK_API_KEY       (platform key)
    |   +-- GROK_API_KEY           (platform key)
    |
    +-- users/
        +-- {tenant_id}/
            +-- GITHUB_PAT          (user token)
            +-- ANTHROPIC_API_KEY   (user BYOK)
            +-- ...
```

**Access Policy**: ECS task role can only access `/outpost/users/{tenant_id}/*` based on resource tags.

---

## Deployment Architecture

```
                    DEPLOYMENT TOPOLOGY

    +-------------------+     +-------------------+
    |   us-east-1a      |     |   us-east-1b      |
    +-------------------+     +-------------------+
    |                   |     |                   |
    | Control Plane x2  |     | Control Plane x2  |
    |                   |     |                   |
    | ECS Tasks (pool)  |     | ECS Tasks (pool)  |
    |                   |     |                   |
    | NAT Gateway       |     | NAT Gateway       |
    |                   |     |                   |
    | EFS Mount Target  |     | EFS Mount Target  |
    |                   |     |                   |
    +-------------------+     +-------------------+
              |                       |
              +----------+------------+
                         |
              +----------+----------+
              |                     |
              |  DynamoDB (Global)  |
              |  S3 (Regional)      |
              |  Secrets Manager    |
              |                     |
              +---------------------+
```

### Environment Stages

| Environment | Purpose | Pool Size | Scaling |
|-------------|---------|-----------|---------|
| dev | Development/testing | 1 per agent | Manual |
| staging | Pre-prod validation | 2 per agent | Auto |
| prod | Production | 5 per agent | Auto |

---

## Scaling Strategy

### Control Plane Auto-Scaling

```yaml
autoscaling:
  min_instances: 2
  max_instances: 10
  target_cpu_utilization: 70%
  scale_out_cooldown: 60s
  scale_in_cooldown: 300s
```

### ECS Task Pool Scaling

```yaml
pool_scaling:
  default_pool_size: 10  # Total across agents
  max_pool_size: 50
  scale_triggers:
    - metric: pool_miss_rate
      threshold: 20%  # Triggers scale-up
    - metric: queue_depth
      threshold: 10   # 10+ pending dispatches
```

### Capacity Targets

| Metric | Conservative | Expected | Peak |
|--------|--------------|----------|------|
| Daily dispatches | 2,000 | 5,000 | 10,000 |
| Peak concurrent | 50 | 100 | 200 |
| Avg duration | 120s | 90s | 60s |

---

## Monitoring and Observability

### Key Metrics

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| `dispatch.pending.count` | > 50 | Scale pool |
| `dispatch.failure_rate` | > 15% | Page on-call |
| `pool.miss_rate` | > 20% | Scale pool |
| `api.latency.p99` | > 1000ms | Scale service |
| `agent.{name}.failure_rate` | > 10% | Circuit breaker |

### CloudWatch Log Groups

| Log Group | Source | Retention |
|-----------|--------|-----------|
| `/outpost/control-plane` | Control Plane service | 14 days |
| `/outpost/agents/claude` | Claude agent tasks | 14 days |
| `/outpost/agents/codex` | Codex agent tasks | 14 days |
| `/outpost/agents/gemini` | Gemini agent tasks | 14 days |
| `/outpost/agents/aider` | Aider agent tasks | 14 days |
| `/outpost/agents/grok` | Grok agent tasks | 14 days |

---

## Related Documentation

- [API Reference](./API.md) - Complete REST API documentation
- [Control Plane Architecture](./CONTROL_PLANE_ARCHITECTURE.md) - Detailed component design
- [Security Assessment](./SECURITY_ASSESSMENT.md) - Security model analysis
- [Setup Guide - Server](./SETUP_SERVER.md) - Server deployment instructions
- [Setup Guide - Agents](./SETUP_AGENTS.md) - Agent configuration

---

*Outpost System Architecture v2.0.0*
*Blueprint Task: T5.2*
*Generated: 2026-01-13*
