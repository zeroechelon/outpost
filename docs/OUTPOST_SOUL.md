# OUTPOST_SOUL.md
## Identity & Purpose

**Outpost** is a headless Claude Code executor that enables Claude UI sessions to dispatch coding tasks to a remote server. It bridges conversational AI with hands-on code execution, creating an agentic coding loop.

## Core Capability

Outpost solves the "UI Claude can't edit files" limitation by delegating to Claude Code CLI running on infrastructure you control.

```
Claude UI → SSM → Outpost Server → Claude Code CLI → Results → Claude UI
```

## Current Deployment

| Component | Value |
|-----------|-------|
| Server | SOC Server (52.44.78.2) |
| SSM Instance | mi-0d77bfe39f630bd5c |
| Executor Path | /home/ubuntu/claude-executor/ |
| Auth | Max subscription (token transfer) |
| Claude Code | v2.0.76 |

## Scripts

| Script | Purpose |
|--------|---------|
| `dispatch.sh` | Execute a coding task against a repo |
| `get-results.sh` | Retrieve run outputs |
| `push-changes.sh` | Commit and push changes |
| `list-runs.sh` | List recent runs |

## Dispatch Pattern

From Claude UI, execute via SSM:

```bash
# Dispatch
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch.sh <repo> <task>

# Get results
sudo -u ubuntu /home/ubuntu/claude-executor/scripts/get-results.sh <run-id> all

# Push when approved
sudo -u ubuntu /home/ubuntu/claude-executor/scripts/push-changes.sh <repo> "commit message"
```

## Run Artifacts

Each run creates `/home/ubuntu/claude-executor/runs/<run-id>/`:

- `task.md` - Original task
- `output.log` - Claude Code output
- `summary.json` - Run metadata (status, SHA, changes)
- `diff.patch` - Git diff if changes exist

## MANDATORY BOOT SEQUENCE

When loading an Outpost session:

1. Read this file (OUTPOST_SOUL.md)
2. Read README.md from outpost repo
3. Read latest session-journals/*.md
4. Verify server connectivity via SSM
5. Output Resume Card

## Resume Card Format

```
═══════════════════════════════════════════════════════════════
OUTPOST SESSION LOADED
═══════════════════════════════════════════════════════════════
Agent: Claude (Persistence Executor)
Profile: richie
Application: Outpost

Purpose: Headless Claude Code executor for remote task dispatch
Server: SOC (52.44.78.2) via SSM
Auth: Max subscription
Last Run: [ID and status from most recent run]
═══════════════════════════════════════════════════════════════
Commands: dispatch, get-results, push-changes, list-runs
Ready for Outpost directives.
```

## Integration Points

- **zeOS**: Runs as application on zeOS
- **SOC Server**: Primary deployment target (dev environment)
- **GitHub**: All repos accessible via PAT
- **AWS SSM**: Control plane for dispatch/results

## Security Model

- Claude Code uses subscription auth (no API key stored)
- Git credentials stored with 600 permissions
- Runs isolated in timestamped directories
- Review-before-push workflow protects main branch

## Future Enhancements

1. S3 output storage for large results
2. SNS notifications for long-running tasks
3. Multi-server support (beyond SOC)
4. Branch workflow (feature branches, not just main)
5. Parallel task execution
