# Outpost v2 Control Plane Architecture

> **Document Status**: Blueprint T3.1 Deliverable
> **Last Updated**: 2026-01-12
> **Owner**: Platform Team
> **Blueprint**: OUTPOST_V2_COMMANDER_PLATFORM

---

## Executive Summary

The Control Plane is the orchestration layer that transforms Outpost from SSM-based dispatch to ECS Fargate container orchestration. It receives dispatch requests from MCPify, manages warm task pools for sub-5-second cold starts, launches isolated containers, streams logs, and emits cost events to Ledger.

**Key Design Principles:**
- Container-per-dispatch isolation (no shared state between users)
- Warm pool for fast cold starts (<5s with pool, <30s without)
- Event-driven architecture with DynamoDB streams
- WebSocket streaming for real-time log delivery
- Cost attribution via Ledger integration

---

## Component Architecture

```
                                    CONTROL PLANE ARCHITECTURE
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|    +-----------------+         +------------------+         +--------------------+        |
|    |     MCPify      |         |   API Gateway    |         |   CloudWatch       |        |
|    |  (MCP Server)   |-------->|   (REST + WS)    |<--------|   (Log Groups)     |        |
|    +-----------------+         +--------+---------+         +--------------------+        |
|                                         |                             ^                   |
|                                         v                             |                   |
|    +-------------------------------------------------------------------------------------+|
|    |                           CONTROL PLANE SERVICE                                     ||
|    |  +-------------+   +----------------+   +-----------------+   +-----------------+   ||
|    |  |             |   |                |   |                 |   |                 |   ||
|    |  | Dispatcher  |<->| Pool Manager   |   | Status Tracker  |   | Workspace       |   ||
|    |  |             |   |                |   |                 |   | Handler         |   ||
|    |  +------+------+   +-------+--------+   +--------+--------+   +--------+--------+   ||
|    |         |                  |                     |                     |            ||
|    |         |                  |                     |                     |            ||
|    +---------+------------------+---------------------+---------------------+------------+|
|              |                  |                     |                     |             |
|              v                  v                     v                     v             |
|    +------------------+  +-------------+  +------------------+  +--------------------+    |
|    |    ECS Fargate   |  |  DynamoDB   |  |   EventBridge    |  |        EFS         |    |
|    |    (5 Agents)    |  |  (3 Tables) |  |   (Events)       |  |  (Workspaces)      |    |
|    +------------------+  +-------------+  +------------------+  +--------------------+    |
|              |                                                          |                 |
|              v                                                          v                 |
|    +------------------+                                        +--------------------+     |
|    | Secrets Manager  |                                        |         S3         |     |
|    | (API Keys)       |                                        |    (Artifacts)     |     |
|    +------------------+                                        +--------------------+     |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
                                         |
                                         v
                              +--------------------+
                              |      Ledger        |
                              |  (Cost Events)     |
                              +--------------------+
```

---

## Component Details

### 1. Dispatcher Service

**Purpose:** Receives dispatch requests, validates parameters, selects task definition, and initiates ECS task launch.

**Responsibilities:**
- Request validation (user_id, agent, model, permissions)
- Task definition selection based on agent/model
- Coordination with Pool Manager for warm task acquisition
- Fallback to cold launch if pool exhausted
- Dispatch ID generation and initial state persistence

```
                    DISPATCHER FLOW

    Request ──> Validate ──> Select Task Def ──> Acquire/Launch ──> Return ID
       │            │              │                   │              │
       │            │              │                   │              │
       v            v              v                   v              v
   [Parse]     [Schema]      [Registry]         [Pool/ECS]      [DynamoDB]
```

**Key Functions:**
```typescript
interface DispatcherService {
  dispatch(request: DispatchRequest): Promise<DispatchResponse>;
  cancel(dispatchId: string, userId: string): Promise<void>;
  getTaskDefinition(agent: Agent, model?: string): TaskDefinitionArn;
}
```

### 2. Pool Manager

**Purpose:** Maintains warm ECS tasks for each agent type to minimize cold start latency.

**Responsibilities:**
- Maintain configurable pool size per agent (default: 2 per agent)
- Pre-launch tasks in PENDING state awaiting dispatch
- Replenish pool when tasks are consumed
- Health checking of pool tasks
- Pool metrics emission

```
                    POOL MANAGER STATE

    +-----------+     +------------+     +------------+
    |   WARM    |---->|  ACQUIRED  |---->|  RUNNING   |
    | (waiting) |     | (assigned) |     | (active)   |
    +-----------+     +------------+     +------------+
          ^                                    |
          |           +-----------+            |
          +-----------| REPLENISH |<-----------+
                      +-----------+
```

**Pool Configuration:**
```yaml
pool_config:
  claude:
    min_size: 2
    max_size: 5
    warm_timeout: 300  # seconds before recycling unused task
  codex:
    min_size: 2
    max_size: 5
    warm_timeout: 300
  gemini:
    min_size: 1
    max_size: 3
    warm_timeout: 300
  aider:
    min_size: 1
    max_size: 3
    warm_timeout: 300
  grok:
    min_size: 1
    max_size: 3
    warm_timeout: 300
```

### 3. Status Tracker

**Purpose:** Monitors dispatch lifecycle, processes ECS events, and provides status queries.

**Responsibilities:**
- Subscribe to ECS task state changes via EventBridge
- Update dispatch status in DynamoDB
- Handle timeout enforcement
- Aggregate logs from CloudWatch
- Emit completion events to Ledger

**Event Sources:**
- ECS Task State Change events
- CloudWatch Logs subscription filters
- DynamoDB Streams for status changes

### 4. Workspace Handler

**Purpose:** Manages workspace lifecycle for both ephemeral and persistent modes.

**Responsibilities:**
- Ephemeral: Clean workspace per dispatch (default)
- Persistent: EFS-backed workspace per user/repo combination
- Workspace enumeration and deletion
- Storage quota enforcement
- Artifact collection to S3

```
                    WORKSPACE MODES

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

## API Specification

### REST Endpoints

#### POST /dispatch
Create a new dispatch request.

**Request:**
```json
{
  "user_id": "usr_abc123",
  "repo": "owner/repo-name",
  "task": "Implement feature X with tests",
  "agent": "claude",
  "model": "claude-opus-4-5-20251101",
  "workspace_mode": "ephemeral",
  "timeout_seconds": 600,
  "context_level": "standard",
  "secrets": ["GITHUB_PAT"]
}
```

**Response (202 Accepted):**
```json
{
  "dispatch_id": "dsp_20260112_143052_abc123",
  "status": "PENDING",
  "agent": "claude",
  "model": "claude-opus-4-5-20251101",
  "created_at": "2026-01-12T14:30:52Z",
  "estimated_start": "2026-01-12T14:30:55Z"
}
```

**Error Responses:**
- 400 Bad Request: Invalid parameters
- 401 Unauthorized: Missing/invalid user credentials
- 403 Forbidden: User quota exceeded
- 429 Too Many Requests: Rate limit exceeded
- 503 Service Unavailable: Fleet unhealthy

---

#### GET /dispatch/:id
Get dispatch status and details.

**Response (200 OK):**
```json
{
  "dispatch_id": "dsp_20260112_143052_abc123",
  "user_id": "usr_abc123",
  "status": "RUNNING",
  "agent": "claude",
  "model": "claude-opus-4-5-20251101",
  "repo": "owner/repo-name",
  "task": "Implement feature X with tests",
  "workspace_mode": "ephemeral",
  "created_at": "2026-01-12T14:30:52Z",
  "started_at": "2026-01-12T14:30:55Z",
  "progress": {
    "phase": "executing",
    "percent": 45
  },
  "logs_url": "/ws/dispatch/dsp_20260112_143052_abc123",
  "task_arn": "arn:aws:ecs:us-east-1:311493921645:task/outpost-prod/abc123"
}
```

**Status Values:** `PENDING`, `PROVISIONING`, `RUNNING`, `COMPLETING`, `SUCCESS`, `FAILED`, `TIMEOUT`, `CANCELLED`

---

#### DELETE /dispatch/:id
Cancel an in-progress dispatch.

**Response (200 OK):**
```json
{
  "dispatch_id": "dsp_20260112_143052_abc123",
  "status": "CANCELLED",
  "cancelled_at": "2026-01-12T14:35:00Z"
}
```

**Error Responses:**
- 404 Not Found: Dispatch not found
- 409 Conflict: Dispatch already completed

---

#### GET /workspaces
List user's persistent workspaces.

**Response (200 OK):**
```json
{
  "user_id": "usr_abc123",
  "workspaces": [
    {
      "workspace_id": "ws_owner_repo_abc123",
      "repo": "owner/repo-name",
      "created_at": "2026-01-10T10:00:00Z",
      "last_accessed": "2026-01-12T14:30:00Z",
      "size_bytes": 52428800,
      "dispatch_count": 15
    }
  ],
  "total_size_bytes": 52428800,
  "quota_bytes": 1073741824
}
```

---

#### DELETE /workspaces/:id
Delete a persistent workspace.

**Response (200 OK):**
```json
{
  "workspace_id": "ws_owner_repo_abc123",
  "deleted_at": "2026-01-12T15:00:00Z",
  "freed_bytes": 52428800
}
```

---

#### GET /artifacts/:dispatch_id
Get presigned URLs for dispatch artifacts.

**Response (200 OK):**
```json
{
  "dispatch_id": "dsp_20260112_143052_abc123",
  "artifacts": {
    "stdout": "https://outpost-artifacts.s3.amazonaws.com/...",
    "stderr": "https://outpost-artifacts.s3.amazonaws.com/...",
    "diff": "https://outpost-artifacts.s3.amazonaws.com/...",
    "context_json": "https://outpost-artifacts.s3.amazonaws.com/..."
  },
  "expires_at": "2026-01-12T16:30:52Z"
}
```

---

#### GET /health
Fleet health and status.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-12T14:30:00Z",
  "agents": {
    "claude": {
      "status": "healthy",
      "pool_size": 2,
      "pool_available": 2,
      "active_dispatches": 3,
      "success_rate_24h": 0.97,
      "avg_duration_sec": 85
    },
    "codex": {
      "status": "healthy",
      "pool_size": 2,
      "pool_available": 1,
      "active_dispatches": 5,
      "success_rate_24h": 0.95,
      "avg_duration_sec": 120
    },
    "gemini": {
      "status": "healthy",
      "pool_size": 1,
      "pool_available": 1,
      "active_dispatches": 1,
      "success_rate_24h": 0.98,
      "avg_duration_sec": 60
    },
    "aider": {
      "status": "healthy",
      "pool_size": 1,
      "pool_available": 0,
      "active_dispatches": 2,
      "success_rate_24h": 0.92,
      "avg_duration_sec": 150
    },
    "grok": {
      "status": "degraded",
      "pool_size": 1,
      "pool_available": 0,
      "active_dispatches": 1,
      "success_rate_24h": 0.85,
      "avg_duration_sec": 90,
      "degraded_reason": "High failure rate"
    }
  },
  "dispatches_last_hour": 47,
  "dispatches_last_24h": 312,
  "system": {
    "ecs_cluster": "outpost-prod",
    "running_tasks": 12,
    "pending_tasks": 2,
    "cpu_utilization": 0.35,
    "memory_utilization": 0.42
  }
}
```

---

### WebSocket Endpoint

#### WS /ws/dispatch/:id
Stream dispatch logs in real-time.

**Connection URL:** `wss://api.outpost.dev/ws/dispatch/dsp_20260112_143052_abc123`

**Message Types:**

**Log Entry:**
```json
{
  "type": "log",
  "timestamp": "2026-01-12T14:31:00.123Z",
  "stream": "stdout",
  "message": "Cloning repository owner/repo-name..."
}
```

**Status Change:**
```json
{
  "type": "status",
  "timestamp": "2026-01-12T14:30:55.000Z",
  "status": "RUNNING",
  "previous": "PROVISIONING"
}
```

**Progress Update:**
```json
{
  "type": "progress",
  "timestamp": "2026-01-12T14:32:00.000Z",
  "phase": "executing",
  "percent": 45,
  "message": "Processing files..."
}
```

**Completion:**
```json
{
  "type": "complete",
  "timestamp": "2026-01-12T14:35:00.000Z",
  "status": "SUCCESS",
  "duration_sec": 245,
  "exit_code": 0,
  "artifacts_url": "/artifacts/dsp_20260112_143052_abc123"
}
```

**Error:**
```json
{
  "type": "error",
  "timestamp": "2026-01-12T14:35:00.000Z",
  "code": "TIMEOUT",
  "message": "Task exceeded 600 second timeout"
}
```

---

## Dispatch Lifecycle State Machine

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
             | Artifacts uploaded, cost event emitted
             v
    +-------------------+
    |     SUCCESS       |  Terminal state - task completed successfully
    +-------------------+


    State Transitions:

    PENDING -> PROVISIONING     : Task acquired from pool or launched
    PENDING -> CANCELLED        : User cancelled before start
    PENDING -> FAILED           : No capacity available

    PROVISIONING -> RUNNING     : Container started successfully
    PROVISIONING -> FAILED      : Container failed to start
    PROVISIONING -> TIMEOUT     : Provisioning exceeded limit (60s)

    RUNNING -> COMPLETING       : Agent exited with code 0
    RUNNING -> FAILED           : Agent exited with non-zero code
    RUNNING -> TIMEOUT          : Execution exceeded timeout
    RUNNING -> CANCELLED        : User requested cancellation

    COMPLETING -> SUCCESS       : Artifacts uploaded, cleanup done
    COMPLETING -> FAILED        : Post-processing failed
```

**State Descriptions:**

| State | Description | Typical Duration |
|-------|-------------|------------------|
| PENDING | Request received, awaiting task | 0-5s (warm), 0-30s (cold) |
| PROVISIONING | ECS task starting, pulling image | 5-30s |
| RUNNING | Agent CLI executing task | 30s - 3600s |
| COMPLETING | Task done, uploading artifacts | 5-15s |
| SUCCESS | Completed successfully | Terminal |
| FAILED | Task failed (any reason) | Terminal |
| TIMEOUT | Exceeded configured timeout | Terminal |
| CANCELLED | User cancelled | Terminal |

---

## DynamoDB Schema

### Table: outpost-dispatches

**Purpose:** Track all dispatch requests and their lifecycle.

**Key Structure:**
- Partition Key: `dispatch_id` (String)
- GSI1: `user_id-started_at-index`
  - Partition Key: `user_id` (String)
  - Sort Key: `started_at` (String, ISO8601)

**Attributes:**
```json
{
  "dispatch_id": "dsp_20260112_143052_abc123",
  "user_id": "usr_abc123",
  "status": "SUCCESS",
  "agent": "claude",
  "model": "claude-opus-4-5-20251101",
  "repo": "owner/repo-name",
  "task": "Implement feature X with tests",
  "workspace_mode": "ephemeral",
  "timeout_seconds": 600,
  "context_level": "standard",
  "secrets_requested": ["GITHUB_PAT"],

  "task_arn": "arn:aws:ecs:us-east-1:311493921645:task/outpost-prod/abc123",
  "task_definition": "outpost-claude:15",
  "pool_acquired": true,

  "created_at": "2026-01-12T14:30:52Z",
  "started_at": "2026-01-12T14:30:55Z",
  "ended_at": "2026-01-12T14:35:00Z",
  "duration_seconds": 245,

  "exit_code": 0,
  "error_message": null,

  "artifacts": {
    "stdout_key": "dispatches/dsp_20260112_143052_abc123/stdout.log",
    "stderr_key": "dispatches/dsp_20260112_143052_abc123/stderr.log",
    "diff_key": "dispatches/dsp_20260112_143052_abc123/diff.patch"
  },

  "cost_event_id": "cost_20260112_143500_xyz789",

  "ttl": 1710288000
}
```

**TTL Policy:** Dispatches expire after 30 days (configurable). Artifacts in S3 have separate lifecycle policy.

---

### Table: outpost-workspaces

**Purpose:** Track persistent workspaces for users.

**Key Structure:**
- Partition Key: `user_id` (String)
- Sort Key: `workspace_id` (String)

**Attributes:**
```json
{
  "user_id": "usr_abc123",
  "workspace_id": "ws_owner_repo_abc123",
  "repo": "owner/repo-name",
  "efs_access_point_id": "fsap-0123456789abcdef0",
  "efs_path": "/users/usr_abc123/workspaces/owner_repo-name",

  "created_at": "2026-01-10T10:00:00Z",
  "last_accessed": "2026-01-12T14:30:00Z",
  "size_bytes": 52428800,
  "dispatch_count": 15,

  "branch": "main",
  "last_commit": "abc123def456",

  "status": "active",
  "locked_by": null,
  "locked_at": null
}
```

**Workspace Status Values:** `active`, `locked`, `deleting`, `deleted`

---

### Table: outpost-pool

**Purpose:** Track warm pool tasks for fast dispatch.

**Key Structure:**
- Partition Key: `agent_type` (String)
- Sort Key: `task_arn` (String)

**Attributes:**
```json
{
  "agent_type": "claude",
  "task_arn": "arn:aws:ecs:us-east-1:311493921645:task/outpost-prod/abc123",
  "task_definition": "outpost-claude:15",

  "status": "warm",
  "created_at": "2026-01-12T14:25:00Z",
  "acquired_at": null,
  "acquired_by": null,

  "health_check_at": "2026-01-12T14:30:00Z",
  "health_status": "healthy",

  "ttl": 1705067100
}
```

**Pool Status Values:** `warming`, `warm`, `acquired`, `releasing`

**TTL Policy:** Pool tasks expire after `warm_timeout` (default 300s) if not acquired.

---

## Event Flow

```
                              EVENT FLOW DIAGRAM

    1. DISPATCH REQUEST
    +-------------+     +-------------+     +--------------+     +-------------+
    |   MCPify    |---->| API Gateway |---->|  Dispatcher  |---->|  DynamoDB   |
    |             |     |   (REST)    |     |   Service    |     | (dispatches)|
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
    |   Status    |---->|  DynamoDB   |---->|  WebSocket   |
    |   Tracker   |     | (dispatches)|     |   Clients    |
    +------+------+     +-------------+     +--------------+
           |
    6. COMPLETION
           |
           +--------> S3 (Artifacts)
           |
           +--------> Ledger (Cost Event)
           |
           +--------> Pool Manager (Replenish)
```

### Event Processing Details

**Step 1: Dispatch Request**
1. MCPify sends dispatch request via REST API
2. API Gateway validates request format
3. Dispatcher validates user permissions and quotas
4. Dispatch record created in DynamoDB with `PENDING` status
5. Dispatch ID returned to caller

**Step 2: Task Acquisition**
1. Dispatcher queries Pool Manager for available warm task
2. If warm task available:
   - Mark task as `acquired` in pool table
   - Associate with dispatch ID
3. If no warm task:
   - Launch new ECS task with RunTask API
   - Include secrets injection in task override

**Step 3: ECS Launch**
1. ECS receives RunTask or pool task receives environment injection
2. Container pulls from ECR (if not cached)
3. Secrets Manager injects API keys via task definition
4. Container starts with workspace mounted (EFS or tmpfs)

**Step 4: Task Execution**
1. Agent CLI starts with task parameters
2. Logs stream to CloudWatch Logs
3. ECS events published to EventBridge
4. Status Tracker subscribes to both

**Step 5: Status Updates**
1. Status Tracker processes events
2. Updates DynamoDB dispatch record
3. Pushes updates to WebSocket connections

**Step 6: Completion**
1. Task exits (success, failure, or timeout)
2. Status Tracker:
   - Uploads artifacts to S3
   - Emits cost event to Ledger
   - Updates final status in DynamoDB
   - Signals Pool Manager to replenish
3. EFS workspace retained (persistent) or cleaned (ephemeral)

---

## Error Handling and Retry Policies

### Error Categories

| Category | Examples | Retry Strategy |
|----------|----------|----------------|
| Transient | ECS capacity, network timeout | Exponential backoff, max 3 retries |
| User Error | Invalid repo, bad credentials | No retry, return error |
| Agent Error | CLI crash, timeout | No retry, mark failed |
| System Error | DynamoDB throttling | Exponential backoff, max 5 retries |

### Retry Configuration

```yaml
retry_policies:
  ecs_launch:
    max_attempts: 3
    base_delay_ms: 1000
    max_delay_ms: 10000
    jitter: true
    retryable_errors:
      - ECS.ServiceException
      - ECS.ClusterNotFoundException
      - ThrottlingException

  dynamodb:
    max_attempts: 5
    base_delay_ms: 100
    max_delay_ms: 3000
    retryable_errors:
      - ProvisionedThroughputExceededException
      - ThrottlingException

  secrets_manager:
    max_attempts: 3
    base_delay_ms: 500
    max_delay_ms: 5000
    retryable_errors:
      - ThrottlingException
      - InternalServiceError
```

### Circuit Breaker

```yaml
circuit_breaker:
  ecs:
    failure_threshold: 5
    recovery_timeout_sec: 60
    half_open_requests: 3

  agent:
    # Per-agent circuit breakers
    failure_threshold: 3
    recovery_timeout_sec: 120
    half_open_requests: 2
```

### Timeout Enforcement

```
                    TIMEOUT LAYERS

    Layer 1: API Gateway (29s)
    ├── Request/response timeout for synchronous calls

    Layer 2: Provisioning (60s)
    ├── Time from PENDING to RUNNING
    ├── Includes: pool acquisition, ECS launch, container start

    Layer 3: Execution (configurable, max 3600s)
    ├── Time from RUNNING to completion
    ├── Enforced via: ECS StopTask after timeout

    Layer 4: Completion (30s)
    ├── Time for artifact upload and cleanup
```

### Error Response Format

```json
{
  "error": {
    "code": "DISPATCH_FAILED",
    "message": "Task failed to start within provisioning timeout",
    "details": {
      "dispatch_id": "dsp_20260112_143052_abc123",
      "stage": "PROVISIONING",
      "reason": "ECS capacity unavailable",
      "retry_after_sec": 30
    }
  }
}
```

---

## Scaling Considerations

### Target: 1000+ Daily Active Users

**Capacity Planning:**

| Metric | Conservative | Expected | Peak |
|--------|--------------|----------|------|
| Daily dispatches | 2,000 | 5,000 | 10,000 |
| Peak concurrent dispatches | 50 | 100 | 200 |
| Avg dispatch duration | 120s | 90s | 60s |
| Required ECS tasks (peak) | 50 | 100 | 200 |

### Horizontal Scaling Strategy

**Control Plane Service:**
```yaml
autoscaling:
  min_instances: 2
  max_instances: 10
  target_cpu_utilization: 70
  scale_out_cooldown_sec: 60
  scale_in_cooldown_sec: 300
```

**ECS Fargate Pool:**
```yaml
pool_scaling:
  default_pool_size: 10  # Total across agents
  max_pool_size: 50
  scale_trigger:
    - metric: pool_miss_rate
      threshold: 0.2  # 20% miss rate triggers scale-up
    - metric: queue_depth
      threshold: 10   # 10+ pending dispatches
```

### DynamoDB Capacity

```yaml
dynamodb:
  outpost-dispatches:
    billing_mode: PAY_PER_REQUEST  # Auto-scaling
    # Expected: 1000 WCU, 2000 RCU at peak

  outpost-workspaces:
    billing_mode: PAY_PER_REQUEST
    # Expected: 100 WCU, 500 RCU at peak

  outpost-pool:
    billing_mode: PAY_PER_REQUEST
    # Expected: 500 WCU, 1000 RCU at peak
```

### Connection Limits

| Component | Connection Limit | Strategy |
|-----------|------------------|----------|
| WebSocket connections | 10,000 per instance | API Gateway managed WebSocket |
| DynamoDB connections | 50,000 per account | Connection pooling |
| ECS API calls | 100 TPS | Request batching, caching |

### Cost Optimization

1. **Fargate Spot**: Use Spot for 60-90% of pool tasks (70% cost reduction)
2. **Pool right-sizing**: Monitor pool hit rate, reduce if >90%
3. **DynamoDB TTL**: Auto-delete old dispatches (30 days)
4. **S3 Intelligent Tiering**: Artifacts auto-tier after 30 days
5. **CloudWatch Log retention**: 14 days hot, archive to S3

---

## Integration Points

### MCPify (MCP Server)

**Interface:** HTTP REST + WebSocket
**Authentication:** API Gateway + Lambda Authorizer (API keys)
**Tools Exposed:**
- `outpost_dispatch` -> POST /dispatch
- `outpost_status` -> GET /dispatch/:id
- `outpost_cancel` -> DELETE /dispatch/:id
- `outpost_list_workspaces` -> GET /workspaces
- `outpost_delete_workspace` -> DELETE /workspaces/:id
- `outpost_get_artifacts` -> GET /artifacts/:dispatch_id
- `outpost_health` -> GET /health

### Ledger (Cost Events)

**Interface:** EventBridge + SQS
**Event Schema:**
```json
{
  "source": "outpost.control-plane",
  "detail-type": "dispatch.complete",
  "detail": {
    "event_type": "dispatch_complete",
    "user_id": "usr_abc123",
    "dispatch_id": "dsp_20260112_143052_abc123",
    "agent": "claude",
    "model": "claude-opus-4-5-20251101",
    "started_at": "2026-01-12T14:30:55Z",
    "ended_at": "2026-01-12T14:35:00Z",
    "duration_seconds": 245,
    "status": "success",
    "workspace_mode": "ephemeral",
    "resources": {
      "vcpu": 1,
      "memory_mb": 2048,
      "network_egress_bytes": 15728640
    },
    "tokens": {
      "input": 4500,
      "output": 12000
    }
  }
}
```

### AWS Services

| Service | Purpose | Interface |
|---------|---------|-----------|
| ECS Fargate | Container orchestration | AWS SDK (ECS) |
| DynamoDB | State persistence | AWS SDK (DynamoDB) |
| EFS | Persistent workspaces | Mount in task definition |
| Secrets Manager | API key injection | Task definition secrets |
| S3 | Artifact storage | AWS SDK (S3) |
| CloudWatch Logs | Log aggregation | Logs Insights, subscriptions |
| EventBridge | Event routing | Rules + targets |
| API Gateway | REST + WebSocket API | Infrastructure |

---

## Security Model

### Authentication Flow

```
    MCPify Request
         |
         v
    +-------------+
    | API Gateway |
    +------+------+
           |
           v
    +------------------+
    | Lambda Authorizer|
    +--------+---------+
             |
             | Validate API key (op_live_xxx)
             | Check user quotas
             | Inject user_id into request
             v
    +------------------+
    | Control Plane    |
    +------------------+
```

### Secret Isolation

```
    Secrets Manager Namespace:

    /outpost/
    ├── system/
    │   ├── ANTHROPIC_API_KEY      (platform key)
    │   ├── OPENAI_API_KEY         (platform key)
    │   └── ...
    │
    └── users/
        └── {user_id}/
            ├── GITHUB_PAT          (user's token)
            ├── ANTHROPIC_API_KEY   (user's BYOK key)
            └── ...
```

**Access Policy:**
- ECS task role can only access `/outpost/users/{user_id}/*` based on task tags
- Platform keys used only if user hasn't provided BYOK

### Network Isolation

```
    VPC Architecture:

    +---------------------------+
    |         VPC               |
    |  +--------------------+   |
    |  | Public Subnets     |   |
    |  | - NAT Gateway      |   |
    |  | - ALB (future)     |   |
    |  +--------------------+   |
    |                           |
    |  +--------------------+   |
    |  | Private Subnets    |   |
    |  | - ECS Tasks        |   |
    |  | - EFS Mount Targets|   |
    |  +--------------------+   |
    |                           |
    |  Security Groups:         |
    |  - ECS: egress 443, 22    |
    |  - EFS: ingress 2049      |
    +---------------------------+
```

---

## Monitoring and Observability

### Key Metrics

| Metric | Threshold | Alert |
|--------|-----------|-------|
| `dispatch.pending.count` | > 50 | Scale pool |
| `dispatch.duration.p95` | > 300s | Investigate |
| `pool.miss_rate` | > 20% | Scale pool |
| `pool.warm.count` | < 5 | Replenish |
| `agent.{name}.failure_rate` | > 10% | Circuit breaker |
| `api.latency.p99` | > 1000ms | Scale service |

### CloudWatch Dashboards

1. **Fleet Overview**: Dispatch counts, success rates, active tasks
2. **Agent Performance**: Per-agent metrics, latency, errors
3. **Pool Health**: Pool sizes, hit rates, warm task counts
4. **Cost Attribution**: Dispatches by user, agent, duration

### Alarms

```yaml
alarms:
  - name: HighDispatchFailureRate
    metric: dispatch.failure_rate
    threshold: 0.15
    period: 300
    evaluation_periods: 2
    action: SNS -> PagerDuty

  - name: PoolExhausted
    metric: pool.available.count
    threshold: 0
    period: 60
    evaluation_periods: 3
    action: SNS -> Scale pool

  - name: DynamoDBThrottling
    metric: ConsumedWriteCapacityUnits
    threshold: 1000
    period: 60
    action: SNS -> Review capacity
```

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

### Deployment Stages

| Environment | Purpose | Pool Size | Scaling |
|-------------|---------|-----------|---------|
| dev | Development/testing | 1 per agent | Manual |
| staging | Pre-prod validation | 2 per agent | Auto |
| prod | Production | 5 per agent | Auto |

---

## Appendix A: Dispatch ID Format

```
Format: dsp_{YYYYMMDD}_{HHMMSS}_{random6}

Example: dsp_20260112_143052_abc123

Components:
- dsp_: Prefix for identification
- YYYYMMDD: Date (UTC)
- HHMMSS: Time (UTC)
- random6: 6 character alphanumeric for uniqueness
```

---

## Appendix B: Agent Task Definition Template

```json
{
  "family": "outpost-claude",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::311493921645:role/outpost-task-execution",
  "taskRoleArn": "arn:aws:iam::311493921645:role/outpost-task",
  "containerDefinitions": [
    {
      "name": "agent",
      "image": "311493921645.dkr.ecr.us-east-1.amazonaws.com/outpost-claude:latest",
      "essential": true,
      "environment": [
        {"name": "AGENT_TYPE", "value": "claude"},
        {"name": "WORKSPACE_MODE", "value": "ephemeral"}
      ],
      "secrets": [
        {
          "name": "ANTHROPIC_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:311493921645:secret:/outpost/system/ANTHROPIC_API_KEY"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/outpost/agents/claude",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "dispatch"
        }
      },
      "mountPoints": [
        {
          "sourceVolume": "workspace",
          "containerPath": "/workspace",
          "readOnly": false
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "workspace",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-0123456789abcdef0",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-0123456789abcdef0",
          "iam": "ENABLED"
        }
      }
    }
  ]
}
```

---

*Control Plane Architecture v1.0 — Outpost v2 Commander Platform*
*Blueprint Task: T3.1*
*Generated: 2026-01-12*
