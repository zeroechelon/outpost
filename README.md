# Outpost

**Multi-Agent Headless Executor System v1.4**

Outpost enables Claude UI sessions to dispatch coding tasks to remote servers running multiple AI coding agents in parallel.

## Fleet Status

| Agent | Model | Status | Dispatcher |
|-------|-------|--------|------------|
| Claude Code | claude-opus-4-5-20251101 | ✅ Active | `dispatch.sh` |
| OpenAI Codex | gpt-5.2-codex | ✅ Active | `dispatch-codex.sh` |
| Gemini CLI | gemini-3-pro-preview | ✅ Active | `dispatch-gemini.sh` |
| Aider | deepseek/deepseek-coder | ✅ Active | `dispatch-aider.sh` |

**Subscription Total:** $170/mo (Claude Max + ChatGPT Plus + Gemini AI Ultra)  
**API Agent:** Aider uses DeepSeek API (~$0.14/MTok)

## Architecture

```
Claude UI (Orchestrator) → AWS SSM SendCommand
    │
    └─→ dispatch-unified.sh
         │
         ├─→ dispatch.sh       (Claude Code)
         ├─→ dispatch-codex.sh (OpenAI Codex)
         ├─→ dispatch-gemini.sh(Gemini CLI)
         └─→ dispatch-aider.sh (Aider)
              │
              └─→ Isolated workspace per agent
```

## Quick Start

### Single Agent
```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <repo> \"<task>\" --executor=claude"]'
```

### All Agents (Parallel)
```bash
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-unified.sh <repo> \"<task>\" --executor=all"]'
```

## v1.4 Features

- **Security:** GitHub token from environment (no hardcoding)
- **Timeout Protection:** 10-minute default agent timeout
- **Race-Safe:** flock prevents cache corruption on parallel dispatch
- **Dynamic Branches:** Auto-detects default branch (main/master/etc)
- **Running Status:** Immediate status:running in summary.json
- **Workspace Promotion:** `promote-workspace.sh` for pushing changes

## Helper Scripts

| Script | Purpose |
|--------|---------|
| `scripts/list-runs.sh` | List recent runs with status |
| `scripts/get-results.sh` | Retrieve run artifacts |
| `scripts/promote-workspace.sh` | Push workspace changes to origin |

## Documentation

- [OUTPOST_INTERFACE.md](OUTPOST_INTERFACE.md) - Full API specification
- [docs/MULTI_AGENT_INTEGRATION.md](docs/MULTI_AGENT_INTEGRATION.md) - Integration guide

## Server Details

- **Host:** SOC (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Executor Path:** `/home/ubuntu/claude-executor/`

---

*Outpost v1.4 - Multi-Agent Headless Executor*
