# Outpost Interface Specification v1.1

> **Cross-Project API Contract for Multi-Agent Dispatch**

This document enables any zeOS Claude session to invoke Outpost's multi-agent fleet.

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
# Wait 3-5 seconds, then:
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

## List Recent Runs

```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/scripts/list-runs.sh"]' \
  --query 'Command.CommandId' \
  --output text
```

---

## Integration Example (Geaux File → Outpost)

```python
# In a Geaux File session, Claude can:

# 1. Ask all 4 agents the same question
task = "Review the customer onboarding flow and suggest improvements"
repo = "geauxfile-website"

# 2. Dispatch to all
aws ssm send-command ... --executor=all

# 3. Collect results from each agent
# 4. Synthesize into unified recommendation
```

---

## Server Details

- **Host:** SOC (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Region:** us-east-1
- **Executor Path:** `/home/ubuntu/claude-executor/`

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

**Outpost v1.1** — Four-agent fleet for multi-model orchestration

### Changelog
- v1.0: Initial release (3 agents: Claude, Codex, Gemini)
- v1.1: Added Aider with DeepSeek Coder backend

---

*This interface is stable. Breaking changes will increment major version.*
