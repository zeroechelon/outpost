# Environment Variables Specification

> **Complete reference for all Outpost environment variables**

**Document Version:** 1.0.0
**Last Updated:** 2026-01-14
**Author:** Richie G. Suarez, Zero Echelon LLC

---

## Table of Contents

1. [Overview](#overview)
2. [Control Plane Variables](#control-plane-variables)
3. [Worker Container Variables](#worker-container-variables)
4. [AWS Configuration](#aws-configuration)
5. [Agent-Specific Variables](#agent-specific-variables)
6. [Example Configurations](#example-configurations)

---

## Overview

This document specifies all environment variables used by Outpost components. Variables are organized by component and marked with their requirement level.

**Requirement Levels:**
- **Required:** Must be set; application will not start without it
- **Recommended:** Should be set for production; has sensible default
- **Optional:** Enhances functionality; safe to omit

---

## Control Plane Variables

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Required | — | Environment mode: `development` or `production` |
| `PORT` | Optional | `3000` | HTTP server port |
| `HOST` | Optional | `0.0.0.0` | HTTP server bind address |
| `LOG_LEVEL` | Optional | `info` | Logging level: `debug`, `info`, `warn`, `error` |

### AWS Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | Required | — | AWS region (e.g., `us-east-1`) |
| `AWS_PROFILE` | Optional | — | AWS credentials profile (local dev only) |
| `AWS_ACCESS_KEY_ID` | Conditional | — | AWS access key (if not using profile/role) |
| `AWS_SECRET_ACCESS_KEY` | Conditional | — | AWS secret key (if not using profile/role) |

### ECS Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ECS_CLUSTER_ARN` | Required | — | ECS cluster ARN for worker tasks |
| `ECS_TASK_DEFINITION_PREFIX` | Optional | `outpost` | Task definition name prefix |
| `ECS_SUBNETS` | Required | — | Comma-separated subnet IDs for tasks |
| `ECS_SECURITY_GROUPS` | Required | — | Comma-separated security group IDs |
| `ECS_ASSIGN_PUBLIC_IP` | Optional | `DISABLED` | Public IP assignment: `ENABLED` or `DISABLED` |

### DynamoDB Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DYNAMODB_TABLE_PREFIX` | Optional | `outpost` | Table name prefix |
| `DYNAMODB_JOBS_TABLE` | Optional | `{prefix}-jobs-{env}` | Jobs table name override |
| `DYNAMODB_API_KEYS_TABLE` | Optional | `{prefix}-api-keys-{env}` | API keys table name override |
| `DYNAMODB_AUDIT_TABLE` | Optional | `{prefix}-audit-{env}` | Audit table name override |

### S3 Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `S3_ARTIFACTS_BUCKET` | Required | — | S3 bucket for task artifacts |
| `S3_LOGS_BUCKET` | Optional | — | S3 bucket for archived logs |
| `S3_PRESIGNED_URL_EXPIRY` | Optional | `3600` | Presigned URL expiry in seconds |

### EFS Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EFS_FILE_SYSTEM_ID` | Recommended | — | EFS file system for workspaces |
| `EFS_ACCESS_POINT_ID` | Optional | — | Default EFS access point |
| `WORKSPACE_MOUNT_PATH` | Optional | `/workspace` | Workspace mount path in containers |

### Security Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY_HASH_ALGORITHM` | Optional | `sha256` | Hash algorithm for API keys |
| `ENABLE_AUDIT_LOGGING` | Optional | `true` | Enable audit trail logging |
| `AUDIT_LOG_RETENTION_DAYS` | Optional | `90` | Audit log retention period |

### Rate Limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | Optional | `true` | Enable rate limiting |
| `RATE_LIMIT_WINDOW_MS` | Optional | `60000` | Rate limit window (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | Optional | `100` | Max requests per window |

### Timeouts

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEFAULT_TASK_TIMEOUT_SECONDS` | Optional | `600` | Default task timeout (10 min) |
| `MAX_TASK_TIMEOUT_SECONDS` | Optional | `3600` | Maximum task timeout (1 hour) |
| `HEALTH_CHECK_TIMEOUT_MS` | Optional | `5000` | Health check timeout |

---

## Worker Container Variables

### Common Variables (All Agents)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_TYPE` | Required | — | Agent identifier: `claude`, `codex`, `gemini`, `aider`, `grok` |
| `TASK_ID` | Required | — | Unique task/dispatch ID |
| `TASK_DESCRIPTION` | Required | — | Task to execute |
| `WORKSPACE_PATH` | Required | — | Path to workspace directory |
| `REPO_URL` | Optional | — | Git repository URL to clone |
| `REPO_BRANCH` | Optional | `main` | Git branch to checkout |
| `TIMEOUT_SECONDS` | Optional | `600` | Task execution timeout |
| `OUTPUT_BUCKET` | Required | — | S3 bucket for output |
| `OUTPUT_PREFIX` | Required | — | S3 key prefix for output |

### Git Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Required | — | GitHub token for repo operations |
| `GIT_AUTHOR_NAME` | Optional | `Outpost Agent` | Git commit author name |
| `GIT_AUTHOR_EMAIL` | Optional | `agent@outpost.dev` | Git commit author email |
| `GIT_SAFE_DIRECTORY` | Optional | `*` | Git safe directory setting |

### Context Injection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTEXT_LEVEL` | Optional | `standard` | Context level: `minimal`, `standard`, `full` |
| `CONTEXT_PAYLOAD` | Optional | — | Base64-encoded context JSON |
| `ZEOS_SOUL_PATH` | Optional | — | Path to project SOUL file |
| `ZEOS_JOURNAL_PATH` | Optional | — | Path to session journal |

---

## AWS Configuration

### IAM Role Requirements

The ECS task execution role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ecs/outpost-*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:*:*:secret:outpost/*"
    }
  ]
}
```

### Secrets Manager References

| Secret Path | Purpose | Format |
|-------------|---------|--------|
| `outpost/agents/anthropic` | Claude API key | `{"apiKey": "sk-ant-..."}` |
| `outpost/agents/openai` | OpenAI API key | `{"apiKey": "sk-..."}` |
| `outpost/agents/google` | Google AI API key | `{"apiKey": "..."}` |
| `outpost/agents/deepseek` | DeepSeek API key | `{"apiKey": "..."}` |
| `outpost/agents/xai` | xAI API key | `{"apiKey": "..."}` |
| `outpost/github` | GitHub token | `{"token": "ghp_..."}` |

---

## Agent-Specific Variables

### Claude Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Required | — | Anthropic API key (from Secrets Manager) |
| `CLAUDE_MODEL` | Optional | `claude-opus-4-5-20251101` | Claude model ID |
| `CLAUDE_CODE_HEADLESS` | Required | `1` | Enable headless mode |
| `CLAUDE_MAX_TOKENS` | Optional | `4096` | Maximum output tokens |

### Codex Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Required | — | OpenAI API key (from Secrets Manager) |
| `CODEX_MODEL` | Optional | `gpt-5.2-codex` | Codex model ID |
| `CODEX_TEMPERATURE` | Optional | `0` | Generation temperature |

### Gemini Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_API_KEY` | Required | — | Google AI API key (from Secrets Manager) |
| `GEMINI_MODEL` | Optional | `gemini-3-pro-preview` | Gemini model ID |

### Aider Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Required | — | DeepSeek API key (from Secrets Manager) |
| `AIDER_MODEL` | Optional | `deepseek/deepseek-coder` | Aider model ID |
| `AIDER_AUTO_COMMITS` | Optional | `true` | Enable auto-commit |
| `AIDER_YOLO` | Optional | `true` | Skip confirmation prompts |

### Grok Agent

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XAI_API_KEY` | Required | — | xAI API key (from Secrets Manager) |
| `GROK_MODEL` | Optional | `grok-4.1` | Grok model ID |
| `GROK_REASONING_MODE` | Optional | `fast` | Reasoning mode |

---

## Example Configurations

### Local Development (.env)

```bash
# Core
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# AWS
AWS_REGION=us-east-1
AWS_PROFILE=soc

# ECS
ECS_CLUSTER_ARN=arn:aws:ecs:us-east-1:311493921645:cluster/outpost-dev
ECS_SUBNETS=subnet-abc123,subnet-def456
ECS_SECURITY_GROUPS=sg-xyz789

# DynamoDB
DYNAMODB_TABLE_PREFIX=outpost
# Tables will be: outpost-jobs-development, etc.

# S3
S3_ARTIFACTS_BUCKET=outpost-artifacts-dev

# EFS
EFS_FILE_SYSTEM_ID=fs-0123456789abcdef0

# Security
ENABLE_AUDIT_LOGGING=true

# Timeouts
DEFAULT_TASK_TIMEOUT_SECONDS=600
MAX_TASK_TIMEOUT_SECONDS=3600
```

### Production (ECS Task Definition)

```json
{
  "containerDefinitions": [
    {
      "name": "control-plane",
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" },
        { "name": "LOG_LEVEL", "value": "info" },
        { "name": "AWS_REGION", "value": "us-east-1" },
        { "name": "DYNAMODB_TABLE_PREFIX", "value": "outpost" },
        { "name": "RATE_LIMIT_ENABLED", "value": "true" },
        { "name": "RATE_LIMIT_MAX_REQUESTS", "value": "100" }
      ],
      "secrets": [
        {
          "name": "GITHUB_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:311493921645:secret:outpost/github:token::"
        }
      ]
    }
  ]
}
```

### Worker Task Override

```json
{
  "containerOverrides": [
    {
      "name": "claude",
      "environment": [
        { "name": "AGENT_TYPE", "value": "claude" },
        { "name": "TASK_ID", "value": "01HXYZ..." },
        { "name": "TASK_DESCRIPTION", "value": "Refactor auth module" },
        { "name": "WORKSPACE_PATH", "value": "/workspace/01HXYZ" },
        { "name": "REPO_URL", "value": "https://github.com/org/repo" },
        { "name": "REPO_BRANCH", "value": "main" },
        { "name": "TIMEOUT_SECONDS", "value": "600" },
        { "name": "CONTEXT_LEVEL", "value": "standard" }
      ]
    }
  ]
}
```

---

## Validation

### Required Variables Check

The control plane validates required variables on startup:

```typescript
const requiredVars = [
  'NODE_ENV',
  'AWS_REGION',
  'ECS_CLUSTER_ARN',
  'ECS_SUBNETS',
  'ECS_SECURITY_GROUPS',
  'S3_ARTIFACTS_BUCKET'
];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    throw new Error(`Required environment variable ${varName} is not set`);
  }
}
```

### Environment Validation Script

```bash
#!/bin/bash
# scripts/validate-env.sh

REQUIRED_VARS=(
  "NODE_ENV"
  "AWS_REGION"
  "ECS_CLUSTER_ARN"
  "S3_ARTIFACTS_BUCKET"
)

MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "ERROR: $var is not set"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  echo "Missing $MISSING required variables"
  exit 1
fi

echo "All required variables are set"
```

---

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - Environment configuration during deployment
- [Infrastructure](INFRASTRUCTURE.md) - Terraform variable mapping
- [Troubleshooting](TROUBLESHOOTING.md) - Configuration issues

---

**Author:** Richie G. Suarez
**Organization:** Zero Echelon LLC

---

*Outpost Environment Specification v1.0.0*
