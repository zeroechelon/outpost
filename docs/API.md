# Outpost Control Plane API Reference

> **Multi-Agent Fleet Orchestration Platform**

**Document Version:** 2.0.0
**Last Updated:** 2026-01-14
**Primary Architect:** Richie G. Suarez, Zero Echelon LLC

---

## Base URL

**Production:**
```
http://outpost-control-plane-dev-140603164.us-east-1.elb.amazonaws.com
```

**Future (with custom domain):**
```
https://api.outpost.dev
```

---

## Overview

The Outpost Control Plane API provides RESTful endpoints for dispatching tasks to AI coding agents, managing workspaces, and retrieving execution artifacts. It is the primary interface for the multi-agent fleet orchestration platform.

**Key Features:**
- Dispatch tasks to 5 specialized AI agents (Claude, Codex, Gemini, Aider, Grok)
- Cryptographic tenant isolation with per-tenant API keys
- Workspace persistence options (ephemeral or persistent)
- Context injection for continuity-aware execution
- Real-time status polling with log streaming

**Ecosystem Integration:**
- **MCPify:** HTTP provider routes MCP tool calls to this API
- **Blueprint:** Python client executes generated specifications via this API
- **Ledger:** Cost events emitted for billing integration

---

## Authentication

All endpoints except health checks require authentication via API key.

### Authentication Methods

**X-API-Key Header (Recommended)**
```
X-API-Key: otp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Bearer Token**
```
Authorization: Bearer otp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### API Key Format

```
otp_xxxxxxxx...   # 72 characters total (otp_ prefix + 64 hex chars)
```

**Key Generation:** Keys are generated using `otp_` prefix + 32 random bytes (hex encoded).
**Storage:** Only SHA-256 hash is stored; plaintext key is shown once at creation.

### Scopes

API keys are issued with specific scopes that control access:

| Scope | Description |
|-------|-------------|
| `dispatch` | Create new dispatches |
| `status` | View dispatch status and artifacts |
| `cancel` | Cancel active dispatches |
| `list` | List workspaces |
| `delete` | Delete workspaces |
| `admin` | Full access (all scopes) |

---

## Response Format

All responses follow a consistent JSON structure:

### Success Response

```json
{
  "success": true,
  "data": {
    // Response payload
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-13T14:30:00.000Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      // Additional error context
    }
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-13T14:30:00.000Z"
  }
}
```

---

## Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request parameters |
| 401 | `AUTHENTICATION_ERROR` | Missing or invalid API key |
| 403 | `AUTHORIZATION_ERROR` | Insufficient permissions or scope |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource state conflict |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

---

## Rate Limits and Quotas

| Limit Type | Value | Scope |
|------------|-------|-------|
| Requests per minute | 60 | Per API key |
| Concurrent dispatches | 10 | Per tenant |
| Max task length | 50,000 chars | Per dispatch |
| Max timeout | 86,400 seconds (24h) | Per dispatch |
| Presigned URL expiration | 60-86,400 seconds | Per request |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705067460
```

---

## Endpoints

### Dispatch Operations

#### POST /dispatch

Create a new dispatch to execute a task on an AI agent.

**Authentication**: Required (scope: `dispatch`)

**Request Body**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent` | string | Yes | - | Agent type: `claude`, `codex`, `gemini`, `aider`, `grok` |
| `task` | string | Yes | - | Task description (10-50,000 characters) |
| `repo` | string | No | - | GitHub repository in `owner/repo` format |
| `branch` | string | No | `main` | Branch to checkout (max 255 chars) |
| `context` | string | No | `standard` | Context level: `minimal`, `standard`, `full` |
| `workspaceMode` | string | No | `ephemeral` | Workspace mode: `ephemeral`, `persistent` |
| `timeoutSeconds` | integer | No | `600` | Execution timeout (30-86,400 seconds) |
| `additionalSecrets` | string[] | No | - | Additional secrets to inject |

**Request**

```json
{
  "agent": "claude",
  "task": "Implement unit tests for the authentication module",
  "repo": "myorg/myrepo",
  "branch": "feature/auth",
  "context": "standard",
  "workspaceMode": "ephemeral",
  "timeoutSeconds": 600
}
```

**Response (201 Created)**

```json
{
  "success": true,
  "data": {
    "dispatchId": "dsp_20260113_143052_abc123",
    "status": "pending",
    "agent": "claude",
    "modelId": "claude-opus-4-5-20251101",
    "estimatedStartTime": "2026-01-13T14:30:55.000Z"
  },
  "meta": {
    "requestId": "req_xyz789",
    "timestamp": "2026-01-13T14:30:52.000Z"
  }
}
```

**Example**

```bash
curl -X POST https://api.outpost.dev/dispatch \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude",
    "task": "Add error handling to the payment processor module",
    "repo": "myorg/payments-api",
    "timeoutSeconds": 900
  }'
```

---

#### GET /dispatch/:dispatchId

Get dispatch status with optional log streaming.

**Authentication**: Required (scope: `status`)

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `dispatchId` | string | The dispatch identifier |

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `logOffset` | string | - | Pagination token for logs |
| `logLimit` | integer | 100 | Number of log entries (1-1000) |
| `skipLogs` | boolean | false | Skip log retrieval for faster response |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "dispatchId": "dsp_20260113_143052_abc123",
    "status": "running",
    "agent": "claude",
    "modelId": "claude-opus-4-5-20251101",
    "task": "Add error handling to the payment processor module",
    "progress": 45,
    "logs": [
      {
        "timestamp": "2026-01-13T14:31:00.123Z",
        "message": "Cloning repository myorg/payments-api...",
        "level": "info"
      },
      {
        "timestamp": "2026-01-13T14:31:05.456Z",
        "message": "Analyzing codebase structure...",
        "level": "info"
      }
    ],
    "logOffset": "eyJsYXN0VGltZXN0YW1wIjoiMjAyNi0wMS0xM1QxNDozMTowNS40NTZaIn0=",
    "startedAt": "2026-01-13T14:30:55.000Z",
    "taskArn": "arn:aws:ecs:us-east-1:311493921645:task/outpost-prod/abc123"
  },
  "meta": {
    "requestId": "req_def456",
    "timestamp": "2026-01-13T14:32:00.000Z"
  }
}
```

**Status Values**

| Status | Description |
|--------|-------------|
| `pending` | Dispatch queued, awaiting task allocation |
| `provisioning` | ECS task starting, container initializing |
| `running` | Agent actively executing task |
| `completing` | Task finished, uploading artifacts |
| `success` | Completed successfully |
| `failed` | Task failed with error |
| `timeout` | Execution exceeded timeout limit |
| `cancelled` | Cancelled by user |

**Example**

```bash
curl https://api.outpost.dev/dispatch/dsp_20260113_143052_abc123 \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

```bash
# With log pagination
curl "https://api.outpost.dev/dispatch/dsp_20260113_143052_abc123?logLimit=50&skipLogs=false" \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

---

#### DELETE /dispatch/:dispatchId

Cancel an active dispatch.

**Authentication**: Required (scope: `cancel`)

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `dispatchId` | string | The dispatch identifier |

**Request Body (Optional)**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reason` | string | "Cancelled by user" | Cancellation reason (max 500 chars) |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "dispatchId": "dsp_20260113_143052_abc123",
    "status": "cancelled",
    "message": "Dispatch cancelled successfully"
  },
  "meta": {
    "requestId": "req_ghi789",
    "timestamp": "2026-01-13T14:35:00.000Z"
  }
}
```

**Example**

```bash
curl -X DELETE https://api.outpost.dev/dispatch/dsp_20260113_143052_abc123 \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Task no longer needed"}'
```

---

### Workspace Operations

#### GET /workspaces

List all workspaces for the authenticated user.

**Authentication**: Required (scope: `list`)

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Pagination cursor from previous response |
| `limit` | integer | 20 | Number of results (1-100) |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "workspaceId": "550e8400-e29b-41d4-a716-446655440000",
        "userId": "usr_abc123",
        "createdAt": "2026-01-10T10:00:00.000Z",
        "lastAccessedAt": "2026-01-13T14:30:00.000Z",
        "sizeBytes": 52428800,
        "sizeFormatted": "50.00 MB",
        "repoUrl": "https://github.com/myorg/myrepo",
        "efsAccessPointId": "fsap-0123456789abcdef0"
      }
    ],
    "nextCursor": "eyJsYXN0S2V5IjoiNTUwZTg0MDAifQ==",
    "hasMore": true
  },
  "meta": {
    "requestId": "req_jkl012",
    "timestamp": "2026-01-13T14:30:00.000Z",
    "pagination": {
      "cursor": "eyJsYXN0S2V5IjoiNTUwZTg0MDAifQ==",
      "hasMore": true,
      "limit": 20
    }
  }
}
```

**Example**

```bash
curl https://api.outpost.dev/workspaces?limit=10 \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

---

#### GET /workspaces/:workspaceId

Get details for a specific workspace.

**Authentication**: Required (scope: `status`)

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string (UUID) | The workspace identifier |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "workspace": {
      "workspaceId": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "usr_abc123",
      "createdAt": "2026-01-10T10:00:00.000Z",
      "lastAccessedAt": "2026-01-13T14:30:00.000Z",
      "sizeBytes": 52428800,
      "sizeFormatted": "50.00 MB",
      "repoUrl": "https://github.com/myorg/myrepo",
      "efsAccessPointId": "fsap-0123456789abcdef0"
    }
  },
  "meta": {
    "requestId": "req_mno345",
    "timestamp": "2026-01-13T14:30:00.000Z"
  }
}
```

**Example**

```bash
curl https://api.outpost.dev/workspaces/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

---

#### DELETE /workspaces/:workspaceId

Delete a workspace and its associated storage.

**Authentication**: Required (scope: `delete`)

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string (UUID) | The workspace identifier |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "workspaceId": "550e8400-e29b-41d4-a716-446655440000",
    "message": "Workspace deleted successfully"
  },
  "meta": {
    "requestId": "req_pqr678",
    "timestamp": "2026-01-13T14:30:00.000Z"
  }
}
```

**Example**

```bash
curl -X DELETE https://api.outpost.dev/workspaces/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

---

### Artifacts

#### GET /artifacts/:dispatchId

Get presigned S3 URLs for artifacts generated by a dispatch.

**Authentication**: Required (scope: `status`)

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `dispatchId` | string | The dispatch identifier |

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | integer | 3600 | URL expiration in seconds (60-86,400) |

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "dispatchId": "dsp_20260113_143052_abc123",
    "artifacts": [
      {
        "type": "output",
        "key": "result.json",
        "url": "https://outpost-artifacts.s3.amazonaws.com/dispatches/dsp_20260113_143052_abc123/result.json?...",
        "expiresAt": "2026-01-13T15:30:52.000Z",
        "sizeBytes": 15360,
        "contentType": "application/json"
      },
      {
        "type": "logs",
        "key": "execution.log",
        "url": "https://outpost-artifacts.s3.amazonaws.com/dispatches/dsp_20260113_143052_abc123/execution.log?...",
        "expiresAt": "2026-01-13T15:30:52.000Z",
        "sizeBytes": 8192,
        "contentType": "text/plain"
      },
      {
        "type": "metadata",
        "key": "metadata.json",
        "url": "https://outpost-artifacts.s3.amazonaws.com/dispatches/dsp_20260113_143052_abc123/metadata.json?...",
        "expiresAt": "2026-01-13T15:30:52.000Z",
        "sizeBytes": 512,
        "contentType": "application/json"
      }
    ],
    "status": "success"
  },
  "meta": {
    "requestId": "req_stu901",
    "timestamp": "2026-01-13T14:30:52.000Z"
  }
}
```

**Artifact Types**

| Type | Description |
|------|-------------|
| `output` | Primary output files (diffs, responses, generated code) |
| `logs` | Execution logs |
| `workspace` | Workspace snapshots |
| `metadata` | Execution metadata JSON |

**Example**

```bash
curl "https://api.outpost.dev/artifacts/dsp_20260113_143052_abc123?expiresIn=7200" \
  -H "Authorization: Bearer op_live_xxxxxxxxxxxx"
```

---

### Health Checks

#### GET /health

Full health check with component status.

**Authentication**: Not required

**Response (200 OK)**

```json
{
  "status": "healthy",
  "version": "2.0.0",
  "uptime": 86400,
  "checks": {
    "efs": {
      "status": "pass",
      "message": "EFS accessible"
    },
    "worker-pool": {
      "status": "pass",
      "message": "3/10 workers busy"
    }
  }
}
```

**Status Values**

| Status | HTTP Code | Description |
|--------|-----------|-------------|
| `healthy` | 200 | All components operational |
| `degraded` | 200 | Some components have warnings |
| `unhealthy` | 503 | Critical component failure |

**Example**

```bash
curl https://api.outpost.dev/health
```

---

#### GET /health/live

Kubernetes liveness probe endpoint.

**Authentication**: Not required

**Response (200 OK)**

```json
{
  "status": "ok"
}
```

---

#### GET /health/ready

Kubernetes readiness probe endpoint.

**Authentication**: Not required

**Response (200 OK)**

```json
{
  "status": "ready"
}
```

---

#### GET /health/fleet

Fleet status with comprehensive metrics including pool status, agent availability, and system metrics.

**Authentication**: Not required

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "pool": {
      "totalTasks": 15,
      "warmTasks": 8,
      "inUseTasks": 7,
      "byAgent": [
        {
          "agentType": "claude",
          "totalTasks": 5,
          "warmTasks": 3,
          "inUseTasks": 2,
          "idleTasks": 1
        }
      ]
    },
    "agents": [
      {
        "agent": "claude",
        "available": true,
        "modelId": "claude-opus-4-5-20251101",
        "poolSize": 5,
        "active": 2,
        "idle": 3,
        "successRate": 97,
        "avgDurationMs": 85000,
        "maxConcurrent": 10
      },
      {
        "agent": "codex",
        "available": true,
        "modelId": "gpt-5.2-codex",
        "poolSize": 4,
        "active": 3,
        "idle": 1,
        "successRate": 95,
        "avgDurationMs": 120000,
        "maxConcurrent": 10
      }
    ],
    "system": {
      "cpuUsagePercent": 35,
      "memoryUsagePercent": 42,
      "memoryUsedMB": 1720,
      "memoryTotalMB": 4096,
      "heapUsedMB": 256,
      "heapTotalMB": 512
    },
    "dispatches": {
      "lastHourTotal": 47,
      "byStatus": {
        "pending": 2,
        "running": 5,
        "completed": 35,
        "failed": 3,
        "cancelled": 1,
        "timeout": 1
      }
    },
    "uptime": 86400,
    "timestamp": "2026-01-13T14:30:00.000Z"
  },
  "meta": {
    "requestId": "req_vwx234",
    "timestamp": "2026-01-13T14:30:00.000Z",
    "responseTimeMs": 125
  }
}
```

**Note**: Fleet metrics are cached for 30 seconds to ensure response times under 500ms.

**Example**

```bash
curl https://api.outpost.dev/health/fleet
```

---

## Agent Reference

| Agent | Model ID | Description |
|-------|----------|-------------|
| `claude` | `claude-opus-4-5-20251101` | Anthropic Claude Code |
| `codex` | `gpt-5.2-codex` | OpenAI Codex |
| `gemini` | `gemini-3-pro-preview` | Google Gemini CLI |
| `aider` | `deepseek/deepseek-coder` | Aider with DeepSeek |
| `grok` | `grok-4.1` | xAI Grok |

---

## Context Levels

| Level | Description |
|-------|-------------|
| `minimal` | Basic file listing only |
| `standard` | File tree + key file contents (default) |
| `full` | Complete repository context |

---

## Webhook Events (Coming Soon)

Webhook support for dispatch lifecycle events is planned for a future release.

---

## Related Documentation

- [Architecture Overview](ARCHITECTURE_OVERVIEW.md) - System design
- [Deployment Guide](DEPLOYMENT.md) - Production deployment
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions
- [Zero Echelon Ecosystem](ZERO_ECHELON_ECOSYSTEM.md) - Product integrations

---

**Primary Architect:** Richie G. Suarez
**Organization:** Zero Echelon LLC

---

*Outpost Control Plane API v2.0.0 — Multi-Agent Fleet Orchestration Platform*
