# Outpost Interface Specification v1.4

> **v1.4 Features:** Security hardening, timeout protection, race-safe caching, dynamic branch detection

> **Cross-Project API Contract for Multi-Agent Dispatch**

This document enables any zeOS Claude session to invoke Outpost's multi-agent fleet.

---

## ⚠️ CRITICAL: INVOCATION CONSTRAINTS

**ALL agent invocations MUST use the dispatch scripts. Direct CLI calls WILL FAIL.**

### ❌ FORBIDDEN (will fail due to auth/ownership)

```bash
# NEVER DO THIS - runs as root, credentials are for ubuntu user
'commands=["claude --print \"...\""]'
'commands=["gemini \"...\""]'
'commands=["codex \"...\""]'
'commands=["aider \"...\""]'
```

### ✅ REQUIRED (always use dispatch scripts)

```bash
# ALWAYS DO THIS - dispatch scripts handle sudo, env, git ownership
'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <repo> \"<task>\" --executor=<agent>"]'
```

**Why?** SSM executes as root. CLI credentials live in `/home/ubuntu/`. Dispatch scripts bridge this gap.

---

## Quick Start (Copy-Paste Ready)

### Prerequisites

Claude needs these credentials (already in richie profile preferences):
```
AWS Account: 311493921645
Region: us-east-1
SSM Instance: mi-0d77bfe39f630bd5c
```

### Single Agent Query

```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <REPO> \"<TASK>\" --executor=<AGENT>"]' \
  --query 'Command.CommandId' \
  --output text
```

**Agents:** `claude` | `codex` | `gemini` | `aider`

### All Agents (Parallel)

```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <REPO> \"<TASK>\" --executor=all"]' \
  --query 'Command.CommandId' \
  --output text
```

### Get Results

```bash
# Wait 30-90 seconds depending on task complexity, then:
aws ssm get-command-invocation \
  --command-id "<COMMAND_ID>" \
  --instance-id "mi-0d77bfe39f630bd5c" \
  --query 'StandardOutputContent' \
  --output text
```

---

## Fleet Configuration

| Agent | Model | Cost | Strengths |
|-------|-------|------|-----------|
| `claude` | claude-opus-4-5-20251101 | $100/mo | Complex reasoning, architecture, multi-file changes |
| `codex` | gpt-5.2-codex | $20/mo | Code generation, refactoring, test writing |
| `gemini` | gemini-3-pro-preview | $50/mo | Analysis, documentation, broad context |
| `aider` | deepseek/deepseek-coder | ~$0.14/MTok | Low-cost, high-quality code, iterative editing |

**Subscription Agents:** $170/mo total (claude + codex + gemini)
**API Agent:** Aider uses DeepSeek API (pay-per-use, extremely cheap)

---

## v1.4 Improvements

| Feature | Description |
|---------|-------------|
| **Security** | GitHub token from .env, fail-fast if missing |
| **Timeout** | 10-minute default (AGENT_TIMEOUT configurable) |
| **Race-Safe** | flock prevents cache corruption on parallel dispatch |
| **Branch Detection** | Auto-detects default branch (main/master/etc) |
| **Running Status** | Immediate status:running in summary.json |
| **Workspace Promotion** | `promote-workspace.sh <run-id>` pushes changes |

---

## Response Format

Each agent creates a run directory with:
```
runs/<run-id>/
├── task.md          # Original task
├── output.log       # Agent stdout/stderr
├── summary.json     # Metadata (includes status:running at start)
├── diff.patch       # Git changes (if any)
└── workspace/       # Isolated repo copy
```

### summary.json Schema
```json
{
  "run_id": "20260103-001234-aider-abc123",
  "repo": "repo-name",
  "executor": "aider",
  "model": "deepseek/deepseek-coder",
  "started": "2026-01-03T00:12:00Z",
  "completed": "2026-01-03T00:12:34Z",
  "status": "success",
  "exit_code": 0,
  "before_sha": "abc...",
  "after_sha": "def...",
  "changes": "committed|uncommitted|none",
  "workspace": "/home/ubuntu/claude-executor/runs/.../workspace"
}
```

---

## Promoting Changes

After a successful run with changes:

```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/scripts/promote-workspace.sh <RUN_ID> \"Commit message\" --push"]'
```

---

## Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| `GITHUB_TOKEN not set` | .env missing or empty | Check `/home/ubuntu/claude-executor/.env` |
| `fatal: detected dubious ownership` | Git repo owned by different user | Use dispatch scripts (they handle sudo) |
| `Authentication Fails` | API key not set | Add to .env (DEEPSEEK_API_KEY, etc) |
| `stdin is not a terminal` | CLI requires interactive TTY | Use dispatch scripts (they use --print/--yolo flags) |
| `NO_RESPONSE_YET` | Agent still processing | Wait longer (30-90 seconds) |
| `status: timeout` | Agent exceeded AGENT_TIMEOUT | Increase timeout or simplify task |

---

## Server Details

- **Host:** SOC (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Region:** us-east-1
- **Executor Path:** `/home/ubuntu/claude-executor/`
- **Environment:** `/home/ubuntu/claude-executor/.env`

---

## Version

**Outpost v1.4** — Security hardening, reliability improvements

### Changelog
- v1.0: Initial release (3 agents: Claude, Codex, Gemini)
- v1.1: Added Aider with DeepSeek Coder backend
- v1.2: Added explicit invocation constraints, error documentation
- v1.3: Workspace isolation for true parallelism
- v1.4: Security hardening, timeout, race-safe caching, dynamic branches

---

*This interface is stable. Breaking changes will increment major version.*
*Agents MUST read this document before invoking Outpost.*
