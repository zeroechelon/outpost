# Outpost

**Headless Claude Code Executor** - Dispatch coding tasks from Claude UI to a remote server running Claude Code CLI.

## Overview

Outpost enables Claude UI sessions to delegate complex coding tasks to a remote server where Claude Code runs with full filesystem access. Results are captured and returned for review, creating an agentic coding loop that bridges conversational AI with hands-on code execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE UI SESSION                          │
│  (Conversation with Claude in browser/app)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          │ 1. Dispatch Task (SSM SendCommand)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPOST SERVER                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ~/claude-executor/                                     │   │
│  │  ├── dispatch.sh        # Entry point                   │   │
│  │  ├── runs/              # Output capture                │   │
│  │  │   └── {run-id}/                                      │   │
│  │  │       ├── task.md    # Input prompt                  │   │
│  │  │       ├── output.log # Claude Code stdout/stderr     │   │
│  │  │       ├── summary.json # Structured result           │   │
│  │  │       └── diff.patch # Git changes (if any)          │   │
│  │  └── repos/             # Working copies                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          │ 2. Return Results (SSM GetCommandInvocation)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE UI SESSION                          │
│  - Review output and diffs                                      │
│  - Iterate or approve changes                                   │
│  - Push to GitHub when ready                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Requirements

- AWS account with SSM-enabled EC2/Lightsail instance
- Claude Pro or Max subscription (for Claude Code CLI)
- Node.js 20+ on the server
- GitHub PAT for repo access

## Installation

### 1. Install Claude Code on Server

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Authenticate (Token Transfer)

On your local machine with a browser:
```bash
claude
# Complete /login in browser
# Exit Claude Code
```

Extract token (macOS):
```bash
security find-generic-password -s "Claude Code-credentials" -w
```

Create on server:
```bash
mkdir -p ~/.claude
echo '<token-json>' > ~/.claude/.credentials.json
chmod 600 ~/.claude/.credentials.json
```

### 3. Deploy Scripts

```bash
mkdir -p ~/claude-executor/{runs,repos,scripts}
# Copy dispatch.sh to ~/claude-executor/
chmod +x ~/claude-executor/dispatch.sh
```

### 4. Configure Git

```bash
git config --global credential.helper store
echo "https://<username>:<PAT>@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials
```

## Usage

### Dispatch a Task

```bash
~/claude-executor/dispatch.sh <repo-name> <task description>
```

Example:
```bash
~/claude-executor/dispatch.sh swords-of-chaos-reborn "Fix the combat damage calculation in combat.js"
```

### Output

Each run creates a directory in `~/claude-executor/runs/<run-id>/`:

| File | Contents |
|------|----------|
| `task.md` | Original task description |
| `output.log` | Claude Code stdout/stderr |
| `summary.json` | Structured run metadata |
| `diff.patch` | Git diff of changes (if any) |

### Run Summary Format

```json
{
  "run_id": "20260102-205023-cs429e",
  "repo": "swords-of-chaos-reborn",
  "completed": "2026-01-02T20:50:35+00:00",
  "status": "success",
  "exit_code": 0,
  "before_sha": "78fec328...",
  "after_sha": "78fec328...",
  "changes": "none|uncommitted|committed"
}
```

## Current Deployment

- **Server:** SOC Server (52.44.78.2)
- **SSM Instance:** mi-0d77bfe39f630bd5c
- **Executor Path:** /home/ubuntu/claude-executor/
- **Auth:** Max subscription via token transfer

## zeOS Integration

Outpost runs ON zeOS as an application. Boot sequence:

```
1. Read kernel/SOUL.md from zeOS repo
2. Read profiles/richie/MISSION.md
3. Read apps/outpost/OUTPOST_SOUL.md
4. Load latest session journal
5. Output Resume Card
```

## License

MIT
