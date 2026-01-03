# Outpost Interface Specification v1.2

> **Cross-Project API Contract for Multi-Agent Dispatch**

This document enables any zeOS Claude session to invoke Outpost's multi-agent fleet.

---

## ⚠️ CRITICAL: INVOCATION CONSTRAINTS

**ALL agent invocations MUST use the dispatch scripts. Direct CLI calls WILL FAIL.**

### ❌ FORBIDDEN (will fail due to auth/ownership)

```bash
# NEVER DO THIS - runs as root, credentials are for ubuntu user
'commands=["claude --print \"...\"""]'
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

## Invocation Patterns

### Pattern 1: Single Agent
```bash
--executor=claude
--executor=codex
--executor=gemini
--executor=aider
```

### Pattern 2: Multiple Specific Agents
```bash
--executor=claude,gemini
--executor=codex,aider
--executor=claude,codex,aider
```

### Pattern 3: All Agents (Consensus/Comparison)
```bash
--executor=all
```

---

## Use Cases

| Scenario | Command |
|----------|---------|
| Quick code task | `--executor=claude` |
| Need second opinion | `--executor=claude,codex` |
| Consensus (high confidence) | `--executor=all` |
| Documentation task | `--executor=gemini` |
| High-volume/cheap queries | `--executor=aider` |
| Iterative code editing | `--executor=aider` |

---

## Response Format

Each agent creates a run directory with:
```
runs/<run-id>/
├── task.md          # Original task
├── output.log       # Agent stdout/stderr
├── summary.json     # Metadata
└── diff.patch       # Git changes (if any)
```

### summary.json Schema
```json
{
  "run_id": "20260103-001234-aider-abc123",
  "repo": "repo-name",
  "executor": "aider",
  "model": "deepseek/deepseek-coder",
  "completed": "2026-01-03T00:12:34Z",
  "status": "success",
  "exit_code": 0,
  "before_sha": "abc...",
  "after_sha": "def...",
  "changes": "committed|uncommitted|none"
}
```

---

## Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| `fatal: detected dubious ownership` | Git repo owned by ubuntu, command ran as root | Use dispatch scripts (they handle sudo) |
| `Please set Auth method in /root/.gemini/` | CLI looking for root's config | Use dispatch scripts (they run as ubuntu) |
| `stdin is not a terminal` | CLI requires interactive TTY | Use dispatch scripts (they use --print/--yolo flags) |
| `NO_RESPONSE_YET` | Agent still processing | Wait longer (30-90 seconds) |

---

## Server Details

- **Host:** SOC (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Region:** us-east-1
- **Executor Path:** `/home/ubuntu/claude-executor/`
- **Guard File:** `/home/ubuntu/claude-executor/AGENTS_README.md`

---

## Credentials Reference

Outpost uses the SOC server credentials (same as Swords of Chaos):
```
AWS_ACCESS_KEY_ID: [In richie profile preferences]
AWS_SECRET_ACCESS_KEY: [In richie profile preferences]
```

**Security:** Credentials are in operator preferences, never in repos or journals.

---

## Version

**Outpost v1.2** — Four-agent fleet with invocation constraints

### Changelog
- v1.0: Initial release (3 agents: Claude, Codex, Gemini)
- v1.1: Added Aider with DeepSeek Coder backend
- v1.2: Added explicit invocation constraints, error documentation, guard file

---

*This interface is stable. Breaking changes will increment major version.*
*Agents MUST read this document before invoking Outpost.*
