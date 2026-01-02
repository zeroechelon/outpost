# Outpost: Multi-Agent Integration Guide

## Executive Summary

Outpost is a multi-agent headless executor system that enables Claude UI to dispatch coding tasks to remote servers running multiple AI coding agents in parallel.

**Fleet Status:** OPERATIONAL (3/3 agents)

| Agent | Model | Status | Auth Method |
|-------|-------|--------|-------------|
| Claude Code | claude-sonnet-4 | ✅ Active | Claude Max subscription |
| OpenAI Codex | gpt-5.2-codex | ✅ Active | ChatGPT Plus subscription |
| Gemini CLI | gemini-2.5-pro | ✅ Active | Google AI Ultra subscription |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│              CLAUDE UI (Orchestrator)                             │
│              "The Commander"                                      │
└───────────┬─────────────────┬─────────────────┬───────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │ dispatch.sh   │ │ dispatch-     │ │ dispatch-     │
    │ (Claude Code) │ │ codex.sh      │ │ gemini.sh     │
    │               │ │ (OpenAI)      │ │ (Google)      │
    └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
            │                 │                 │
            ▼                 ▼                 ▼
    ┌─────────────────────────────────────────────────────┐
    │              SHARED INFRASTRUCTURE                  │
    │  - repos/          (cloned repositories)            │
    │  - runs/           (execution artifacts)            │
    │  - Git credentials (GitHub PAT)                     │
    └─────────────────────────────────────────────────────┘
```

---

## Agent Comparison

| Aspect | Claude Code | OpenAI Codex | Gemini CLI |
|--------|-------------|--------------|------------|
| Install | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` | `npm i -g @google/gemini-cli` |
| Version | 2.0.76 | 0.77.0 | 0.22.5 |
| Subscription | Claude Pro/Max ($100) | ChatGPT Plus ($20) | Google AI Ultra (~$50) |
| Headless | `claude -p "task"` | `codex exec "task"` | `gemini -p "task"` |
| Auto-approve | `--dangerously-skip-permissions` | `--full-auto --sandbox workspace-write` | `--yolo` |
| Config Dir | `~/.claude/` | `~/.codex/` | `~/.gemini/` |
| Credentials | `.credentials.json` | `auth.json` | `oauth_creds.json` |
| **Total Cost** | **$170/mo** for all three | | |

---

## Dispatcher Scripts

### dispatch.sh (Claude Code)
```bash
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch.sh <repo> "<task>"
```

### dispatch-codex.sh (OpenAI Codex)
```bash
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-codex.sh <repo> "<task>"
```

### dispatch-gemini.sh (Gemini CLI)
```bash
sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-gemini.sh <repo> "<task>"
```

---

## Run Artifacts

Each execution creates a run directory:

```
~/claude-executor/runs/<run-id>/
├── task.md          # Original task description
├── output.log       # Agent stdout/stderr
├── summary.json     # Metadata (executor, status, sha, changes)
└── diff.patch       # Git changes (if any)
```

**Run ID Format:**
- Claude Code: `YYYYMMDD-HHMMSS-<random>`
- OpenAI Codex: `YYYYMMDD-HHMMSS-codex-<random>`
- Gemini CLI: `YYYYMMDD-HHMMSS-gemini-<random>`

---

## Authentication

### Token Transfer Pattern

All three agents use OAuth with subscription tiers, avoiding API charges:

1. **Login on Mac** (interactive, one-time)
2. **Extract credentials** from local storage
3. **Transfer to server** via base64-encoded files
4. **Headless execution** uses cached credentials

### Credential Locations

| Agent | macOS | Linux |
|-------|-------|-------|
| Claude Code | Keychain (`security find-generic-password`) | `~/.claude/.credentials.json` |
| OpenAI Codex | `~/.codex/auth.json` | `~/.codex/auth.json` |
| Gemini CLI | `~/.gemini/oauth_creds.json` | `~/.gemini/oauth_creds.json` |

---

## Usage Examples

### Single Agent
```bash
# Via SSM from Claude UI
aws ssm send-command \
  --instance-ids "mi-0d77bfe39f630bd5c" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo -u ubuntu /home/ubuntu/claude-executor/dispatch-gemini.sh swords-of-chaos-reborn \"Count JS files\""]'
```

### Parallel Execution (All Agents)
```bash
# Dispatch same task to all three agents simultaneously
for script in dispatch.sh dispatch-codex.sh dispatch-gemini.sh; do
  aws ssm send-command ... "$script repo \"task\"" &
done
wait
```

### Get Results
```bash
sudo -u ubuntu /home/ubuntu/claude-executor/scripts/get-results.sh <run-id> all
```

---

## Cost Model

| Service | Monthly | Annual | Notes |
|---------|---------|--------|-------|
| Claude Max | $100 | $1,200 | Unlimited Claude Code |
| ChatGPT Plus | $20 | $240 | Unlimited Codex CLI |
| Google AI Ultra | ~$50 | ~$600 | Highest Gemini limits |
| **Total** | **$170** | **$2,040** | Three AI executors |

No per-token API charges - all use subscription-based auth.

---

## Multi-Agent Use Cases

1. **Comparison** - Same task to multiple agents, compare approaches
2. **Consensus** - Multiple agents agree = high confidence
3. **Parallel execution** - Race for fastest solution
4. **Specialization** - Route tasks to best-fit agent
5. **Fallback** - Redundancy if one rate-limits
6. **Cost optimization** - Use cheapest capable agent

---

## Server Configuration

**Server:** SOC (52.44.78.2)
**SSM Instance:** mi-0d77bfe39f630bd5c
**Region:** us-east-1

```
/home/ubuntu/claude-executor/
├── dispatch.sh          # Claude Code
├── dispatch-codex.sh    # OpenAI Codex
├── dispatch-gemini.sh   # Gemini CLI
├── repos/               # Cloned repositories
├── runs/                # Execution artifacts
└── scripts/             # Helper scripts

/home/ubuntu/.claude/.credentials.json   # Claude Code auth
/home/ubuntu/.codex/auth.json            # OpenAI Codex auth
/home/ubuntu/.gemini/oauth_creds.json    # Gemini CLI auth
```

---

## Future Enhancements

- [ ] Unified dispatcher with `--executor` flag (claude|codex|gemini|all)
- [ ] Parallel execution mode (`--executor all`)
- [ ] Result comparison tooling
- [ ] Agent routing based on task type
- [ ] S3 storage for large outputs (SSM has 24KB limit)
- [ ] SNS notifications for long-running tasks
- [ ] Token refresh automation (cron)
- [ ] Dashboard for multi-agent runs
- [ ] Conductor integration for Gemini context persistence

---

## Quick Reference

```bash
# Claude Code (subscription auth)
claude --dangerously-skip-permissions -p "task"

# OpenAI Codex (subscription auth)
codex exec --full-auto --sandbox workspace-write "task"

# Gemini CLI (subscription auth)
gemini --yolo -p "task"
```
