# Outpost Interface Specification v1.5

> **v1.5 Features:** Context injection system for continuity-aware agent execution

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

## Context Injection (v1.5.0 — NEW)

Context injection prepends zeOS knowledge (SOUL, profile, journals) to agent tasks, enabling continuity-aware execution.

### Usage

```bash
# Without context (default - OFF)
dispatch-unified.sh <repo> "<task>" --executor=claude

# With context (standard level)
dispatch-unified.sh <repo> "<task>" --executor=claude --context

# Specific level
dispatch-unified.sh <repo> "<task>" --executor=claude --context=minimal
dispatch-unified.sh <repo> "<task>" --executor=claude --context=standard
dispatch-unified.sh <repo> "<task>" --executor=claude --context=full

# Custom token budget
dispatch-unified.sh <repo> "<task>" --executor=claude --context=1400
```

### Context Levels

| Level | Token Budget | Sections Included |
|-------|--------------|-------------------|
| `minimal` | ~600 | SOUL, JOURNAL |
| `standard` | ~1200 | SOUL, ANCHORS, PROFILE, JOURNAL |
| `full` | ~1800 | All sections including ROADMAP |
| `<number>` | 600-2000 | Custom budget |

### Sections

| Section | Purpose | When Included |
|---------|---------|---------------|
| **SOUL** | Project identity and constraints | Always (never dropped) |
| **ANCHORS** | Long-lived decisions (never summarized) | Standard+ |
| **PROFILE** | Operator preferences | Standard+ |
| **JOURNAL** | Recent session state | Minimal+ (summarized if stale) |
| **ROADMAP** | Current phase | Full only |

### SSM Example with Context

```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh swords-of-chaos-reborn \"Add PARTY command for group combat\" --executor=claude --context=standard"]' \
  --query 'Command.CommandId' \
  --output text
```

### Context Logging

Each run with context generates `context.json` with provenance:

```json
{
  "injection_id": "INJ-20260103-183000-a1b2c3",
  "level": "standard",
  "sections": ["soul", "anchors", "profile", "journal"],
  "token_counts": { "total": 850 },
  "provenance": {
    "soul": "apps/swords-of-chaos/SOC_SOUL.md",
    "journal": "session-journals/2026-01-03-session.md"
  }
}
```

### When to Use Context

| Scenario | Recommendation |
|----------|----------------|
| Simple fix, known repo | No context needed |
| New feature, needs project understanding | `--context=standard` |
| Complex refactor, strategic work | `--context=full` |
| Quick query to all agents | No context (faster) |

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

## v1.5 Improvements

| Feature | Description |
|---------|-------------|
| **Context Injection** | Prepend zeOS context to tasks for continuity |
| **ANCHORS Section** | Long-lived decisions protected from summarization |
| **Provenance Logging** | Track exactly which files contributed to context |
| **Security Scrubbing** | 15+ patterns for credential redaction |
| **Deterministic Summarization** | Predictable journal trimming when stale |

---

## Response Format

Each agent creates a run directory with:
```
runs/<run-id>/
├── task.md          # Original task (or enhanced with context)
├── output.log       # Agent stdout/stderr
├── summary.json     # Metadata (includes status:running at start)
├── diff.patch       # Git changes (if any)
├── context.json     # Context injection metadata (if --context used)
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
  "workspace": "/home/ubuntu/claude-executor/runs/.../workspace",
  "context_injection_id": "INJ-20260103-001234-abc123"
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
| `Context assembly failed` | SOUL file not found | Ensure repo has proper zeOS structure |

---

## Server Details

- **Host:** SOC (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Region:** us-east-1
- **Executor Path:** `/home/ubuntu/claude-executor/`
- **Environment:** `/home/ubuntu/claude-executor/.env`

---

## Version

**Outpost v1.5.0** — Context injection system

### Changelog
- v1.0: Initial release (3 agents: Claude, Codex, Gemini)
- v1.1: Added Aider with DeepSeek Coder backend
- v1.2: Added explicit invocation constraints, error documentation
- v1.3: Workspace isolation for true parallelism
- v1.4: Security hardening, timeout, race-safe caching, dynamic branches
- v1.5: **Context injection system** (--context flag, ANCHORS section, provenance logging)

---

*This interface is stable. Breaking changes will increment major version.*
*Agents MUST read this document before invoking Outpost.*
